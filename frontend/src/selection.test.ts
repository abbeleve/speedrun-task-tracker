import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { buildChains, buildGroups, dayStartMs } from './schedule';
import type { Marquee, SelectionBlock } from './selection';
import {
  HOLD_SLOP_PX,
  chainOfSelection,
  clampMarquee,
  marqueeRect,
  onTheSpot,
  splitPatches,
  sweep,
  tasksInMarquee,
  toggled,
} from './selection';

const DAY = '2026-03-10';
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

const area = (x1: number, y1: number, x2: number, y2: number, dayIdx = 0): Marquee => ({
  dayIdx, anchor: { x: x1, y: y1 }, cursor: { x: x2, y: y2 },
});
const block = (taskId: string, left: number, top: number, right: number, bottom: number, dayIdx = 0): SelectionBlock => ({
  taskId, dayIdx, left, top, right, bottom,
});

describe('marquee geometry', () => {
  it('normalizes drags in every direction', () => {
    for (const marquee of [area(20, 30, 80, 90), area(80, 90, 20, 30), area(80, 30, 20, 90), area(20, 90, 80, 30)]) {
      expect(marqueeRect(marquee)).toEqual({ left: 20, top: 30, right: 80, bottom: 90 });
    }
  });

  it('stops a column selection at its starting day, even across other columns', () => {
    const day = { left: 100, top: 0, right: 200, bottom: 1200 };
    expect(clampMarquee(area(120, 300, 450, 1500, 1), day)).toEqual(area(120, 300, 200, 1200, 1));
    expect(clampMarquee(area(180, 300, -50, -100, 1), day)).toEqual(area(180, 300, 100, 0, 1));
  });

  it('stops a timeline selection at its starting row and the ends of the day', () => {
    const day = { left: 0, top: 100, right: 3000, bottom: 250 };
    expect(clampMarquee(area(500, 130, 3200, 450, 1), day)).toEqual(area(500, 130, 3000, 250, 1));
    expect(clampMarquee(area(500, 230, -100, 20, 1), day)).toEqual(area(500, 230, 0, 100, 1));
  });
});

describe('tasksInMarquee', () => {
  const columns = [
    block('left-early', 14, 100, 90, 160),
    block('right-early', 100, 100, 180, 160),
    block('left-late', 14, 170, 90, 230),
    block('right-late', 100, 170, 180, 230),
    block('next-day', 214, 100, 290, 160, 1),
  ];

  it('picks only one task from each parallel pair in a column', () => {
    expect(tasksInMarquee(columns, area(10, 95, 95, 235))).toEqual(['left-early', 'left-late']);
    expect(tasksInMarquee(columns, area(185, 235, 95, 95))).toEqual(['right-early', 'right-late']);
  });

  it('picks only one lane of parallel tasks in the timeline', () => {
    const rows = columns.slice(0, 4).map((b) => ({
      ...b, left: b.top, right: b.bottom, top: b.left, bottom: b.right,
    }));
    expect(tasksInMarquee(rows, area(95, 10, 235, 95))).toEqual(['left-early', 'left-late']);
  });

  it('selects both parallel lanes only when the rectangle overlaps both', () => {
    expect(tasksInMarquee(columns, area(85, 110, 105, 120))).toEqual(['left-early', 'right-early']);
  });

  it('never includes a segment from another day', () => {
    expect(tasksInMarquee(columns, area(0, 95, 500, 165))).toEqual(['left-early', 'right-early']);
  });

  it('uses rendered short blocks and reminder rails without selecting their neighbours', () => {
    const rendered = [block('short', 14, 100, 90, 116), block('reminder', 188, 100, 194, 160)];
    expect(tasksInMarquee(rendered, area(20, 110, 30, 115))).toEqual(['short']);
    expect(tasksInMarquee(rendered, area(186, 110, 195, 120))).toEqual(['reminder']);
  });

  it('can select an overnight continuation in the day it runs into', () => {
    const overnight = [block('night', 14, 1100, 90, 1200), block('night', 214, 0, 290, 60, 1)];
    expect(tasksInMarquee(overnight, area(220, 15, 280, 45, 1))).toEqual(['night']);
  });

  it('does not select blocks only touching an edge, or rectangles without area', () => {
    expect(tasksInMarquee(columns, area(90, 100, 100, 160))).toEqual([]);
    expect(tasksInMarquee(columns, area(14, 160, 90, 170))).toEqual([]);
    expect(tasksInMarquee(columns, area(20, 110, 20, 150))).toEqual([]);
    expect(tasksInMarquee(columns, area(20, 110, 80, 110))).toEqual([]);
  });

  it('returns each task once even if more than one segment is supplied', () => {
    expect(tasksInMarquee([...columns, columns[0]], area(10, 95, 95, 165))).toEqual(['left-early']);
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
  const blocks = [block('a', 14, 100, 90, 160), block('b', 14, 170, 90, 230)];

  it('adds touched blocks to the original selection, without duplicates', () => {
    expect([...sweep(blocks, area(10, 95, 95, 235), ['a', 'previous'])]).toEqual(['a', 'previous', 'b']);
  });

  it('releases swept blocks when the rectangle shrinks, keeping the original selection', () => {
    expect(sweep(blocks, area(10, 95, 95, 235), ['previous']).has('b')).toBe(true);
    expect([...sweep(blocks, area(10, 95, 95, 165), ['previous'])]).toEqual(['previous', 'a']);
  });

  it('keeps the original selection while the rectangle has no area', () => {
    expect([...sweep(blocks, area(20, 110, 20, 110), ['previous'])]).toEqual(['previous']);
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
