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
import { DEFAULT_COLOR, DEFAULT_START_MIN } from './types';
import { dateKey } from './history';
import { newTaskId } from './tasks';

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MIN = 24 * 60;

// Two blocks separated by no more than this count as "идущие подряд": the next
// one starts immediately, so the overtake keeps running through the seam
// instead of freezing. A minute of slack absorbs rounding and hand-placed
// blocks that miss each other by seconds.
export const SEQUENCE_GAP_MS = 60_000;

// Blocks that miss each other by no more than this are close enough that they
// were probably *meant* to be one session: the calendar offers to glue them
// together (it never does it on its own — see mergeSuggestions).
export const MERGE_GAP_MS = 5 * MIN_MS;

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
  // Set when the chain is an *explicit* session (its blocks were glued by
  // hand): it then holds together whatever the gaps inside it are, moves as one
  // block and may carry a name.
  sessionId: string | null;
  name: string | null;
}

// The explicit session a group belongs to, or null for a loose block.
function groupSessionId(group: TaskGroup): string | null {
  for (const task of group.tasks) {
    if (task.sessionId) return task.sessionId;
  }
  return null;
}

// Groups that start (almost) exactly when the previous one ends are one
// sequence — and so are groups glued into the same explicit session, however
// far apart they sit. A block that belongs to a session never joins anything
// else, so two sessions laid back to back stay two sessions.
export function buildChains(groups: TaskGroup[]): Chain[] {
  const chains: Chain[] = [];
  // Every chain of a session is found by its id, not by being the previous one:
  // a loose block dropped into a gap of the session must not split it in two.
  const bySession = new Map<string, Chain>();

  const extend = (chain: Chain, group: TaskGroup) => {
    chain.groups.push(group);
    chain.tasks.push(...group.tasks);
    chain.endMs = Math.max(chain.endMs, group.endMs);
    chain.name = chain.name ?? sessionNameOf(group.tasks);
  };

  for (const group of groups) {
    const sessionId = groupSessionId(group);
    const openSession = sessionId !== null ? bySession.get(sessionId) : undefined;
    if (openSession) {
      extend(openSession, group);
      continue;
    }
    const last = chains[chains.length - 1];
    // Only loose blocks grow by proximity: a block that belongs to a session
    // never joins anything else, so two sessions laid back to back stay two.
    if (
      last &&
      sessionId === null &&
      last.sessionId === null &&
      group.startMs - last.endMs <= SEQUENCE_GAP_MS
    ) {
      extend(last, group);
      continue;
    }
    const chain: Chain = {
      id: group.tasks[0].id,
      groups: [group],
      tasks: [...group.tasks],
      startMs: group.startMs,
      endMs: group.endMs,
      sessionId,
      name: sessionNameOf(group.tasks),
    };
    chains.push(chain);
    if (sessionId !== null) bySession.set(sessionId, chain);
  }
  return chains;
}

function sessionNameOf(tasks: Task[]): string | null {
  for (const task of tasks) {
    if (task.sessionName) return task.sessionName;
  }
  return null;
}

export function chainOfTask(chains: Chain[], taskId: string): Chain | null {
  return chains.find((c) => c.tasks.some((t) => t.id === taskId)) ?? null;
}

// A chain is worth showing as a session spine once it holds more than one block
// or has been glued by hand.
export function isSession(chain: Chain): boolean {
  return chain.sessionId !== null || chain.groups.length > 1;
}

// ── Gluing sequences together ──────────────────────────────────────

export interface MergeSuggestion {
  before: Chain;
  after: Chain;
  gapMs: number;
}

