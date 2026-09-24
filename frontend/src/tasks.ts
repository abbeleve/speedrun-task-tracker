// Kanban helpers: task statuses, normalization of legacy rows and the
// timeline/backlog split used by the board and the tracker.

import type { RepeatConfig, Task, TaskStatus } from './types';
import { shiftDayKey, todayKey } from './history';
import { normalizeTaskColorAnimation } from './taskAppearance';
import { isDone, isScheduled, taskEndMs } from './schedule';

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
    pinned: task.pinned ?? false,
    colorAnimation: normalizeTaskColorAnimation(task.colorAnimation, task.color),
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

// Keep the placement of an already-pinned task immutable at the store boundary,
// not only in drag handlers. Completion/reopening remains allowed because it
// moves between done and in-progress without changing calendar placement.
// Supplying pinned:false explicitly unlocks the task and permits the same edit
// to move it, which is useful when the dialog is saved after unchecking the pin.
export function preservePinnedPlacement(previous: Task | undefined, next: Task): Task {
  if (!previous?.pinned || next.pinned === false) return next;
  const changesPlacementKind =
    (previous.status === 'open') !== (next.status === 'open');
  return {
    ...next,
    day: previous.day,
    start: previous.start,
    status: changesPlacementKind ? previous.status : next.status,
  };
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
    colorAnimation: task.colorAnimation ?? null,
    type: task.type,
    habitId: task.habitId,
    day: shiftDayKey(baseDay, interval),
    status: placed ? 'in-progress' : 'open',
    pinned: task.pinned ?? false,
    repeat: task.repeat,
    repeatIndex: index + 1,
    repeatOf: task.id,
  };
}

// ── Reminders close themselves ─────────────────────────────────────
// A reminder has no ✓: it counts as completed the moment its window has
// passed, and that is also what schedules a recurring one's next occurrence —
// exactly what pressing ✓ does for an ordinary task. The completion is stored
// (status 'done', finishedAt = the window's end), so it fires once: deleting
// the next occurrence afterwards does not bring it back.

// Occurrences caught up in one pass. A series left alone for longer resumes on
// the next pass from the last occurrence created.
const MAX_REMINDER_CATCH_UP = 400;

function isPlacedReminder(task: Task): boolean {
  return task.type === 'reminder' && isScheduled(task);
}

// The reminders whose window closed by `now` but that are not completed yet,
// completed, plus the occurrences their completion schedules. An occurrence
// whose own window is already over (the app was not open for a while) is
// completed on the spot and schedules the next one, until one lies ahead.
// Null when there is nothing to do.
export function closeExpiredReminders(
  tasks: Task[],
  now: number,
  makeId: () => string
): { patches: { id: string; patch: Partial<Task> }[]; spawned: Task[] } | null {
  const due = tasks.filter(
    (task) => isPlacedReminder(task) && !isDone(task) && taskEndMs(task) <= now
  );
  if (due.length === 0) return null;
  const hasNext = new Set(tasks.map((t) => t.repeatOf).filter((id) => id !== undefined));
  const patches: { id: string; patch: Partial<Task> }[] = [];
  const spawned: Task[] = [];
  for (const task of due) {
    patches.push({ id: task.id, patch: { status: 'done', finishedAt: taskEndMs(task) } });
    // An occurrence scheduled earlier is never duplicated.
    if (hasNext.has(task.id)) continue;
    let next = spawnNextOccurrence(task, makeId, task.day);
    for (let i = 0; next; i++) {
      if (i >= MAX_REMINDER_CATCH_UP || taskEndMs(next) > now) {
        spawned.push(next);
        break;
      }
      const closed: Task = { ...next, status: 'done', finishedAt: taskEndMs(next) };
      spawned.push(closed);
      next = spawnNextOccurrence(closed, makeId, closed.day);
    }
  }
  return { patches, spawned };
}

// A reminder edited in the dialog keeps its completion, unless the edit
// changes its window or its repeat rule: then it is re-armed (not completed),
// so the caller drops the occurrence it had scheduled and it closes again —
// right away if the new window is already over — scheduling the next one from
// the new settings. This is how turning repetition on for a reminder whose
// window has passed takes effect.
export function rearmEditedReminder(before: Task, after: Task): Task {
  if (after.type !== 'reminder') return after;
  const repeatKey = (t: Task) => (t.repeat ? `${t.repeat.mode}:${t.repeat.baseDays}` : '');
  const changed =
    before.type !== 'reminder' ||
    before.day !== after.day ||
    before.start !== after.start ||
    before.plannedTime !== after.plannedTime ||
    repeatKey(before) !== repeatKey(after);
  if (!changed && isDone(before)) {
    return { ...after, status: 'done', finishedAt: before.finishedAt ?? taskEndMs(before) };
  }
  return {
    ...after,
    status: after.status === 'open' ? 'open' : 'in-progress',
    finishedAt: null,
    completedAt: null,
  };
}

// Human-readable schedule of a repeat rule, e.g. "каждые 7 дн." or
// "1 → 3 → 7 → 16 → 35 дн." (base 1). Used as the card badge tooltip.
export function describeRepeat(repeat: RepeatConfig): string {
  const base = repeat.baseDays > 0 ? repeat.baseDays : 1;
  if (repeat.mode === 'fixed') return `каждые ${base} дн.`;
  return INCREASING_SERIES.map((s) => s * base).join(' → ') + ' дн.';
}
