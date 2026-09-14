// Wall-clock scheduling model (the Google-Calendar rework).
//
// A task owns a real slot: `day` + `start` (minutes from midnight) +
// `plannedTime` (seconds). Everything the calendar and the overtake engine need
// is derived from that here, in pure functions:
//
//   groups  — tasks that overlap in time are one *parallel group*; the group is
//             finished only when its last task is finished.
//   chains  — groups that follow each other with no real gap form a *sequence*
//             (the thing the thermometer/spiral/list views can be opened on).
//   layout  — side-by-side columns for overlapping blocks, like Google Calendar.

import type { Task } from './types';
import { DEFAULT_START_MIN } from './types';
import { dateKey } from './history';

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MIN = 24 * 60;

// Two blocks separated by no more than this count as "идущие подряд": the next
// one starts immediately, so the overtake keeps running through the seam
// instead of freezing. A minute of slack absorbs rounding and hand-placed
// blocks that miss each other by seconds.
export const SEQUENCE_GAP_MS = 60_000;

export function dayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// Local 'YYYY-MM-DD' of an epoch timestamp.
export function dayKeyOf(ms: number): string {
  return dateKey(new Date(ms));
}

// A task sits on the calendar once it has a slot and is not in the backlog.
export function isScheduled(task: Task): boolean {
  return task.status !== 'open' && task.start !== null && task.start !== undefined;
}

export function taskStartMs(task: Task): number {
  return dayStartMs(task.day) + (task.start ?? 0) * MIN_MS;
}

export function taskEndMs(task: Task): number {
  return taskStartMs(task) + Math.max(0, task.plannedTime) * 1000;
}

export function isDone(task: Task): boolean {
  return task.status === 'done' || task.finishedAt !== null;
}

// ── Parallel groups ────────────────────────────────────────────────

export interface TaskGroup {
  id: string; // id of the earliest task — stable while the group's members are
  tasks: Task[];
  startMs: number;
  endMs: number;
  // When every task of the group is finished: the latest of their finish
  // timestamps (the group is only really closed once the last one is). Null
  // while anything in it is still open.
  doneMs: number | null;
}

// Tasks that overlap in time (transitively) belong to one group: A overlapping
// B and B overlapping C puts all three in one group even if A and C do not
// touch, because they are all "running at once" from the schedule's point of
// view.
export function buildGroups(tasks: Task[]): TaskGroup[] {
  const scheduled = tasks.filter(isScheduled);
  const sorted = [...scheduled].sort(
    (a, b) => taskStartMs(a) - taskStartMs(b) || a.id.localeCompare(b.id)
  );
  const groups: TaskGroup[] = [];
  for (const task of sorted) {
    const start = taskStartMs(task);
    const end = taskEndMs(task);
    const last = groups[groups.length - 1];
    if (last && start < last.endMs) {
      last.tasks.push(task);
      last.endMs = Math.max(last.endMs, end);
    } else {
      groups.push({ id: task.id, tasks: [task], startMs: start, endMs: end, doneMs: null });
    }
  }
  for (const group of groups) {
    group.doneMs = groupDoneMs(group.tasks);
  }
  return groups;
}

// The moment a set of tasks is fully closed, or null if any of them is still
// open. A task marked done without a timestamp (legacy row) counts as finished
// exactly on plan, so an old day never looks like a huge overtake.
function groupDoneMs(tasks: Task[]): number | null {
  let latest = -Infinity;
  for (const task of tasks) {
    if (!isDone(task)) return null;
    latest = Math.max(latest, task.finishedAt ?? taskEndMs(task));
  }
  return latest === -Infinity ? null : latest;
}

// ── Sequences (chains of back-to-back groups) ──────────────────────

export interface Chain {
  id: string; // id of the first task in the chain
  groups: TaskGroup[];
  tasks: Task[]; // every task of the chain, ordered by start
  startMs: number;
  endMs: number;
}

// Groups that start (almost) exactly when the previous one ends are one
// sequence. A sequence of two or more blocks is what the tracker views are
// opened on.
export function buildChains(groups: TaskGroup[]): Chain[] {
  const chains: Chain[] = [];
  for (const group of groups) {
    const last = chains[chains.length - 1];
    if (last && group.startMs - last.endMs <= SEQUENCE_GAP_MS) {
      last.groups.push(group);
      last.tasks.push(...group.tasks);
      last.endMs = Math.max(last.endMs, group.endMs);
    } else {
      chains.push({
        id: group.tasks[0].id,
        groups: [group],
        tasks: [...group.tasks],
        startMs: group.startMs,
        endMs: group.endMs,
      });
    }
  }
  return chains;
}

export function chainOfTask(chains: Chain[], taskId: string): Chain | null {
  return chains.find((c) => c.tasks.some((t) => t.id === taskId)) ?? null;
}

// ── Calendar layout (side-by-side columns) ─────────────────────────

export interface Placement {
  task: Task;
  startMs: number;
  endMs: number;
  col: number; // 0-based column inside its overlap cluster
  cols: number; // how many columns the cluster needs
}

