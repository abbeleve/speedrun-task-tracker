import { describe, expect, it } from 'vitest';
import { formatDelta, formatTime } from './useTimer';

describe('formatTime', () => {
  it('formats sub-hour durations as MM:SS.CC', () => {
    expect(formatTime(65_000)).toBe('01:05.00');
  });

  it('includes hours when present and honours showMs', () => {
    expect(formatTime(3_661_000, false)).toBe('1:01:01');
  });

  it('clamps negative or invalid input to zero', () => {
    expect(formatTime(-10)).toBe('00:00.00');
  });
});

describe('formatDelta', () => {
  it('returns an em dash for zero / equal', () => {
    expect(formatDelta(0)).toBe('—');
  });

  it('signs ahead (negative) and behind (positive)', () => {
    expect(formatDelta(-1500)).toBe('-1.50');
    expect(formatDelta(1500)).toBe('+1.50');
  });
});
