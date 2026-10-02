import { describe, expect, it } from 'vitest';
import type { DayStats } from './types';
import type { SleepData } from './sleep';
import { avgSleepMin, fmtPercent, percentChange, yearFigures } from './yearSummary';

function day(date: string, workSec: number): DayStats {
  return { date, workSec, restSec: 0, sessions: 1, overtakeSec: 0 };
}

const history: Record<string, DayStats> = {
  '2025-03-01': day('2025-03-01', 3600),
  '2025-11-20': day('2025-11-20', 7200),
  '2026-02-10': day('2026-02-10', 1800),
  '2026-10-01': day('2026-10-01', 5400),
};

// 23:00 → 07:00 is eight hours; a rating alone is a logged night of no length.
const night: SleepData = { hours: [23, 0, 1, 2, 3, 4, 5, 6], quality: 4, bed: 23 * 60, wake: 7 * 60 };
const ratedOnly: SleepData = { hours: [], quality: 3 };

const sleepLog: Record<string, SleepData> = {
  '2025-03-02': night,
  '2025-12-01': night,
  '2026-03-02': night,
  '2026-03-03': ratedOnly,
};

describe('yearFigures', () => {
  it('counts every day worked in the year, not only the nights that were logged', () => {
    expect(yearFigures(2026, history, sleepLog, null).workSec).toBe(1800 + 5400);
  });

  it('cuts both years at the same date', () => {
    const prev = yearFigures(2025, history, sleepLog, '10-02');
    expect(prev.workSec).toBe(3600);
    expect(prev.daysWithSleep).toBe(1);
    expect(yearFigures(2025, history, sleepLog, null).workSec).toBe(3600 + 7200);
  });

  it('counts a rated night as logged, and averages over every logged night', () => {
    const f = yearFigures(2026, history, sleepLog, null);
    expect(f.daysWithSleep).toBe(2);
    expect(f.sleepMin).toBe(8 * 60);
    expect(avgSleepMin(f)).toBe(4 * 60);
  });

  it('has no average for a year without a logged night', () => {
    expect(avgSleepMin(yearFigures(2024, history, sleepLog, null))).toBeNull();
  });
});

describe('percentChange', () => {
  it('is relative to the earlier value', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it('has nothing to say without an earlier value', () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
  });
});

describe('fmtPercent', () => {
  it('signs the change and writes a decimal comma', () => {
    expect(fmtPercent(38.12)).toBe('+38,1%');
    expect(fmtPercent(-5.6)).toBe('−5,6%');
    expect(fmtPercent(120)).toBe('+120%');
    expect(fmtPercent(0)).toBe('+0%');
  });
});
