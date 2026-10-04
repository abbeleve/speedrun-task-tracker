// Streaks: how many days in a row a habit's quota has been met.
//
// A habit opts in with `streak: true`. The run is counted back from today when
// today's quota is already met, and from yesterday while it is not: an
// unfinished today does not break a streak before the day is over, it only
// puts it at risk. Each day is judged against the quota it had then
// (habitTargetOn), like every other view of the habit's past.
//
// The backend counts the same way (backend/app/streak.py) to push a warning
// 3, 2 and 1 hours before midnight; streakWarningText is worded like its own.

import type { Habit, HabitEntry, Task } from './types';
import { defaultUnit, habitTargetOn, isHabitComplete } from './habits';
import { isDone } from './schedule';
import { shiftDayKey } from './history';

export interface HabitStreak {
  days: number; // days in a row the quota was met — today included once met
  todayDone: boolean; // today's quota is met: the fire is lit
  left: number; // what is still missing to today's quota, in the habit's units
}

// Every day's progress for one habit at once — the same sum as habitTotal,
// but in one pass, so walking a long streak back does not rescan the plan
// for every day of it.
function dailyTotals(habit: Habit, tasks: Task[], entries: HabitEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (date: string, value: number) => totals.set(date, (totals.get(date) ?? 0) + value);
  for (const entry of entries) {
    if (entry.habitId === habit.id) add(entry.date, entry.manual);
  }
  const seconds = new Map<string, number>();
  for (const task of tasks) {
    if (task.habitId !== habit.id || !isDone(task)) continue;
    if (habit.format === 'time') {
      seconds.set(task.day, (seconds.get(task.day) ?? 0) + Math.max(0, task.plannedTime));
    } else {
      add(task.day, 1);
    }
  }
  // Minutes are rounded per day, as habitAuto does.
  for (const [date, sec] of seconds) add(date, Math.round(sec / 60));
  return totals;
}

export function habitStreak(
  habit: Habit,
  today: string,
  tasks: Task[],
  entries: HabitEntry[]
): HabitStreak {
  const totals = dailyTotals(habit, tasks, entries);
  const met = (date: string) => isHabitComplete(totals.get(date) ?? 0, habitTargetOn(habit, date));
  const todayDone = met(today);
  let days = todayDone ? 1 : 0;
  // A day with nothing recorded is never met, so the walk always ends.
  for (let date = shiftDayKey(today, -1); met(date); date = shiftDayKey(date, -1)) days++;
  const left = Math.max(0, habitTargetOn(habit, today) - (totals.get(today) ?? 0));
  return { days, todayDone, left };
}

// The hours before midnight at which an unmet streak is warned about.
export const STREAK_WARN_HOURS = [3, 2, 1] as const;

// How many whole hours of the day are left, rounded up — 3 from 21:00 on,
// then 2, then 1 in the last hour — or null earlier in the day. Measured in
// real time to the next local midnight, as the backend's pushes are.
export function streakWarnStage(nowMs: number): number | null {
  const now = new Date(nowMs);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const hours = Math.ceil((midnight - nowMs) / 3_600_000);
  return hours <= STREAK_WARN_HOURS[0] ? hours : null;
}

// 1 день, 2 дня, 5 дней, 11 дней, 21 день.
export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

export function formatAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// "Серия 12 дней сгорит через 3 ч — осталось 4 раз", or, with no streak to
// lose yet, a nudge to start one.
export function streakWarningText(habit: Habit, days: number, left: number, hours: number): string {
  const unit = habit.unit || defaultUnit(habit.format);
  const rest = `осталось ${formatAmount(left)}${unit ? ` ${unit}` : ''}`;
  if (days > 0) return `Серия ${days} ${pluralDays(days)} сгорит через ${hours} ч — ${rest}`;
  return `До конца дня ${hours} ч — ${rest}. Начни серию!`;
}

// ── What this browser has already shown ─────────────────────────────
// The fire is celebrated once a day per habit, and a warning closed stays
// closed, so reloading the page does not replay them. Kept in localStorage: it is
// about this screen, not the account. Storage may be unavailable (private
// windows), in which case everything simply shows again.

const CELEBRATED_KEY = 'speedrun_streak_celebrated';
const WARNED_KEY = 'speedrun_streak_warned';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked — the moment just shows again next time
  }
}

// habit id → the last day its streak was celebrated.
export function wasCelebrated(habitId: string, date: string): boolean {
  return readJson<Record<string, string>>(CELEBRATED_KEY, {})[habitId] === date;
}

export function markCelebrated(habitId: string, date: string): void {
  writeJson(CELEBRATED_KEY, { ...readJson<Record<string, string>>(CELEBRATED_KEY, {}), [habitId]: date });
}

// Dropping below the quota again re-arms the day's celebration.
export function forgetCelebration(habitId: string, date: string): void {
  const all = readJson<Record<string, string>>(CELEBRATED_KEY, {});
  if (all[habitId] !== date) return;
  delete all[habitId];
  writeJson(CELEBRATED_KEY, all);
}

export function warningKey(habitId: string, hours: number): string {
  return `${habitId}:${hours}`;
}

// The warnings closed today; yesterday's are forgotten on the first read.
export function closedWarnings(date: string): string[] {
  const stored = readJson<{ date?: string; keys?: string[] }>(WARNED_KEY, {});
  return stored.date === date && Array.isArray(stored.keys) ? stored.keys : [];
}

export function closeWarning(date: string, key: string): void {
  writeJson(WARNED_KEY, { date, keys: [...new Set([...closedWarnings(date), key])] });
}
