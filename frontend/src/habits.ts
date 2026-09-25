// Pure helpers for the habit tracker (home page).
//
// A habit's daily progress has two parts:
//   • auto — derived live from that day's plan: every *completed* task linked to
//            the habit adds its duration (in minutes) to a 'time' habit, or adds
//            1 to a 'count' habit (one linked task = one unit done that day).
//   • manual — the hand-entered portion stored per day (see HabitEntry).
// Keeping the task-linked part derived (not stored) follows the rest of the app:
// one source of truth, re-opened tasks immediately take the same credit back.

import type { Habit, HabitEntry, HabitFormat, HabitTarget, Task } from './types';
import { isDone } from './schedule';

export function newHabitId(): string {
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// A habit's quota history, oldest first. A habit with no history yet (built
// by hand, say) reads as its one quota applying from the beginning.
export function habitTargets(habit: Habit): HabitTarget[] {
  return habit.targets.length > 0 ? habit.targets : [{ since: '', target: habit.target }];
}

// The quota a habit had on one day: the latest version that had started by
// then. Every past day is judged against the quota of its own time, so raising
// 10 отжиманий to 15 does not turn the days done at 10 into misses. A day
// before the first version falls back to that first quota.
export function habitTargetOn(habit: Habit, date: string): number {
  const versions = habitTargets(habit);
  let target = versions[0].target;
  for (const version of versions) {
    if (version.since > date) break;
    target = version.target;
  }
  return target;
}

// The quota history after setting `target` from `since` on. Versions that
// would start on or after that day are dropped — the new quota covers them
// now — so a same-day correction replaces rather than piles up, and a `since`
// of '' rewrites the whole history. A version that does not change the quota
// is folded into the one before it, so typing the old number back undoes a
// change without a trace.
export function setHabitTarget(
  targets: HabitTarget[],
  target: number,
  since: string
): HabitTarget[] {
  const out: HabitTarget[] = [];
  for (const version of [...targets.filter((v) => v.since < since), { since, target }]) {
    if (out.length > 0 && out[out.length - 1].target === version.target) continue;
    out.push(version);
  }
  return out;
}

// The 'time' 'count' → unit label fallback used when a habit has none.
export function defaultUnit(format: HabitFormat): string {
  return format === 'time' ? 'мин' : '';
}

// How much one tap of − / + moves a habit, when no amount was typed in. Time
// habits move in 5-minute chunks (a single minute is never what anyone means);
// count habits move by one.
export function defaultStep(format: HabitFormat): number {
  return format === 'time' ? 5 : 1;
}

// The digits typed into a card's step pill → the step to apply, or null while
// the text is not a usable number yet (empty, or all zeroes). Only a magnitude
// is parsed: the direction comes from which of the two buttons is pressed. A
// comma works as the decimal separator, like the app's other number fields.
export function parseHabitAmount(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const n = parseFloat(text);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

// The auto part of a habit's progress on one day, in the habit's own units
// (minutes for 'time', integer count for 'count'). Linked-but-open tasks are
// ignored — only really completed ones count, so the number is honest.
export function habitAuto(habit: Habit, date: string, tasks: Task[]): number {
  if (habit.format === 'time') {
    let sec = 0;
    for (const task of tasks) {
      if (task.day !== date) continue;
      if (task.habitId !== habit.id) continue;
      if (!isDone(task)) continue;
      sec += Math.max(0, task.plannedTime);
    }
    return Math.round(sec / 60);
  }
  let count = 0;
  for (const task of tasks) {
    if (task.day !== date) continue;
    if (task.habitId !== habit.id) continue;
    if (!isDone(task)) continue;
    count++;
  }
  return count;
}

// The hand-entered portion for a day (0 when the user added nothing by hand).
export function habitManual(
  entries: HabitEntry[],
  habitId: string,
  date: string
): number {
  for (const entry of entries) {
    if (entry.habitId === habitId && entry.date === date) return entry.manual;
  }
  return 0;
}

// Today's total progress for a habit, in its own units.
export function habitTotal(
  habit: Habit,
  date: string,
  tasks: Task[],
  entries: HabitEntry[]
): number {
  return habitManual(entries, habit.id, date) + habitAuto(habit, date, tasks);
}

// Progress 0…1, clamped: how far the habit is towards its daily quota.
export function habitProgress(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
}

export function isHabitComplete(value: number, target: number): boolean {
  return target > 0 && value >= target;
}

// A habit's completion status on a single day, against that day's own quota —
// the dial and the hero summary both care about "was it hit that day", not the
// raw number. Habits with a zero target count as not done (avoid div-by-zero +
// never-met).
export function isHabitDoneOn(
  habit: Habit,
  date: string,
  tasks: Task[],
  entries: HabitEntry[]
): boolean {
  return isHabitComplete(habitTotal(habit, date, tasks, entries), habitTargetOn(habit, date));
}

// Counts of done / total on a given day, plus the completion rate 0..1.
// Empty habit lists return 0/0/0 so the dial renders its empty state instead
// of NaN.
export interface DayCompletion {
  done: number;
  total: number;
  rate: number; // 0..1, clamped
}

export function dayCompletion(
  habits: Habit[],
  date: string,
  tasks: Task[],
  entries: HabitEntry[]
): DayCompletion {
  if (habits.length === 0) return { done: 0, total: 0, rate: 0 };
  let done = 0;
  for (const h of habits) {
    if (isHabitDoneOn(h, date, tasks, entries)) done++;
  }
  return { done, total: habits.length, rate: Math.max(0, Math.min(1, done / habits.length)) };
}

// Human-readable "value unit target" line, e.g. "7 / 10 раз" or "245 / 300 мин".
export function formatHabit(value: number, target: number, unit: string): string {
  const u = unit ? ` ${unit}` : '';
  return `${trimZero(value)} / ${trimZero(target)}${u}`;
}

export interface HabitDayValue {
  date: string; // 'YYYY-MM-DD' (local)
  value: number; // total progress that day, in the habit's own units
}

// GitHub-style intensity buckets for a habit's heatmap, mirroring heatLevel
// in ./history.ts but scaled to the habit's own quota instead of a fixed
// work-time scale: 0 = nothing … 4 = quota met or exceeded.
export function habitHeatLevel(value: number, target: number): number {
  if (value <= 0) return 0;
  if (target <= 0) return 4; // no quota to compare against — any activity maxes the scale
  const ratio = value / target;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 1) return 3;
  return 4;
}

// A habit's progress across a run of days (today and the past ones), so the
// tracker can show "what I did last Tuesday". Each past day re-derives the
// task-linked part from that day's plan, exactly as today does.
export function habitHistory(
  habit: Habit,
  days: string[],
  tasks: Task[],
  entries: HabitEntry[]
): HabitDayValue[] {
  return days.map((date) => ({ date, value: habitTotal(habit, date, tasks, entries) }));
}

function trimZero(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