// Google-Calendar column packing: inside a cluster of mutually overlapping
// blocks each one takes the leftmost free column, and every block of the
// cluster is then drawn 1/cols wide.
export function layoutTasks(tasks: Task[]): Placement[] {
  const groups = buildGroups(tasks);
  const out: Placement[] = [];
  for (const group of groups) {
    const colEnds: number[] = [];
    const placed: Placement[] = [];
    for (const task of group.tasks) {
      const startMs = taskStartMs(task);
      const endMs = taskEndMs(task);
      let col = colEnds.findIndex((end) => end <= startMs);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(endMs);
      } else {
        colEnds[col] = endMs;
      }
      placed.push({ task, startMs, endMs, col, cols: 1 });
    }
    for (const p of placed) p.cols = colEnds.length;
    out.push(...placed);
  }
  return out;
}

// ── Legacy migration ───────────────────────────────────────────────

// Days saved before the calendar existed hold an ordered list of durations and
// a session-relative `completedAt`, with no wall-clock slot anywhere. Lay those
// tasks out back to back from the moment the session actually started (falling
// back to 09:00), which reproduces exactly the timeline they used to be run on,
// and turn `completedAt` into a real timestamp.
export function migrateDayTasks(
  tasks: Task[],
  day: string,
  startedAt?: number | null
): Task[] {
  if (tasks.length === 0) return tasks;
  if (tasks.every((t) => t.start !== null && t.start !== undefined)) return tasks;

  const base = dayStartMs(day);
  const anchorMs =
    startedAt && startedAt >= base && startedAt < base + DAY_MIN * MIN_MS
      ? startedAt
      : base + DEFAULT_START_MIN * MIN_MS;
  const anchorMin = Math.round((anchorMs - base) / MIN_MS);

  let cursor = anchorMin;
  return [...tasks]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((task) => {
      if (task.start !== null && task.start !== undefined) return task;
      // The backlog has no slot by definition — only placed tasks get one.
      if (task.status === 'open') {
        return { ...task, start: null, finishedAt: task.finishedAt ?? null };
      }
      const start = cursor;
      cursor += Math.round(Math.max(0, task.plannedTime) / 60);
      const finishedAt =
        task.finishedAt ??
        (task.completedAt !== null && task.completedAt !== undefined
          ? anchorMs + task.completedAt * 1000
          : null);
      return { ...task, start, finishedAt };
    });
}

// ── Rendering one day column ───────────────────────────────────────

export interface DaySegment {
  task: Task;
  topMin: number; // minutes from midnight of the rendered day
  bottomMin: number;
  startsHere: boolean; // false when the block began on an earlier day
  endsHere: boolean; // false when it runs past midnight
  col: number;
  cols: number;
}

// Everything visible in a day's column, clipped to that day and packed into
// side-by-side columns. A block that runs past midnight is returned for every
// day it touches, so the two halves line up across the seam.
export function daySegments(tasks: Task[], day: string): DaySegment[] {
  const from = dayStartMs(day);
  const to = from + DAY_MIN * MIN_MS;

  const visible = tasks
    .filter(isScheduled)
    .map((task) => ({ task, startMs: taskStartMs(task), endMs: taskEndMs(task) }))
    .filter((s) => s.endMs > from && s.startMs < to)
    .sort((a, b) => a.startMs - b.startMs || a.task.id.localeCompare(b.task.id));

  const segments: DaySegment[] = [];
  // Column packing runs on the clipped intervals, so a block spilling over
  // midnight does not reserve a column in a day it is not shown in.
  let clusterEnd = -Infinity;
  let cluster: DaySegment[] = [];
  const colEnds: number[] = [];

  const closeCluster = () => {
    for (const s of cluster) s.cols = colEnds.length;
    segments.push(...cluster);
    cluster = [];
    colEnds.length = 0;
    clusterEnd = -Infinity;
  };

  for (const { task, startMs, endMs } of visible) {
    const top = Math.max(startMs, from);
    const bottom = Math.min(endMs, to);
    if (top >= clusterEnd) closeCluster();
    let col = colEnds.findIndex((end) => end <= top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(bottom);
    } else {
      colEnds[col] = bottom;
    }
    clusterEnd = Math.max(clusterEnd, bottom);
    cluster.push({
      task,
      topMin: (top - from) / MIN_MS,
      bottomMin: (bottom - from) / MIN_MS,
      startsHere: startMs >= from,
      endsHere: endMs <= to,
      col,
      cols: 1,
    });
  }
  closeCluster();
  return segments;
}

// Where a task would land if it were dropped at `startMin` on `day`, keeping
// its duration and clamping it inside the day.
export function clampStartMin(startMin: number, plannedTime: number): number {
  const durationMin = Math.max(1, Math.round(plannedTime / 60));
  return Math.max(0, Math.min(startMin, DAY_MIN - Math.min(durationMin, DAY_MIN)));
}
