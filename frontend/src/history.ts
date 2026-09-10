import type { Task } from './types';

// Pure helpers for building/reading daily statistics.
// Persistence now lives in ./api.ts (server-backed); this module only keeps the
// deterministic, easily testable functions.

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

// Step a 'YYYY-MM-DD' key by a whole number of days (can be negative).
export function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + delta));
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