// Pairs of neighbouring sequences that sit close enough to be one session (a
// gap of no more than MERGE_GAP_MS). The calendar draws a "склеить" handle in
// that gap; nothing is merged until it is pressed.
export function mergeSuggestions(chains: Chain[]): MergeSuggestion[] {
  const out: MergeSuggestion[] = [];
  for (let i = 1; i < chains.length; i++) {
    const before = chains[i - 1];
    const after = chains[i];
    const gapMs = after.startMs - before.endMs;
    if (gapMs > 0 && gapMs <= MERGE_GAP_MS) out.push({ before, after, gapMs });
  }
  return out;
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Rest gaps inside a session ────────────────────────────────────

// A session holds its blocks together whatever the gaps inside it are, so two
// blocks of the same session can end up standing hours apart. A playable day
// should not leave an empty hole in the middle of a session though: once the
// gap between two consecutive blocks grows beyond MERGE_GAP_MS the plan fills
// it automatically with a rest task, so the run reads task → отдых → task
// instead of a stretch that has nothing to close.
export function sessionGapRestTasks(tasks: Task[]): Task[] {
  const scheduled = tasks.filter(isScheduled);
  const bySession = new Map<string, TaskGroup[]>();
  for (const group of buildGroups(scheduled)) {
    const sid = groupSessionId(group);
    if (sid === null) continue;
    const list = bySession.get(sid);
    if (list) list.push(group);
    else bySession.set(sid, [group]);
  }
  const rests: Task[] = [];
  for (const [sid, groups] of bySession) {
    const sorted = [...groups].sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      const gapMs = next.startMs - prev.endMs;
      // A gap of a few minutes is "идущие подряд"; only a real hole needs rest.
      if (gapMs <= MERGE_GAP_MS) continue;
      const fromMs = prev.endMs;
      const toMs = next.startMs;
      // Never double-book: a rest fills only a gap nothing else already occupies.
      if (scheduled.some((t) => taskStartMs(t) < toMs && taskEndMs(t) > fromMs)) continue;
      const sessionName = sessionNameOf(prev.tasks) ?? sessionNameOf(next.tasks);
      rests.push(restTaskFor(fromMs, toMs, sid, sessionName));
    }
  }
  return rests;
}

// The tasks of a day with every hole inside a session filled with a rest block.
export function fillSessionGaps(tasks: Task[]): Task[] {
  const covered = new Set(coveredRests(tasks).map((t) => t.id));
  const kept = covered.size > 0 ? tasks.filter((t) => !covered.has(t.id)) : tasks;
  const extra = sessionGapRestTasks(kept);
  return extra.length === 0 ? kept : [...kept, ...extra];
}

// The rest tasks of a day that some task now spans completely. The reverse of
// sessionGapRestTasks: closing a session back up — pulling a block all the way
// over the rest — makes the rest redundant, so it is dropped.
export function coveredRests(tasks: Task[]): Task[] {
  const scheduled = tasks.filter(isScheduled);
  const out: Task[] = [];
  for (const rest of scheduled) {
    if (rest.type !== 'rest') continue;
    const rStart = taskStartMs(rest);
    const rEnd = taskEndMs(rest);
    const covered = scheduled.some(
      (t) =>
        t.id !== rest.id &&
        t.type !== 'rest' &&
        taskStartMs(t) <= rStart &&
        taskEndMs(t) >= rEnd
    );
    if (covered) out.push(rest);
  }
  return out;
}

function restTaskFor(
  fromMs: number,
  toMs: number,
  sessionId: string,
  sessionName: string | null
): Task {
  const day = dayKeyOf(fromMs);
  const base = dayStartMs(day);
  return {
    id: newTaskId(),
    name: 'Отдых',
    plannedTime: Math.round((toMs - fromMs) / 1000),
    completedAt: null,
    start: Math.round((fromMs - base) / MIN_MS),
    finishedAt: null,
    order: 0,
    emoji: '☕',
    color: DEFAULT_COLOR,
    type: 'rest',
    day,
    status: 'in-progress',
    sessionId,
    sessionName,
  };
}

// ── Moving a whole sequence ────────────────────────────────────────

// Where a task lands when the thing it belongs to is shifted by `deltaMs`. The
// slot is recomputed against the date it lands on, so a session may be dragged
// across midnight and keeps its shape.
export function shiftedSlot(task: Task, deltaMs: number): { day: string; start: number } {
  const ms = taskStartMs(task) + deltaMs;
  const day = dayKeyOf(ms);
  return { day, start: Math.round((ms - dayStartMs(day)) / MIN_MS) };
}

// The patches that move a set of tasks together, keeping every gap inside them.
export function shiftPatches(
  tasks: Task[],
  deltaMs: number
): { id: string; patch: { day: string; start: number } }[] {
  return tasks.map((task) => ({ id: task.id, patch: shiftedSlot(task, deltaMs) }));
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
