// Kanban helpers: task statuses, normalization of legacy rows and the
// timeline/backlog split used by the board and the tracker.

import type { RepeatConfig, Task, TaskStatus } from './types';
import { shiftDayKey, todayKey } from './history';

export const TASK_STATUSES: TaskStatus[] = ['open', 'in-progress', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  'in-progress': 'In-Progress',
  done: 'Done',
};

let nextTaskId = 1;

export function newTaskId(): string {
  return `t-${nextTaskId++}-${Date.now()}`;
}

// Legacy rows stored before kanban existed have no `status`/`day`. A task that
// already sat on a day's timeline defaults to in-progress (or done when it was
// completed), and its day defaults to the day it is stored under.
export function normalizeTask(task: Task, day: string): Task {
  const completed =
    (task.completedAt !== null && task.completedAt !== undefined) ||
    (task.finishedAt !== null && task.finishedAt !== undefined);
  const status = (task.status as TaskStatus | undefined) ?? (completed ? 'done' : 'in-progress');
  return {
    ...task,
    day: task.day || day,
    status,
    // Calendar fields, absent on rows written before the slot model. The slot
    // itself is filled in by migrateDayTasks() once the whole day is known.
    start: task.start ?? null,
    finishedAt: task.finishedAt ?? null,
  };
}

export function normalizeTasks(tasks: Task[] | undefined | null, day: string): Task[] {
  return (tasks ?? []).map((t) => normalizeTask(t, day));
}

export function sortByOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// Tasks that belong on a timeline (placed or completed) — the Open backlog is
// excluded.
export function getTimelineTasks(tasks: Task[]): Task[] {
  return sortByOrder(tasks.filter((t) => t.status !== 'open'));
}

export function getOpenTasks(tasks: Task[]): Task[] {
  return sortByOrder(tasks.filter((t) => t.status === 'open'));
}

// Timeline tasks first, backlog after, renumbered with a single dense 0..N-1
// sequence so the two groups never collide on `order`.
export function reindexTasks(tasks: Task[]): Task[] {
  return [...getTimelineTasks(tasks), ...getOpenTasks(tasks)].map((t, i) => ({ ...t, order: i }));
}

// ── Recurrence (spaced repetition) ─────────────────────────────────
// A ready forgetting-curve series, in base units. Each time a recurring task is
// completed the next occurrence is scheduled this many base-days ahead. The
// series length caps the number of repetitions so a review task can't repeat
// forever.
export const INCREASING_SERIES = [1, 3, 7, 16, 35];

// Days until the next occurrence of a task whose current step is `index`
// (0-based). Returns null once an increasing series has no more steps.
export function nextRepeatIntervalDays(repeat: RepeatConfig, index: number): number | null {
  const base = repeat.baseDays > 0 ? repeat.baseDays : 1;
  if (repeat.mode === 'fixed') return base;
  if (index < 0 || index >= INCREASING_SERIES.length) return null;
  return INCREASING_SERIES[index] * base;
}

// The day the next occurrence of `task` will be scheduled on, or null when the
// task has no repeat rule or its series is exhausted. `fallbackDay` covers
// legacy rows without a day.
export function scheduledDayFor(task: Task, fallbackDay: string): string | null {
  if (!task.repeat) return null;
  const interval = nextRepeatIntervalDays(task.repeat, task.repeatIndex ?? 0);
  if (interval === null) return null;
  return shiftDayKey(task.day || fallbackDay || todayKey(), interval);
}

// The next occurrence of a recurring task, scheduled `interval` days after this
// one's day. A task that sits on the calendar keeps its slot — the occurrence
// lands on the same time of day, like a repeating calendar event; one that was
// only ever in the backlog comes back to the backlog. `makeId` supplies the new
// id and `fromDay` is the fallback day for legacy rows without one. Returns
// null for a one-off task or once an increasing series has run out of steps.
export function spawnNextOccurrence(
  task: Task,
  makeId: () => string,
  fromDay: string
): Task | null {
  if (!task.repeat) return null;
  const index = task.repeatIndex ?? 0;
  const interval = nextRepeatIntervalDays(task.repeat, index);
  if (interval === null) return null;
  const baseDay = task.day || fromDay || todayKey();
  const placed = task.start !== null && task.start !== undefined;
  return {
    id: makeId(),
    name: task.name,
    description: task.description,
    plannedTime: task.plannedTime,
    completedAt: null,
    start: placed ? task.start : null,
    finishedAt: null,
    order: 0,
    emoji: task.emoji,
    color: task.color,
    type: task.type,
    day: shiftDayKey(baseDay, interval),
    status: placed ? 'in-progress' : 'open',
    repeat: task.repeat,
    repeatIndex: index + 1,
    repeatOf: task.id,
  };
}

// Human-readable schedule of a repeat rule, e.g. "каждые 7 дн." or
// "1 → 3 → 7 → 16 → 35 дн." (base 1). Used as the card badge tooltip.
export function describeRepeat(repeat: RepeatConfig): string {
  const base = repeat.baseDays > 0 ? repeat.baseDays : 1;
  if (repeat.mode === 'fixed') return `каждые ${base} дн.`;
  return INCREASING_SERIES.map((s) => s * base).join(' → ') + ' дн.';
}
