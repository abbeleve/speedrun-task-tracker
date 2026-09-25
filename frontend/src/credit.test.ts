import { describe, it, expect } from 'vitest';
import type { Task, TaskType } from './types';
import { dayStartMs } from './schedule';
import { computeCredit, creditGroups, projectedFinishMs } from './credit';

const DAY = '2026-03-10';
const NEXT = '2026-03-11';

// Minutes from midnight → epoch ms on `day`.
const at = (day: string, min: number) => dayStartMs(day) + min * 60_000;
const hm = (h: number, m = 0) => h * 60 + m;

let seq = 0;

function task(opts: {
  day?: string;
  start: number; // minutes from midnight
  minutes: number;
  done?: number | null; // epoch ms
  name?: string;
  type?: TaskType;
}): Task {
  const day = opts.day ?? DAY;
  return {
    id: `t${++seq}`,
    name: opts.name ?? `task ${seq}`,
    plannedTime: opts.minutes * 60,
    completedAt: null,
    start: opts.start,
    finishedAt: opts.done ?? null,
    order: seq,
    emoji: '📋',
    color: '#3498db',
    type: opts.type ?? 'task',
    day,
    status: opts.done ? 'done' : 'in-progress',
  };
}

const credit = (tasks: Task[], nowMs: number) => computeCredit(creditGroups(tasks), nowMs);
const min = (sec: number) => sec / 60;

