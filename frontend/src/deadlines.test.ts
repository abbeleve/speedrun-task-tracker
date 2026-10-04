import { describe, expect, it } from 'vitest';
import type { Deadline, Task } from './types';
import { deadlineClusters, deadlineDueMs, deadlineLabel, deadlineShortLabel, deadlinePlanLate, deadlineState, openDeadlines } from './deadlines';
import { shiftPatches } from './schedule';

const deadline = (patch: Partial<Deadline> = {}): Deadline => ({ id: 'launch', name: 'Launch', description: null, dueDay: '2026-10-02', dueTime: 18 * 60, completedAt: null, ...patch });
const task = (patch: Partial<Task> = {}): Task => ({ id: 'work', name: 'Work', day: '2026-10-01', start: 9 * 60, plannedTime: 3600, completedAt: null, finishedAt: null, status: 'in-progress', order: 0, emoji: '📋', color: '#3498db', type: 'task', deadlineId: 'launch', ...patch });
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

describe('independent deadline semantics', () => {
  it('keeps overdue deadlines open and ordered before future milestones', () => {
    const past = deadline({ id: 'past', dueDay: '2026-09-30' });
    const future = deadline({ id: 'future', dueDay: '2026-10-08' });
    const done = deadline({ id: 'done', completedAt: local(1, 10) });
    expect(openDeadlines([future, done, past]).map((item) => item.id)).toEqual(['past', 'future']);
    expect(deadlineState(past, local(1, 12))).toBe('overdue');
    expect(past.completedAt).toBeNull();
    expect(deadlineState(deadline(), local(1, 12))).toBe('soon');
    expect(deadlineState(future, local(1, 12))).toBe('open');
    expect(deadlineState(done, local(9, 12))).toBe('done');
  });
  it('gives date-only deadlines their entire local day and preserves midnight', () => {
    const allDay = deadline({ dueTime: null });
    expect(deadlineState(allDay, local(2, 23, 59))).toBe('soon');
    expect(deadlineState(allDay, local(3, 0))).toBe('overdue');
    expect(deadlineDueMs(deadline({ dueTime: 0 }))).toBe(local(2, 0));
  });
  it('ends a date-only deadline at the next local midnight across DST', () => {
    const spring = deadline({ dueDay: '2026-03-08', dueTime: null });
    expect(deadlineDueMs(spring)).toBe(new Date(2026, 2, 9, 0).getTime() - 1);
  });
  it('shows only the due date and time, without countdowns', () => {
    expect(deadlineLabel(deadline(), false)).toBe('18:00');
    expect(deadlineLabel(deadline({ dueTime: null }), false)).toBe('весь день');
    expect(deadlineLabel(deadline())).toContain('2026');
    expect(deadlineLabel(deadline())).not.toMatch(/осталось|запас|через/);
  });
  it('fits the due date on a block in a few characters', () => {
    expect(deadlineShortLabel(deadline(), '2026-10-02')).toBe('18:00');
    expect(deadlineShortLabel(deadline({ dueTime: null }), '2026-10-02')).toBe('');
    expect(deadlineShortLabel(deadline(), '2026-10-01')).not.toMatch(/2026|18:00/);
    expect(deadlineShortLabel(deadline(), '2025-12-30')).toContain('2026');
  });
  it('does not treat completed blocks or backlog slots as a late plan', () => {
    const late = task({ day: '2026-10-03' });
    expect(deadlinePlanLate(deadline(), [late])).toBe(true);
    expect(deadlinePlanLate(deadline(), [{ ...late, status: 'done', finishedAt: local(2, 10) }])).toBe(false);
    expect(deadlinePlanLate(deadline(), [{ ...late, status: 'open' }])).toBe(false);
    expect(deadlinePlanLate(deadline(), [{ ...late, start: null }])).toBe(false);
    expect(deadlinePlanLate(deadline({ completedAt: local(2, 10) }), [late])).toBe(false);
  });
  it('keeps the same deadline link when blocks move across days', () => {
    const work = task();
    const patches = shiftPatches([work], 2 * 24 * 3600000);
    const moved = { ...work, ...patches[0].patch };
    expect(moved.day).toBe('2026-10-03');
    expect(moved.deadlineId).toBe('launch');
    expect(deadline().dueDay).toBe('2026-10-02');
  });
  it('groups colliding flags without losing deadlines or mixing due days', () => {
    const items = [deadline({ id: 'a', dueTime: 600 }), deadline({ id: 'b', dueTime: 605 }), deadline({ id: 'c', dueTime: 900 }), deadline({ id: 'date', dueTime: null }), deadline({ id: 'other', dueDay: '2026-10-03' })];
    const clusters = deadlineClusters(items, '2026-10-02', 20);
    expect(clusters.map((item) => [item.minute, item.deadlines.map((entry) => entry.id)])).toEqual([[600, ['a', 'b']], [900, ['c']]]);
    expect(deadlineClusters([deadline({ dueTime: 0 }), deadline({ id: 'last', dueTime: 1439 })], '2026-10-02', 20)).toHaveLength(2);
  });
});
