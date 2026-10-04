import { describe, it, expect } from 'vitest';
import type { Habit, HabitEntry, Task } from './types';
import { habitStreak, pluralDays, streakWarnStage, streakWarningText } from './streak';

const TODAY = '2026-10-05';

function habit(patch: Partial<Habit> = {}): Habit {
  const target = patch.target ?? 10;
  return {
    id: 'h1',
    name: 'Отжимания',
    emoji: '💪',
    color: '#e74c3c',
    format: 'count',
    target,
    targets: [{ since: '', target }],
    unit: 'раз',
    order: 0,
    streak: true,
    ...patch,
  };
}

function task(patch: Partial<Task> & { id: string; day: string }): Task {
  return {
    name: 'Чтение',
    plannedTime: 20 * 60,
    completedAt: null,
    start: 600,
    finishedAt: null,
    order: 0,
    emoji: '📚',
    color: '#3498db',
    type: 'task',
    status: 'done',
    habitId: 'h1',
    ...patch,
  };
}

const entries = (days: Record<string, number>): HabitEntry[] =>
  Object.entries(days).map(([date, manual]) => ({ habitId: 'h1', date, manual }));

describe('habitStreak', () => {
  it('counts today once its quota is met', () => {
    const e = entries({ '2026-10-03': 10, '2026-10-04': 12, [TODAY]: 10 });
    expect(habitStreak(habit(), TODAY, [], e)).toEqual({ days: 3, todayDone: true, left: 0 });
  });

  it('keeps the streak alive, unlit, while today is still open', () => {
    const e = entries({ '2026-10-03': 10, '2026-10-04': 10, [TODAY]: 6 });
    expect(habitStreak(habit(), TODAY, [], e)).toEqual({ days: 2, todayDone: false, left: 4 });
  });

  it('a missed day breaks it', () => {
    const e = entries({ '2026-10-02': 10, '2026-10-03': 9, '2026-10-04': 10 });
    expect(habitStreak(habit(), TODAY, [], e).days).toBe(1);
    expect(habitStreak(habit(), TODAY, [], []).days).toBe(0);
  });

  it('runs across a month boundary', () => {
    const e = entries({ '2026-09-29': 10, '2026-09-30': 10, '2026-10-01': 10 });
    expect(habitStreak(habit(), '2026-10-02', [], e).days).toBe(3);
  });

  it('judges every day by the quota it had then', () => {
    const raised = habit({
      target: 15,
      targets: [
        { since: '', target: 10 },
        { since: '2026-10-04', target: 15 },
      ],
    });
    const e = entries({ '2026-10-03': 10, '2026-10-04': 15, [TODAY]: 12 });
    expect(habitStreak(raised, TODAY, [], e)).toEqual({ days: 2, todayDone: false, left: 3 });
  });

  it('adds closed linked blocks: minutes for a time habit, one each for a count habit', () => {
    const tasks = [
      task({ id: 'a', day: '2026-10-04' }),
      task({ id: 'b', day: '2026-10-04', plannedTime: 10 * 60 }),
      task({ id: 'open', day: TODAY, status: 'in-progress' }),
      task({ id: 'other', day: TODAY, habitId: 'h2' }),
    ];
    const time = habit({ format: 'time', target: 30, unit: '' });
    expect(habitStreak(time, TODAY, tasks, [])).toEqual({ days: 1, todayDone: false, left: 30 });
    const count = habit({ target: 2 });
    expect(habitStreak(count, '2026-10-04', tasks, [])).toEqual({ days: 1, todayDone: true, left: 0 });
  });
});

describe('streakWarnStage', () => {
  const at = (hh: number, mm = 0, ss = 0) => new Date(2026, 9, 5, hh, mm, ss).getTime();

  it('is quiet until three hours are left', () => {
    expect(streakWarnStage(at(1, 6))).toBeNull();
    expect(streakWarnStage(at(20, 59, 59))).toBeNull();
  });

  it('counts the hours left, rounded up', () => {
    expect(streakWarnStage(at(21))).toBe(3);
    expect(streakWarnStage(at(21, 59))).toBe(3);
    expect(streakWarnStage(at(22))).toBe(2);
    expect(streakWarnStage(at(23, 59, 59))).toBe(1);
  });
});

describe('streak wording', () => {
  it('declines days in Russian', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111, 104].map(pluralDays)).toEqual([
      'день', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'дней', 'дня',
    ]);
  });

  it('says what burns, when, and what is left — as the push does', () => {
    expect(streakWarningText(habit(), 12, 4, 3)).toBe('Серия 12 дней сгорит через 3 ч — осталось 4 раз');
    expect(streakWarningText(habit({ format: 'time', unit: '' }), 0, 25, 2)).toBe(
      'До конца дня 2 ч — осталось 25 мин. Начни серию!'
    );
  });
});
