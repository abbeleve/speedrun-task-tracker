// Geometry of the calendar's horizontal layout — the timeline.
//
// Each visible day is a row and the hours run across it. Blocks that overlap
// in time are stacked into lanes, one under the other, instead of being
// squeezed side by side the way the vertical grid shares a column; a row grows
// by one lane for every block running in parallel. From the top down a row is:
//
//   rail zone   the sessions' rails and the 🔗 glue handles
//   lanes       the blocks, one lane per parallel block
//   reminders   thin rails along the bottom, one per overlapping reminder
//
// When the rows need less height than the sheet has, the spare height is
// shared between them, so a short week still fills the screen. Across, an
// hour is wide enough for a block's name to be read, and the sheet scrolls
// sideways through the day; right-drag zooms a stretch of it to fill the
// sheet's width.

import type { Task } from './types';
import type { Chain, DaySegment } from './schedule';
import { DAY_MIN, MIN_MS, dayStartMs, daySegments, isSession } from './schedule';

export const TL_PX_PER_MIN = 2; // 120px an hour
export const TL_GUTTER_PX = 68; // the day labels on the left
export const TL_RULER_PX = 30; // the hour ruler along the top
export const TL_RAIL_PX = 20;
export const TL_LANE_PX = 42;
export const TL_LANE_GAP_PX = 6;
export const TL_ROW_PAD_PX = 10; // under the last lane
export const TL_REMINDER_PX = 8; // one reminder rail and the gap above it
// The narrowest a block is drawn: the colour bar, the emoji and the ✓ still
// fit, one over the other.
export const TL_MIN_BLOCK_PX = 26;
// Hour labels closer together than this start skipping hours.
const TL_MIN_LABEL_GAP_PX = 44;
// How wide a block must be to have any room for its name beside the emoji
// and the ✓, and to show its times on a second line as well.
const TL_NAME_MIN_PX = 48;
const TL_TIMES_MIN_PX = 92;

// Pixels per minute across the timeline: the fixed scale, or — zoomed — the
// chosen stretch spread over the room right of the day labels.
export function timelineScale(viewPx: number, zoomSpanMin: number | null): number {
  if (zoomSpanMin === null || viewPx <= 0) return TL_PX_PER_MIN;
  return viewPx / Math.max(1, zoomSpanMin);
}

// What a block this wide has room for: everything, its name but not its
// times, or — a sliver of a block — only the emoji over the ✓ (the hover
// card has the rest).
export function blockDetail(widthPx: number): 'full' | 'name' | 'compact' {
  if (widthPx >= TL_TIMES_MIN_PX) return 'full';
  return widthPx >= TL_NAME_MIN_PX ? 'name' : 'compact';
}

// How many lanes a day needs: as many as blocks ever run at once in it.
export function laneCount(segments: Pick<DaySegment, 'cols'>[]): number {
  return segments.reduce((most, seg) => Math.max(most, seg.cols), 1);
}

// How many reminder rails are stacked along the bottom of a day.
export function reminderRailCount(segments: Pick<DaySegment, 'col'>[]): number {
  return segments.reduce((most, seg) => Math.max(most, seg.col + 1), 0);
}

export function laneTop(lane: number): number {
  return TL_RAIL_PX + lane * (TL_LANE_PX + TL_LANE_GAP_PX);
}

export function laneMiddle(lane: number): number {
  return laneTop(lane) + TL_LANE_PX / 2;
}

// From the top of the first lane to the bottom of the last.
export function lanesHeight(lanes: number): number {
  return lanes * TL_LANE_PX + Math.max(0, lanes - 1) * TL_LANE_GAP_PX;
}

// The least height a row can have and still show everything in it.
export function rowContentHeight(lanes: number, reminderRails: number): number {
  return TL_RAIL_PX + lanesHeight(lanes) + TL_ROW_PAD_PX + reminderRails * TL_REMINDER_PX;
}

export interface RowLayout {
  tops: number[];
  heights: number[];
  total: number;
}

