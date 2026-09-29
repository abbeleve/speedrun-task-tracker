import { describe, expect, it } from 'vitest';
import {
  EDGE_SCROLL_MAX_PX,
  EDGE_SCROLL_ZONE_PX,
  FLING_GUARD_MS,
  TOUCH_SLOP_PX,
  edgeScrollStep,
  isTouchPointer,
  landsOnFling,
  touchWandered,
} from './touchGesture';

describe('touch on the calendar grid', () => {
  it('treats every pointer but the mouse as a finger', () => {
    expect(isTouchPointer('mouse')).toBe(false);
    expect(isTouchPointer('touch')).toBe(true);
    expect(isTouchPointer('pen')).toBe(true);
  });

  it('keeps a resting finger within the slop and drops one that scrolls', () => {
    expect(touchWandered(100, 100, 100, 100)).toBe(false);
    expect(touchWandered(100, 100, 106, 106)).toBe(false);
    expect(touchWandered(100, 100, 100, 100 + TOUCH_SLOP_PX + 1)).toBe(true);
    expect(touchWandered(100, 100, 92, 92)).toBe(true);
  });

  it('ignores a landing that only stops a flick', () => {
    expect(landsOnFling(1000, 1000 + FLING_GUARD_MS - 1)).toBe(true);
    expect(landsOnFling(1000, 1000 + FLING_GUARD_MS)).toBe(false);
    expect(landsOnFling(-Infinity, 1000)).toBe(false);
  });
});

describe('edge auto-scroll while dragging', () => {
  const top = 200;
  const bottom = 600;

  it('stays put in the middle of the grid', () => {
    expect(edgeScrollStep(400, top, bottom)).toBe(0);
    expect(edgeScrollStep(top + EDGE_SCROLL_ZONE_PX, top, bottom)).toBe(0);
    expect(edgeScrollStep(bottom - EDGE_SCROLL_ZONE_PX, top, bottom)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster at the edge', () => {
    const nearTop = edgeScrollStep(top + EDGE_SCROLL_ZONE_PX - 5, top, bottom);
    const atTop = edgeScrollStep(top, top, bottom);
    expect(nearTop).toBeLessThan(0);
    expect(atTop).toBe(-EDGE_SCROLL_MAX_PX);
    expect(Math.abs(nearTop)).toBeLessThan(Math.abs(atTop));

    const nearBottom = edgeScrollStep(bottom - EDGE_SCROLL_ZONE_PX + 5, top, bottom);
    expect(nearBottom).toBeGreaterThan(0);
    expect(edgeScrollStep(bottom, top, bottom)).toBe(EDGE_SCROLL_MAX_PX);
  });

  it('keeps full speed just past the edges but ignores the rest of the page', () => {
    expect(edgeScrollStep(top - 10, top, bottom)).toBe(-EDGE_SCROLL_MAX_PX);
    expect(edgeScrollStep(bottom + 10, top, bottom)).toBe(EDGE_SCROLL_MAX_PX);
    expect(edgeScrollStep(top - EDGE_SCROLL_ZONE_PX - 1, top, bottom)).toBe(0);
    expect(edgeScrollStep(bottom + EDGE_SCROLL_ZONE_PX + 1, top, bottom)).toBe(0);
  });
});
