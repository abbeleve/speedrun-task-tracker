import { describe, expect, it } from 'vitest';
import { dateKey, heatLevel, shiftDayKey, splitSessionByType } from './history';
import type { Task } from './types';

function task(partial: Partial<Task>): Task {
  return {
    id: 'x',
    name: 'Task',
    plannedTime: 300,
    completedAt: null,
    order: 0,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    ...partial,
  };
}

describe('dateKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 8, 10))).toBe('2026-09-10');
  });

  it('pads month and day with zeros', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('shiftDayKey', () => {
  it('steps forward and backward across month boundaries', () => {
    expect(shiftDayKey('2026-09-10', 1)).toBe('2026-09-11');
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('heatLevel', () => {
  it('maps daily work seconds into GitHub-style intensity buckets', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1800)).toBe(1);
    expect(heatLevel(3600)).toBe(1); // exactly 1h stays level 1
    expect(heatLevel(7200)).toBe(2);
    expect(heatLevel(4 * 3600)).toBe(3);
    expect(heatLevel(10 * 3600)).toBe(4);
  });
});

describe('splitSessionByType', () => {
  const elapsedSec = 250;
  const tasks: Task[] = [
    task({ id: 'a', name: 'Dev', order: 0, plannedTime: 100, completedAt: 100 }),
    task({ id: 'b', name: 'Break', order: 1, plannedTime: 50, completedAt: 150, type: 'rest' }),
    task({ id: 'c', name: 'Test', order: 2, plannedTime: 100, completedAt: 250 }),
  ];

  it('splits a completed session into work and rest by task type', () => {
    const { workSec, restSec } = splitSessionByType(tasks, elapsedSec);
    expect(workSec).toBe(200);
    expect(restSec).toBe(50);
  });

  it('counts only partial progress of the current unfinished task', () => {
    const partial: Task[] = [
      task({ id: 'a', name: 'Dev', order: 0, plannedTime: 100, completedAt: 100 }),
      task({ id: 'b', name: 'Test', order: 1, plannedTime: 200, completedAt: null }),
    ];
    const { workSec, restSec } = splitSessionByType(partial, 150);
    expect(workSec).toBe(150); // 100 completed + 50 in progress
    expect(restSec).toBe(0);
  });
});
