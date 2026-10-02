// Cutting a block in two (hold C and click it on the calendar).
//
// The first piece is the block itself, cut short at the click; the second is a
// deep copy of it that fills the rest of the slot — same name, same notes, same
// colours, same links. Together the two pieces cover exactly the slot the
// block had, so the plan, the habit minutes and the overtake add up to what
// they were before the cut.

import type { Task } from './types';
import { MIN_MS, isReminder, isScheduled, slotAtMs, taskEndMs, taskStartMs } from './schedule';

// Neither piece of a cut is ever shorter than this.
export const MIN_CUT_PIECE_MIN = 5;

// A cut is aimed onto the grid's 5-minute steps…
export const CUT_GRID_MIN = 5;

// …unless it comes within this many screen pixels of the current moment:
// then it is pulled onto now, the way "I worked on this until now" is cut.
// Pixels rather than minutes, so the pull feels the same at any zoom.
export const NOW_PULL_PX = 8;

// The key held to cut, read by its place on the keyboard rather than the
// letter it types, so it is the same key on a Russian layout («с»).
export const CUT_KEY_CODE = 'KeyC';

type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>;

// Whether this key press arms the cut: C on its own — not Ctrl/⌘+C (copy),
// and not while typing into a field, where it is just a letter.
export function armsCut(e: KeyLike): boolean {
  if (e.code !== CUT_KEY_CODE || e.ctrlKey || e.metaKey || e.altKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return true;
  return !(
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

// A copy of `task` under a new id that shares nothing with it: the nested
// colour animation and repeat rule are cloned too, so editing one task can
// never reach into the other.
export function cloneTask(task: Task, id: string): Task {
  return { ...structuredClone(task), id };
}

// Where a click at `atMs` cuts `task`: rounded to a whole minute and kept far
// enough inside the block that both pieces last at least MIN_CUT_PIECE_MIN.
// Null for a block that cannot be cut — one in the backlog, a reminder (a
// window, not a piece of work) or one too short to leave two such pieces.
export function cutPoint(task: Task, atMs: number): number | null {
  if (!isScheduled(task) || isReminder(task)) return null;
  const pieceMs = MIN_CUT_PIECE_MIN * MIN_MS;
  const earliest = Math.ceil((taskStartMs(task) + pieceMs) / MIN_MS) * MIN_MS;
  const latest = Math.floor((taskEndMs(task) - pieceMs) / MIN_MS) * MIN_MS;
  if (!Number.isFinite(atMs) || earliest > latest) return null;
  return Math.min(latest, Math.max(earliest, Math.round(atMs / MIN_MS) * MIN_MS));
}

// Where a press at `pointerMs` cuts `task`, and whether the now magnet took
// it: within `pullMs` of `nowMs` it lands on now (to the minute) — provided
// the block can be cut right there, so a now just outside it, or too near
// one of its ends, pulls nothing — and anywhere else on the CUT_GRID_MIN
// grid. Null when the block cannot be cut at all.
export function cutTarget(
  task: Task,
  pointerMs: number,
  nowMs: number,
  pullMs: number
): { ms: number; atNow: boolean } | null {
  const atNow = cutPoint(task, nowMs);
  if (
    atNow !== null &&
    atNow === Math.round(nowMs / MIN_MS) * MIN_MS &&
    Math.abs(pointerMs - nowMs) <= pullMs
  ) {
    return { ms: atNow, atNow: true };
  }
  const gridMs = CUT_GRID_MIN * MIN_MS;
  const ms = cutPoint(task, Math.round(pointerMs / gridMs) * gridMs);
  return ms === null ? null : { ms, atNow: false };
}

// The two pieces `task` falls into when cut at `atMs` (see cutPoint), or null
// when it cannot be cut. The first keeps the task's id; the second is a fresh
// task from `makeId` starting where the first now ends — on the next day if
// the cut lands past midnight.
//
// What the second piece deliberately does not copy as-is:
//   - `repeat`: the pieces are one occurrence, so only the first carries the
//     rule — closing both must schedule the next occurrence once, not twice.
//     `repeatOf` is kept: if the occurrence was scheduled by an earlier one,
//     reopening that one takes back both pieces.
// Everything else — done state, session, pin, habit and deadline links — is
// the block's, so it is the same on both pieces.
export function cutTask(task: Task, atMs: number, makeId: () => string): [Task, Task] | null {
  const cutMs = cutPoint(task, atMs);
  if (cutMs === null) return null;
  const firstSec = Math.round((cutMs - taskStartMs(task)) / 1000);
  const first: Task = { ...task, plannedTime: firstSec };
  const second: Task = {
    ...cloneTask(task, makeId()),
    ...slotAtMs(cutMs),
    plannedTime: task.plannedTime - firstSec,
    repeat: null,
  };
  return [first, second];
}