describe('overtake (обгон)', () => {
  it('banks the time won when a block is closed early', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const snap = credit([a], at(DAY, hm(10, 50)));
    expect(min(snap.banked)).toBe(15);
    expect(snap.frozen).toBe(true); // nothing else planned — the lead just waits
  });

  it('ignores a reminder entirely, even one overlapping the running block', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const reminder = task({ start: hm(10, 15), minutes: 30, type: 'reminder' });
    const withReminder = credit([a, reminder], at(DAY, hm(10, 50)));
    const without = credit([a], at(DAY, hm(10, 50)));
    expect(withReminder).toEqual(without);
  });

  it('keeps running against the next block when it starts immediately', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const b = task({ start: hm(11), minutes: 60 });

    // Inside B's shifted slot (10:45–11:45): the lead holds at 15 min and the
    // projection is "close it now and bank 70 min".
    const running = credit([a, b], at(DAY, hm(10, 50)));
    expect(running.active?.tasks[0].id).toBe(b.id);
    expect(min(running.lead)).toBe(15);
    expect(min(running.projected)).toBe(70);
    expect(running.frozen).toBe(false);

    // Right on the shifted end — still exactly 15 min ahead.
    expect(min(credit([a, b], at(DAY, hm(11, 45))).lead)).toBe(15);
    // Past the planned end the lead is gone and turns into a lag.
    expect(min(credit([a, b], at(DAY, hm(12, 10))).lead)).toBe(-10);
  });

  it('carries the lead through the next block when it is also closed early', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const b = task({ start: hm(11), minutes: 60, done: at(DAY, hm(11, 30)) });
    expect(min(credit([a, b], at(DAY, hm(11, 35))).banked)).toBe(30);
  });

  it('freezes the lead in a gap and hands it to the next block intact', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const b = task({ start: hm(12), minutes: 60 });

    const waiting = credit([a, b], at(DAY, hm(11, 30)));
    expect(waiting.frozen).toBe(true);
    expect(waiting.active).toBeNull();
    expect(min(waiting.lead)).toBe(15);

    // The 15 banked minutes buy an 11:45 start, so B may begin early…
    const early = credit([a, b], at(DAY, hm(11, 50)));
    expect(early.frozen).toBe(false);
    expect(min(early.lead)).toBe(15);

    // …and closing it 15 min before its slot ends keeps exactly that lead.
    const b2 = { ...b, finishedAt: at(DAY, hm(12, 45)), status: 'done' as const };
    expect(min(credit([a, b2], at(DAY, hm(12, 50))).banked)).toBe(15);
  });

  it('measures a parallel group against its latest planned end', () => {
    // 10:00–11:00 alongside 10:00–10:30; both closed by 10:40.
    const long = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 40)) });
    const short = task({ start: hm(10), minutes: 30, done: at(DAY, hm(10, 20)) });
    const snap = credit([long, short], at(DAY, hm(10, 45)));
    expect(min(snap.banked)).toBe(20);
  });

  it('holds a parallel group open until its last task is closed', () => {
    const long = task({ start: hm(10), minutes: 60 });
    const short = task({ start: hm(10), minutes: 30, done: at(DAY, hm(10, 20)) });
    const snap = credit([long, short], at(DAY, hm(10, 30)));
    expect(snap.active?.tasks).toHaveLength(2);
    expect(snap.banked).toBe(0);
    expect(min(snap.projected)).toBe(30);
  });

  it('wins the whole block when it was already closed before its slot', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    // Closed in the morning, long before its own 15:00 slot.
    const later = task({ start: hm(15), minutes: 60, done: at(DAY, hm(10, 30)) });
    const snap = credit([a, later], at(DAY, hm(11)));
    expect(min(snap.banked)).toBe(75); // 15 kept + the full hour skipped
  });

  it('does not credit a future block before the plan reaches it', () => {
    const open = task({ start: hm(10), minutes: 60 });
    const later = task({ start: hm(15), minutes: 60, done: at(DAY, hm(10, 30)) });
    const snap = credit([open, later], at(DAY, hm(10, 30)));
    expect(snap.banked).toBe(0);
    expect(snap.active?.tasks[0].id).toBe(open.id);
  });

  it('keeps the lead across a long gap inside the same day', () => {
    const morning = task({ start: hm(9), minutes: 60, done: at(DAY, hm(9, 45)) });
    const evening = task({ start: hm(15), minutes: 60 });
    expect(min(credit([morning, evening], at(DAY, hm(12))).lead)).toBe(15);
  });

  it('keeps the lead past midnight when the next block is a true sequence', () => {
    // 23:00–00:00 NEXT, done 10 min early, and the next block starts exactly
    // where it left off — one sequence straddling the seam.
    const late = task({ start: hm(23), minutes: 60, done: at(DAY, hm(23, 50)) });
    const after = task({ day: NEXT, start: hm(0), minutes: 60 });
    const snap = credit([late, after], at(NEXT, hm(0, 10)));
    expect(min(snap.banked)).toBe(10);
    expect(snap.active?.tasks[0].id).toBe(after.id);
    expect(snap.closedDays).toEqual([]);
  });

  it('drops the lead across midnight when the blocks are not one sequence', () => {
    // Same lead as above, but a real 5-minute gap sits between the two
    // blocks' slots — not a sequence, so the new date starts fresh even
    // though the gap itself is short.
    const late = task({ start: hm(23), minutes: 55, done: at(DAY, hm(23, 45)) });
    const after = task({ day: NEXT, start: hm(0, 5), minutes: 60 });
    const snap = credit([late, after], at(NEXT, hm(0, 15)));
    expect(snap.banked).toBe(0);
    expect(snap.active?.tasks[0].id).toBe(after.id);
    expect(snap.closedDays).toEqual([{ day: DAY, overtakeSec: 600 }]);
  });

  it('holds the lead open while a block that crosses midnight is still running', () => {
    // 23:00 DAY → 00:30 NEXT, still unfinished: a single block never takes a
    // day boundary against itself, so it just keeps running past the seam.
    const crossing = task({ start: hm(23), minutes: 90 });
    const after = task({ day: NEXT, start: hm(9), minutes: 60 });
    const running = credit([crossing, after], at(NEXT, hm(0, 10)));
    expect(running.active?.tasks[0].id).toBe(crossing.id);
    expect(running.closedDays).toEqual([]);
  });

  it('drops the lead the moment the crossing block closes, without waiting for the next one', () => {
    // Same block, now closed 10 min early — well before `after` (09:00) even
    // starts. NEXT still opens at zero: the lead is not held open just
    // because nothing else has started yet.
    const crossing = task({ start: hm(23), minutes: 90 }); // 23:00 → 00:30 NEXT
    const after = task({ day: NEXT, start: hm(9), minutes: 60 });
    const closed = { ...crossing, finishedAt: at(NEXT, hm(0, 20)), status: 'done' as const };

    const snap = credit([closed, after], at(NEXT, hm(0, 25)));
    expect(snap.banked).toBe(0);
    expect(snap.frozen).toBe(true);
    expect(snap.closedDays).toEqual([{ day: DAY, overtakeSec: 600 }]);
  });

  it('reports a day as closed once real time has moved past it with nothing open', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const snap = credit([a], at(NEXT, hm(9)));
    expect(snap.banked).toBe(0);
    expect(snap.closedDays).toEqual([{ day: DAY, overtakeSec: 900 }]);
  });

  it('drops the lead at a ten-minute gap on the new date', () => {
    // The session is put down at 23:30 and picked up at 00:15 — that is a new
    // working day, so the evening's lead does not carry into it.
    const late = task({ start: hm(23), minutes: 30, done: at(DAY, hm(23, 20)) });
    const after = task({ day: NEXT, start: hm(0, 15), minutes: 60 });
    const snap = credit([late, after], at(NEXT, hm(0, 20)));
    expect(snap.banked).toBe(0);
    expect(snap.epochStartMs).toBe(at(NEXT, hm(0, 15)));
  });

  it('still shows the day\'s lead in the evening, before the new day starts', () => {
    const done = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const tomorrow = task({ day: NEXT, start: hm(9), minutes: 60 });
    const snap = credit([done, tomorrow], at(DAY, hm(23, 30)));
    expect(min(snap.banked)).toBe(15);
    expect(snap.frozen).toBe(true);
    // Tomorrow's block is past the boundary — it is not part of today's plan.
    expect(snap.remaining).toHaveLength(0);
  });

  it('drops the lead at the first long gap on a new date', () => {
    const late = task({ start: hm(22), minutes: 60, done: at(DAY, hm(22, 45)) });
    const tomorrow = task({ day: NEXT, start: hm(9), minutes: 60 });
    const snap = credit([late, tomorrow], at(NEXT, hm(9, 30)));
    expect(snap.banked).toBe(0);
    expect(snap.epochStartMs).toBe(at(NEXT, hm(9)));
  });

  it('starts a fresh day after a day was abandoned half-finished', () => {
    const abandoned = task({ start: hm(10), minutes: 60 });
    const today = task({ day: NEXT, start: hm(10), minutes: 60 });
    const snap = credit([abandoned, today], at(NEXT, hm(10, 15)));
    expect(snap.banked).toBe(0);
    expect(snap.active?.tasks[0].id).toBe(today.id);
    expect(min(snap.projected)).toBe(45);
  });

  it('projects when the rest of the plan will be done', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const b = task({ start: hm(11), minutes: 60 });
    const c = task({ start: hm(12), minutes: 60 });
    const snap = credit([a, b, c], at(DAY, hm(11)));
    expect(projectedFinishMs(snap)).toBe(at(DAY, hm(12, 45)));
  });

  it('has nothing to say about an empty plan', () => {
    const snap = credit([], at(DAY, hm(10)));
    expect(snap).toMatchObject({ banked: 0, lead: 0, frozen: true, active: null });
  });
});

