import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { buildChains, buildGroups, dayStartMs } from './schedule';
import {
  HOLD_SLOP_PX,
  chainOfSelection,
  normalizeBand,
  onTheSpot,
  splitPatches,
  sweep,
  tasksInBand,
  toggled,
} from './selection';

const DAY = '2026-03-10';
const NEXT = '2026-03-11';
const hm = (h: number, m = 0) => h * 60 + m;

let seq = 0;

function task(patch: Partial<Task> & { start?: number | null }): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `task ${seq}`,
    plannedTime: 3600,
    completedAt: null,
    start: null,
    finishedAt: null,
    order: seq,
    emoji: '🎯',
    color: '#3498db',
    type: 'task',
    day: DAY,
    status: 'in-progress',
    ...patch,
  };
}

function apply(tasks: Task[], patches: { id: string; patch: Partial<Task> }[]): Task[] {
  return tasks.map((t) => {
    const found = patches.find((p) => p.id === t.id);
    return found ? { ...t, ...found.patch } : t;
  });
}

describe('normalizeBand', () => {
  it('sorts the corners and clamps the columns to what is on screen', () => {
    expect(normalizeBand({ fromDayIdx: 4, toDayIdx: -2, fromMin: 600, toMin: 120 }, 3)).toEqual({
      fromDayIdx: 0,
      toDayIdx: 2,
      topMin: 120,
      bottomMin: 600,
    });
  });
});

