import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { dayStatsFromTasks } from './dayStats';

const DAY = '2026-03-10';

let seq = 0;

function task(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `task ${seq}`,
    plannedTime: 3600,
    completedAt: null,
    start: 9 * 60,
    finishedAt: Date.now(),
    order: seq,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    day: DAY,
    status: 'done',
    ...patch,
  };
}

describe('dayStatsFromTasks', () => {
  it('never credits a reminder towards work or rest, whatever its status', () => {
    const real = task({ plannedTime: 1800 });
    // A reminder should never actually reach status 'done' (see TaskDialog's
    // submit()), but the stats function guards against it independently too —
    // productivity must stay honest even if that invariant is ever broken.
    const reminder = task({ type: 'reminder', plannedTime: 1800 * 5 });
    const stats = dayStatsFromTasks(DAY, [real, reminder]);
    expect(stats.workSec).toBe(1800);
    expect(stats.restSec).toBe(0);
  });

  it('does not add a reminder as a worked sequence of its own', () => {
    const real = task({ start: 9 * 60, plannedTime: 1800 });
    const reminder = task({ type: 'reminder', start: 11 * 60, plannedTime: 1800 });
    const withReminder = dayStatsFromTasks(DAY, [real, reminder]);
    const without = dayStatsFromTasks(DAY, [real]);
    expect(withReminder.sessions).toBe(without.sessions);
    expect(withReminder.sessions).toBe(1);
  });
});