describe('overtake ignores rest (☕ Отдых)', () => {
  it('wins nothing for a break closed before its slot even begins', () => {
    const rest = task({ start: hm(14), minutes: 60, type: 'rest', done: at(DAY, hm(12)) });
    const snap = credit([rest], at(DAY, hm(12, 5)));
    expect(snap.banked).toBe(0);
    expect(snap.epochStartMs).toBeNull(); // the plan has no work in it at all
  });

  it('keeps the lead won before a break, however early the break is closed', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const rest = task({ start: hm(11), minutes: 30, type: 'rest', done: at(DAY, hm(11, 5)) });
    const snap = credit([a, rest], at(DAY, hm(11, 10)));
    expect(min(snap.banked)).toBe(15);
  });

  it('holds the lead frozen through a running break instead of decaying it', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const rest = task({ start: hm(11), minutes: 30, type: 'rest' });
    const b = task({ start: hm(11, 30), minutes: 60 });
    // 11:10: resting. B's shifted slot opens at 11:15 — until then nothing is
    // running and the lead just waits.
    const snap = credit([a, rest, b], at(DAY, hm(11, 10)));
    expect(snap.active).toBeNull();
    expect(snap.frozen).toBe(true);
    expect(min(snap.lead)).toBe(15);
    expect(snap.remaining.map((g) => g.tasks[0].id)).toEqual([b.id]);
  });

  it('loses nothing to a break left open long after its slot', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const rest = task({ start: hm(11), minutes: 30, type: 'rest' });
    const snap = credit([a, rest], at(DAY, hm(15)));
    expect(min(snap.lead)).toBe(15);
    expect(snap.frozen).toBe(true);
  });

  it('does not let an open break hold a work block it overlaps open', () => {
    const a = task({ start: hm(10), minutes: 60, done: at(DAY, hm(10, 45)) });
    const rest = task({ start: hm(10, 30), minutes: 60, type: 'rest' });
    const withRest = credit([a, rest], at(DAY, hm(10, 50)));
    expect(withRest).toEqual(credit([a], at(DAY, hm(10, 50))));
    expect(min(withRest.banked)).toBe(15);
  });
});
