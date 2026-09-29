// Touch on the calendar grid.
//
// With a mouse a press on the grid is already a drag: it draws a block, moves
// one, or sweeps a lasso. A finger on a phone or tablet has to scroll the same
// grid, so a touch press only takes hold of what it landed on once it has been
// held still for TOUCH_HOLD_MS. Until then it is a tap in waiting — let go
// where it landed it opens the block (or drafts a new one on empty canvas);
// moved off the spot it was a scroll and is dropped. Once held, the grid stops
// scrolling under the finger and the press drags exactly like a mouse would.

// How long a finger has to rest on a block before it can be dragged.
export const TOUCH_HOLD_MS = 450;

// How far the finger may drift while it is held and still count as resting.
// Past this, the press is a scroll.
export const TOUCH_SLOP_PX = 10;

// A finger that lands while the grid is still gliding from a flick stops the
// glide; that landing is not a tap on whatever happened to be underneath.
export const FLING_GUARD_MS = 120;

// Anything that is not a mouse is handled as a finger: a pen drags a scroll
// view the same way.
export function isTouchPointer(pointerType: string): boolean {
  return pointerType !== 'mouse';
}

// Whether the finger has left the spot it landed on.
export function touchWandered(fromX: number, fromY: number, x: number, y: number): boolean {
  return Math.hypot(x - fromX, y - fromY) > TOUCH_SLOP_PX;
}

// Whether a press at `nowMs` lands on a grid that scrolled at `lastScrollMs`
// — that is, one still gliding.
export function landsOnFling(lastScrollMs: number, nowMs: number): boolean {
  return nowMs - lastScrollMs < FLING_GUARD_MS;
}

// Edge auto-scroll while something is dragged over the grid.
export const EDGE_SCROLL_ZONE_PX = 36;
export const EDGE_SCROLL_MAX_PX = 14;

// How far to scroll the grid on this frame for a pointer at `y`, given the
// grid's visible top and bottom: up near (or just above) the top edge, down
// near (or just below) the bottom edge, faster the closer it gets. Well
// outside the grid — over the backlog, say — it does not scroll at all.
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  const zone = EDGE_SCROLL_ZONE_PX;
  if (y < top - zone || y > bottom + zone) return 0;
  if (y < top + zone) {
    return -Math.ceil(EDGE_SCROLL_MAX_PX * Math.min(1, (top + zone - y) / zone));
  }
  if (y > bottom - zone) {
    return Math.ceil(EDGE_SCROLL_MAX_PX * Math.min(1, (y - (bottom - zone)) / zone));
  }
  return 0;
}
