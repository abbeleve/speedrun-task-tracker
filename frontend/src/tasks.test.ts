import { describe, expect, it } from 'vitest';
import type { RepeatConfig, Task, TaskStatus } from './types';
import {
  describeRepeat,
  getOpenTasks,
  getTimelineTasks,
  INCREASING_SERIES,
  nextRepeatIntervalDays,
  normalizeTask,
  normalizeTasks,
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

  it('normalizes a whole list', () => {
    expect(normalizeTasks([legacy({ id: 'a' }), legacy({ id: 'b' })], '2026-09-10')).toHaveLength(2);
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

  it('schedules an unplaced recurrence back into the backlog on day+interval', () => {
    const child = spawnNextOccurrence(recurring({ mode: 'fixed', baseDays: 7 }), makeId, '2026-09-10');
    expect(child).not.toBeNull();
    expect(child!.day).toBe('2026-09-17');
    expect(child!.status).toBe('open');
    expect(child!.repeatIndex).toBe(1);
    expect(child!.repeatOf).toBe('r');
    expect(child!.completedAt).toBeNull();
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
