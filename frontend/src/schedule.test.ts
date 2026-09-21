import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import {
  absorbIntoSessions,
  buildChains,
  buildGroups,
  buildRunChains,
  buildRuns,
  daySegments,
  dayStartMs,
  isContinuous,
  layoutTasks,
  mergeSuggestions,
  migrateDayTasks,
  reorderPatches,
  resizePatches,
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

  it('ignores reminders entirely — a service overlay, never real work', () => {
    expect(buildGroups([task({ type: 'reminder' })])).toHaveLength(0);
  });

  it('does not let a reminder join a group it overlaps in time', () => {
    const groups = buildGroups([
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(10, 15), plannedTime: 1800, type: 'reminder' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(1);
  });
});

describe('buildChains', () => {
  it('leaves back-to-back blocks unconnected until they are glued by hand', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(10), plannedTime: 1800 }),
        task({ start: hm(10, 30), plannedTime: 1800 }),
      ])
    );
    // Three blocks touching exactly — and still three separate sequences.
    expect(chains).toHaveLength(3);
    expect(chains.every((c) => c.sessionId === null)).toBe(true);
  });

  it('makes one sequence of the blocks that share a session id', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
        task({ start: hm(10), plannedTime: 3600, sessionId: 's1' }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks).toHaveLength(2);
    expect(chains[0].name).toBe('Утро');
  });

  it('never pulls a reminder into a sequence, however tightly it is placed', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(10), plannedTime: 1800, type: 'reminder', sessionId: 's1' }),
        task({ start: hm(10, 30), plannedTime: 1800, sessionId: 's1' }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks.every((t) => t.type !== 'reminder')).toBe(true);
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

  it('does not let a loose block join a session it merely follows', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(10), plannedTime: 3600 }),
      ])
    );
    expect(chains).toHaveLength(2);
    expect(chains[1].sessionId).toBeNull();
  });

  it('swallows a loose block dropped inside a session, with no approval asked', () => {
    const inside = task({ start: hm(11), plannedTime: 1800 });
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
        inside,
        task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].sessionId).toBe('s1');
    // Ordered by the clock, with the newcomer in the middle where it sits.
    expect(chains[0].tasks[1].id).toBe(inside.id);
    expect(chains[0].groups.map((g) => g.startMs)).toEqual(
      [...chains[0].groups.map((g) => g.startMs)].sort((a, b) => a - b)
    );
    // Its span is unchanged: the block was already inside it.
    expect(chains[0].endMs).toBe(dayStartMs(DAY) + hm(15) * 60_000);
  });

  it('leaves a block that only overhangs the session alone', () => {
    const chains = buildChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
        task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
        // 14:30–16:00 — starts inside, ends past the session's 15:00.
        task({ start: hm(16), plannedTime: 3600 }),
      ])
    );
    expect(chains).toHaveLength(2);
    expect(chains.find((c) => c.sessionId === null)?.tasks).toHaveLength(1);
  });

  it('gives a block inside two nested sessions to the tighter one', () => {
    const inside = task({ start: hm(11), plannedTime: 1800 });
    const chains = buildChains(
      buildGroups([
        task({ start: hm(8), plannedTime: 3600, sessionId: 'wide' }),
        task({ start: hm(10), plannedTime: 1800, sessionId: 'tight' }),
        inside,
        task({ start: hm(12), plannedTime: 1800, sessionId: 'tight' }),
        task({ start: hm(18), plannedTime: 3600, sessionId: 'wide' }),
      ])
    );
    const tight = chains.find((c) => c.sessionId === 'tight')!;
    expect(tight.tasks.map((t) => t.id)).toContain(inside.id);
    expect(chains.find((c) => c.sessionId === 'wide')!.tasks.map((t) => t.id)).not.toContain(
      inside.id
    );
  });
});

