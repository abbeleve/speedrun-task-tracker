import { describe, expect, it } from 'vitest';
import type { Task, TaskStatus } from './types';
import {
  getOpenTasks,
  getTimelineTasks,
  normalizeTask,
  normalizeTasks,
  reindexTasks,
} from './tasks';

const base = { plannedTime: 60, emoji: '📋', color: '#3498db', type: 'task' as const };

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
