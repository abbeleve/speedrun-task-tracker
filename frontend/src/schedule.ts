// Wall-clock scheduling model (the Google-Calendar rework).
//
// A task owns a real slot: `day` + `start` (minutes from midnight) +
// `plannedTime` (seconds). Everything the calendar and the overtake engine need
// is derived from that here, in pure functions:
//
//   groups  — tasks that overlap in time are one *parallel group*; the group is
//             finished only when its last task is finished.
//   chains  — a *sequence*: the blocks of one explicit session (the thing the
//             thermometer/spiral/list views can be opened on). Nothing is ever
//             glued on its own — see buildChains.
//   runs    — the stretches the clock ran without a break. Not a sequence:
//             purely geometric, and nothing in one is connected to anything.
//   layout  — side-by-side columns for overlapping blocks, like Google Calendar.

import type { Task } from './types';
import { DEFAULT_START_MIN } from './types';
import { dateKey } from './history';

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MIN = 24 * 60;

// Two blocks separated by no more than this count as "идущие подряд": the next
// one starts immediately, so the clock never really stopped between them and
// the overtake keeps running through the seam instead of freezing. A minute of
// slack absorbs rounding and hand-placed blocks that miss each other by
// seconds. This says nothing about *sequences* — those are explicit now (see
// buildChains); it is only what isContinuous/buildRuns read off the geometry.
export const SEQUENCE_GAP_MS = 60_000;

// Blocks that miss each other by no more than this — touching ones included —
// are close enough that they were probably *meant* to be one session: the
// calendar offers to glue them together. It never does it on its own, and
// without that press they stay two separate blocks (see mergeSuggestions).
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

// A service reminder (see types.ts's TaskType): keeps a real slot so it can be
// drawn on the grid, but is never real work.
export function isReminder(task: Task): boolean {
  return task.type === 'reminder';
}

