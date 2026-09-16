import { describe, expect, it } from 'vitest';
import {
  entryWithRange,
  extendToHour,
  fmtClock,
  hourSpan,
  hoursOf,
  parseClock,
  rangeFromHours,
  rangeOf,
  sleepDuration,
} from './sleep';

describe('sleepDuration', () => {
  it('measures a stretch inside one day', () => {
    expect(sleepDuration({ bed: 1 * 60 + 30, wake: 7 * 60 + 15 })).toBe(5 * 60 + 45);
  });

  it('measures a stretch through midnight', () => {
    expect(sleepDuration({ bed: 23 * 60 + 40, wake: 7 * 60 + 20 })).toBe(7 * 60 + 40);
  });

  it('reads a stretch ending where it began as a full day', () => {
    expect(sleepDuration({ bed: 0, wake: 1440 })).toBe(1440);
    expect(sleepDuration({ bed: 120, wake: 120 })).toBe(1440);
  });

  it('is zero without a range', () => {
    expect(sleepDuration(null)).toBe(0);
  });
});

describe('rangeFromHours', () => {
  it('reads a whole-hour selection as its span', () => {
    expect(rangeFromHours([1, 2, 3])).toEqual({ bed: 60, wake: 4 * 60 });
  });

  it('finds the start of a selection that wraps past midnight', () => {
    expect(rangeFromHours([23, 0, 1, 2])).toEqual({ bed: 23 * 60, wake: 3 * 60 });
  });

  it('ends a selection that runs to midnight at 24:00', () => {
    expect(rangeFromHours([22, 23])).toEqual({ bed: 22 * 60, wake: 1440 });
  });

  it('has no range for an empty or junk selection', () => {
    expect(rangeFromHours([])).toBeNull();
    expect(rangeFromHours(null)).toBeNull();
    expect(rangeFromHours([99, -1])).toBeNull();
  });
});

describe('rangeOf', () => {
  it('prefers the entry’s own minutes', () => {
    expect(rangeOf({ hours: [1, 2], quality: null, bed: 85, wake: 200 })).toEqual({ bed: 85, wake: 200 });
  });

  it('falls back to whole hours for an entry saved before minutes existed', () => {
    expect(rangeOf({ hours: [1, 2], quality: 3 })).toEqual({ bed: 60, wake: 3 * 60 });
  });

  it('has no range for a day rated but never filled in', () => {
    expect(rangeOf({ hours: [], quality: 4 })).toBeNull();
  });
});

describe('hoursOf', () => {
  it('paints every cell a partial stretch touches', () => {
    expect(hoursOf({ bed: 1 * 60 + 30, wake: 4 * 60 + 5 })).toEqual([1, 2, 3, 4]);
  });

  it('paints in slept order through midnight', () => {
    expect(hoursOf({ bed: 23 * 60, wake: 1 * 60 })).toEqual([23, 0]);
  });

  it('stops at 24 cells', () => {
    expect(hoursOf({ bed: 30, wake: 30 })).toHaveLength(24);
  });
});

describe('hourSpan', () => {
  it('fills a cell the stretch covers end to end', () => {
    expect(hourSpan({ bed: 60, wake: 4 * 60 }, 2)).toEqual({ from: 0, to: 1 });
  });

  it('fills only the slept part of the cell sleep began in', () => {
    expect(hourSpan({ bed: 1 * 60 + 30, wake: 4 * 60 }, 1)).toEqual({ from: 0.5, to: 1 });
  });

  it('fills only the slept part of the cell sleep ended in', () => {
    expect(hourSpan({ bed: 60, wake: 3 * 60 + 15 }, 3)).toEqual({ from: 0, to: 0.25 });
  });

  it('leaves untouched cells empty', () => {
    expect(hourSpan({ bed: 60, wake: 3 * 60 }, 5)).toBeNull();
    expect(hourSpan(null, 5)).toBeNull();
  });

  it('fills cells on both sides of midnight', () => {
    const r = { bed: 23 * 60 + 30, wake: 30 };
    expect(hourSpan(r, 23)).toEqual({ from: 0.5, to: 1 });
    expect(hourSpan(r, 0)).toEqual({ from: 0, to: 0.5 });
    expect(hourSpan(r, 12)).toBeNull();
  });
});