describe('tasksInBand', () => {
  const a = task({ start: hm(9), plannedTime: 3600 }); // 09:00–10:00
  const b = task({ start: hm(10), plannedTime: 1800 }); // 10:00–10:30
  const late = task({ start: hm(20), plannedTime: 3600 });
  const otherDay = task({ day: NEXT, start: hm(9), plannedTime: 3600 });
  const backlog = task({ status: 'open', start: null });
  const all = [a, b, late, otherDay, backlog];
  const days = [DAY, NEXT];

  it('picks every block the rectangle touches, in start order', () => {
    const picked = tasksInBand(all, days, {
      fromDayIdx: 0,
      toDayIdx: 0,
      fromMin: hm(9, 30),
      toMin: hm(10, 10),
    });
    expect(picked.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('spans several day columns', () => {
    const picked = tasksInBand(all, days, {
      fromDayIdx: 1,
      toDayIdx: 0,
      fromMin: hm(8),
      toMin: hm(11),
    });
    expect(picked.map((t) => t.id).sort()).toEqual([a.id, b.id, otherDay.id].sort());
  });

  it('leaves the backlog alone and never picks a block it only misses', () => {
    const picked = tasksInBand(all, days, {
      fromDayIdx: 0,
      toDayIdx: 1,
      fromMin: hm(12),
      toMin: hm(13),
    });
    expect(picked).toEqual([]);
  });

  it('catches a block spilling past midnight from the column it runs into', () => {
    const night = task({ start: hm(23), plannedTime: 2 * 3600 }); // 23:00–01:00
    const picked = tasksInBand([night], [DAY, NEXT], {
      fromDayIdx: 1,
      toDayIdx: 1,
      fromMin: hm(0, 15),
      toMin: hm(0, 45),
    });
    expect(picked.map((t) => t.id)).toEqual([night.id]);
  });

  it('picks nothing from a rectangle with no height', () => {
    expect(tasksInBand(all, days, { fromDayIdx: 0, toDayIdx: 0, fromMin: 540, toMin: 540 })).toEqual(
      []
    );
  });
});

describe('onTheSpot', () => {
  it('forgives a few pixels of drift in either direction', () => {
    expect(onTheSpot(100, 100, 100 + HOLD_SLOP_PX, 100 - HOLD_SLOP_PX)).toBe(true);
  });

  it('reads anything further as the pointer leaving the spot', () => {
    expect(onTheSpot(100, 100, 100 + HOLD_SLOP_PX + 1, 100)).toBe(false);
    expect(onTheSpot(100, 100, 100, 100 - HOLD_SLOP_PX - 1)).toBe(false);
  });
});

describe('sweep', () => {
  const a = task({ start: hm(9), plannedTime: 3600 }); // 09:00–10:00
  const b = task({ start: hm(10), plannedTime: 1800 }); // 10:00–10:30
  const late = task({ start: hm(20), plannedTime: 3600 });
  const all = [a, b, late];
  const days = [DAY];

  it('adds what the rectangle touches to the batch it started from', () => {
    const band = { fromDayIdx: 0, toDayIdx: 0, fromMin: hm(9, 30), toMin: hm(10, 10) };
    expect([...sweep(all, days, band, [late.id])].sort()).toEqual([a.id, b.id, late.id].sort());
  });

  it('lets go of what it swept when the rectangle shrinks, but never of the base', () => {
    const wide = { fromDayIdx: 0, toDayIdx: 0, fromMin: hm(9, 30), toMin: hm(10, 10) };
    const narrow = { ...wide, toMin: hm(9, 45) };
    expect(sweep(all, days, wide, [late.id]).has(b.id)).toBe(true);
    expect([...sweep(all, days, narrow, [late.id])].sort()).toEqual([a.id, late.id].sort());
  });

  it('keeps the base as it is while the rectangle has no height yet', () => {
    const band = { fromDayIdx: 0, toDayIdx: 0, fromMin: hm(9, 30), toMin: hm(9, 30) };
    expect([...sweep(all, days, band, [late.id])]).toEqual([late.id]);
  });
});

describe('toggled', () => {
  it('adds a block that was not in the batch', () => {
    expect([...toggled(new Set(['a']), 'b')].sort()).toEqual(['a', 'b']);
  });

  it('drops a block that was, leaving the original set untouched', () => {
    const before = new Set(['a', 'b']);
    expect([...toggled(before, 'a')]).toEqual(['b']);
    expect([...before].sort()).toEqual(['a', 'b']);
  });
});

describe('chainOfSelection', () => {
  const a = task({ start: hm(9), plannedTime: 3600, sessionId: 's1' });
  const b = task({ start: hm(10), plannedTime: 3600, sessionId: 's1' });
  const far = task({ start: hm(18), plannedTime: 3600 });
  const chains = buildChains(buildGroups([a, b, far]));

  it('returns the sequence the whole selection shares', () => {
    expect(chainOfSelection(chains, [a.id, b.id])?.tasks.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('returns null when the blocks come from different sequences', () => {
    expect(chainOfSelection(chains, [a.id, far.id])).toBeNull();
  });

  it('returns null for blocks that merely touch, since those are not one sequence', () => {
    const x = task({ start: hm(9), plannedTime: 3600 });
    const y = task({ start: hm(10), plannedTime: 3600 });
    expect(chainOfSelection(buildChains(buildGroups([x, y])), [x.id, y.id])).toBeNull();
  });

  it('returns null for an empty selection', () => {
    expect(chainOfSelection(chains, [])).toBeNull();
  });
});

describe('splitPatches', () => {
  it('cuts the batch out into a sequence of its own, leaving the rest behind', () => {
    const a = task({ start: hm(9), plannedTime: 3600, sessionId: 's-old' });
    const b = task({ start: hm(10), plannedTime: 3600, sessionId: 's-old' });
    const c = task({ start: hm(11), plannedTime: 3600, sessionId: 's-old' });
    const all = [a, b, c];
    expect(buildChains(buildGroups(all))).toHaveLength(1);

    const after = apply(all, splitPatches([b, c], 's-new'));
    const chains = buildChains(buildGroups(after));
    expect(chains.map((chain) => chain.tasks.map((t) => t.id))).toEqual([
      [a.id],
      [b.id, c.id],
    ]);
    expect(chains[1].sessionId).toBe('s-new');
  });

  it('makes one sequence of loose blocks that were not connected before', () => {
    const a = task({ start: hm(9), plannedTime: 3600 });
    const b = task({ start: hm(10), plannedTime: 3600 });
    expect(buildChains(buildGroups([a, b]))).toHaveLength(2);

    const chains = buildChains(buildGroups(apply([a, b], splitPatches([a, b], 's-new'))));
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('keeps the blocks exactly where they were', () => {
    const a = task({ start: hm(9), plannedTime: 3600 });
    const after = apply([a], splitPatches([a], 's-new', 'Разбор'));
    expect(after[0].start).toBe(hm(9));
    expect(after[0].day).toBe(DAY);
    expect(after[0].sessionName).toBe('Разбор');
    // Sanity: the slot is still the same moment on the clock.
    expect(dayStartMs(after[0].day) + (after[0].start ?? 0) * 60_000).toBe(
      dayStartMs(DAY) + hm(9) * 60_000
    );
  });
});
