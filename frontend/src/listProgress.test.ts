import { describe, expect, it } from 'vitest';
import { progressPct } from './listProgress';
import type { Task } from './types';

const task = (plannedTime: number): Task => ({
  id: 't1',
  name: 'Task',
  plannedTime,
  completedAt: null,
  order: 0,
  emoji: '🛠️',
  color: '#3498db',
  type: 'task',
});

describe('progressPct', () => {
  it('reports partial progress through the current task', () => {
    expect(progressPct(task(600), 300, 630)).toBeCloseTo(55);
  });

  it('clamps before the task starts and after it ends', () => {
    expect(progressPct(task(600), 300, 200)).toBe(0);
    expect(progressPct(task(600), 300, 5000)).toBe(100);
  });

  it('returns 0 for a missing or zero-length task', () => {
    expect(progressPct(undefined, 0, 100)).toBe(0);
    expect(progressPct(task(0), 0, 100)).toBe(0);
  });
});
