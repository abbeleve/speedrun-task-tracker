import { describe, expect, it } from 'vitest';
import type { Habit, RepeatConfig, Task, TaskColorAnimation, TaskStatus } from './types';
import { habitAuto } from './habits';
import { taskEndMs } from './schedule';
import {
  closeExpiredReminders,
  describeRepeat,
  getOpenTasks,
  getTimelineTasks,
  INCREASING_SERIES,
  nextRepeatIntervalDays,
  normalizeTask,
  normalizeTasks,
  preservePinnedPlacement,
  rearmEditedReminder,
  reindexTasks,
  scheduledDayFor,
  spawnNextOccurrence,
} from './tasks';

const base = {
  plannedTime: 60,
  emoji: '📋',
  color: '#3498db',
  type: 'task' as const,
  start: null,
  finishedAt: null,
};

// Legacy rows (stored before kanban existed) omit `day`/`status`.
const legacy = (partial: Partial<Task>): Task =>
  ({ id: 'a', name: 'Dev', ...base, completedAt: null, order: 0, ...partial }) as Task;

const task = (id: string, status: TaskStatus, order: number): Task => ({
  id,
  name: id,
  ...base,
  completedAt: null,
  order,
  day: '2026-09-10',
  status,
});

describe('normalizeTask', () => {
  it('treats a legacy unfinished task as in-progress on its storage day', () => {
    const t = normalizeTask(legacy({}), '2026-09-10');
    expect(t.status).toBe('in-progress');
    expect(t.day).toBe('2026-09-10');
  });

  it('treats a legacy completed task as done', () => {
    expect(normalizeTask(legacy({ completedAt: 120 }), '2026-09-11').status).toBe('done');
  });

  it('keeps an explicit status and day', () => {
    const t = normalizeTask(
      { id: 'a', name: 'Dev', ...base, completedAt: null, order: 0, status: 'open', day: '2026-09-12' },
      '2026-09-10'
    );
    expect(t.status).toBe('open');
    expect(t.day).toBe('2026-09-12');
  });

  it('defaults legacy tasks to unpinned', () => {
    expect(normalizeTask(legacy({}), '2026-09-10').pinned).toBe(false);
  });

  it('normalizes a stored task color animation', () => {
    const normalized = normalizeTask(
      legacy({
        colorAnimation: {
          type: 'flow',
          colors: ['#FF0000', 'invalid', '#0000FF'],
          direction: 'left',
          durationSec: 99,
        } as unknown as TaskColorAnimation,
      }),
      '2026-09-10'
    );
    expect(normalized.colorAnimation).toEqual({
      type: 'flow',
      colors: ['#ff0000', '#3498db', '#0000ff'],
      direction: 180,
      durationSec: 20,
    });
  });

  it('normalizes a whole list', () => {
    expect(normalizeTasks([legacy({ id: 'a' }), legacy({ id: 'b' })], '2026-09-10')).toHaveLength(2);
  });
});

describe('pinned placement', () => {
  it('keeps day, slot and backlog/timeline placement while pinned', () => {
    const pinned = task('p', 'in-progress', 0);
    pinned.start = 9 * 60;
    pinned.pinned = true;
    const attemptedMove = preservePinnedPlacement(pinned, {
      ...pinned,
      day: '2026-09-11',
      start: 12 * 60,
      status: 'open',
    });
    expect(attemptedMove.day).toBe('2026-09-10');
    expect(attemptedMove.start).toBe(9 * 60);
    expect(attemptedMove.status).toBe('in-progress');
  });

  it('allows completion without moving a pinned task', () => {
    const pinned = task('p', 'in-progress', 0);
    pinned.start = 9 * 60;
    pinned.pinned = true;
    expect(preservePinnedPlacement(pinned, { ...pinned, status: 'done' }).status).toBe('done');
  });

  it('allows movement in the same edit that unpins the task', () => {
    const pinned = task('p', 'in-progress', 0);
    pinned.start = 9 * 60;
    pinned.pinned = true;
    const moved = preservePinnedPlacement(pinned, {
      ...pinned,
      pinned: false,
      day: '2026-09-11',
      start: 12 * 60,
    });
    expect(moved.day).toBe('2026-09-11');
    expect(moved.start).toBe(12 * 60);
  });
});

