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
//  3. The next block is far away but still the same day → nothing happens in
//     between: the lead is frozen and waits, the way a `rest` block used to
//     hold it. When the block is reached it may be started `lead` earlier, so
//     the lead is kept rather than spent.
//  4. Parallel blocks count as one group: the group closes with its *last*
//     task, and the lead is measured against the latest planned end in it.
//  5. Closing a group before its (shifted) slot even begins wins the whole
//     block: the lead grows by the group's duration instead.
//  6. A lead belongs to one calendar day. It only survives past midnight while
//     an actual *sequence* is running through the seam — schedule.ts's chain:
//     blocks that follow each other with no real gap, or blocks glued into the
//     same explicit session, however far apart their times land. The moment
//     that chain closes (or, if nothing was running at midnight, at midnight
//     itself) the day is over: whatever comes next starts the new day's plan
//     fresh, at zero — even if the chain that carried yesterday's lead across
//     the seam happens to finish well into today.
//  7. Rest (☕ Отдых) is not work, so the engine never sees it (creditGroups):
//     a break is a gap like any other — the lead is frozen through it (rule 3)
//     — so cutting it short or skipping it wins nothing, and overrunning it
//     or leaving it open costs nothing. Only the work around it counts.
//
// Everything here is derived from the plan + the current time, so nothing has
// to be stored to keep the live number right: reload the page mid-day and the
// lead is exactly what it was. `closedDays` is the one exception — it reports
// the final lead of every day that has fully closed while scanning `groups`,
// purely so the caller can persist that number as history (see api.ts); it is
// still recomputed from the plan every time, never read back.

import type { Task } from './types';
import type { TaskGroup } from './schedule';
import { buildGroups, dayKeyOf, isContinuous } from './schedule';

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
  // Start of the current day's lead, if any day is currently open.
  epochStartMs: number | null;
  // Groups of the current day still to be closed (the running one included),
  // stopping at the boundary where this lead would be dropped.
  remaining: TaskGroup[];
  // The final banked lead of every calendar day that closed while scanning
  // `groups`, oldest first — everything strictly before the day that is
  // either still open or not yet reached. The caller persists these.
  closedDays: { day: string; overtakeSec: number }[];
}

const EMPTY: CreditSnapshot = {
  banked: 0,
  lead: 0,
  projected: 0,
  frozen: true,
  active: null,
  epochStartMs: null,
  remaining: [],
  closedDays: [],
};

// The groups the engine reads: the plan's work blocks only (rule 7). Grouped
// after rest is dropped, so a break overlapping a work block neither holds that
// block's group open nor glues it to the next one.
export function creditGroups(tasks: Task[]): TaskGroup[] {
  return buildGroups(tasks.filter((task) => task.type !== 'rest'));
}

// `groups` must be chronological (buildGroups returns them that way), and
// should come from creditGroups so rest stays out of the lead.
export function computeCredit(groups: TaskGroup[], nowMs: number): CreditSnapshot {
  if (groups.length === 0) return { ...EMPTY, closedDays: [] };

  let banked = 0;
  let epochDay: string | null = null;
  let epochStartMs: number | null = null;
  let prevEndMs: number | null = null;
  let active: TaskGroup | null = null;
  // Set once an unfinished group is reached: nothing after it can be credited
  // yet, because its own time has not been spent. Only a day boundary clears
  // it — otherwise a day abandoned halfway would block the lead forever.
  let blocked = false;
  let firstOpenIdx = -1;
  let endIdx = groups.length;
  const closedDays: { day: string; overtakeSec: number }[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupDay = dayKeyOf(group.startMs);
    // Two groups the clock ran straight through — back to back, or two blocks
    // of one session — never take a day boundary between them, however far
    // their times land from midnight: that is a stretch of work carried into
    // the next day, not a new day. It says nothing about them being connected
    // (sequences are explicit — see schedule.ts's buildChains); it is only
    // whether the clock ever stopped.
    const sameRun = i > 0 && isContinuous(groups[i - 1], group);
    const boundary = prevEndMs !== null && !sameRun && groupDay !== epochDay;

    if (boundary) {
      // Two different reasons a day is not over yet, depending on what it is
      // waiting on:
      //  - the last group is still open (`blocked`): nothing has actually
      //    closed to judge the date against, so give it the benefit of the
      //    doubt until the clock reaches *this* block's own start — otherwise
      //    a task simply left unfinished would abandon the lead the instant
      //    a later day happens to appear in the plan.
      //  - the last group is closed: it closed at a real moment in the past,
      //    so the day is over as soon as the wall clock itself is on a later
      //    date — a lead that survived a sequence past midnight does not get
      //    to wait for the next block to actually start before letting go.
      const stillToday = blocked ? nowMs < group.startMs : dayKeyOf(nowMs) === epochDay;
      if (stillToday) {
        endIdx = i;
        break;
      }
      closedDays.push({ day: epochDay!, overtakeSec: banked });
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

  // Real time may already be a day (or several) past the plan's last group,
  // with nothing open to carry it further — that day is closed too, exactly
  // as if a boundary had fired right against it.
  if (!blocked && epochDay !== null && dayKeyOf(nowMs) !== epochDay) {
    closedDays.push({ day: epochDay, overtakeSec: banked });
    // That lead belonged to the closed day — today opens with a clean sheet.
    banked = 0;
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
    closedDays,
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
