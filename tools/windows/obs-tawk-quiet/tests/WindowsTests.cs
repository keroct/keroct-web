using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Security.Principal;
using Keroct.Quiet;

class WindowsTests {
    static string fixture, obsFile, root, configPath, monitorFile;
    static Process tawk, obs, monitor, other;
    static void Check(bool ok,string label) { if(!ok)throw new Exception(label); Console.WriteLine("PASS: "+label); }
    static Process Launch(string file,string arguments) { return Process.Start(new ProcessStartInfo(file,arguments){UseShellExecute=false,CreateNoWindow=true}); }
    static void Stop(Process p) { if(p!=null){try{if(!p.HasExited){p.Kill();p.WaitForExit(5000);}}finally{p.Dispose();}} }
    static AudioSnapshot Snapshot() {
        var targets=new Dictionary<int,TargetProcess>();
        if(tawk!=null && !tawk.HasExited)targets[tawk.Id]=TargetProcess.Read(tawk.Id);
        return Audio.Scan(targets);
    }
    static bool MuteIs(bool mute) {
        using(var s=Snapshot())return s.Complete && s.Sessions.Count>0 && s.Sessions.All(x=>x.Muted==mute);
    }
    static bool OtherUnmuted() {
        var targets=new Dictionary<int,TargetProcess>();targets[other.Id]=TargetProcess.Read(other.Id);
        using(var s=Audio.Scan(targets))return s.Complete&&s.Sessions.Count>0&&s.Sessions.All(x=>!x.Muted);
    }
    static void Wait(Func<bool> done,string label) {
        for(int i=0;i<100;i++){if(done()){Check(true,label);return;}Thread.Sleep(100);}
        throw new Exception("Timeout: "+label);
    }
    static void StartMonitor() {monitor=Launch(monitorFile,"--monitor \""+configPath+"\"");}
    static void StopMonitor() {
        using(var cli=Launch(Path.Combine(Path.GetDirectoryName(monitorFile),"Keroct.Quiet.Cli.exe"),"--stop \""+configPath+"\"")) {
            Check(cli.WaitForExit(20000)&&cli.ExitCode==0,"cooperative stop exits");
        }
        Check(monitor.WaitForExit(5000),"monitor exits"); monitor.Dispose();monitor=null;
    }
    [MTAThread] static int Main(string[] args) {
        root=Path.GetFullPath(args[0]);fixture=Path.Combine(root,"tawk.to.exe");obsFile=Path.Combine(root,"obs64.exe");
        monitorFile=Path.Combine(root,"Keroct.Quiet.exe");configPath=Path.Combine(root,"config.json");
        if(Process.GetProcessesByName("obs64").Length!=0) {Console.Error.WriteLine("Real OBS is running; isolated Windows tests require it closed.");return 2;}
        Files.Write(configPath,new Config{InstallId=Guid.NewGuid().ToString(),OwnerSid=WindowsIdentity.GetCurrent().User.Value,TawkPaths=new[]{fixture},PollMilliseconds=1000});
        try {
            tawk=Launch(fixture,""); Wait(()=>{using(var s=Snapshot())return s.Complete&&s.Sessions.Count>0;},"native target session detected");
            using(var s=Snapshot())foreach(var session in s.Sessions)session.SetMute(false);
            Check(MuteIs(false),"fixture baseline set to unmuted");
            other=Launch(Path.Combine(root,"other-app.exe"),"");Wait(OtherUnmuted,"unrelated fixture session detected");
            StartMonitor();Thread.Sleep(700);Check(MuteIs(false),"idle monitor leaves tawk alone");
            obs=Launch(obsFile,"--obs");Wait(()=>MuteIs(true),"OBS process -> target session mute");
            Check(OtherUnmuted(),"unrelated audio session remains unmuted");
            monitor.Refresh();var cpuBefore=monitor.TotalProcessorTime;var wall=Stopwatch.StartNew();Thread.Sleep(5000);monitor.Refresh();
            Console.WriteLine("MEASURE: monitor CPU ms="+(monitor.TotalProcessorTime-cpuBefore).TotalMilliseconds+" over wall ms="+wall.ElapsedMilliseconds);
            Stop(obs);obs=null;Wait(()=>MuteIs(false),"OBS process disappearance -> baseline restoration");
            using(var s=Snapshot())foreach(var session in s.Sessions)session.SetMute(true);
            obs=Launch(obsFile,"--obs");Thread.Sleep(1100);Stop(obs);obs=null;Thread.Sleep(1100);
            Check(MuteIs(true),"original native mute maintained");
            using(var s=Snapshot())foreach(var session in s.Sessions)session.SetMute(false);
            Stop(tawk);tawk=null;obs=Launch(obsFile,"--obs");Thread.Sleep(1000);
            tawk=Launch(fixture,"");Wait(()=>MuteIs(true),"late target arrival during OBS");
            Stop(tawk);tawk=null;Thread.Sleep(1100);tawk=Launch(fixture,"");Wait(()=>MuteIs(true),"target restart gets muted");
            Stop(obs);obs=null;Wait(()=>MuteIs(false),"restarted target baseline restored");
            obs=Launch(obsFile,"--obs");Wait(()=>MuteIs(true),"mute before cooperative shutdown");
            StopMonitor();Wait(()=>MuteIs(false),"utility shutdown restores while OBS still running");
            StartMonitor();Wait(()=>MuteIs(true),"second monitor run muted");
            Stop(monitor);monitor=null;Stop(obs);obs=null;StartMonitor();Thread.Sleep(1100);
            Check(MuteIs(true),"monitor crash/restart preserves mute conservatively");StopMonitor();
            return 0;
        } catch(Exception ex){Console.Error.WriteLine(ex);return 1;}
        finally{Stop(obs);Stop(monitor);Stop(tawk);Stop(other);}
    }
}