describe('timeline / backlog split', () => {
  const tasks = [task('d', 'done', 2), task('o', 'open', 0), task('i', 'in-progress', 1), task('o2', 'open', 3)];

  it('excludes the Open backlog from the timeline', () => {
    expect(getTimelineTasks(tasks).map((t) => t.id)).toEqual(['i', 'd']);
  });

  it('lists only backlog tasks as open', () => {
    expect(getOpenTasks(tasks).map((t) => t.id)).toEqual(['o', 'o2']);
  });

  it('reindexes the timeline first, then the backlog', () => {
    const reindexed = reindexTasks(tasks);
    expect(reindexed.map((t) => t.id)).toEqual(['i', 'd', 'o', 'o2']);
    expect(reindexed.map((t) => t.order)).toEqual([0, 1, 2, 3]);
  });
});

describe('recurrence', () => {
  let n = 0;
  const makeId = () => `child-${n++}`;

  const recurring = (repeat: RepeatConfig, partial: Partial<Task> = {}): Task => ({
    id: 'r',
    name: 'Review',
    ...base,
    completedAt: null,
    order: 0,
    day: '2026-09-10',
    status: 'done',
    repeat,
    repeatIndex: 0,
    ...partial,
  });

  it('keeps a fixed interval constant', () => {
    const repeat: RepeatConfig = { mode: 'fixed', baseDays: 7 };
    expect(nextRepeatIntervalDays(repeat, 0)).toBe(7);
    expect(nextRepeatIntervalDays(repeat, 5)).toBe(7);
  });

  it('walks a forgetting-curve series scaled by the base', () => {
    const repeat: RepeatConfig = { mode: 'increasing', baseDays: 1 };
    const intervals = INCREASING_SERIES.map((_, i) => nextRepeatIntervalDays(repeat, i));
    expect(intervals).toEqual([1, 3, 7, 16, 35]);
    expect(nextRepeatIntervalDays(repeat, INCREASING_SERIES.length)).toBeNull();

    expect(nextRepeatIntervalDays({ mode: 'increasing', baseDays: 2 }, 1)).toBe(6);
  });

  it('keeps a calendar slot on the next occurrence', () => {
    const placed = recurring({ mode: 'fixed', baseDays: 2 }, { start: 9 * 60 });
    const child = spawnNextOccurrence(placed, makeId, '2026-09-10');
    expect(child!.day).toBe('2026-09-12');
    expect(child!.start).toBe(9 * 60);
    expect(child!.status).toBe('in-progress');
    expect(child!.finishedAt).toBeNull();
  });

  it('carries the pinned setting to the next occurrence', () => {
    const placed = recurring(
      { mode: 'fixed', baseDays: 2 },
      { start: 9 * 60, pinned: true }
    );
    expect(spawnNextOccurrence(placed, makeId, '2026-09-10')!.pinned).toBe(true);
  });

  it('carries the color animation to the next occurrence', () => {
    const colorAnimation = {
      type: 'flow' as const,
      colors: ['#ff0000', '#0000ff'],
      direction: 90,
      durationSec: 8,
    };
    const placed = recurring(
      { mode: 'fixed', baseDays: 2 },
      { start: 9 * 60, colorAnimation }
    );
    expect(spawnNextOccurrence(placed, makeId, '2026-09-10')!.colorAnimation).toEqual(
      colorAnimation
    );
  });

  it('schedules an unplaced recurrence back into the backlog on day+interval', () => {
    const child = spawnNextOccurrence(recurring({ mode: 'fixed', baseDays: 7 }), makeId, '2026-09-10');
    expect(child).not.toBeNull();
    expect(child!.day).toBe('2026-09-17');
    expect(child!.status).toBe('open');
    expect(child!.repeatIndex).toBe(1);
    expect(child!.repeatOf).toBe('r');
    expect(child!.completedAt).toBeNull();
  });

  it('keeps the habit link through consecutive occurrences', () => {
    const first = recurring({ mode: 'fixed', baseDays: 1 }, { habitId: 'habit-1', plannedTime: 3600 });
    const second = spawnNextOccurrence(first, makeId, first.day)!;
    const third = spawnNextOccurrence(second, makeId, second.day)!;
    const completedSecond = { ...second, status: 'done' as const, finishedAt: Date.now() };
    const habit: Habit = {
      id: 'habit-1',
      name: 'Practice',
      emoji: '📋',
      color: '#3498db',
      format: 'count',
      target: 1,
      unit: 'times',
      order: 0,
    };

    expect(third.habitId).toBe('habit-1');
    expect(habitAuto(habit, second.day, [completedSecond])).toBe(1);
    expect(
      habitAuto({ ...habit, format: 'time', unit: 'min' }, second.day, [completedSecond])
    ).toBe(60);
  });

  it('stops spawning once an increasing series is exhausted', () => {
    const repeat: RepeatConfig = { mode: 'increasing', baseDays: 1 };
    const last = recurring(repeat, { repeatIndex: INCREASING_SERIES.length });
    expect(spawnNextOccurrence(last, makeId, '2026-09-10')).toBeNull();
  });

  it('reports the day of the next occurrence (or null once exhausted)', () => {
    expect(scheduledDayFor(recurring({ mode: 'fixed', baseDays: 3 }), '2026-09-10')).toBe('2026-09-13');
    const exhausted = recurring({ mode: 'increasing', baseDays: 1 }, { repeatIndex: INCREASING_SERIES.length });
    expect(scheduledDayFor(exhausted, '2026-09-10')).toBeNull();
  });

  it('does not spawn for one-off tasks', () => {
    expect(spawnNextOccurrence(recurring({ mode: 'fixed', baseDays: 3 }, { repeat: null }), makeId, '2026-09-10')).toBeNull();
  });

  it('describes a repeat rule', () => {
    expect(describeRepeat({ mode: 'fixed', baseDays: 7 })).toBe('каждые 7 дн.');
    expect(describeRepeat({ mode: 'increasing', baseDays: 1 })).toBe('1 → 3 → 7 → 16 → 35 дн.');
  });
});

