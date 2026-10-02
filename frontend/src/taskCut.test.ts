import { describe, expect, it } from 'vitest';
import type { Habit, Task } from './types';
import {
  CUT_KEY_CODE,
  MIN_CUT_PIECE_MIN,
  armsCut,
  cloneTask,
  cutPoint,
  cutTarget,
  cutTask,
} from './taskCut';
import { buildChains, buildGroups, dayStartMs, MIN_MS, taskEndMs, taskStartMs } from './schedule';
import { scheduledAheadIds, spawnNextOccurrence } from './tasks';
import { habitAuto } from './habits';

const DAY = '2026-10-02';

// 10:00–11:00, with every optional field set so a lost one shows up.
const block = (partial: Partial<Task> = {}): Task => ({
  id: 'a',
  name: 'Write the report',
  description: 'Sections 2 and 3',
  plannedTime: 3600,
  completedAt: null,
  start: 600,
  finishedAt: null,
  order: 4,
  emoji: '📝',
  color: '#2ecc71',
  colorAnimation: { type: 'flow', colors: ['#2ecc71', '#3498db'], direction: 90, durationSec: 6 },
  type: 'task',
  day: DAY,
  status: 'in-progress',
  pinned: false,
  repeat: null,
  sessionId: 's-1',
  sessionName: 'Morning',
  sequenceGradient: 'linear-gradient(90deg, #111, #222)',
  habitId: 'h-1',
  deadlineId: 'd-1',
  ...partial,
});

const at = (day: string, min: number) => dayStartMs(day) + min * MIN_MS;
let ids = 0;
const makeId = () => `cut-${++ids}`;

