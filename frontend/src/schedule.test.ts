import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import {
  buildChains,
  buildGroups,
  dayStartMs,
  layoutTasks,
  migrateDayTasks,
  taskEndMs,
} from './schedule';

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
    start: hm(10),
    finishedAt: null,
    order: seq,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    day: DAY,
    status: 'in-progress',
    ...patch,
  };
}

describe('buildGroups', () => {
  it('keeps blocks that do not overlap apart', () => {
    const groups = buildGroups([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(11), plannedTime: 3600 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('merges overlapping blocks into one parallel group', () => {
    const groups = buildGroups([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(10, 30), plannedTime: 1800 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].endMs).toBe(dayStartMs(DAY) + hm(11) * 60_000);
  });

  it('chains overlaps transitively', () => {
    // 10:00–11:00, 10:30–11:30, 11:15–12:00 — the first and last never touch.
    const groups = buildGroups([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(10, 30), plannedTime: 3600 }),
      task({ start: hm(11, 15), plannedTime: 2700 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(3);
  });

  it('ignores the unplaced backlog', () => {
    expect(buildGroups([task({ status: 'open', start: null })])).toHaveLength(0);
  });

  it('closes a group only once its last task is closed', () => {
    const base = dayStartMs(DAY);
    const a = task({ start: hm(10), plannedTime: 3600, status: 'done', finishedAt: base + 1 });
    const b = task({ start: hm(10), plannedTime: 1800 });
    expect(buildGroups([a, b])[0].doneMs).toBeNull();
    const bDone = { ...b, status: 'done' as const, finishedAt: base + 2 };
    expect(buildGroups([a, bDone])[0].doneMs).toBe(base + 2);
  });

  it('treats a done row with no timestamp as finished exactly on plan', () => {
    const t = task({ start: hm(10), plannedTime: 3600, status: 'done', finishedAt: null });
    expect(buildGroups([t])[0].doneMs).toBe(taskEndMs(t));
  });
});

describe('buildChains', () => {
  it('joins back-to-back groups into one sequence', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(10), plannedTime: 1800 }),
        task({ start: hm(10, 30), plannedTime: 1800 }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks).toHaveLength(3);
  });

  it('breaks the sequence on a real gap', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(11), plannedTime: 3600 }),
      ])
    );
    expect(chains).toHaveLength(2);
  });
});

describe('layoutTasks', () => {
  it('gives a lone block the full width', () => {
    const places = layoutTasks([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(11), plannedTime: 3600 }),
    ]);
    expect(places.map((p) => p.cols)).toEqual([1, 1]);
  });

  it('splits overlapping blocks into side-by-side columns', () => {
    const places = layoutTasks([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(10, 15), plannedTime: 1800 }),
    ]);
    expect(places.every((p) => p.cols === 2)).toBe(true);
    expect(places.map((p) => p.col).sort()).toEqual([0, 1]);
  });

  it('reuses a column once its block has ended', () => {
    // 10:00–11:00 in column 0; 10:30–11:30 needs column 1; 11:00–12:00 can go
    // back to column 0, which is free again by then.
    const places = layoutTasks([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(10, 30), plannedTime: 3600 }),
      task({ start: hm(11), plannedTime: 3600 }),
    ]);
    expect(places.map((p) => p.col)).toEqual([0, 1, 0]);
    expect(places.every((p) => p.cols === 2)).toBe(true);
  });
});

describe('migrateDayTasks', () => {
  it('lays legacy tasks out back to back from the session start', () => {
    const startedAt = dayStartMs(DAY) + hm(14) * 60_000;
    const legacy = [
      { ...task({ start: null, plannedTime: 1800, order: 0 }), completedAt: 1500 },
      task({ start: null, plannedTime: 900, order: 1 }),
    ];
    const migrated = migrateDayTasks(legacy as Task[], DAY, startedAt);
    expect(migrated.map((t) => t.start)).toEqual([hm(14), hm(14, 30)]);
    // completedAt was session-relative seconds — it becomes a real timestamp.
    expect(migrated[0].finishedAt).toBe(startedAt + 1500 * 1000);
    expect(migrated[1].finishedAt).toBeNull();
  });

  it('falls back to 09:00 when the day never recorded a start', () => {
    const migrated = migrateDayTasks([task({ start: null, plannedTime: 3600 })], DAY, null);
    expect(migrated[0].start).toBe(hm(9));
  });

  it('leaves the backlog unplaced', () => {
    const migrated = migrateDayTasks(
      [task({ start: null, status: 'open' }), task({ start: null, plannedTime: 600 })],
      DAY,
      null
    );
    expect(migrated.find((t) => t.status === 'open')!.start).toBeNull();
    expect(migrated.find((t) => t.status !== 'open')!.start).toBe(hm(9));
  });

  it('leaves an already migrated day untouched', () => {
    const tasks = [task({ start: hm(12) })];
    expect(migrateDayTasks(tasks, DAY, null)).toBe(tasks);
  });
});
