// Persists the overtake engine's per-day result (credit.ts's `closedDays`) to
// the backend history table, so a day's final lead survives as a record
// instead of only ever being a number re-derived from the plan.
//
// The engine itself needs nothing stored to show the *live* lead correctly —
// see credit.ts. This is purely a side effect: once a day closes, write its
// final number down, and only once (a loaded baseline stops it from resending
// years of already-settled days every time the app reloads).
//
// The same loaded baseline is returned so other views (the weekly total in
// weekOvertake.ts, say) can read past days' overtake without loading it
// again themselves.

import { useEffect, useState } from 'react';
import type { TaskGroup } from './schedule';
import { computeCredit } from './credit';
import { loadHistory, saveOvertakeSec } from './api';

// A stable reference for "nothing loaded yet", so consumers that memoize on
// the returned map do not see a new object on every render before it loads.
const NONE: Record<string, number> = {};

export function useOvertakeHistorySync(
  groups: TaskGroup[],
  todayKey: string
): Record<string, number> {
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHistory().then((h) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const [day, stats] of Object.entries(h)) map[day] = stats.overtakeSec;
      setBaseline(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-runs only when the plan changes or the calendar day actually flips
  // (`todayKey`), never on the fast per-second tick that drives the live HUD.
  useEffect(() => {
    if (baseline === null) return;
    const { closedDays } = computeCredit(groups, Date.now());
    const updates: Record<string, number> = {};
    for (const { day, overtakeSec } of closedDays) {
      if (baseline[day] === overtakeSec) continue;
      updates[day] = overtakeSec;
      void saveOvertakeSec(day, overtakeSec);
    }
    if (Object.keys(updates).length > 0) {
      setBaseline((prev) => (prev ? { ...prev, ...updates } : prev));
    }
  }, [groups, todayKey, baseline]);

  return baseline ?? NONE;
}
