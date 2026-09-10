import type { DayStats, SleepEntry, Task } from './types';

const HISTORY_KEY = 'speedrun_history';
const SLEEP_KEY = 'speedrun_sleep';

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function loadHistory(): Record<string, DayStats> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load history', e);
    return {};
  }
}

export function addSessionToHistory(workSec: number, restSec: number): void {
  const hist = loadHistory();
  const key = todayKey();
  const cur = hist[key];
  hist[key] = {
    date: key,
    workSec: (cur?.workSec ?? 0) + workSec,
    restSec: (cur?.restSec ?? 0) + restSec,
    sessions: (cur?.sessions ?? 0) + 1,
  };
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

export function loadSleepMap(): Record<string, SleepEntry> {
  try {
    const raw = localStorage.getItem(SLEEP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load sleep log', e);
    return {};
  }
}

export function setSleepForDate(date: string, entry: SleepEntry | null): void {
  const map = loadSleepMap();
  if (entry && (entry.bed !== null || entry.wake !== null)) {
    map[date] = entry;
  } else {
    delete map[date];
  }
  try {
    localStorage.setItem(SLEEP_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save sleep log', e);
  }
}

// New sleep-log API: { hours: number; quality: number | null }
const SLEEP_LOG_KEY = 'speedrun_sleep_log';

export interface SleepLogData {
  hours: number[]; // hour indices 0..23 the person was asleep
  quality: number | null;
}

export function loadSleepLog(): Record<string, SleepLogData> {
  try {
    const raw = localStorage.getItem(SLEEP_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!(parsed && typeof parsed === 'object')) return {};

    // Migrate old format {from, to} → {hours: [], quality}
    const migrated: Record<string, SleepLogData> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const entry = v as Record<string, unknown>;
      if (Array.isArray(entry.hours) && Array.isArray(entry.from)) {
        // Corrupt entry — skip
        continue;
      }
      if (typeof entry.from === 'number' && typeof entry.to === 'number') {
        // Old format — convert to new
        const lo = Math.min(entry.from, entry.to);
        const hi = Math.max(entry.from, entry.to);
        const hours: number[] = [];
        for (let h = lo; h <= hi; h++) hours.push(h);
        migrated[k] = { hours, quality: null };
      } else if (entry.hours !== undefined || entry.quality !== undefined) {
        // Already in new format
        migrated[k] = {
          hours: Array.isArray(entry.hours) ? entry.hours.filter((h): h is number => typeof h === 'number') : [],
          quality: typeof entry.quality === 'number' ? entry.quality : null,
        };
      }
      // Otherwise skip unrecognized entry
    }
    return migrated;
  } catch (e) {
    console.error('Failed to load sleep log', e);
    return {};
  }
}

export function saveSleepLog(date: string, entry: SleepLogData | null): void {
  const map = loadSleepLog();
  if (entry && (entry.hours.length > 0 || entry.quality !== null)) {
    map[date] = entry;
  } else {
    delete map[date];
  }
  try {
    localStorage.setItem(SLEEP_LOG_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save sleep log', e);
  }
}

// Split finished session time into work vs rest using actual task completion
// timestamps. An unfinished current task counts only its partial progress.
export function splitSessionByType(
  tasks: Task[],
  elapsedSec: number
): { workSec: number; restSec: number } {
  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  let prev = 0;
  let workSec = 0;
  let restSec = 0;
  for (const t of sorted) {
    if (t.completedAt !== null) {
      const span = Math.max(0, t.completedAt - prev);
      prev = Math.max(prev, t.completedAt);
      if (t.type === 'rest') restSec += span;
      else workSec += span;
    } else {
      const spent = Math.max(0, Math.min(elapsedSec - prev, t.plannedTime));
      if (t.type === 'rest') restSec += spent;
      else workSec += spent;
      break; // tasks after the current one have no spent time
    }
  }
  return { workSec: Math.round(workSec), restSec: Math.round(restSec) };
}

// GitHub-style intensity buckets for the heatmap: 0 = nothing … 4 = 4h+ of work
export function heatLevel(workSec: number): number {
  if (workSec <= 0) return 0;
  if (workSec <= 3600) return 1;
  if (workSec <= 2 * 3600) return 2;
  if (workSec <= 4 * 3600) return 3;
  return 4;
}
