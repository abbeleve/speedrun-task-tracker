// Picking a batch of blocks on the calendar canvas.
//
// A press on empty canvas is ambiguous: drawn away from where it started it
// creates a block, held still on the spot for HOLD_MS it arms a *marquee*
// instead — a rectangle swept over the grid that picks up every block it
// touches, across day columns. With Ctrl (⌘) down there is nothing to wait
// for: the press is a marquee from the start, on empty canvas or on a block,
// and adds to the batch already standing. What it picks then moves as one
// batch, and can be declared a session of its own — or pulled out of the
// sequence it sits in into a sequence of its own.

import type { Task } from './types';
import type { Chain } from './schedule';
import { MIN_MS, dayStartMs, isScheduled, taskEndMs, taskStartMs } from './schedule';

// How long the button has to be held before the marquee arms.
export const HOLD_MS = 1000;

// How far the pointer may wander in that second and still count as held "on
// the spot": a hand resting on a mouse is never perfectly still, and a couple
// of pixels of drift must not be read as the start of a drawn block.
export const HOLD_SLOP_PX = 6;

// Whether the pointer is still where the press landed, give or take that slop.
export function onTheSpot(fromX: number, fromY: number, x: number, y: number): boolean {
  return Math.abs(x - fromX) <= HOLD_SLOP_PX && Math.abs(y - fromY) <= HOLD_SLOP_PX;
}

// The swept rectangle, in grid coordinates: whole day columns across, minutes
// of the day down. Anchor and cursor are kept as they came in — the rectangle
// is normalised where it is used, so dragging up or left works the same.
export interface Band {
  fromDayIdx: number;
  toDayIdx: number;
  fromMin: number;
  toMin: number;
}

export interface NormalBand {
  fromDayIdx: number;
  toDayIdx: number;
  topMin: number;
  bottomMin: number;
}

// The rectangle with its corners sorted and its columns clamped to the days
// actually on screen.
export function normalizeBand(band: Band, dayCount: number): NormalBand {
  return {
    fromDayIdx: Math.max(0, Math.min(band.fromDayIdx, band.toDayIdx)),
    toDayIdx: Math.min(dayCount - 1, Math.max(band.fromDayIdx, band.toDayIdx)),
    topMin: Math.min(band.fromMin, band.toMin),
    bottomMin: Math.max(band.fromMin, band.toMin),
  };
}

// Every scheduled block the rectangle touches, ordered by start. A block is
// tested against the window the rectangle covers *in each column it spans*, so
// one that spills past midnight is caught by sweeping either the column it
// starts in or the one it runs into. Backlog tasks have no slot and are never
// picked up.
export function tasksInBand(tasks: Task[], days: string[], band: Band): Task[] {
  const { fromDayIdx, toDayIdx, topMin, bottomMin } = normalizeBand(band, days.length);
  const picked = new Map<string, Task>();
  for (let i = fromDayIdx; i <= toDayIdx; i++) {
    const base = dayStartMs(days[i]);
    const fromMs = base + topMin * MIN_MS;
    const toMs = base + bottomMin * MIN_MS;
    if (toMs <= fromMs) continue;
    for (const task of tasks) {
      if (picked.has(task.id) || !isScheduled(task)) continue;
      if (taskStartMs(task) < toMs && taskEndMs(task) > fromMs) picked.set(task.id, task);
    }
  }
  return [...picked.values()].sort(
    (a, b) => taskStartMs(a) - taskStartMs(b) || a.id.localeCompare(b.id)
  );
}

// What the marquee holds once it covers `band`: the batch it started from plus
// every block it touches. Rebuilt from `baseIds` on each move, so shrinking the
// rectangle lets go of what it swept but never of what was picked before.
export function sweep(tasks: Task[], days: string[], band: Band, baseIds: string[]): Set<string> {
  return new Set([...baseIds, ...tasksInBand(tasks, days, band).map((t) => t.id)]);
}

// A Ctrl (⌘) click on a block: in the batch it goes out, otherwise it comes in.
export function toggled(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

// The one sequence every selected block belongs to, or null when the selection
// is empty or spread over several of them. Only blocks that share a sequence
// can be split off into a second one.
export function chainOfSelection(chains: Chain[], ids: Iterable<string>): Chain | null {
  const wanted = [...ids];
  if (wanted.length === 0) return null;
  const home = chains.find((c) => c.tasks.some((t) => t.id === wanted[0]));
  if (!home) return null;
  const inHome = new Set(home.tasks.map((t) => t.id));
  return wanted.every((id) => inHome.has(id)) ? home : null;
}

// Pull a batch of blocks into a session of their own. They keep their slots —
// nothing moves — but an explicit session id makes them a sequence in their own
// right (see buildChains: that id is the *only* thing that makes blocks one
// sequence), so the blocks left behind stay separate.
export function splitPatches(
  tasks: Task[],
  sessionId: string,
  sessionName: string | null = null
): { id: string; patch: { sessionId: string; sessionName: string | null } }[] {
  return tasks.map((task) => ({ id: task.id, patch: { sessionId, sessionName } }));
}