describe('reminders close themselves', () => {
  let n = 0;
  const makeId = () => `next-${n++}`;
  const MIN = 60_000;

  // A 17:00–18:00 reminder on 2026-09-10.
  const reminder = (partial: Partial<Task> = {}): Task => ({
    id: 'rem',
    name: 'Pick projects',
    ...base,
    type: 'reminder',
    plannedTime: 3600,
    start: 17 * 60,
    completedAt: null,
    order: 0,
    day: '2026-09-10',
    status: 'in-progress',
    repeat: null,
    repeatIndex: 0,
    ...partial,
  });

  it('leaves a reminder alone while its window is still open', () => {
    const r = reminder({ repeat: { mode: 'fixed', baseDays: 1 } });
    expect(closeExpiredReminders([r], taskEndMs(r) - MIN, makeId)).toBeNull();
  });

  it('completes a reminder at the end of its window', () => {
    const r = reminder();
    const closed = closeExpiredReminders([r], taskEndMs(r) + 5 * MIN, makeId)!;
    expect(closed.patches).toEqual([
      { id: 'rem', patch: { status: 'done', finishedAt: taskEndMs(r) } },
    ]);
    expect(closed.spawned).toEqual([]);
  });

  it('schedules the next occurrence of a recurring reminder once it has passed', () => {
    const r = reminder({ repeat: { mode: 'fixed', baseDays: 2 } });
    const closed = closeExpiredReminders([r], taskEndMs(r), makeId)!;
    expect(closed.spawned).toHaveLength(1);
    const next = closed.spawned[0];
    expect(next.type).toBe('reminder');
    expect(next.day).toBe('2026-09-12');
    expect(next.start).toBe(17 * 60);
    expect(next.status).toBe('in-progress');
    expect(next.finishedAt).toBeNull();
    expect(next.repeatOf).toBe('rem');
    expect(next.repeatIndex).toBe(1);
  });

  it('fires once: a completed reminder schedules nothing more', () => {
    const r = reminder({ repeat: { mode: 'fixed', baseDays: 1 } });
    const now = taskEndMs(r) + MIN;
    const closed = closeExpiredReminders([r], now, makeId)!;
    const after = [{ ...r, ...closed.patches[0].patch }, ...closed.spawned];
    expect(closeExpiredReminders(after, now, makeId)).toBeNull();
    // Deleting the scheduled occurrence does not bring it back.
    expect(closeExpiredReminders([after[0]], now, makeId)).toBeNull();
  });

  it('does not duplicate an occurrence that is already scheduled', () => {
    const r = reminder({ repeat: { mode: 'fixed', baseDays: 1 } });
    const next = { ...reminder(), id: 'already', day: '2026-09-11', repeatOf: 'rem' };
    const closed = closeExpiredReminders([r, next], taskEndMs(r) + MIN, makeId)!;
    expect(closed.patches.map((p) => p.id)).toEqual(['rem']);
    expect(closed.spawned).toEqual([]);
  });

  it('catches up on the occurrences missed while the app was closed', () => {
    const r = reminder({ repeat: { mode: 'fixed', baseDays: 1 } });
    // 2026-09-13 17:30: the 11th and 12th are over, the 13th is still open.
    const now = taskEndMs({ ...r, day: '2026-09-13' }) - 30 * MIN;
    const { spawned } = closeExpiredReminders([r], now, makeId)!;
    expect(spawned.map((t) => [t.day, t.status])).toEqual([
      ['2026-09-11', 'done'],
      ['2026-09-12', 'done'],
      ['2026-09-13', 'in-progress'],
    ]);
    expect(spawned[0].finishedAt).toBe(taskEndMs(spawned[0]));
    expect(spawned[2].finishedAt).toBeNull();
    expect(spawned[1].repeatOf).toBe(spawned[0].id);
    expect(spawned[2].repeatOf).toBe(spawned[1].id);
  });

  it('stops catching up when an increasing series runs out', () => {
    const r = reminder({ repeat: { mode: 'increasing', baseDays: 1 } });
    const { spawned } = closeExpiredReminders([r], taskEndMs(r) + 365 * 24 * 60 * MIN, makeId)!;
    expect(spawned.map((t) => t.day)).toEqual([
      '2026-09-11',
      '2026-09-14',
      '2026-09-21',
      '2026-10-07',
      '2026-11-11',
    ]);
    expect(spawned.every((t) => t.status === 'done')).toBe(true);
  });

  it('ignores ordinary tasks and reminders left in the backlog', () => {
    const task = reminder({ id: 'task', type: 'task', repeat: { mode: 'fixed', baseDays: 1 } });
    const backlog = reminder({ id: 'backlog', status: 'open', start: null });
    expect(closeExpiredReminders([task, backlog], taskEndMs(task) + MIN, makeId)).toBeNull();
  });

  describe('editing', () => {
    const fired = reminder({
      repeat: { mode: 'fixed', baseDays: 1 },
      status: 'done',
      finishedAt: taskEndMs(reminder()),
    });

    it('keeps a passed reminder completed through an ordinary edit', () => {
      const saved = rearmEditedReminder(fired, { ...fired, name: 'Renamed', status: 'in-progress', finishedAt: null });
      expect(saved.status).toBe('done');
      expect(saved.finishedAt).toBe(fired.finishedAt);
      expect(saved.name).toBe('Renamed');
    });

    it('re-arms a passed reminder when repetition is turned on', () => {
      const oneOff = { ...fired, repeat: null };
      const saved = rearmEditedReminder(oneOff, { ...oneOff, repeat: { mode: 'fixed', baseDays: 1 } });
      expect(saved.status).toBe('in-progress');
      expect(saved.finishedAt).toBeNull();
      // …so the next pass completes it again, this time scheduling the next one.
      const closed = closeExpiredReminders([saved], taskEndMs(saved) + MIN, makeId)!;
      expect(closed.spawned[0].day).toBe('2026-09-11');
    });

    it('re-arms a reminder whose window or repeat rule changes', () => {
      expect(rearmEditedReminder(fired, { ...fired, start: 18 * 60 }).status).toBe('in-progress');
      expect(rearmEditedReminder(fired, { ...fired, day: '2026-09-11' }).status).toBe('in-progress');
      expect(rearmEditedReminder(fired, { ...fired, plannedTime: 7200 }).status).toBe('in-progress');
      expect(
        rearmEditedReminder(fired, { ...fired, repeat: { mode: 'fixed', baseDays: 3 } }).status
      ).toBe('in-progress');
    });

    it('never saves a reminder that has not passed yet as completed', () => {
      const pending = reminder();
      expect(rearmEditedReminder(pending, { ...pending, status: 'done', finishedAt: 1 }).finishedAt).toBeNull();
    });

    it('leaves ordinary tasks to their own ✓', () => {
      const task = { ...fired, type: 'task' as const };
      expect(rearmEditedReminder(task, { ...task, start: 9 * 60 })).toEqual({ ...task, start: 9 * 60 });
    });
  });
});
