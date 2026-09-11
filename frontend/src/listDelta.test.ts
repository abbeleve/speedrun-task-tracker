import { describe, expect, it } from 'vitest';
import { taskDeltaMs } from './listDelta';
import type { Task } from './types';

const task = (completedAt: number | null): Task => ({
  id: 't1',
  name: 'Task',
  plannedTime: 600,
  completedAt,
  order: 0,
  emoji: '🛠️',
  color: '#3498db',
  type: 'task',
  day: '2026-09-10',
  status: 'in-progress',
});

describe('taskDeltaMs', () => {
  it('is negative when the task finished ahead of its planned end', () => {
    expect(taskDeltaMs(task(540), 600)).toBe(-60000);
  });

  it('is positive when the task finished behind its planned end', () => {
    expect(taskDeltaMs(task(680), 600)).toBe(80000);
  });

  it('is zero when the task finished exactly on time', () => {
    expect(taskDeltaMs(task(600), 600)).toBe(0);
  });

  it('returns null while the task is still uncompleted', () => {
    expect(taskDeltaMs(task(null), 600)).toBeNull();
  });
});
