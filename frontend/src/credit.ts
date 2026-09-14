// The overtake engine ("обгон") — how far ahead of the plan you are running.
//
// The plan is wall-clock now, so "ahead" is a real amount of time you have won
// back: finish a block before its slot ends and the rest of the schedule can
// slide that much earlier. The rules:
//
//  1. Closing a group early banks `end − now`: the plan may start that much
//     sooner from here on.
//  2. The next block starts immediately (a *sequence*) → the lead simply keeps
//     running against that block, exactly like the old sequential tracker.
//  3. The next block is far away → nothing happens in between: the lead is
//     frozen and waits, the way a `rest` block used to hold it. When the block
//     is reached it may be started `lead` earlier, so the lead is kept rather
//     than spent.
//  4. Parallel blocks count as one group: the group closes with its *last*
//     task, and the lead is measured against the latest planned end in it.
//  5. Closing a group before its (shifted) slot even begins wins the whole
//     block: the lead grows by the group's duration instead.
//  6. A lead belongs to a "day" — a working session, not a date. It survives
//     past midnight while the blocks keep coming, and is only dropped at the
//     first gap of EPOCH_GAP_MS or more that falls on a later date than the one
//     the lead was earned on. Inside one date even a long gap keeps it: an
//     evening block still answers to the morning's plan.
//
// Everything here is derived from the plan + the current time, so nothing has
// to be stored: reload the page mid-day and the lead is exactly what it was.

import type { TaskGroup } from './schedule';
import { MIN_MS, dayKeyOf } from './schedule';

// A gap of this size or more, once the date has changed, closes the lead's
// epoch: the next block starts a fresh "day" with a clean sheet. Ten minutes is
// about as long as a session survives being put down — anything longer on a new
// date is a new working day, however late the previous one ran.
export const EPOCH_GAP_MS = 10 * MIN_MS;

export interface CreditSnapshot {
  // Seconds of lead carried out of the last closed group (negative = behind).
  // This is the number that is frozen while nothing is running.
  banked: number;
  // Where you actually stand right now: equal to `banked` while the running
  // group still fits in its shifted slot, and decaying once it overruns.
  lead: number;
  // What `banked` would become if the running group were closed this second —
  // the live "possible time save" the old tracker showed as its delta.
  projected: number;
  // No group is running (a gap, or the day has not begun): the lead is frozen.
  frozen: boolean;
  // The group the clock is currently inside, if any.
  active: TaskGroup | null;
  // Start of the current lead's epoch — the first block it was earned from.
  epochStartMs: number | null;
  // Groups of the current epoch still to be closed (the running one included),
  // stopping at the boundary where this lead would be dropped.
  remaining: TaskGroup[];
}

const EMPTY: CreditSnapshot = {
  banked: 0,
  lead: 0,
  projected: 0,
  frozen: true,
  active: null,
  epochStartMs: null,
  remaining: [],
};

// `groups` must be chronological (buildGroups returns them that way).
export function computeCredit(groups: TaskGroup[], nowMs: number): CreditSnapshot {
  if (groups.length === 0) return { ...EMPTY };

  let banked = 0;
  let epochDay: string | null = null;
  let epochStartMs: number | null = null;
  let prevEndMs: number | null = null;
  let active: TaskGroup | null = null;
  // Set once an unfinished group is reached: nothing after it can be credited
  // yet, because its own time has not been spent. Only an epoch boundary
  // (rule 6) clears it — otherwise a day abandoned halfway would block the
  // lead forever.
  let blocked = false;
  let firstOpenIdx = -1;
  let endIdx = groups.length;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupDay = dayKeyOf(group.startMs);
    const boundary =
      prevEndMs !== null &&
      group.startMs - prevEndMs >= EPOCH_GAP_MS &&
      groupDay !== epochDay;

    if (boundary) {
      // The epoch only really ends when the clock gets there: until tomorrow's
      // first block begins, today's lead is still today's lead, and nothing
      // beyond the boundary belongs to it.
      if (nowMs < group.startMs) {
        endIdx = i;
        break;
      }
      banked = 0;
      epochDay = groupDay;
      epochStartMs = group.startMs;
      blocked = false;
      active = null;
      firstOpenIdx = -1;
    }

    if (epochDay === null) {
      epochDay = groupDay;
      epochStartMs = group.startMs;
    }
    prevEndMs = prevEndMs === null ? group.endMs : Math.max(prevEndMs, group.endMs);
    if (blocked) continue;

    // The slot may be entered `banked` early — that is what a banked lead buys.
    const shiftedStartMs = group.startMs - banked * 1000;

    if (group.doneMs !== null) {
      banked = (group.endMs - Math.max(group.doneMs, shiftedStartMs)) / 1000;
      continue;
    }

    blocked = true;
    firstOpenIdx = i;
    if (nowMs >= shiftedStartMs) active = group;
  }

  const projected = active ? (active.endMs - nowMs) / 1000 : banked;
  return {
    banked,
    lead: active ? Math.min(banked, projected) : banked,
    projected,
    frozen: active === null,
    active,
    epochStartMs,
    remaining: firstOpenIdx >= 0 ? groups.slice(firstOpenIdx, endIdx) : [],
  };
}

// When the remaining plan is expected to be finished, given the current lead:
// every block still open slides `lead` earlier. Null when nothing is left.
export function projectedFinishMs(snapshot: CreditSnapshot): number | null {
  const last = snapshot.remaining[snapshot.remaining.length - 1];
  if (!last) return null;
  return last.endMs - snapshot.lead * 1000;
}

// Signed lead of a single finished group against its own slot, in seconds
// (positive = closed early). Used to label a block on the calendar.
export function groupDeltaSec(group: TaskGroup): number | null {
  if (group.doneMs === null) return null;
  return (group.endMs - group.doneMs) / 1000;
}
