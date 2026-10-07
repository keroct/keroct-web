using System;
using System.Collections.Generic;
using System.Linq;

namespace Keroct.Quiet {
    public interface ISession {
        string Key { get; }
        string Family { get; }
        bool Muted { get; }
        void SetMute(bool muted);
    }
    public sealed class Ownership {
        public string Key;
        public string Family;
        public bool OriginalMute;
        public bool CanRestore;
    }
    // No Windows API dependency: callers supply only positively identified target sessions.
    public sealed class Policy {
        public readonly List<Ownership> Records;
        readonly Action<List<Ownership>> persist;
        public Policy(List<Ownership> records, Action<List<Ownership>> persist, bool recovered) {
            Records = records; this.persist = persist;
            if (recovered && records.Count != 0) {
                // After a crash we cannot tell whether the user intentionally muted in the gap.
                foreach (var record in records) record.CanRestore = false;
                persist(Records);
            }
        }
        public void Step(bool obsRunning, IList<ISession> sessions, bool complete) {
            var present = new HashSet<string>(sessions.Select(s => s.Key));
            var arrivalsByFamily = sessions.Where(s => !Records.Any(r => r.Key == s.Key))
                .GroupBy(s => s.Family).ToDictionary(g => g.Key, g => g.Count());
            if (complete) foreach (var session in sessions.Where(s => !Records.Any(r => r.Key == s.Key))) {
                var previous = Records.Where(r => r.Family == session.Family && !present.Contains(r.Key)).ToList();
                // Also reconcile when OBS just exited: replacement may occur between two polls.
                if (arrivalsByFamily[session.Family] == 1 && previous.Count == 1 && previous[0].CanRestore) {
                    var oldKey = previous[0].Key; previous[0].Key = session.Key;
                    try { persist(Records); } catch { previous[0].Key = oldKey; throw; }
                }
            }
            if (complete && !obsRunning) {
                var gone = Records.Where(r => !present.Contains(r.Key)).ToList();
                if (gone.Count != 0) { foreach (var r in gone) Records.Remove(r); persist(Records); }
            }
            foreach (var session in sessions) {
                try {
                    var record = Records.FirstOrDefault(r => r.Key == session.Key);
                    if (obsRunning) {
                        if (record == null) {
                            record = new Ownership { Key = session.Key, Family = session.Family, OriginalMute = session.Muted, CanRestore = true };
                            Records.Add(record);
                            // Write-ahead journal: never mute if recording the baseline fails.
                            try { persist(Records); } catch { Records.Remove(record); throw; }
                        }
                        if (!session.Muted) session.SetMute(true);
                    } else if (record != null) {
                        if (record.CanRestore && session.Muted != record.OriginalMute)
                            session.SetMute(record.OriginalMute);
                        // Ambiguous recovered sessions remain muted; never invent a baseline.
                        Records.Remove(record); persist(Records);
                    }
                } catch (Exception ex) { Errors.Add(ex.Message); }
            }
        }
        public readonly List<string> Errors = new List<string>();
    }
}
