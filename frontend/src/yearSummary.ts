// The home page's summary cards: one year's totals, and how they moved
// against the year before.
//
// A year can be cut at a date ("MM-DD", inclusive), so the current year —
// only part-way through — is held against the same stretch of the last one
// rather than against all twelve months of it.

import type { DayStats } from './types';
import { rangeOf, sleepDuration } from './sleep';
import type { SleepData } from './sleep';

export interface YearFigures {
  workSec: number;
  sleepMin: number;
  daysWithSleep: number; // a rating alone counts: the night was logged
}

export function yearFigures(
  year: number,
  history: Record<string, DayStats>,
  sleepLog: Record<string, SleepData>,
  through: string | null
): YearFigures {
  const prefix = `${year}-`;
  const inYear = (key: string) => key.startsWith(prefix) && (through === null || key.slice(5) <= through);
  let workSec = 0;
  for (const [key, day] of Object.entries(history)) if (inYear(key)) workSec += day.workSec;
  let sleepMin = 0;
  let daysWithSleep = 0;
  for (const [key, entry] of Object.entries(sleepLog)) {
    if (!inYear(key) || (!entry.hours.length && entry.quality === null)) continue;
    daysWithSleep++;
    sleepMin += sleepDuration(rangeOf(entry));
  }
  return { workSec, sleepMin, daysWithSleep };
}

export const avgSleepMin = (f: YearFigures): number | null =>
  f.daysWithSleep > 0 ? Math.round(f.sleepMin / f.daysWithSleep) : null;

// Relative change in percent, or null when there is nothing to compare with.
export function percentChange(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

// "+38,1%", "−5,6%", "+120%" — at most one decimal, Russian decimal comma.
export function fmtPercent(p: number): string {
  const abs = Math.abs(p).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  return `${p < 0 ? '−' : '+'}${abs}%`;
}
