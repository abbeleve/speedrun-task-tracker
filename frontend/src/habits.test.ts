import { describe, it, expect } from 'vitest';
import type { Habit, HabitEntry, Task } from './types';
import {
  dayCompletion,
  defaultUnit,
  habitAuto,
  habitHeatLevel,
  habitHistory,
  habitManual,
  habitProgress,
  habitTotal,
  isHabitComplete,
  isHabitDoneOn,
  formatHabit,
} from './habits';

const DAY = '2026-03-10';

function habit(patch: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Подтягивания',
    emoji: '💪',
    color: '#2ecc71',
    format: 'count',
    target: 10,
    unit: 'раз',
    order: 0,
    ...patch,
  };
}

function task(patch: Partial<Task> & { id: string }): Task {
  return {
    name: 'task',
    plannedTime: 3600, // 60 мин
    completedAt: null,
    start: 600,
    finishedAt: null,
    order: 0,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    status: 'in-progress',
    day: DAY,
    ...patch,
  };
}

const entry = (manual: number): HabitEntry => ({ habitId: 'h1', date: DAY, manual });

describe('habitAuto', () => {
  it('a completed linked task adds 1 to a count habit', () => {
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, day: DAY });
    expect(habitAuto(habit(), DAY, [done])).toBe(1);
  });

  it('several completed linked tasks sum up for a count habit', () => {
    const a = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, day: DAY });
    const b = task({ id: 'b', habitId: 'h1', status: 'done', finishedAt: 2, day: DAY });
    expect(habitAuto(habit(), DAY, [a, b])).toBe(2);
  });

  it('open or unlinked tasks do not count for a count habit', () => {
    const open = task({ id: 'a', habitId: 'h1', status: 'in-progress', finishedAt: null, day: DAY });
    const other = task({ id: 'b', status: 'done', finishedAt: 1, day: DAY });
    expect(habitAuto(habit(), DAY, [open, other])).toBe(0);
  });

  it('a completed linked task adds its minutes to a time habit', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, day: DAY });
    expect(habitAuto(h, DAY, [done])).toBe(60);
  });

  it('several completed linked tasks sum up', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const a = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, plannedTime: 3600, day: DAY });
    const b = task({ id: 'b', habitId: 'h1', status: 'done', finishedAt: 2, plannedTime: 9000, day: DAY });
    expect(habitAuto(h, DAY, [a, b])).toBe(210); // 60 + 150
  });

  it('open or unlinked tasks do not count', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const open = task({ id: 'a', habitId: 'h1', status: 'in-progress', finishedAt: null, day: DAY });
    const other = task({ id: 'b', status: 'done', finishedAt: 1, day: DAY });
    expect(habitAuto(h, DAY, [open, other])).toBe(0);
  });

  it('only counts tasks of that date', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const otherDay = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, day: '2026-03-11' });
    expect(habitAuto(h, DAY, [otherDay])).toBe(0);
  });
});

describe('habitManual / habitTotal', () => {
  it('habitManual falls back to 0 without an entry', () => {
    expect(habitManual([], 'h1', DAY)).toBe(0);
    expect(habitManual([entry(7)], 'h1', '2026-03-11')).toBe(0);
  });

  it('habitTotal is manual + auto', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, plannedTime: 3600, day: DAY });
    expect(habitTotal(h, DAY, [done], [entry(30)])).toBe(90);
  });

  it('a count habit total is manual + linked-task auto', () => {
    const h = habit();
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, day: DAY });
    expect(habitTotal(h, DAY, [done], [entry(5)])).toBe(6);
  });

  it('a count habit with no linked tasks equals its manual value', () => {
    const h = habit();
    expect(habitTotal(h, DAY, [], [entry(5)])).toBe(5);
  });
});

describe('progress / completion', () => {
  it('clamps progress to 0…1', () => {
    expect(habitProgress(0, 10)).toBe(0);
    expect(habitProgress(5, 10)).toBe(0.5);
    expect(habitProgress(15, 10)).toBe(1);
    expect(habitProgress(3, 0)).toBe(0);
  });

  it('completion needs target met', () => {
    expect(isHabitComplete(9, 10)).toBe(false);
    expect(isHabitComplete(10, 10)).toBe(true);
    expect(isHabitComplete(4, 0)).toBe(false);
  });
});