// Scheduled tasks that count as actual work for the schedule engine: no
// reminders. Feeds buildGroups (and, through it, the overtake engine and
// sequences), so a reminder can never join a group or a chain/session.
export function isEngineTask(task: Task): boolean {
  return isScheduled(task) && !isReminder(task);
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
  const scheduled = tasks.filter(isEngineTask);
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

// Sequences are explicit. Only blocks glued into the same session by hand are
// one sequence, however tightly anything else is laid out: two blocks that
// merely touch stay two separate blocks until the calendar's 🔗 handle or the
// batch menu is actually pressed (see mergeSuggestions, splitPatches).
//
// The one thing that happens without being asked is the reverse — a loose block
// standing *entirely inside* a session's span is swallowed by it. On the clock
// it is already in the middle of that session, and a block that reads as part
// of one but is not really in it would be left behind the moment the session is
// dragged.
export function buildChains(groups: TaskGroup[]): Chain[] {
  const chains: Chain[] = [];
  // Every chain of a session is found by its id, not by being the previous one:
  // a loose block dropped into a gap of the session must not split it in two.
  const bySession = new Map<string, Chain>();

  for (const group of groups) {
    const sessionId = groupSessionId(group);
    const openSession = sessionId !== null ? bySession.get(sessionId) : undefined;
    if (openSession) {
      extendChain(openSession, group);
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

  return absorbLooseChains(chains);
}

function extendChain(chain: Chain, group: TaskGroup): void {
  chain.groups.push(group);
  chain.tasks.push(...group.tasks);
  chain.endMs = Math.max(chain.endMs, group.endMs);
  chain.name = chain.name ?? sessionNameOf(group.tasks);
}

// Hand every loose chain that fits entirely inside a session over to it. The
// tightest session wins, so one nested inside another keeps what sits in it.
// A swallowed group never reaches past its host's edges, so no span grows and
// nothing cascades: one pass is enough.
function absorbLooseChains(chains: Chain[]): Chain[] {
  const sessions = chains.filter((c) => c.sessionId !== null);
  if (sessions.length === 0) return chains;

  const swallowed = new Set<Chain>();
  for (const chain of chains) {
    if (chain.sessionId !== null) continue;
    let host: Chain | null = null;
    for (const session of sessions) {
      if (chain.startMs < session.startMs || chain.endMs > session.endMs) continue;
      if (host === null || session.endMs - session.startMs < host.endMs - host.startMs) {
        host = session;
      }
    }
    if (host === null) continue;
    for (const group of chain.groups) extendChain(host, group);
    swallowed.add(chain);
  }
  if (swallowed.size === 0) return chains;

  // A block absorbed from the middle arrived after the ones around it — put the
  // chain back in clock order, which is what every consumer reads it as. Its
  // `id` stays the block it was born on: nothing can be absorbed ahead of that
  // one (an equal start would have made them the same group), and the calendar
  // keys its spine on it.
  for (const session of sessions) {
    session.groups.sort((a, b) => a.startMs - b.startMs);
    session.tasks.sort((a, b) => taskStartMs(a) - taskStartMs(b) || a.id.localeCompare(b.id));
  }
  return chains.filter((c) => !swallowed.has(c));
}

// ── Continuous runs ────────────────────────────────────────────────

// Nothing separates two consecutive groups when they run back to back, or when
// they are two blocks of the same explicit session. This is *not* connection:
// it is the reporting question "did the clock keep running here?", asked of the
// geometry alone, and it moves nothing.
export function isContinuous(prev: TaskGroup, next: TaskGroup): boolean {
  const sessionId = groupSessionId(prev);
  if (sessionId !== null && sessionId === groupSessionId(next)) return true;
  return next.startMs - prev.endMs <= SEQUENCE_GAP_MS;
}

// The stretches the clock ran without a break. `groups` must be chronological
// (buildGroups returns them that way).
export function buildRuns(groups: TaskGroup[]): TaskGroup[][] {
  const runs: TaskGroup[][] = [];
  for (const group of groups) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && isContinuous(prev, group)) last.push(group);
    else runs.push([group]);
  }
  return runs;
}

// Those stretches wrapped as chains, so the views built to render a sequence
// can render one. A stretch is still not a sequence — its blocks are not glued
// and dragging one leaves the others where they are — but "what was worked in
// one go" is exactly what the history timeline lists.
export function buildRunChains(groups: TaskGroup[]): Chain[] {
  return buildRuns(groups).map((run) => {
    const chain: Chain = {
      id: run[0].tasks[0].id,
      groups: [...run],
      tasks: run.flatMap((g) => g.tasks),
      startMs: run[0].startMs,
      endMs: Math.max(...run.map((g) => g.endMs)),
      sessionId: null,
      name: null,
    };
    for (const group of run) {
      chain.sessionId = chain.sessionId ?? groupSessionId(group);
      chain.name = chain.name ?? sessionNameOf(group.tasks);
    }
    return chain;
  });
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

// A chain worth drawing as a spine / listing as something that was worked. For
// a sequence (buildChains) that means it was glued by hand — a loose chain is
// always exactly one group. For a run (buildRunChains) it also covers a stretch
// of several blocks worked back to back, which is what the history lists.
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
// that gap; nothing is merged until it is pressed — that press *is* the
// approval, and it is the only way two blocks ever become one sequence.
//
// A gap of exactly zero counts: blocks laid back to back used to be glued on
// their own, so without the handle there would be no way left to join them.
export function mergeSuggestions(chains: Chain[]): MergeSuggestion[] {
  const out: MergeSuggestion[] = [];
  for (let i = 1; i < chains.length; i++) {
    const before = chains[i - 1];
    const after = chains[i];
    const gapMs = after.startMs - before.endMs;
    if (gapMs >= 0 && gapMs <= MERGE_GAP_MS) out.push({ before, after, gapMs });
  }
  return out;
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Blocks that sit inside a session ──────────────────────────────

// buildChains already *reads* a block standing entirely inside a session as
// part of it; this writes that down. A block that only looks like a member is
// a trap — it is drawn under the session's spine, is counted in it and runs
// with it, yet would be left behind the first time the session is dragged — so
// the plan makes the membership real as soon as it appears.
//
// This is the one join that needs no approval: the block is already inside the
// session on the clock. Two blocks merely following each other are never
// touched — that still takes the 🔗 handle.
export function absorbIntoSessions(tasks: Task[]): Task[] {
  const joined = new Map<string, { sessionId: string; sessionName: string | null }>();
  for (const chain of buildChains(buildGroups(tasks))) {
    if (chain.sessionId === null) continue;
    for (const task of chain.tasks) {
      if (task.sessionId === chain.sessionId) continue;
      joined.set(task.id, { sessionId: chain.sessionId, sessionName: chain.name });
    }
  }
  if (joined.size === 0) return tasks;
  return tasks.map((task) => {
    const patch = joined.get(task.id);
    return patch ? { ...task, ...patch } : task;
  });
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

// ── Editing a sequence from its own timeline ────────────────────────

// `tasks` must already be one chain's tasks, ordered by start (as
// `Chain.tasks` and `ChainRun.tasks` are) — the two views below are the only
// ones that let a sequence be edited from its own thermometer/spiral/list.

// The patches that move one task to a new position inside its sequence: every
// task is repacked back to back, in the new order, from the sequence's own
// start — each one keeping its own duration.
export function reorderPatches(
  tasks: Task[],
  fromIdx: number,
  toIdx: number
): { id: string; patch: { day: string; start: number } }[] {
  if (
    fromIdx === toIdx ||
    fromIdx < 0 ||
    toIdx < 0 ||
    fromIdx >= tasks.length ||
    toIdx >= tasks.length
  ) {
    return [];
  }
  const reordered = [...tasks];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);

  let cursor = taskStartMs(tasks[0]);
  const patches: { id: string; patch: { day: string; start: number } }[] = [];
  for (const t of reordered) {
    patches.push({ id: t.id, patch: shiftedSlot(t, cursor - taskStartMs(t)) });
    cursor += Math.max(0, t.plannedTime) * 1000;
  }
  return patches;
}

// The patches that change one task's planned duration, pushing every task
// after it in the sequence by the same delta so the whole thing stays back to
// back.
export function resizePatches(
  tasks: Task[],
  taskId: string,
  plannedTime: number
): { id: string; patch: Partial<Task> }[] {
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1 || plannedTime <= 0) return [];
  const deltaMs = (plannedTime - tasks[idx].plannedTime) * 1000;
  const patches: { id: string; patch: Partial<Task> }[] = [
    { id: tasks[idx].id, patch: { plannedTime } },
  ];
  for (let i = idx + 1; i < tasks.length && deltaMs !== 0; i++) {
    patches.push({ id: tasks[i].id, patch: shiftedSlot(tasks[i], deltaMs) });
  }
  return patches;
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
//
// `minDurationMin` is how short a block can be drawn before the calendar
// clamps its pixel height to stay readable (see the `Math.max(16, …)` at the
// call site). A block shorter than that visually reaches further down than
// its real end time, so — like Google Calendar — the very next block must be
// packed into its own column rather than drawn underneath it, or the two
// would appear to overlap even though nothing actually does.
export function daySegments(tasks: Task[], day: string, minDurationMin = 0): DaySegment[] {
  const from = dayStartMs(day);
  const to = from + DAY_MIN * MIN_MS;
  const minDurationMs = minDurationMin * MIN_MS;

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
    // Only for deciding column overlap — the segment itself still reports the
    // real bottom, so times and labels stay accurate.
    const visualBottom = Math.max(bottom, top + minDurationMs);
    if (top >= clusterEnd) closeCluster();
    let col = colEnds.findIndex((end) => end <= top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(visualBottom);
    } else {
      colEnds[col] = visualBottom;
    }
    clusterEnd = Math.max(clusterEnd, visualBottom);
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