describe('extendToHour', () => {
  it('opens a one-hour stretch on an empty day', () => {
    expect(extendToHour(null, 3)).toEqual({ bed: 3 * 60, wake: 4 * 60 });
  });

  it('grows the waking end for a cell after the stretch', () => {
    expect(extendToHour({ bed: 60, wake: 3 * 60 }, 5)).toEqual({ bed: 60, wake: 6 * 60 });
  });

  it('grows the bedtime end for a cell before the stretch', () => {
    expect(extendToHour({ bed: 4 * 60, wake: 6 * 60 }, 2)).toEqual({ bed: 2 * 60, wake: 6 * 60 });
  });

  it('keeps a partial bedtime when growing the other end', () => {
    expect(extendToHour({ bed: 60 + 20, wake: 3 * 60 }, 6)).toEqual({ bed: 80, wake: 7 * 60 });
  });

  it('cuts the stretch short at a cell it already covers', () => {
    expect(extendToHour({ bed: 60, wake: 6 * 60 }, 4)).toEqual({ bed: 60, wake: 4 * 60 });
  });

  it('clears the day when the cell sleep began in is clicked', () => {
    expect(extendToHour({ bed: 60 + 20, wake: 6 * 60 }, 1)).toBeNull();
  });

  it('grows past midnight towards the nearer end', () => {
    expect(extendToHour({ bed: 0, wake: 5 * 60 }, 23)).toEqual({ bed: 23 * 60, wake: 5 * 60 });
  });

  it('cuts rather than grows when the whole clock is already filled', () => {
    expect(extendToHour({ bed: 60, wake: 30 }, 0)).toEqual({ bed: 60, wake: 0 });
  });
});

describe('entryWithRange', () => {
  it('saves the minutes and the hours they paint', () => {
    expect(entryWithRange({ hours: [], quality: 2 }, { bed: 90, wake: 7 * 60 + 10 })).toEqual({
      hours: [1, 2, 3, 4, 5, 6, 7],
      quality: 2,
      bed: 90,
      wake: 430,
    });
  });

  it('drops a cleared day that has no rating either', () => {
    expect(entryWithRange({ hours: [1, 2], quality: null }, null)).toBeNull();
  });

  it('keeps a cleared day that still carries a rating', () => {
    expect(entryWithRange({ hours: [1, 2], quality: 5 }, null)).toEqual({
      hours: [],
      quality: 5,
      bed: null,
      wake: null,
    });
  });
});

describe('fmtClock', () => {
  it('pads both halves', () => {
    expect(fmtClock(7 * 60 + 5)).toBe('07:05');
    expect(fmtClock(0)).toBe('00:00');
  });

  it('writes the closing midnight as 24:00', () => {
    expect(fmtClock(1440)).toBe('24:00');
  });
});

describe('parseClock', () => {
  it('reads a bare hour', () => {
    expect(parseClock('7')).toBe(7 * 60);
  });

  it('reads digits without a separator', () => {
    expect(parseClock('730')).toBe(7 * 60 + 30);
    expect(parseClock('0730')).toBe(7 * 60 + 30);
  });

  it('reads the usual separators', () => {
    expect(parseClock('7:30')).toBe(7 * 60 + 30);
    expect(parseClock('7.05')).toBe(7 * 60 + 5);
    expect(parseClock(' 23:59 ')).toBe(23 * 60 + 59);
  });

  it('accepts the closing midnight', () => {
    expect(parseClock('24:00')).toBe(1440);
  });

  it('rejects what is not a time', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('7:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});
