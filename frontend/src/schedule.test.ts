import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import {
  buildChains,
  buildGroups,
  dayStartMs,
  fillSessionGaps,
  layoutTasks,
  mergeSuggestions,
  migrateDayTasks,
  sessionGapRestTasks,
  shiftPatches,
  shiftedSlot,
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

  it('holds an explicit session together across a gap', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
        task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].sessionId).toBe('s1');
    expect(chains[0].name).toBe('Утро');
  });

  it('keeps two sessions apart even back to back', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(10), plannedTime: 3600, sessionId: 's2' }),
      ])
    );
    expect(chains.map((c) => c.sessionId)).toEqual(['s1', 's2']);
  });

  it('is not split by a loose block dropped into its gap', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(11), plannedTime: 1800 }),
        task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
      ])
    );
    expect(chains).toHaveLength(2);
    const session = chains.find((c) => c.sessionId === 's1')!;
    expect(session.tasks).toHaveLength(2);
    expect(session.endMs).toBe(dayStartMs(DAY) + hm(15) * 60_000);
  });

  it('does not let a loose block join a session', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(10), plannedTime: 3600 }),
      ])
    );
    expect(chains).toHaveLength(2);
  });
});

describe('mergeSuggestions', () => {
  const chainsOf = (tasks: Task[]) => buildChains(buildGroups(tasks));

  it('offers to glue sequences that miss each other by a few minutes', () => {
    const suggestions = mergeSuggestions(
      chainsOf([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(10, 5), plannedTime: 3600 }),
      ])
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].gapMs).toBe(5 * 60_000);
  });

  it('says nothing about a gap that is a real break', () => {
    expect(
      mergeSuggestions(
        chainsOf([
          task({ start: hm(9), plannedTime: 3600 }),
          task({ start: hm(10, 20), plannedTime: 3600 }),
        ])
      )
    ).toHaveLength(0);
  });

  it('says nothing when the blocks are already one sequence', () => {
    expect(
      mergeSuggestions(
        chainsOf([
          task({ start: hm(9), plannedTime: 3600 }),
          task({ start: hm(10), plannedTime: 3600 }),
        ])
      )
    ).toHaveLength(0);
  });
});

describe('session rest gaps', () => {
  it('fills a session hole bigger than five minutes with a rest block', () => {
    const filled = fillSessionGaps([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
      task({ start: hm(10, 30), plannedTime: 1800, sessionId: 's1' }),
    ]);
    const rest = filled.find((t) => t.type === 'rest');
    expect(rest).toBeDefined();
    expect(rest!.start).toBe(hm(10)); // 09:00 end → gap 10:00–10:30
    expect(rest!.plannedTime).toBe(30 * 60);
    expect(rest!.day).toBe(DAY);
    expect(rest!.sessionId).toBe('s1');
    expect(rest!.sessionName).toBe('Утро');
  });

  it('leaves a gap of five minutes or less alone', () => {
    const tasks = [
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      task({ start: hm(10, 5), plannedTime: 3600, sessionId: 's1' }),
    ];
    expect(sessionGapRestTasks(tasks)).toEqual([]);
  });

  it('ignores gaps between loose blocks that are not a session', () => {
    const tasks = [
      task({ start: hm(9), plannedTime: 3600 }),
      task({ start: hm(11), plannedTime: 3600 }),
    ];
    expect(sessionGapRestTasks(tasks)).toEqual([]);
    expect(fillSessionGaps(tasks)).toHaveLength(2);
  });

  it('is idempotent once the hole is already filled', () => {
    const filled = fillSessionGaps([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      task({ start: hm(11), plannedTime: 3600, sessionId: 's1' }),
    ]);
    expect(filled.filter((t) => t.type === 'rest')).toHaveLength(1);
    expect(sessionGapRestTasks(filled)).toEqual([]);
  });

  it('does not rest over a block another session put in the gap', () => {
    const tasks = [
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      task({ start: hm(10, 30), plannedTime: 1800, sessionId: 's2' }),
      task({ start: hm(11), plannedTime: 1800, sessionId: 's1' }),
    ];
    expect(sessionGapRestTasks(tasks)).toEqual([]);
  });
});

describe('shifting a sequence', () => {
  it('moves a block by a delta, keeping its duration', () => {
    expect(shiftedSlot(task({ start: hm(10) }), 90 * 60_000)).toEqual({
      day: DAY,
      start: hm(11, 30),
    });
  });

  it('carries a block over midnight onto the next date', () => {
    expect(shiftedSlot(task({ start: hm(23) }), 2 * 60 * 60_000)).toEqual({
      day: '2026-03-11',
      start: hm(1),
    });
  });

  it('keeps the gaps inside the sequence it moves', () => {
    const a = task({ start: hm(9), plannedTime: 3600 });
    const b = task({ start: hm(10, 30), plannedTime: 3600 });
    const patches = shiftPatches([a, b], -60 * 60_000);
    expect(patches.map((p) => p.patch.start)).toEqual([hm(8), hm(9, 30)]);
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