describe('cutTask', () => {
  it('cuts a block where it was clicked, into two that cover its slot exactly', () => {
    const task = block();
    const [first, second] = cutTask(task, at(DAY, 625), makeId)!;

    expect(first.id).toBe('a');
    expect(first.start).toBe(600);
    expect(first.plannedTime).toBe(25 * 60);
    expect(second.id).not.toBe('a');
    expect(second.day).toBe(DAY);
    expect(second.start).toBe(625);
    expect(second.plannedTime).toBe(35 * 60);
    expect(taskStartMs(first)).toBe(taskStartMs(task));
    expect(taskEndMs(first)).toBe(taskStartMs(second));
    expect(taskEndMs(second)).toBe(taskEndMs(task));
  });

  it('keeps the name as it is — the second piece is not a "копия"', () => {
    const [first, second] = cutTask(block(), at(DAY, 630), makeId)!;
    expect(first.name).toBe('Write the report');
    expect(second.name).toBe('Write the report');
  });

  it('makes the second piece a deep copy of the block, sharing no nested object', () => {
    const task = block({ repeat: { mode: 'fixed', baseDays: 2 } });
    const [, second] = cutTask(task, at(DAY, 630), makeId)!;

    // Only its id, its slot and the repeat rule (see the recurring case below)
    // differ from the block's.
    expect({
      ...second,
      id: task.id,
      start: task.start,
      plannedTime: task.plannedTime,
      repeat: task.repeat,
    }).toEqual(task);

    expect(second.colorAnimation).not.toBe(task.colorAnimation);
    second.colorAnimation!.colors.push('#e74c3c');
    second.colorAnimation!.direction = 0;
    expect(task.colorAnimation).toEqual({
      type: 'flow',
      colors: ['#2ecc71', '#3498db'],
      direction: 90,
      durationSec: 6,
    });
  });

  it('cuts on whole minutes and never leaves a piece shorter than the minimum', () => {
    const task = block();
    expect(cutTask(task, at(DAY, 630) + 20_000, makeId)![1].start).toBe(630);
    // A click right at an edge still leaves the minimum on that side.
    expect(cutTask(task, at(DAY, 601), makeId)![1].start).toBe(600 + MIN_CUT_PIECE_MIN);
    expect(cutTask(task, at(DAY, 659), makeId)![1].start).toBe(660 - MIN_CUT_PIECE_MIN);
    expect(cutTask(task, at(DAY, 300), makeId)![1].start).toBe(600 + MIN_CUT_PIECE_MIN);
  });

  it('refuses what cannot be cut: too short, in the backlog, a reminder', () => {
    expect(cutTask(block({ plannedTime: (2 * MIN_CUT_PIECE_MIN - 1) * 60 }), at(DAY, 604), makeId)).toBeNull();
    expect(cutTask(block({ plannedTime: 2 * MIN_CUT_PIECE_MIN * 60 }), at(DAY, 604), makeId)).not.toBeNull();
    expect(cutTask(block({ status: 'open', start: null }), at(DAY, 630), makeId)).toBeNull();
    expect(cutTask(block({ type: 'reminder' }), at(DAY, 630), makeId)).toBeNull();
    expect(cutPoint(block(), Number.NaN)).toBeNull();
  });

  it('puts the second piece on the next day when the cut lands past midnight', () => {
    const task = block({ start: 23 * 60 + 30, plannedTime: 2 * 3600 });
    const [first, second] = cutTask(task, at('2026-10-03', 30), makeId)!;
    expect(first.day).toBe(DAY);
    expect(first.plannedTime).toBe(60 * 60);
    expect(second.day).toBe('2026-10-03');
    expect(second.start).toBe(30);
    expect(taskEndMs(second)).toBe(taskEndMs(task));
  });

  it('keeps the seconds of a duration that is not whole minutes on the second piece', () => {
    const task = block({ plannedTime: 25 * 60 + 30 });
    const [first, second] = cutTask(task, at(DAY, 610), makeId)!;
    expect(first.plannedTime).toBe(600);
    expect(second.plannedTime).toBe(15 * 60 + 30);
    expect(taskEndMs(second)).toBe(taskEndMs(task));
  });

  it('keeps both pieces in the block\'s session', () => {
    const before = block({ id: 'b', start: 540, plannedTime: 3600 });
    const [first, second] = cutTask(block(), at(DAY, 630), makeId)!;
    const chains = buildChains(buildGroups([before, first, second]));
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks.map((t) => t.id)).toEqual(['b', 'a', second.id]);
  });

  it('cuts a closed block into two closed pieces that add up to the same habit minutes', () => {
    const finishedAt = at(DAY, 655);
    const task = block({ status: 'done', finishedAt });
    const [first, second] = cutTask(task, at(DAY, 620), makeId)!;
    expect(first.status).toBe('done');
    expect(second.status).toBe('done');
    expect(first.finishedAt).toBe(finishedAt);
    expect(second.finishedAt).toBe(finishedAt);

    const habit = { id: 'h-1', format: 'time' } as Habit;
    expect(habitAuto(habit, DAY, [first, second])).toBe(habitAuto(habit, DAY, [task]));
  });

  it('schedules a recurring block\'s next occurrence once, from the first piece', () => {
    const task = block({ repeat: { mode: 'fixed', baseDays: 1 }, repeatIndex: 2, repeatOf: 'parent' });
    const [first, second] = cutTask(task, at(DAY, 630), makeId)!;
    expect(first.repeat).toEqual({ mode: 'fixed', baseDays: 1 });
    expect(second.repeat).toBeNull();
    expect(spawnNextOccurrence(first, makeId, DAY)).not.toBeNull();
    expect(spawnNextOccurrence(second, makeId, DAY)).toBeNull();
    // Both pieces still belong to the occurrence that scheduled them, so
    // reopening that one takes the whole occurrence back.
    expect(second.repeatOf).toBe('parent');
    expect(scheduledAheadIds([first, second, block({ id: 'x', repeatOf: 'other' })], 'parent'))
      .toEqual(['a', second.id]);
  });
});

