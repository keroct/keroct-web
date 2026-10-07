using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Keroct.Quiet {
    public sealed class TargetProcess {
        public int Pid; public long StartTicks; public string Path;
        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref int length);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool ProcessIdToSessionId(int pid, out int session);
        public static TargetProcess Read(int pid) {
            int session;
            if (!ProcessIdToSessionId(pid,out session)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            if (session != Process.GetCurrentProcess().SessionId) return null;
            var handle=OpenProcess(0x1000,false,pid); // query-only, never termination rights
            if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try {
                var path=new StringBuilder(32768);int length=path.Capacity;long created,exited,kernel,user;
                if(!QueryFullProcessImageName(handle,0,path,ref length)||!GetProcessTimes(handle,out created,out exited,out kernel,out user))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                return new TargetProcess {Pid=pid,StartTicks=DateTime.FromFileTimeUtc(created).Ticks,Path=System.IO.Path.GetFullPath(path.ToString())};
            } finally {CloseHandle(handle);}
        }
        public bool StillSame() {
            try { var now = Read(Pid); return now != null && StartTicks == now.StartTicks &&
                String.Equals(Path, now.Path, StringComparison.OrdinalIgnoreCase); } catch { return false; }
        }
    }
    public sealed class AudioSnapshot : IDisposable {
        public readonly List<ISession> Sessions = new List<ISession>();
        public readonly List<string> Errors = new List<string>();
        public bool Complete { get { return Errors.Count == 0; } }
        public void Dispose() { foreach (NativeSession s in Sessions) s.Dispose(); }
    }
    public sealed class NativeSession : ISession, IDisposable {
        readonly IAudioSessionControl2 control;
        readonly ISimpleAudioVolume volume;
        readonly TargetProcess process;
        readonly string instance;
        static readonly Guid Context = new Guid("ee5c6572-75ef-4e7a-8d0d-7d023de73c8b");
        public string Key { get; private set; }
        public string Family { get; private set; }
        public int Pid { get { return process.Pid; } }
        public NativeSession(IAudioSessionControl2 control, TargetProcess process, string endpoint, string instance) {
            this.control = control; this.volume = (ISimpleAudioVolume)control; this.process = process; this.instance = instance;
            Key = endpoint + "|" + instance + "|" + process.Pid + "|" + process.StartTicks + "|" + process.Path;
            Family = endpoint + "|" + process.Path.ToUpperInvariant();
        }
        public bool Muted { get { bool value; Check(volume.GetMute(out value)); return value; } }
        public void SetMute(bool muted) {
            string current; uint pid;
            Check(control.GetSessionInstanceIdentifier(out current));
            // S_FALSE-like success AUDCLNT_S_NO_SINGLE_PROCESS is deliberately rejected.
            if (control.GetProcessId(out pid) != 0 || pid != process.Pid || current != instance || !process.StillSame())
                throw new InvalidOperationException("Target identity changed; session left untouched.");
            var context = Context; Check(volume.SetMute(muted, ref context));
        }
        public void Dispose() { Marshal.ReleaseComObject(control); }
        internal static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
    }
    public static class Audio {
        static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
        public static AudioSnapshot Scan(IDictionary<int, TargetProcess> targets) {
            var result = new AudioSnapshot(); IMMDeviceEnumerator enumerator = null; IMMDeviceCollection devices = null;
            if (targets.Count == 0) return result;
            try {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                NativeSession.Check(enumerator.EnumAudioEndpoints(0, 1, out devices)); // render, active: every output device
                uint count; NativeSession.Check(devices.GetCount(out count));
                for (uint d = 0; d < count; d++) {
                    IMMDevice device = null; object managerObject = null; IAudioSessionEnumerator sessions = null;
                    try {
                        NativeSession.Check(devices.Item(d, out device)); string endpoint; NativeSession.Check(device.GetId(out endpoint));
                        var iid = typeof(IAudioSessionManager2).GUID;
                        NativeSession.Check(device.Activate(ref iid, 23, IntPtr.Zero, out managerObject));
                        NativeSession.Check(((IAudioSessionManager2)managerObject).GetSessionEnumerator(out sessions));
                        int sessionCount; NativeSession.Check(sessions.GetCount(out sessionCount));
                        for (int i = 0; i < sessionCount; i++) {
                            IAudioSessionControl2 control = null;
                            try {
                                NativeSession.Check(sessions.GetSession(i, out control)); uint pid;
                                int processResult = control.GetProcessId(out pid);
                                NativeSession.Check(processResult);
                                if (processResult != 0) continue; // AUDCLNT_S_NO_SINGLE_PROCESS: intentionally unsupported.
                                int systemSoundsResult = control.IsSystemSoundsSession();
                                NativeSession.Check(systemSoundsResult);
                                if (systemSoundsResult == 0) continue;
                                TargetProcess target; if (!targets.TryGetValue((int)pid, out target)) continue;
                                int state; NativeSession.Check(control.GetState(out state)); if (state == 2) continue; // expired
                                string instance; NativeSession.Check(control.GetSessionInstanceIdentifier(out instance));
                                var session = new NativeSession(control, target, endpoint, instance);
                                bool mute = session.Muted; // Validate interface and access before transferring ownership.
                                result.Sessions.Add(session); control = null;
                            } catch (Exception ex) { result.Errors.Add("session: " + ex.Message); }
                            finally { Release(control); }
                        }
                    } catch (Exception ex) { result.Errors.Add("endpoint: " + ex.Message); }
                    finally { Release(sessions); Release(managerObject); Release(device); }
                }
            } catch (Exception ex) { result.Errors.Add("audio: " + ex.Message); }
            finally { Release(devices); Release(enumerator); }
            return result;
        }
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint clsctx, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 {
        [PreserveSig] int GetAudioSessionControl(ref Guid guid, uint flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(ref Guid guid, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        [PreserveSig] int RegisterSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterSessionNotification(IntPtr client);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr client);
        [PreserveSig] int UnregisterDuckNotification(IntPtr client);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }
    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl2 {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context); // vtable only; never called
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
}