describe('isHabitDoneOn', () => {
  it('is true when total hits the target on that day', () => {
    const h = habit({ target: 10 });
    expect(isHabitDoneOn(h, DAY, [], [entry(10)])).toBe(true);
  });

  it('is false when total falls short', () => {
    const h = habit({ target: 10 });
    expect(isHabitDoneOn(h, DAY, [], [entry(9)])).toBe(false);
  });

  it('combines manual + auto parts (linked task)', () => {
    const h = habit({ format: 'time', target: 60, unit: 'мин' });
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, plannedTime: 3600, day: DAY });
    expect(isHabitDoneOn(h, DAY, [done], [])).toBe(true);
  });

  it('returns false for a zero-target habit', () => {
    const h = habit({ target: 0 });
    expect(isHabitDoneOn(h, DAY, [], [entry(5)])).toBe(false);
  });
});

describe('dayCompletion', () => {
  it('returns 0/0/0 for an empty habit list', () => {
    expect(dayCompletion([], DAY, [], [])).toEqual({ done: 0, total: 0, rate: 0 });
  });

  it('counts done habits and reports the rate', () => {
    const h1 = habit({ id: 'h1', target: 10 });
    const h2 = habit({ id: 'h2', target: 5 });
    const h3 = habit({ id: 'h3', target: 1 });
    const habits = [h1, h2, h3];
    // h1 met, h2 met, h3 not met — note each entry is bound to a specific
    // habit id, otherwise the helper factory collides on h1.
    const entries = [
      { habitId: 'h1', date: DAY, manual: 10 },
      { habitId: 'h2', date: DAY, manual: 5 },
      { habitId: 'h3', date: DAY, manual: 0 },
    ];
    expect(dayCompletion(habits, DAY, [], entries)).toEqual({
      done: 2,
      total: 3,
      rate: 2 / 3,
    });
  });

  it('clamps the rate into 0..1', () => {
    const h = habit({ target: 1 });
    // Far over the target — still 1.0, not bigger.
    expect(dayCompletion([h], DAY, [], [entry(99)])).toEqual({
      done: 1,
      total: 1,
      rate: 1,
    });
  });
});

describe('formatting', () => {
  it('formats value / target with its unit', () => {
    expect(formatHabit(7, 10, 'раз')).toBe('7 / 10 раз');
    expect(formatHabit(245, 300, 'мин')).toBe('245 / 300 мин');
  });

  it('defaultUnit mirrors format', () => {
    expect(defaultUnit('time')).toBe('мин');
    expect(defaultUnit('count')).toBe('');
  });
});

describe('habitHeatLevel', () => {
  it('is 0 for no progress', () => {
    expect(habitHeatLevel(0, 10)).toBe(0);
  });

  it('splits progress into quarters below the quota', () => {
    expect(habitHeatLevel(1, 10)).toBe(1); // <25%
    expect(habitHeatLevel(4, 10)).toBe(2); // <50%
    expect(habitHeatLevel(9, 10)).toBe(3); // <100%
  });

  it('maxes out once the quota is met or exceeded', () => {
    expect(habitHeatLevel(10, 10)).toBe(4);
    expect(habitHeatLevel(99, 10)).toBe(4);
  });

  it('treats a zero-target habit as maxed by any activity', () => {
    expect(habitHeatLevel(1, 0)).toBe(4);
    expect(habitHeatLevel(0, 0)).toBe(0);
  });
});

describe('habitHistory', () => {
  it('re-derives each past day independently', () => {
    const h = habit({ format: 'time', target: 300, unit: 'мин' });
    const done = task({ id: 'a', habitId: 'h1', status: 'done', finishedAt: 1, plannedTime: 3600, day: DAY });
    const days = [DAY, '2026-03-11'];
    const hist = habitHistory(h, days, [done], [entry(30)]);
    expect(hist[0]).toEqual({ date: DAY, value: 90 }); // 60 auto + 30 manual
    expect(hist[1]).toEqual({ date: '2026-03-11', value: 0 }); // no tasks that day
  });

  it('count habits read only the manual portion per day', () => {
    const h = habit();
    const hist = habitHistory(h, [DAY, '2026-03-09'], [], [entry(5)]);
    expect(hist[0].value).toBe(5);
    expect(hist[1].value).toBe(0);
  });
});
