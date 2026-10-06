import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
  BACKLOG_WIDTH_DEFAULT,
  BACKLOG_WIDTH_MAX,
  BACKLOG_WIDTH_MIN,
  backlogDayLabel,
  backlogSlot,
  backlogWorkSec,
  clampBacklogWidth,
  groupBacklog,
  matchesBacklogQuery,
  pluralTasks,
} from './backlog';

const TODAY = '2026-10-06'; // a Tuesday
const at = (hh: number, mm = 0) => new Date(2026, 9, 6, hh, mm).getTime();

let seq = 0;
function task(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `Task ${seq}`,
    plannedTime: 30 * 60,
    completedAt: null,
    start: null,
    finishedAt: null,
    order: seq,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    day: TODAY,
    status: 'open',
    ...patch,
  };
}

// A block on the calendar: `start` in minutes from midnight, `min` long.
function block(day: string, start: number, min: number, patch: Partial<Task> = {}): Task {
  return task({ day, start, plannedTime: min * 60, status: 'in-progress', ...patch });
}

describe('backlogDayLabel', () => {
  it('names the days next to today in words', () => {
    expect(backlogDayLabel(TODAY, TODAY)).toBe('сегодня');
    expect(backlogDayLabel('2026-10-07', TODAY)).toBe('завтра');
    expect(backlogDayLabel('2026-10-05', TODAY)).toBe('вчера');
  });

  it('gives other days their weekday and date, and the year only when it differs', () => {
    expect(backlogDayLabel('2026-10-08', TODAY)).toBe('чт, 8 окт');
    expect(backlogDayLabel('2026-09-28', TODAY)).toBe('пн, 28 сен');
    expect(backlogDayLabel('2027-01-04', TODAY)).toBe('пн, 4 янв 2027');
  });
});

