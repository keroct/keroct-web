using System;
using System.Collections.Generic;
using System.Linq;
using Keroct.Quiet;

class Fake : ISession {
    public string Key { get; set; }
    public string Family { get; set; }
    public bool Muted { get; set; }
    public bool Fail;
    public List<bool> Writes = new List<bool>();
    public void SetMute(bool value) { if (Fail) throw new Exception("disconnected"); Muted = value; Writes.Add(value); }
}
class PolicyTests {
    static int count;
    static void Check(bool value, string label) { if (!value) throw new Exception(label); count++; }
    static Fake S(string key, bool mute) { return new Fake {Key=key,Family="tawk",Muted=mute}; }
    static int Main() { try { Run(); return 0; } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; } }
    static void Run() {
        var saved = new List<Ownership>();
        Action<List<Ownership>> persist = r => { saved = r.Select(x => new Ownership {Key=x.Key,Family=x.Family,OriginalMute=x.OriginalMute,CanRestore=x.CanRestore}).ToList(); };
        var p = new Policy(new List<Ownership>(),persist,false); var a = S("a",false);
        p.Step(false,new ISession[]{a},true); Check(a.Writes.Count==0,"idle leaves volume alone");
        p.Step(true,new ISession[]{a},true); Check(a.Muted && saved[0].OriginalMute==false,"unmute -> mute, journal baseline");
        p.Step(true,new ISession[]{a},true); Check(a.Writes.Count==1,"unchanged snapshot is not rewritten");
        p.Step(false,new ISession[]{a},true); Check(!a.Muted && saved.Count==0,"OBS exit restores unmute");
        a=S("a",true); p.Step(true,new ISession[]{a},true); p.Step(false,new ISession[]{a},true);
        Check(a.Muted && a.Writes.Count==0,"original mute preserved");
        p.Step(true,new ISession[0],true); a=S("late",false); p.Step(true,new ISession[]{a},true);
        Check(a.Muted,"late tawk arrival");
        var b=S("restart-new-pid-start",false); p.Step(true,new ISession[]{b},true);
        Check(b.Muted && p.Records.Count==1 && p.Records[0].Key==b.Key,"restart identity baseline replaced");
        var c=S("same-pid-new-instance",false); p.Step(true,new ISession[]{c},true);
        Check(c.Muted && p.Records[0].Key==c.Key,"session regeneration");
        a=S("endpoint1",false); b=S("endpoint2",true); p.Step(true,new ISession[]{a,b},true);
        p.Step(false,new ISession[]{a,b},true); Check(!a.Muted && b.Muted,"multiple sessions independent");
        a=S("gone",false); p.Step(true,new ISession[]{a},true); p.Step(false,new ISession[0],true);
        Check(p.Records.Count==0,"disappeared sessions discarded without writes");
        a=S("recover",false); p.Step(true,new ISession[]{a},true);
        var recovered=new Policy(saved,persist,true); recovered.Step(false,new ISession[]{a},true);
        Check(a.Muted,"crash recovery never guesses unmute");
        a=S("recover-obs",false); p.Step(true,new ISession[]{a},true);
        recovered=new Policy(saved,persist,true); recovered.Step(true,new ISession[]{a},true); recovered.Step(false,new ISession[]{a},true);
        Check(a.Muted,"restart while OBS running remains conservative");
        a=S("inherited-mute",true); p=new Policy(new List<Ownership>(),persist,false);
        p.Step(true,new ISession[]{a},true); p.Step(false,new ISession[]{a},true); Check(a.Muted,"new inherited mute never unmuted");
        a=S("failure",false); p=new Policy(new List<Ownership>(),r=>{throw new Exception("disk full");},false);
        p.Step(true,new ISession[]{a},true); Check(!a.Muted && p.Records.Count==0,"journal failure prevents mute");
        p=new Policy(new List<Ownership>(),persist,false); a=S("retry",false); p.Step(true,new ISession[]{a},true);
        a.Fail=true; p.Step(false,new ISession[]{a},true); Check(p.Records.Count==1,"failed restore retains ownership");
        a.Fail=false; p.Step(false,new ISession[]{a},true); Check(!a.Muted && p.Records.Count==0,"restore retry");
        a=S("partial",false); p.Step(true,new ISession[]{a},true); p.Step(false,new ISession[0],false);
        Check(p.Records.Count==1,"partial enumeration preserves ownership");
        p.Step(false,new ISession[]{a},true); Check(!a.Muted,"partial endpoint recovers original baseline");
        a=S("external-unmute",false); p.Step(true,new ISession[]{a},true); a.Muted=false;
        p.Step(true,new ISession[]{a},true); Check(a.Muted,"OBS protection reasserted");
        p.Step(false,new ISession[]{a},true); Check(!a.Muted,"external unmute does not change original baseline");
        // PID reuse is encoded into keys by the native adapter. A new identity must never inherit restoration.
        a=S("pid42-start1",false); p.Step(true,new ISession[]{a},true); b=S("pid42-start2",true);
        b.Family="unrelated-app"; p.Step(false,new ISession[]{b},true); Check(b.Muted,"PID reuse never restores unrelated identity");
        p=new Policy(new List<Ownership>(),persist,false); a=S("before-restart",false);
        p.Step(true,new ISession[]{a},true); p.Step(true,new ISession[0],true);
        b=S("after-restart",true); p.Step(true,new ISession[]{b},true);p.Step(false,new ISession[]{b},true);
        Check(!b.Muted,"persisted utility mute inherited across one-to-one restart restored");
        p=new Policy(new List<Ownership>(),persist,false); a=S("old1",false);b=S("old2",true);
        p.Step(true,new ISession[]{a,b},true); c=S("ambiguous",true);
        p.Step(true,new ISession[]{c},true);p.Step(false,new ISession[]{c},true);
        Check(c.Muted,"ambiguous multiple predecessor mute preserved");
        p=new Policy(new List<Ownership>(),persist,false); a=S("old-at-exit",false);
        p.Step(true,new ISession[]{a},true); b=S("new-at-exit",true);
        p.Step(false,new ISession[]{b},true);Check(!b.Muted,"replacement coincident with OBS exit restores baseline");
        Console.WriteLine("PASS: " + count + " policy assertions");
    }
}
