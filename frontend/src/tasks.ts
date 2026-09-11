// Kanban helpers: task statuses, normalization of legacy rows and the
// timeline/backlog split used by the board and the tracker.

import type { Task, TaskStatus } from './types';

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
  const completed = task.completedAt !== null && task.completedAt !== undefined;
  const status = (task.status as TaskStatus | undefined) ?? (completed ? 'done' : 'in-progress');
  return { ...task, day: task.day || day, status };
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
