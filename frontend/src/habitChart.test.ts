import { describe, expect, it } from 'vitest';
import type { Habit } from './types';
import { GAUGE_SWEEP_DEG, gaugeSegments, gaugeStatus, habitChartOf, habitPercent } from './habitChart';

function habit(patch: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Отжимания',
    emoji: '💪',
    color: '#2ecc71',
    format: 'count',
    target: 10,
    targets: [{ since: '', target: 10 }],
    unit: 'раз',
    order: 0,
    ...patch,
  };
}

describe('habitChartOf', () => {
  it('keeps the dots for habits saved before the choice existed', () => {
    expect(habitChartOf(habit())).toBe('dots');
  });

  it('reads the stored choice', () => {
    expect(habitChartOf(habit({ chart: 'gauge' }))).toBe('gauge');
    expect(habitChartOf(habit({ chart: 'dots' }))).toBe('dots');
  });

  it('falls back to the dots for a value this client does not know', () => {
    expect(habitChartOf(habit({ chart: 'pie' as never }))).toBe('dots');
  });
});

describe('habitPercent', () => {
  it('rounds to a whole percent and may run past 100', () => {
    expect(habitPercent(7, 10)).toBe(70);
    expect(habitPercent(13, 10)).toBe(130);
    expect(habitPercent(1, 3)).toBe(33);
  });

  it('is 0 without a quota and never negative', () => {
    expect(habitPercent(5, 0)).toBe(0);
    expect(habitPercent(-2, 10)).toBe(0);
  });
});

describe('gaugeSegments', () => {
  it('fans out symmetrically from the lower left to the lower right', () => {
    const segs = gaugeSegments(13, 0);
    const overhang = ((GAUGE_SWEEP_DEG - 180) / 2) * (Math.PI / 180);
    expect(segs).toHaveLength(13);
    expect(segs[0].angle).toBeCloseTo(Math.PI + overhang);
    expect(segs[6].angle).toBeCloseTo(Math.PI / 2);
    expect(segs[12].angle).toBeCloseTo(-overhang);
    expect(segs[0].position).toBe(0);
    expect(segs[12].position).toBe(1);
  });

  it('lights only whole capsules, so it is full only when the quota is met', () => {
    const lit = (p: number) => gaugeSegments(13, p).filter((s) => s.lit).length;
    expect(lit(0)).toBe(0);
    expect(lit(0.05)).toBe(0);
    expect(lit(0.5)).toBe(6);
    expect(lit(0.99)).toBe(12);
    expect(lit(1)).toBe(13);
    expect(lit(1.7)).toBe(13);
  });

  it('lights from the start of the arc', () => {
    const segs = gaugeSegments(4, 0.5);
    expect(segs.map((s) => s.lit)).toEqual([true, true, false, false]);
  });

  it('handles degenerate counts', () => {
    expect(gaugeSegments(0, 0.5)).toEqual([]);
    expect(gaugeSegments(1, 1)).toEqual([{ angle: Math.PI / 2 + (GAUGE_SWEEP_DEG * Math.PI) / 360, lit: true, position: 0 }]);
  });
});

describe('gaugeStatus', () => {
  it('says how much is left while the quota is open', () => {
    expect(gaugeStatus(7, 10, 'раз')).toEqual({ done: false, text: 'Ещё 3 раз' });
    expect(gaugeStatus(245, 300, 'мин')).toEqual({ done: false, text: 'Ещё 55 мин' });
    expect(gaugeStatus(0.5, 2, '')).toEqual({ done: false, text: 'Ещё 1.5' });
  });

  it('marks the quota as met, including an overshoot', () => {
    expect(gaugeStatus(10, 10, 'раз')).toEqual({ done: true, text: 'Норма выполнена' });
    expect(gaugeStatus(14, 10, 'раз')?.done).toBe(true);
  });

  it('shows nothing for a habit without a quota', () => {
    expect(gaugeStatus(3, 0, 'раз')).toBeNull();
  });
});
