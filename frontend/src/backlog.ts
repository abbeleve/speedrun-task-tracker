// The backlog rail: open tasks grouped by the day they are planned for, the
// search over them, and where «В план» puts one on the calendar.

import type { Task } from './types';
import { DEFAULT_START_MIN } from './types';
import { DAY_MIN, MIN_MS, dayKeyOf, dayStartMs, isReminder, isScheduled } from './schedule';
import { shiftDayKey } from './history';

// Days from today that get a group of their own; anything further off is
// gathered under «Позже».
export const BACKLOG_HORIZON_DAYS = 7;

const SNAP_MIN = 5;

// In Date#getDay() order.
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

// "сегодня" / "завтра" / "вчера", else "ср, 8 окт" — with the year only when
// it is not this one.
export function backlogDayLabel(day: string, today: string): string {
  if (day === today) return 'сегодня';
  if (day === shiftDayKey(today, 1)) return 'завтра';
  if (day === shiftDayKey(today, -1)) return 'вчера';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return 'без дня';
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const year = y === Number(today.slice(0, 4)) ? '' : ` ${y}`;
  return `${weekday}, ${d} ${MONTHS_SHORT[m - 1]}${year}`;
}

export type BacklogGroupKind = 'overdue' | 'day' | 'later';

export interface BacklogGroup {
  key: string;
  kind: BacklogGroupKind;
  // The one day a 'day' group holds; the others mix days.
  day: string | null;
  tasks: Task[];
  // Planned work in the group. Reminders are not work and add nothing.
  totalSec: number;
}

// Planned work in a list of tasks, in seconds — reminders left out.
export function backlogWorkSec(tasks: Task[]): number {
  return tasks.reduce((sum, task) => (isReminder(task) ? sum : sum + task.plannedTime), 0);
}

// Open tasks by the day they are planned for: everything from days already
// gone under one «Просрочено», a group per day for the week ahead, the rest
// under «Позже». Within a group tasks keep their day's order.
export function groupBacklog(
  tasks: Task[],
  today: string,
  horizonDays = BACKLOG_HORIZON_DAYS
): BacklogGroup[] {
  const horizon = shiftDayKey(today, horizonDays);
  const sorted = [...tasks].sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order);
  const overdue: Task[] = [];
  const later: Task[] = [];
  const byDay = new Map<string, Task[]>();
  for (const task of sorted) {
    if (task.day < today) overdue.push(task);
    else if (task.day >= horizon) later.push(task);
    else byDay.set(task.day, [...(byDay.get(task.day) ?? []), task]);
  }
  const group = (key: string, kind: BacklogGroupKind, day: string | null, list: Task[]): BacklogGroup => ({
    key,
    kind,
    day,
    tasks: list,
    totalSec: backlogWorkSec(list),
  });
  const groups: BacklogGroup[] = [];
  if (overdue.length) groups.push(group('overdue', 'overdue', null, overdue));
  for (const [day, list] of byDay) groups.push(group(day, 'day', day, list));
  if (later.length) groups.push(group('later', 'later', null, later));
  return groups;
}

// 1 задача, 2 задачи, 5 задач.
export function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачи';
  return 'задач';
}

// Every word of the query has to turn up in the task's name or notes.
export function matchesBacklogQuery(task: Task, query: string): boolean {
  const words = query.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${task.name}\n${task.description ?? ''}`.toLocaleLowerCase('ru');
  return words.every((word) => text.includes(word));
}

export interface BacklogSlot {
  day: string;
  start: number; // minutes from midnight of `day`
}

function snapUp(min: number): number {
  return Math.ceil(min / SNAP_MIN - 1e-9) * SNAP_MIN;
}

// The day «В план» puts a backlog task on: its own, or today once that day is
// gone.
export function backlogTargetDay(task: Task, today: string): string {
  return task.day < today ? today : task.day;
}

// Where «В план» puts a backlog task: on its target day (above), in the first
// free stretch long enough for it, looking from now on today and from the
// usual start of the day on any other. Blocks count as taken whatever their
// state (a block that spills over from the evening before included);
// reminders only overlay the grid and take nothing. Null when the day has no
// room left before midnight. `tasks` may be the whole plan or just the blocks
// of the target day and the day before it.
export function backlogSlot(task: Task, tasks: Task[], now: number): BacklogSlot | null {
  const today = dayKeyOf(now);
  const day = backlogTargetDay(task, today);
  const lengthMin = Math.max(1, task.plannedTime / 60);
  const before = shiftDayKey(day, -1);
  const busy = tasks
    .filter(
      (other) =>
        other.id !== task.id &&
        isScheduled(other) &&
        !isReminder(other) &&
        (other.day === day || other.day === before)
    )
    .map((other) => {
      const start = (other.start ?? 0) - (other.day === day ? 0 : DAY_MIN);
      return { start, end: start + Math.max(0, other.plannedTime) / 60 };
    })
    .filter((slot) => slot.end > 0)
    .sort((a, b) => a.start - b.start);

  let at = day === today ? snapUp((now - dayStartMs(today)) / MIN_MS) : DEFAULT_START_MIN;
  for (const slot of busy) {
    if (slot.end <= at) continue;
    if (slot.start >= at + lengthMin) break;
    at = snapUp(slot.end);
  }
  return at < DAY_MIN ? { day, start: at } : null;
}

// The rail's width in pixels, as dragged by its edge.
export const BACKLOG_WIDTH_DEFAULT = 300;
export const BACKLOG_WIDTH_MIN = 240;
export const BACKLOG_WIDTH_MAX = 560;

// A width the rail can take — whatever was saved or dragged, a whole number
// of pixels within the limits, and the default for anything unreadable.
export function clampBacklogWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return BACKLOG_WIDTH_DEFAULT;
  return Math.round(Math.min(BACKLOG_WIDTH_MAX, Math.max(BACKLOG_WIDTH_MIN, width)));
}
