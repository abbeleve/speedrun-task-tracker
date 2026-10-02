import { describe, expect, it } from 'vitest';
import { storyRailPath } from './storyRail';

// A desktop row: a 442px square picture with 22px all round.
const row = { width: 992, height: 486, inset: 22, picture: 442 };

describe('storyRailPath', () => {
  it('bends in a true half-circle around a square picture', () => {
    expect(storyRailPath(row, false, false))
      .toBe('M 243 0 A 243 243 0 0 0 0 243 V 243 A 243 243 0 0 0 243 486 H 749');
  });

  it('mirrors the bend to the right on alternate rows', () => {
    expect(storyRailPath(row, true, false))
      .toBe('M 749 0 A 243 243 0 0 1 992 243 V 243 A 243 243 0 0 1 749 486 H 243');
  });

  it('starts the first step above the far edge of its picture', () => {
    expect(storyRailPath(row, false, true)).toMatch(/^M 464 0 H 243 A/);
  });

  it('straightens a taller row instead of widening its bend', () => {
    expect(storyRailPath({ ...row, height: 600 }, false, false))
      .toBe('M 243 0 A 243 243 0 0 0 0 243 V 357 A 243 243 0 0 0 243 600 H 749');
  });

  it('hands each row over where the next one picks the route up', () => {
    const end = storyRailPath(row, false, false).match(/H (\S+)$/)?.[1];
    const next = storyRailPath({ ...row, height: 600 }, true, false).match(/^M (\S+) 0/)?.[1];
    expect(next).toBe(end);
  });
});
