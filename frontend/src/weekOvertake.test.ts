import { describe, it, expect } from 'vitest';
import { overtakeSegments, sumWeekOvertakeSec, weekKeysOf } from './weekOvertake';

describe('weekKeysOf', () => {
  it('returns Monday..Sunday of the week a date falls in', () => {
    // 2026-09-16 is a Wednesday.
    expect(weekKeysOf('2026-09-16')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('handles a Sunday (last day of its own week)', () => {
    expect(weekKeysOf('2026-09-20')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    // 2026-09-30 is a Wednesday; the week runs into October.
    expect(weekKeysOf('2026-09-30')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });
});

describe('sumWeekOvertakeSec', () => {
  it('adds up every saved day of the week, plus the live value for today', () => {
    const history = {
      '2026-09-14': 600,
      '2026-09-15': -300,
      '2026-09-16': 100, // today — overridden by the live value below
    };
    expect(sumWeekOvertakeSec(history, '2026-09-16', 200)).toBe(500);
  });

  it("substitutes today's live value instead of reading it from history", () => {
    const history = { '2026-09-16': 100 }; // stale/irrelevant — today is live
    expect(sumWeekOvertakeSec(history, '2026-09-16', 900)).toBe(900);
  });

  it('treats days with nothing saved yet as zero', () => {
    expect(sumWeekOvertakeSec({}, '2026-09-16', 300)).toBe(300);
  });

  it('ignores days outside the current week', () => {
    const history = {
      '2026-09-13': 10_000, // previous Sunday — not part of this week
      '2026-09-14': 600,
    };
    expect(sumWeekOvertakeSec(history, '2026-09-16', 0)).toBe(600);
  });
});

describe('overtakeSegments', () => {
  it('returns nothing for zero', () => {
    expect(overtakeSegments(0)).toEqual([]);
  });

  it('returns one partial block for less than an hour', () => {
    // 50 minutes
    const segs = overtakeSegments(50 * 60);
    expect(segs.length).toBe(1);
    expect(segs[0]).toBeCloseTo(50 / 60);
  });

  it('returns whole blocks with no trailing partial on an exact hour count', () => {
    expect(overtakeSegments(2 * 3600)).toEqual([1, 1]);
  });

  it('returns whole blocks plus a trailing partial block', () => {
    // 2h50m
    const segs = overtakeSegments(2 * 3600 + 50 * 60);
    expect(segs.length).toBe(3);
    expect(segs[0]).toBe(1);
    expect(segs[1]).toBe(1);
    expect(segs[2]).toBeCloseTo(50 / 60);
  });

  it('is symmetric for negative (lag) totals', () => {
    expect(overtakeSegments(-2 * 3600)).toEqual(overtakeSegments(2 * 3600));
  });
});