// Stacks the rows. Given more room than they need, each gets an equal share
// of what is left over; given less, each keeps its own height and the sheet
// scrolls.
export function layoutRows(contentHeights: number[], available: number): RowLayout {
  const needed = contentHeights.reduce((sum, h) => sum + h, 0);
  const spare =
    contentHeights.length > 0 ? Math.max(0, available - needed) / contentHeights.length : 0;
  const heights = contentHeights.map((h) => h + spare);
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h;
  }
  return { tops, heights, total: y };
}

// The row under a point `y` pixels below the top of the first row, clamped to
// the first and last row so a drag that leaves the sheet keeps its day.
export function rowAt(y: number, layout: RowLayout): number {
  const { tops, heights } = layout;
  if (tops.length === 0) return 0;
  for (let i = 0; i < tops.length; i++) {
    if (y < tops[i] + heights[i]) return i;
  }
  return tops.length - 1;
}

// The lane each block being carried (or edited) would land in if it were let
// go now: the day packed again, with those blocks at their new slots among the
// ones that stay put. Clamped to the lanes the row already has, so a row never
// grows or shrinks — and the rows below never shift — in the middle of a drag.
export function landingLanes(
  settled: Task[],
  moving: Task[],
  day: string,
  minDurationMin: number,
  lanes: number
): Map<string, number> {
  const result = new Map<string, number>();
  // Nothing carried is the usual case, redrawn on every tick of the clock.
  if (moving.length === 0) return result;
  const ids = new Set(moving.map((t) => t.id));
  const packed = daySegments(
    [...settled.filter((t) => !ids.has(t.id)), ...moving],
    day,
    minDurationMin
  );
  for (const seg of packed) {
    if (ids.has(seg.task.id)) result.set(seg.task.id, Math.min(seg.col, lanes - 1));
  }
  return result;
}

// Every how many hours the ruler prints a label at this scale.
export function hourLabelStep(pxPerMin: number): number {
  const pxPerHour = pxPerMin * 60;
  return [1, 2, 3, 4, 6, 12].find((step) => step * pxPerHour >= TL_MIN_LABEL_GAP_PX) ?? 12;
}

// ── session connectors ─────────────────────────────────────────────

// A connector from where one step of a session ends to where the next one
// starts, within one day's row.
export interface TimelineLink {
  key: string;
  chainId: string;
  fromMin: number;
  fromLane: number;
  toMin: number;
  toLane: number;
}

// The connectors a day's row draws: for every session in it, one from each
// step to the next — from the block of a step that ends last to the block of
// the following step that starts first, so parallel blocks inside a step are
// not tied to each other. A connector is drawn only in the row where both of
// its ends are: one that would cross midnight is drawn in neither.
export function sessionLinks(chains: Chain[], segments: DaySegment[], day: string): TimelineLink[] {
  const from = dayStartMs(day);
  const to = from + DAY_MIN * MIN_MS;
  const byTask = new Map(segments.map((seg) => [seg.task.id, seg]));
  const links: TimelineLink[] = [];
  for (const chain of chains) {
    if (!isSession(chain) || chain.endMs <= from || chain.startMs >= to) continue;
    for (let i = 0; i + 1 < chain.groups.length; i++) {
      const tail = chain.groups[i].tasks
        .map((t) => byTask.get(t.id))
        .filter((seg): seg is DaySegment => seg !== undefined && seg.endsHere)
        .sort((a, b) => b.bottomMin - a.bottomMin)[0];
      const head = chain.groups[i + 1].tasks
        .map((t) => byTask.get(t.id))
        .filter((seg): seg is DaySegment => seg !== undefined && seg.startsHere)
        .sort((a, b) => a.topMin - b.topMin)[0];
      if (!tail || !head) continue;
      links.push({
        key: `${tail.task.id}>${head.task.id}`,
        chainId: chain.id,
        fromMin: tail.bottomMin,
        fromLane: tail.col,
        toMin: head.topMin,
        toLane: head.col,
      });
    }
  }
  return links;
}