describe('groupBacklog', () => {
  it('gathers gone days, gives each day of the week ahead its own group and the rest «later»', () => {
    const old = task({ day: '2026-09-30' });
    const yesterday = task({ day: '2026-10-05' });
    const today = task({ day: TODAY });
    const tomorrow = task({ day: '2026-10-07' });
    const sunday = task({ day: '2026-10-12' });
    const nextTuesday = task({ day: '2026-10-13' });
    const groups = groupBacklog([nextTuesday, today, sunday, yesterday, tomorrow, old], TODAY);
    expect(groups.map((g) => [g.key, g.kind, g.day, g.tasks.map((t) => t.id)])).toEqual([
      ['overdue', 'overdue', null, [old.id, yesterday.id]],
      [TODAY, 'day', TODAY, [today.id]],
      ['2026-10-07', 'day', '2026-10-07', [tomorrow.id]],
      ['2026-10-12', 'day', '2026-10-12', [sunday.id]],
      ['later', 'later', null, [nextTuesday.id]],
    ]);
  });

  it('keeps the day order within a group and leaves out empty groups', () => {
    const second = task({ order: 2 });
    const first = task({ order: 1 });
    const groups = groupBacklog([second, first], TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toEqual([first, second]);
  });

  it('sums the planned work of a group, without reminders', () => {
    const groups = groupBacklog(
      [
        task({ plannedTime: 3600 }),
        task({ plannedTime: 1800, type: 'rest' }),
        task({ plannedTime: 900, type: 'reminder' }),
      ],
      TODAY
    );
    expect(groups[0].totalSec).toBe(5400);
    expect(backlogWorkSec(groups[0].tasks)).toBe(5400);
  });
});

describe('pluralTasks', () => {
  it('agrees the noun with the number', () => {
    expect([1, 2, 5, 11, 21, 22, 104].map((n) => `${n} ${pluralTasks(n)}`)).toEqual([
      '1 задача', '2 задачи', '5 задач', '11 задач', '21 задача', '22 задачи', '104 задачи',
    ]);
  });
});

describe('matchesBacklogQuery', () => {
  const report = task({ name: 'Квартальный отчёт', description: 'Свести цифры по продажам' });

  it('matches everything on an empty query', () => {
    expect(matchesBacklogQuery(report, '   ')).toBe(true);
  });

  it('looks in the name and the notes, ignoring case', () => {
    expect(matchesBacklogQuery(report, 'ОТЧЁТ')).toBe(true);
    expect(matchesBacklogQuery(report, 'продажам')).toBe(true);
    expect(matchesBacklogQuery(report, 'бюджет')).toBe(false);
  });

  it('needs every word to turn up somewhere', () => {
    expect(matchesBacklogQuery(report, 'отчёт цифры')).toBe(true);
    expect(matchesBacklogQuery(report, 'отчёт бюджет')).toBe(false);
  });
});

describe('backlogSlot', () => {
  it('puts a task for today at now, snapped up to the 5-minute grid', () => {
    const item = task({});
    expect(backlogSlot(item, [item], at(14, 32))).toEqual({ day: TODAY, start: 14 * 60 + 35 });
  });

  it('waits for the block running now to end', () => {
    const item = task({});
    const running = block(TODAY, 14 * 60, 60);
    expect(backlogSlot(item, [item, running], at(14, 20))).toEqual({ day: TODAY, start: 15 * 60 });
  });

  it('takes the first gap long enough for it', () => {
    const item = task({ plannedTime: 45 * 60 });
    const plan = [
      block(TODAY, 10 * 60, 60), // 10:00–11:00
      block(TODAY, 11 * 60 + 30, 30), // 11:30–12:00: the 30 min gap before it is too short
      block(TODAY, 13 * 60, 60), // 13:00–14:00: 12:00–13:00 fits
    ];
    expect(backlogSlot(item, [item, ...plan], at(9, 50))).toEqual({ day: TODAY, start: 12 * 60 });
  });

  it('treats parallel blocks as one busy stretch', () => {
    const item = task({});
    const plan = [block(TODAY, 10 * 60, 120), block(TODAY, 10 * 60 + 30, 30)];
    expect(backlogSlot(item, [item, ...plan], at(10))).toEqual({ day: TODAY, start: 12 * 60 });
  });

  it('counts closed blocks as taken but lets reminders and the backlog through', () => {
    const item = task({});
    const plan = [
      block(TODAY, 10 * 60, 30, { status: 'done', finishedAt: at(10, 20) }),
      block(TODAY, 10 * 60 + 30, 60, { type: 'reminder' }),
      task({ day: TODAY }),
    ];
    expect(backlogSlot(item, [item, ...plan], at(10))).toEqual({ day: TODAY, start: 10 * 60 + 30 });
  });

  it('starts a future day from the usual 9:00, after whatever is there', () => {
    const item = task({ day: '2026-10-08' });
    expect(backlogSlot(item, [item], at(20))).toEqual({ day: '2026-10-08', start: 9 * 60 });
    const morning = block('2026-10-08', 8 * 60, 90);
    expect(backlogSlot(item, [item, morning], at(20))).toEqual({ day: '2026-10-08', start: 9 * 60 + 30 });
  });

  it('steps round a block that spills over from the evening before', () => {
    const item = task({ day: '2026-10-08' });
    const night = block('2026-10-07', 23 * 60, 11 * 60); // 23:00 → 10:00 next day
    expect(backlogSlot(item, [item, night], at(20))).toEqual({ day: '2026-10-08', start: 10 * 60 });
  });

  it('brings a task from a day already gone to today', () => {
    const item = task({ day: '2026-10-01' });
    expect(backlogSlot(item, [item], at(16))).toEqual({ day: TODAY, start: 16 * 60 });
  });

  it('gives up when the day has no room left before midnight', () => {
    const item = task({});
    const evening = block(TODAY, 22 * 60, 120);
    expect(backlogSlot(item, [item, evening], at(21, 50))).toBeNull();
  });
});

describe('clampBacklogWidth', () => {
  it('keeps the rail between its limits, in whole pixels', () => {
    expect(clampBacklogWidth(100)).toBe(BACKLOG_WIDTH_MIN);
    expect(clampBacklogWidth(9999)).toBe(BACKLOG_WIDTH_MAX);
    expect(clampBacklogWidth(333.6)).toBe(334);
  });

  it('falls back to the default for nothing saved or a broken value', () => {
    expect(clampBacklogWidth(Number(null))).toBe(BACKLOG_WIDTH_DEFAULT);
    expect(clampBacklogWidth(Number('wide'))).toBe(BACKLOG_WIDTH_DEFAULT);
  });
});
