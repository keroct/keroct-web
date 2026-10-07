using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.Threading;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Keroct.Quiet {
    public sealed class Config {
        public string InstallId;
        public string OwnerSid;
        public string[] TawkPaths;
        public int PollMilliseconds = 1000;
    }
    public static class Files {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        public static T Read<T>(string path) { return Json.Deserialize<T>(File.ReadAllText(path)); }
        public static void Write(string path, object value) {
            var temp = path + ".tmp";
            File.WriteAllText(temp, Json.Serialize(value));
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        }
    }
    public static class Program {
        static string root;
        static Config config;
        static string Name(string kind) { return "Local\\KEROCT.ObsTawkQuiet." + config.OwnerSid + "." + config.InstallId + "." + kind; }
        static Config Load(string path) {
            var c = Files.Read<Config>(path);
            Guid id;
            if (!Guid.TryParse(c.InstallId, out id) || c.OwnerSid != WindowsIdentity.GetCurrent().User.Value ||
                c.PollMilliseconds < 500 || c.PollMilliseconds > 10000 || c.TawkPaths == null || c.TawkPaths.Length == 0)
                throw new InvalidDataException("Invalid configuration / owner.");
            foreach (string p in c.TawkPaths)
                if (!Path.IsPathRooted(p) || !p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(p, Path.GetFullPath(p), StringComparison.OrdinalIgnoreCase) ||
                    !Regex.IsMatch(Path.GetFileName(p), @"^tawk(\.to)?( desktop)?\.exe$", RegexOptions.IgnoreCase))
                    throw new InvalidDataException("Targets must be canonical absolute executable paths.");
            return c;
        }
        static Dictionary<int, TargetProcess> Targets(List<string> errors, List<ProcessEntry> entries) {
            var targets = new Dictionary<int, TargetProcess>();
            foreach (var name in config.TawkPaths.Select(Path.GetFileName).Distinct(StringComparer.OrdinalIgnoreCase)) {
                foreach (var p in entries.Where(p => String.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))) {
                    try {
                        var target = TargetProcess.Read(p.Pid);
                        if (target != null && config.TawkPaths.Contains(target.Path, StringComparer.OrdinalIgnoreCase)) targets[p.Pid] = target;
                    } catch (Exception ex) { errors.Add("process: " + ex.Message); }
                }
            }
            return targets;
        }
        static List<Ownership> Journal() {
            var path = Path.Combine(root, "journal.json");
            var records = File.Exists(path) ? Files.Read<List<Ownership>>(path) : new List<Ownership>();
            if (records == null || records.Any(r => r == null || String.IsNullOrEmpty(r.Key)) || records.Select(r => r.Key).Distinct().Count() != records.Count)
                throw new InvalidDataException("Invalid journal; no audio changes will be made.");
            return records;
        }
        static object Diagnose() {
            var errors = new List<string>(); var processes = ProcessList.Read(); var targets = Targets(errors, processes);
            using (var snapshot = Audio.Scan(targets)) {
                errors.AddRange(snapshot.Errors);
                var statePath = Path.Combine(root, "status.json");
                return new { ObsDetected = ProcessList.Obs(processes), TawkProcesses = targets.Values.ToArray(),
                    AudioSessions = snapshot.Sessions.Select(s => new { s.Key, s.Muted }).ToArray(),
                    OwnedSessions = Journal(), MonitorState = File.Exists(statePath) ? Files.Json.DeserializeObject(File.ReadAllText(statePath)) : null,
                    Errors = errors, ReadOnly = true };
            }
        }
        [MTAThread]
        public static int Main(string[] args) {
            try {
                if (args.Length != 2 || (args[0] != "--monitor" && args[0] != "--diagnose" && args[0] != "--stop"))
                    throw new ArgumentException("Usage: --monitor|--diagnose|--stop config.json");
                var configPath = Path.GetFullPath(args[1]); root = Path.GetDirectoryName(configPath); config = Load(configPath);
                if (args[0] == "--diagnose") { Console.WriteLine(Files.Json.Serialize(Diagnose())); return 0; }
                if (args[0] == "--stop") {
                    EventWaitHandle stop;
                    bool signalled = EventWaitHandle.TryOpenExisting(Name("stop"), out stop);
                    if (signalled) using (stop) stop.Set();
                    // Never terminate an arbitrary PID. Wait for this installation's exact named mutex.
                    using (var mutex = new Mutex(false, Name("monitor"))) {
                        try { if (!mutex.WaitOne(15000)) return 2; } catch (AbandonedMutexException) { }
                        try {
                            if (!signalled) {
                                // Crashed/stopped installation: conservatively retire stale journal entries.
                                var policy = new Policy(Journal(), records => Files.Write(Path.Combine(root,"journal.json"), records), true);
                                var errors = new List<string>(); var processes = ProcessList.Read(); var targets = Targets(errors, processes);
                                using (var snapshot = Audio.Scan(targets)) {
                                    policy.Step(false, snapshot.Sessions, snapshot.Complete && errors.Count == 0);
                                }
                                if (policy.Records.Count != 0) return 2;
                            }
                        } finally { mutex.ReleaseMutex(); }
                    }
                    return 0;
                }
                return Monitor();
            } catch (Exception ex) {
                Console.Error.WriteLine(ex.ToString());
                if (root != null && args.Length > 0 && args[0] == "--monitor") {
                    try { Files.Write(Path.Combine(root, "error.json"), new { Error = ex.ToString(), AtUtc = DateTime.UtcNow.ToString("o") }); } catch { }
                }
                return 1;
            }
        }
        static int Monitor() {
            using (var mutex = new Mutex(false, Name("monitor"))) {
                try { if (!mutex.WaitOne(0)) return 0; } catch (AbandonedMutexException) { }
                try {
                    using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, Name("stop"))) {
                        var journalPath = Path.Combine(root, "journal.json");
                        var policy = new Policy(Journal(), records => Files.Write(journalPath, records), true);
                        bool lastObs = false; string lastStatus = null; int ticks = 0;
                        try {
                            do {
                                var errors = new List<string>(); var processes = ProcessList.Read(); var targets = Targets(errors, processes); bool obs = ProcessList.Obs(processes); lastObs = obs;
                                policy.Errors.Clear();
                                using (var snapshot = Audio.Scan(targets)) {
                                    policy.Step(obs, snapshot.Sessions, snapshot.Complete && errors.Count == 0);
                                    errors.AddRange(snapshot.Errors); errors.AddRange(policy.Errors);
                                    var state = new { ObsDetected = obs, TawkProcessCount = targets.Count, AudioSessionCount = snapshot.Sessions.Count,
                                        ManagingMute = policy.Records.Count > 0, OwnedSessionCount = policy.Records.Count,
                                        ConservativeSessionCount = policy.Records.Count(r => !r.CanRestore), Errors = errors };
                                    var key = Files.Json.Serialize(state);
                                    if (key != lastStatus || ticks++ % 5 == 0) {
                                        Files.Write(Path.Combine(root, "status.json"), new { AtUtc = DateTime.UtcNow.ToString("o"),
                                            Pid = Process.GetCurrentProcess().Id, StartTicks = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,
                                            State = state, Running = true }); lastStatus = key;
                                    }
                                }
                            } while (!stop.WaitOne(config.PollMilliseconds));
                        } finally {
                            // Cooperative stop/uninstall performs the same restoration as OBS process disappearance.
                            var errors = new List<string>(); var processes = ProcessList.Read(); var targets = Targets(errors, processes);
                            using (var snapshot = Audio.Scan(targets)) {
                                policy.Step(false, snapshot.Sessions, snapshot.Complete && errors.Count == 0);
                                errors.AddRange(snapshot.Errors); errors.AddRange(policy.Errors);
                            }
                            Files.Write(Path.Combine(root, "status.json"), new { AtUtc = DateTime.UtcNow.ToString("o"), Running = false,
                                ObsDetected = lastObs, RemainingOwnership = policy.Records.Count, Errors = errors });
                        }
                        return policy.Records.Count == 0 ? 0 : 2;
                    }
                } finally { mutex.ReleaseMutex(); }
            }
        }
    }
}