// The SVG path of a connector: out of the first block to the right, across to
// the next one's lane and into its left edge. Between lanes it is an elbow
// with rounded corners, turning halfway along the gap; in the same lane it is
// a straight line; with too little room for an elbow it is a soft S-curve.
export function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`;
  const run = x2 - x1;
  if (run < 12) {
    const reach = 18;
    return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
  }
  const mid = x1 + run / 2;
  const dir = y2 > y1 ? 1 : -1;
  const r = Math.min(8, Math.abs(y2 - y1) / 2, run / 2);
  return [
    `M ${x1} ${y1}`,
    `H ${mid - r}`,
    `Q ${mid} ${y1} ${mid} ${y1 + dir * r}`,
    `V ${y2 - dir * r}`,
    `Q ${mid} ${y2} ${mid + r} ${y2}`,
    `H ${x2}`,
  ].join(' ');
}

// ── a day's detail cards ───────────────────────────────────────────

// Hovering a day in the columns opens a card per reminder (and one for the
// first real break) beside the column. A timeline row spans the screen, so
// there the cards line up under the row instead — or over it, when the row
// sits too low on the screen for them.
export function cardsBelow(
  rowTop: number,
  rowBottom: number,
  viewportHeight: number,
  gap: number,
  wanted = 150
): boolean {
  const below = viewportHeight - 8 - (rowBottom + gap);
  const above = rowTop - gap - 8;
  return below >= wanted || below >= above;
}

// Lays the cards out in one line: each as close as it can get to straight
// across from what it describes, pushed apart so none overlap, and kept
// inside `bounds`. They narrow (down to `minWidth`) when there are many.
// `anchors` are the x the cards point at, left to right.
export function spreadCards(
  anchors: number[],
  bounds: { left: number; right: number },
  maxWidth: number,
  minWidth: number,
  gap: number
): { width: number; lefts: number[] } {
  const n = anchors.length;
  if (n === 0) return { width: maxWidth, lefts: [] };
  const room = bounds.right - bounds.left;
  const width = Math.max(minWidth, Math.min(maxWidth, (room - (n - 1) * gap) / n));
  const lefts: number[] = [];
  anchors.forEach((x, i) => {
    const wanted = x - width / 2;
    lefts.push(i === 0 ? Math.max(bounds.left, wanted) : Math.max(wanted, lefts[i - 1] + width + gap));
  });
  // Ran off the right edge: pull back from there, as far as the gaps allow.
  if (lefts[n - 1] + width > bounds.right) {
    lefts[n - 1] = bounds.right - width;
    for (let i = n - 2; i >= 0; i--) lefts[i] = Math.min(lefts[i], lefts[i + 1] - gap - width);
  }
  // More cards than fit even at their narrowest: keep the first ones on screen.
  if (lefts[0] < bounds.left) {
    const shift = bounds.left - lefts[0];
    for (let i = 0; i < n; i++) lefts[i] += shift;
  }
  return { width, lefts };
}

// A connector dropping from a point in the row to the near edge of its card:
// it leaves straight down (or up) and arrives the same way.
export function dropPath(x1: number, y1: number, x2: number, y2: number): string {
  const dir = y2 >= y1 ? 1 : -1;
  const bend = Math.max(16, Math.abs(y2 - y1) * 0.42);
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${x2} ${y2 - dir * bend}, ${x2} ${y2}`;
}

// ── hover card ─────────────────────────────────────────────────────

// Where a block's hover card goes in the timeline: under the block (a wide
// block leaves no room beside it), or over it when the block sits too low on
// the screen, and slid sideways to stay on screen.
export function hoverCardUnder(
  rect: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8
): { left: number; top: number; origin: string } {
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, viewport.width - margin - card.width));
  const fitsBelow = rect.bottom + gap + card.height <= viewport.height - margin;
  const top = fitsBelow
    ? rect.bottom + gap
    : Math.max(margin, rect.top - gap - card.height);
  return { left, top, origin: fitsBelow ? 'left top' : 'left bottom' };
}
