import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { buildChains, buildGroups, dayStartMs } from './schedule';
import { chainOfSelection, normalizeBand, splitPatches, tasksInBand } from './selection';

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

describe('chainOfSelection', () => {
  const a = task({ start: hm(9), plannedTime: 3600 });
  const b = task({ start: hm(10), plannedTime: 3600 });
  const far = task({ start: hm(18), plannedTime: 3600 });
  const chains = buildChains(buildGroups([a, b, far]));

  it('returns the sequence the whole selection shares', () => {
    expect(chainOfSelection(chains, [a.id, b.id])?.tasks.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('returns null when the blocks come from different sequences', () => {
    expect(chainOfSelection(chains, [a.id, far.id])).toBeNull();
  });

  it('returns null for an empty selection', () => {
    expect(chainOfSelection(chains, [])).toBeNull();
  });
});

describe('splitPatches', () => {
  it('cuts the batch out into a sequence of its own, leaving the rest behind', () => {
    const a = task({ start: hm(9), plannedTime: 3600 });
    const b = task({ start: hm(10), plannedTime: 3600 });
    const c = task({ start: hm(11), plannedTime: 3600 });
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