describe('cutTarget', () => {
  const pull = 3 * MIN_MS;

  it('snaps to the 5-minute grid away from now', () => {
    expect(cutTarget(block(), at(DAY, 622), at(DAY, 645), pull)).toEqual({
      ms: at(DAY, 620),
      atNow: false,
    });
    expect(cutTarget(block(), at(DAY, 623), at(DAY, 645), pull)).toEqual({
      ms: at(DAY, 625),
      atNow: false,
    });
  });

  it('is pulled onto now when aimed close to it, to the nearest minute', () => {
    const now = at(DAY, 637) + 40_000; // 10:37:40
    expect(cutTarget(block(), at(DAY, 635), now, pull)).toEqual({ ms: at(DAY, 638), atNow: true });
    expect(cutTarget(block(), at(DAY, 640), now, pull)).toEqual({ ms: at(DAY, 638), atNow: true });
    // Just out of reach, the grid has it again.
    expect(cutTarget(block(), at(DAY, 641), now, pull)).toEqual({ ms: at(DAY, 640), atNow: false });
  });

  it('cuts exactly where it said it would', () => {
    const target = cutTarget(block(), at(DAY, 636), at(DAY, 637), pull)!;
    const [first, second] = cutTask(block(), target.ms, makeId)!;
    expect(taskEndMs(first)).toBe(target.ms);
    expect(second.start).toBe(637);
  });

  it('pulls nothing when now is outside the block or too near one of its ends', () => {
    // Now 2 minutes before the block: a press 1 minute in stays on the grid
    // (clamped to the first piece's minimum), not dragged out to now.
    expect(cutTarget(block(), at(DAY, 601), at(DAY, 598), pull)).toEqual({
      ms: at(DAY, 605),
      atNow: false,
    });
    // Now 2 minutes into it: a cut there would leave a piece too short.
    expect(cutTarget(block(), at(DAY, 603), at(DAY, 602), pull)?.atNow).toBe(false);
    expect(cutTarget(block(), at(DAY, 657), at(DAY, 658), pull)?.atNow).toBe(false);
  });

  it('gives nothing for a block that cannot be cut', () => {
    expect(cutTarget(block({ type: 'reminder' }), at(DAY, 630), at(DAY, 630), pull)).toBeNull();
  });
});

describe('scheduledAheadIds', () => {
  it('lists only the occurrences still to do', () => {
    const tasks = [
      block({ id: 'next', repeatOf: 'p' }),
      block({ id: 'closed', repeatOf: 'p', status: 'done', finishedAt: 1 }),
      block({ id: 'loose' }),
    ];
    expect(scheduledAheadIds(tasks, 'p')).toEqual(['next']);
    expect(scheduledAheadIds(tasks, 'nobody')).toEqual([]);
  });
});

describe('cloneTask', () => {
  it('copies every field under the new id and shares nothing nested', () => {
    const task = block({ repeat: { mode: 'increasing', baseDays: 1 } });
    const copy = cloneTask(task, 'copy');
    expect(copy).toEqual({ ...task, id: 'copy' });
    expect(copy.repeat).not.toBe(task.repeat);
    expect(copy.colorAnimation).not.toBe(task.colorAnimation);
    expect(copy.colorAnimation!.colors).not.toBe(task.colorAnimation!.colors);
  });
});

describe('armsCut', () => {
  const key = (partial: Partial<Parameters<typeof armsCut>[0]> = {}) => ({
    code: CUT_KEY_CODE,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    ...partial,
  });
  const element = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  it('is armed by C on its own, on any layout', () => {
    expect(armsCut(key())).toBe(true);
    expect(armsCut(key({ target: element('DIV') }))).toBe(true);
    expect(armsCut(key({ code: 'KeyV' }))).toBe(false);
  });

  it('leaves copy shortcuts alone', () => {
    expect(armsCut(key({ ctrlKey: true }))).toBe(false);
    expect(armsCut(key({ metaKey: true }))).toBe(false);
    expect(armsCut(key({ altKey: true }))).toBe(false);
  });

  it('is just a letter while typing', () => {
    expect(armsCut(key({ target: element('INPUT') }))).toBe(false);
    expect(armsCut(key({ target: element('TEXTAREA') }))).toBe(false);
    expect(armsCut(key({ target: element('SELECT') }))).toBe(false);
    expect(armsCut(key({ target: element('DIV', true) }))).toBe(false);
  });
});