describe('absorbIntoSessions', () => {
  it('writes the membership down for a block standing inside a session', () => {
    const inside = task({ start: hm(11), plannedTime: 1800 });
    const after = absorbIntoSessions([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
      inside,
      task({ start: hm(14), plannedTime: 3600, sessionId: 's1', sessionName: 'Утро' }),
    ]);
    const joined = after.find((t) => t.id === inside.id)!;
    expect(joined.sessionId).toBe('s1');
    expect(joined.sessionName).toBe('Утро');
  });

  it('never joins blocks that merely follow each other', () => {
    const tasks = [
      task({ start: hm(9), plannedTime: 3600 }),
      task({ start: hm(10), plannedTime: 3600 }),
    ];
    expect(absorbIntoSessions(tasks)).toBe(tasks);
    expect(absorbIntoSessions(tasks).every((t) => !t.sessionId)).toBe(true);
  });

  it('leaves a reminder inside a session out of it', () => {
    const reminder = task({ start: hm(11), plannedTime: 600, type: 'reminder' });
    const after = absorbIntoSessions([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      reminder,
      task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
    ]);
    expect(after.find((t) => t.id === reminder.id)!.sessionId).toBeUndefined();
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = absorbIntoSessions([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      task({ start: hm(11), plannedTime: 1800 }),
      task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
    ]);
    expect(absorbIntoSessions(once)).toBe(once);
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

  it('offers to glue blocks that touch exactly — nothing joins them otherwise', () => {
    const suggestions = mergeSuggestions(
      chainsOf([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(10), plannedTime: 3600 }),
      ])
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].gapMs).toBe(0);
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

  it('says nothing when the blocks are already one session', () => {
    expect(
      mergeSuggestions(
        chainsOf([
          task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
          task({ start: hm(10), plannedTime: 3600, sessionId: 's1' }),
        ])
      )
    ).toHaveLength(0);
  });
});

describe('continuous runs', () => {
  it('reads back-to-back groups as one stretch without connecting them', () => {
    const tasks = [
      task({ start: hm(9), plannedTime: 3600 }),
      task({ start: hm(10), plannedTime: 3600 }),
      task({ start: hm(13), plannedTime: 3600 }),
    ];
    const runs = buildRuns(buildGroups(tasks));
    expect(runs.map((run) => run.length)).toEqual([2, 1]);
    // The stretch is a reading, not a bond: the blocks are still loose.
    expect(buildChains(buildGroups(tasks))).toHaveLength(3);
  });

  it('keeps a session together across its own gap', () => {
    const groups = buildGroups([
      task({ start: hm(9), plannedTime: 3600, sessionId: 's1' }),
      task({ start: hm(14), plannedTime: 3600, sessionId: 's1' }),
    ]);
    expect(isContinuous(groups[0], groups[1])).toBe(true);
    expect(buildRuns(groups)).toHaveLength(1);
  });

  it('wraps a stretch as a chain the history can render', () => {
    const chains = buildRunChains(
      buildGroups([
        task({ start: hm(9), plannedTime: 3600 }),
        task({ start: hm(10), plannedTime: 3600 }),
      ])
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks).toHaveLength(2);
    expect(chains[0].startMs).toBe(dayStartMs(DAY) + hm(9) * 60_000);
    expect(chains[0].endMs).toBe(dayStartMs(DAY) + hm(11) * 60_000);
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

describe('reordering a sequence', () => {
  it('repacks the tasks back to back in the new order', () => {
    const a = task({ start: hm(9), plannedTime: 1800 }); // 9:00–9:30
    const b = task({ start: hm(9, 30), plannedTime: 3600 }); // 9:30–10:30
    const c = task({ start: hm(10, 30), plannedTime: 900 }); // 10:30–10:45
    // Move c (idx 2) to the front: order becomes c, a, b.
    const patches = reorderPatches([a, b, c], 2, 0);
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    expect(byId.get(c.id)).toEqual({ day: DAY, start: hm(9) });
    expect(byId.get(a.id)).toEqual({ day: DAY, start: hm(9, 15) });
    expect(byId.get(b.id)).toEqual({ day: DAY, start: hm(9, 45) });
  });

  it('does nothing when the index does not move', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(10) });
    expect(reorderPatches([a, b], 0, 0)).toEqual([]);
  });

  it('carries a moved block over midnight', () => {
    const a = task({ start: hm(23), plannedTime: 3600 }); // 23:00–00:00
    const b = task({ start: hm(0), day: '2026-03-11', plannedTime: 1800 }); // 00:00–00:30
    // Swap them: b (30min) now goes first, so a lands 30min later, spilling
    // further into the next day.
    const patches = reorderPatches([a, b], 0, 1);
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    expect(byId.get(b.id)).toEqual({ day: DAY, start: hm(23) });
    expect(byId.get(a.id)).toEqual({ day: DAY, start: hm(23, 30) });
  });
});

describe('resizing a task in a sequence', () => {
  it('pushes every later task by the size change, leaving earlier ones alone', () => {
    const a = task({ start: hm(9), plannedTime: 1800 });
    const b = task({ start: hm(9, 30), plannedTime: 3600 });
    const c = task({ start: hm(10, 30), plannedTime: 900 });
    const patches = resizePatches([a, b, c], b.id, 1800);
    expect(patches).toEqual([
      { id: b.id, patch: { plannedTime: 1800 } },
      { id: c.id, patch: { day: DAY, start: hm(10) } },
    ]);
  });

  it('does nothing for an unknown task or a non-positive duration', () => {
    const a = task({ start: hm(9) });
    expect(resizePatches([a], 'missing', 60)).toEqual([]);
    expect(resizePatches([a], a.id, 0)).toEqual([]);
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

describe('daySegments', () => {
  it('stacks truly back-to-back blocks in one column when no min duration is given', () => {
    const segs = daySegments(
      [
        task({ start: hm(10), plannedTime: 60 }), // 10:00–10:01
        task({ start: hm(10, 1), plannedTime: 3600 }), // 10:01–11:01
      ],
      DAY
    );
    expect(segs.every((s) => s.cols === 1 && s.col === 0)).toBe(true);
  });

  it('splits a short block and its immediate follower into side-by-side columns once the short one would be drawn taller than its real duration', () => {
    // A 1-minute task rendered at a 20-minute-tall minimum visually reaches
    // into the next task's slot, so — like Google Calendar — the two should
    // be laid out side by side instead of the second one appearing to sit on
    // top of the first.
    const segs = daySegments(
      [
        task({ start: hm(10), plannedTime: 60 }), // 10:00–10:01
        task({ start: hm(10, 1), plannedTime: 3600 }), // 10:01–11:01
      ],
      DAY,
      20
    );
    expect(segs.every((s) => s.cols === 2)).toBe(true);
    expect(segs.map((s) => s.col).sort()).toEqual([0, 1]);
  });

  it('keeps real gaps wide enough to clear the minimum from splitting', () => {
    const segs = daySegments(
      [
        task({ start: hm(10), plannedTime: 60 }), // 10:00–10:01
        task({ start: hm(10, 30), plannedTime: 3600 }), // 10:30–11:30, well clear
      ],
      DAY,
      20
    );
    expect(segs.every((s) => s.cols === 1 && s.col === 0)).toBe(true);
  });

  it('still lays out reminders — it is type-agnostic, callers decide which slice to draw', () => {
    // CalendarPage calls this twice, once per partition (real tasks / reminders
    // — see isReminder), so the function itself must not filter by type.
    const segs = daySegments([task({ start: hm(17), plannedTime: 5 * 3600, type: 'reminder' })], DAY);
    expect(segs).toHaveLength(1);
    expect(segs[0].topMin).toBe(hm(17));
    expect(segs[0].bottomMin).toBe(hm(22));
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
