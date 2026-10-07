using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Keroct.Quiet {
    public sealed class ProcessEntry { public int Pid; public string Name; }
    public static class ProcessList {
        [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry {
            public uint Size,Usage,Pid;public UIntPtr Heap;public uint Module,Threads,Parent;public int Priority;public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string Exe;
        }
        [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
        [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool Process32First(IntPtr snapshot,ref Entry entry);
        [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool Process32Next(IntPtr snapshot,ref Entry entry);
        [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll",SetLastError=true)]static extern bool ProcessIdToSessionId(int pid,out int session);
        public static List<ProcessEntry> Read() {
            var list=new List<ProcessEntry>();var snapshot=CreateToolhelp32Snapshot(2,0);
            if(snapshot==new IntPtr(-1))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try {
                var entry=new Entry {Size=(uint)Marshal.SizeOf(typeof(Entry))};
                if(!Process32First(snapshot,ref entry))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                do{list.Add(new ProcessEntry{Pid=(int)entry.Pid,Name=entry.Exe});}while(Process32Next(snapshot,ref entry));
                int error=Marshal.GetLastWin32Error();if(error!=18)throw new System.ComponentModel.Win32Exception(error);
                return list;
            }finally{CloseHandle(snapshot);}
        }
        public static bool Obs(IEnumerable<ProcessEntry> entries) {
            int current=Process.GetCurrentProcess().SessionId;
            foreach(var p in entries)if(String.Equals(p.Name,"obs64.exe",StringComparison.OrdinalIgnoreCase)) {
                int session;if(ProcessIdToSessionId(p.Pid,out session)&&session==current)return true;
            }
            return false;
        }
    }
}
