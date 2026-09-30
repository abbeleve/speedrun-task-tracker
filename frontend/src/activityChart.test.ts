import { describe, expect, it } from 'vitest';
import {
  activeAverage,
  activityChartOf,
  axisLabelIndices,
  cumulative,
  fmtChartValue,
  highlightRanges,
  lastIndexWithValue,
  monotonePath,
  niceTicks,
  paceStatus,
  spreadLabels,
  valueOnDay,
} from './activityChart';

const H = 3600;

describe('activityChartOf', () => {
  it('reads a stored choice and falls back to the bars', () => {
    expect(activityChartOf('race')).toBe('race');
    expect(activityChartOf('wave')).toBe('wave');
    expect(activityChartOf('bars')).toBe('bars');
    expect(activityChartOf(undefined)).toBe('bars');
    expect(activityChartOf('pie')).toBe('bars');
  });
});

describe('niceTicks', () => {
  it('steps durations through clock-friendly sizes', () => {
    expect(niceTicks(7.2 * H, 'duration')).toEqual([0, 2 * H, 4 * H, 6 * H, 8 * H]);
    expect(niceTicks(50 * 60, 'duration')).toEqual([0, 15 * 60, 30 * 60, 45 * 60, 60 * 60]);
    expect(niceTicks(40 * H, 'duration')).toEqual([0, 12 * H, 24 * H, 36 * H, 48 * H]);
  });

  it('keeps going in whole days for long running totals', () => {
    const ticks = niceTicks(150 * H, 'duration');
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(150 * H);
    expect(ticks.length - 1).toBeLessThanOrEqual(4);
    expect(ticks[1] % (24 * H)).toBe(0);
  });

  it('steps counts through 1 / 2 / 5 × 10ⁿ', () => {
    expect(niceTicks(3, 'count')).toEqual([0, 1, 2, 3]);
    expect(niceTicks(17, 'count')).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(640, 'count')).toEqual([0, 200, 400, 600, 800]);
  });

  it('ends exactly on a round maximum', () => {
    expect(niceTicks(8 * H, 'duration')).toEqual([0, 2 * H, 4 * H, 6 * H, 8 * H]);
    expect(niceTicks(20, 'count')).toEqual([0, 5, 10, 15, 20]);
  });

  it('gives an empty chart a readable scale', () => {
    expect(niceTicks(0, 'duration')).toEqual([0, 15 * 60, 30 * 60, 45 * 60, 60 * 60]);
    expect(niceTicks(0, 'count')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('fmtChartValue', () => {
  it('writes durations in hours and minutes', () => {
    expect(fmtChartValue(0, 'duration')).toBe('0м');
    expect(fmtChartValue(45 * 60, 'duration')).toBe('45м');
    expect(fmtChartValue(2 * H, 'duration')).toBe('2ч');
    expect(fmtChartValue(1.5 * H, 'duration')).toBe('1ч 30м');
    expect(fmtChartValue(59.6 * 60, 'duration')).toBe('1ч');
  });

  it('writes counts with grouped thousands and at most two decimals', () => {
    expect(fmtChartValue(7, 'count')).toBe('7');
    expect(fmtChartValue(2.5, 'count')).toBe('2.5');
    expect(fmtChartValue(1 / 3, 'count')).toBe('0.33');
    expect(fmtChartValue(5987, 'count')).toBe('5 987');
  });
});

describe('cumulative / lastIndexWithValue / valueOnDay', () => {
  it('runs the total and leaves future days empty', () => {
    const totals = cumulative([1, 0, 2, null, null]);
    expect(totals).toEqual([1, 1, 3, null, null]);
    expect(lastIndexWithValue(totals)).toBe(2);
    expect(lastIndexWithValue([null, null])).toBe(-1);
  });

  it('reads a day of a line, and the final total of a shorter period', () => {
    const feb = cumulative([1, 1, 1]);
    expect(valueOnDay(feb, 1)).toBe(2);
    expect(valueOnDay(feb, 5)).toBe(3);
    expect(valueOnDay([1, null], 1)).toBeNull();
    expect(valueOnDay([], 0)).toBeNull();
  });
});

describe('paceStatus', () => {
  it('compares two running totals', () => {
    expect(paceStatus(10 * H, 8 * H)).toBe('ahead');
    expect(paceStatus(6 * H, 8 * H)).toBe('behind');
  });

  it('calls a small difference level', () => {
    expect(paceStatus(100, 97)).toBe('even');
    expect(paceStatus(0, 0)).toBe('even');
  });

  it('is ahead of an empty period as soon as anything is done', () => {
    expect(paceStatus(1, 0)).toBe('ahead');
  });
});

describe('highlightRanges', () => {
  it('groups consecutive days', () => {
    expect(highlightRanges([false, true, true, false, true, false, false, true])).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 4 },
      { from: 7, to: 7 },
    ]);
    expect(highlightRanges([false, false])).toEqual([]);
  });
});

describe('activeAverage', () => {
  it('averages only the days with activity', () => {
    expect(activeAverage([4 * H, 0, 2 * H, null])).toBe(3 * H);
    expect(activeAverage([0, null])).toBeNull();
  });
});

describe('spreadLabels', () => {
  it('pushes crowded labels apart, keeping their order', () => {
    expect(spreadLabels([50, 52, 100], 14, 0, 200)).toEqual([50, 64, 100]);
    expect(spreadLabels([52, 50], 14, 0, 200)).toEqual([64, 50]);
  });

  it('stays within bounds', () => {
    expect(spreadLabels([2, 3], 14, 10, 200)).toEqual([10, 24]);
    expect(spreadLabels([195, 196], 14, 0, 200)).toEqual([186, 200]);
  });
});

describe('monotonePath', () => {
  it('handles short inputs', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 0, y: 5 }])).toBe('M0,5');
  });

  it('draws a cubic through every point', () => {
    const d = monotonePath([
      { x: 0, y: 100 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
    ]);
    expect(d.startsWith('M0,100C')).toBe(true);
    expect(d.endsWith(',20,50')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });

  it('never overshoots a flat stretch', () => {
    // The segment between two equal points must stay flat: both control
    // points sit on the same y as the ends.
    const d = monotonePath([
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
      { x: 30, y: 0 },
    ]);
    const second = d.split('C')[2];
    const ys = second.split(',').filter((_, i) => i % 2 === 1).map(Number);
    expect(ys).toEqual([20, 20, 20]);
  });
});

describe('axisLabelIndices', () => {
  it('labels every day when they fit', () => {
    expect(axisLabelIndices(7, 60, 44)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('thins a month out to round days, keeping the 1st', () => {
    // 30 days at 8px apart: every 5th day fits a 22px label.
    expect(axisLabelIndices(30, 8, 22)).toEqual([0, 4, 9, 14, 19, 24, 29]);
  });

  it('labels every other day when that is enough', () => {
    expect(axisLabelIndices(8, 12, 22)).toEqual([1, 3, 5, 7]);
  });

  it('always labels today, dropping neighbours it would crowd', () => {
    // Today is the 12th (index 11): the 10th sits too close and gives way.
    expect(axisLabelIndices(30, 8, 22, 11)).toEqual([0, 4, 11, 14, 19, 24, 29]);
    expect(axisLabelIndices(7, 60, 44, 3)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
