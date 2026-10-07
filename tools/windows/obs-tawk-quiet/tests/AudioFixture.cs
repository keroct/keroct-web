using System;
using System.Runtime.InteropServices;
using System.Threading;

// Silent PCM stream, used only in explicitly invoked integration tests.
class AudioFixture {
    [StructLayout(LayoutKind.Sequential, Pack=2)] struct Format {
        public ushort Tag,Channels; public uint Rate,BytesPerSecond; public ushort Align,Bits,Extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct Header {
        public IntPtr Data; public uint Length,Recorded; public IntPtr User; public uint Flags,Loops;
        public IntPtr Next,Reserved;
    }
    [DllImport("winmm.dll")] static extern uint waveOutOpen(out IntPtr handle, uint device, ref Format format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
    static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--obs") { Thread.Sleep(120000); return 0; }
        var format=new Format {Tag=1,Channels=1,Rate=8000,BytesPerSecond=16000,Align=2,Bits=16};
        IntPtr handle;
        if (waveOutOpen(out handle,UInt32.MaxValue,ref format,IntPtr.Zero,IntPtr.Zero,0)!=0) return 2;
        IntPtr data=Marshal.AllocHGlobal(16000); Marshal.Copy(new byte[16000],0,data,16000);
        var header=new Header {Data=data,Length=16000,Flags=12,Loops=UInt32.MaxValue};
        var pointer=Marshal.AllocHGlobal(Marshal.SizeOf(header)); Marshal.StructureToPtr(header,pointer,false);
        uint size=(uint)Marshal.SizeOf(header);
        if (waveOutPrepareHeader(handle,pointer,size)!=0 || waveOutWrite(handle,pointer,size)!=0) return 3;
        Thread.Sleep(120000); return 0;
    }
}
