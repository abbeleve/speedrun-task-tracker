import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { buildChains, buildGroups, daySegments } from './schedule';
import {
  TL_LANE_GAP_PX,
  TL_LANE_PX,
  TL_RAIL_PX,
  TL_REMINDER_PX,
  TL_ROW_PAD_PX,
  blockDetail,
  cardsBelow,
  cardsThatFit,
  dropPath,
  hourLabelStep,
  hoverCardUnder,
  landingLanes,
  laneCount,
  laneMiddle,
  laneTop,
  layoutRows,
  linkPath,
  peekBand,
  pickPeeks,
  reminderRailCount,
  rowAt,
  rowContentHeight,
  sessionLinks,
  spreadCards,
  timelineScale,
} from './timeline';

const DAY = '2026-03-10';
const NEXT = '2026-03-11';
const hm = (h: number, m = 0) => h * 60 + m;

let seq = 0;

function task(patch: Partial<Task> & { start?: number | null }): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `task ${seq}`,
    plannedTime: 3600,
    completedAt: null,
    start: null,
    finishedAt: null,
    order: seq,
    emoji: '🎯',
    color: '#3498db',
    type: 'task',
    day: DAY,
    status: 'in-progress',
    ...patch,
  };
}

const chainsOf = (tasks: Task[]) => buildChains(buildGroups(tasks));

describe('lanes', () => {
  it('gives a day one lane per block running at once, and one when it is empty', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(9, 30) });
    const c = task({ start: hm(9, 45) });
    const d = task({ start: hm(14) });
    expect(laneCount(daySegments([a, b, c, d], DAY))).toBe(3);
    expect(laneCount(daySegments([d], DAY))).toBe(1);
    expect(laneCount([])).toBe(1);
  });

  it('stacks lanes one under the other below the rail zone', () => {
    expect(laneTop(0)).toBe(TL_RAIL_PX);
    expect(laneTop(2)).toBe(TL_RAIL_PX + 2 * (TL_LANE_PX + TL_LANE_GAP_PX));
    expect(laneMiddle(1)).toBe(laneTop(1) + TL_LANE_PX / 2);
  });

  it('counts the reminder rails stacked along the bottom', () => {
    const r1 = task({ type: 'reminder', start: hm(8) });
    const r2 = task({ type: 'reminder', start: hm(8, 30) });
    expect(reminderRailCount(daySegments([r1, r2], DAY))).toBe(2);
    expect(reminderRailCount([])).toBe(0);
  });

  it('makes a row tall enough for its lanes and its reminder rails', () => {
    expect(rowContentHeight(1, 0)).toBe(TL_RAIL_PX + TL_LANE_PX + TL_ROW_PAD_PX);
    expect(rowContentHeight(2, 1)).toBe(
      TL_RAIL_PX + 2 * TL_LANE_PX + TL_LANE_GAP_PX + TL_ROW_PAD_PX + TL_REMINDER_PX
    );
  });
});

describe('layoutRows', () => {
  it('shares spare height equally so the rows fill the sheet', () => {
    expect(layoutRows([60, 100], 300)).toEqual({ tops: [0, 130], heights: [130, 170], total: 300 });
  });

  it('keeps each row at its own height when they do not fit', () => {
    expect(layoutRows([200, 150], 300)).toEqual({ tops: [0, 200], heights: [200, 150], total: 350 });
  });

  it('lays out nothing for no rows', () => {
    expect(layoutRows([], 500)).toEqual({ tops: [], heights: [], total: 0 });
  });
});

describe('rowAt', () => {
  const layout = layoutRows([50, 80, 60], 0);

  it('finds the row under a point', () => {
    expect(rowAt(0, layout)).toBe(0);
    expect(rowAt(49, layout)).toBe(0);
    expect(rowAt(50, layout)).toBe(1);
    expect(rowAt(129, layout)).toBe(1);
    expect(rowAt(130, layout)).toBe(2);
  });

  it('keeps a drag that leaves the sheet on the first or last day', () => {
    expect(rowAt(-40, layout)).toBe(0);
    expect(rowAt(1000, layout)).toBe(2);
  });
});

describe('landingLanes', () => {
  it('puts a carried block in the lane it will take once dropped', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(13) });
    // b dragged on top of a: it will be packed beside it, into lane 1.
    const lanes = landingLanes([a, b], [{ ...b, start: hm(9, 30) }], DAY, 0, 2);
    expect(lanes.get(b.id)).toBe(1);
    // Dragged to a free hour it goes back to the first lane.
    expect(landingLanes([a, b], [{ ...b, start: hm(16) }], DAY, 0, 2).get(b.id)).toBe(0);
  });

  it('never needs more lanes than the row already has', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(13) });
    expect(landingLanes([a, b], [{ ...b, start: hm(9) }], DAY, 0, 1).get(b.id)).toBe(0);
  });

  it('packs a whole carried batch together', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(10) });
    const moved = [
      { ...a, start: hm(14) },
      { ...b, start: hm(14, 30) },
    ];
    const lanes = landingLanes([a, b], moved, DAY, 0, 3);
    expect([lanes.get(a.id), lanes.get(b.id)]).toEqual([0, 1]);
  });

  it('leaves out a carried block that lands on another day', () => {
    const a = task({ start: hm(9) });
    expect(landingLanes([a], [{ ...a, day: NEXT }], DAY, 0, 1).has(a.id)).toBe(false);
  });
});

describe('timelineScale', () => {
  it('draws the day at 120px an hour whatever the width, scrolling across it', () => {
    expect(timelineScale(1152, null)).toBe(2);
    expect(timelineScale(320, null)).toBe(2);
  });

  it('spreads a zoomed stretch over the width there is', () => {
    // 09:00–12:00 across 900px: 5px a minute.
    expect(timelineScale(900, 180)).toBe(5);
  });

  it('keeps the fixed scale until the sheet has been measured', () => {
    expect(timelineScale(0, 180)).toBe(2);
  });
});

describe('blockDetail', () => {
  it('shows a wide block in full, a middling one by name, a sliver by emoji', () => {
    expect(blockDetail(120)).toBe('full'); // an hour
    expect(blockDetail(92)).toBe('full');
    expect(blockDetail(60)).toBe('name'); // half an hour
    expect(blockDetail(48)).toBe('name');
    expect(blockDetail(30)).toBe('compact'); // a quarter of an hour
  });
});

describe('hourLabelStep', () => {
  it('labels every hour while an hour is wide enough and skips hours as it shrinks', () => {
    expect(hourLabelStep(2)).toBe(1); // 120px an hour
    expect(hourLabelStep(0.8)).toBe(1); // 48px — a 1152px-wide day
    expect(hourLabelStep(0.5)).toBe(2); // 30px — a 720px-wide day
    expect(hourLabelStep(0.21)).toBe(4); // 12.6px — a phone
    expect(hourLabelStep(0.01)).toBe(12);
  });
});

describe('sessionLinks', () => {
  it('ties each step of a session to the next one', () => {
    const a = task({ start: hm(9), sessionId: 's' });
    const b = task({ start: hm(10), sessionId: 's' });
    const c = task({ start: hm(12), sessionId: 's' });
    const segments = daySegments([a, b, c], DAY);
    expect(sessionLinks(chainsOf([a, b, c]), segments, DAY)).toEqual([
      { key: `${a.id}>${b.id}`, chainId: a.id, fromMin: hm(10), fromLane: 0, toMin: hm(10), toLane: 0 },
      { key: `${b.id}>${c.id}`, chainId: a.id, fromMin: hm(11), fromLane: 0, toMin: hm(12), toLane: 0 },
    ]);
  });

  it('leaves blocks that are not in a session unconnected', () => {
    const a = task({ start: hm(9) });
    const b = task({ start: hm(10) });
    expect(sessionLinks(chainsOf([a, b]), daySegments([a, b], DAY), DAY)).toEqual([]);
  });

  it('leaves the step that ends last and joins the one that starts first', () => {
    // 9:00–10:00 and 9:00–10:30 run in parallel, then 11:00 follows.
    const a = task({ start: hm(9), sessionId: 's' });
    const b = task({ start: hm(9), plannedTime: 5400, sessionId: 's' });
    const c = task({ start: hm(11), sessionId: 's' });
    const segments = daySegments([a, b, c], DAY);
    const [link] = sessionLinks(chainsOf([a, b, c]), segments, DAY);
    expect(link.key).toBe(`${b.id}>${c.id}`);
    expect(link.fromMin).toBe(hm(10, 30));
    expect(link.fromLane).toBe(segments.find((s) => s.task.id === b.id)!.col);
  });

  it('draws no connector across midnight in either row', () => {
    const a = task({ start: hm(22), sessionId: 's' });
    const b = task({ day: NEXT, start: hm(0, 30), sessionId: 's' });
    const chains = chainsOf([a, b]);
    expect(sessionLinks(chains, daySegments([a, b], DAY), DAY)).toEqual([]);
    expect(sessionLinks(chains, daySegments([a, b], NEXT), NEXT)).toEqual([]);
  });

  it('joins a block that ran over midnight in the row where it ends', () => {
    const a = task({ start: hm(23), plannedTime: 2 * 3600, sessionId: 's' });
    const b = task({ day: NEXT, start: hm(2), sessionId: 's' });
    const chains = chainsOf([a, b]);
    expect(sessionLinks(chains, daySegments([a, b], DAY), DAY)).toEqual([]);
    expect(sessionLinks(chains, daySegments([a, b], NEXT), NEXT)).toMatchObject([
      { fromMin: hm(1), toMin: hm(2) },
    ]);
  });
});

describe('linkPath', () => {
  it('is a straight line inside one lane', () => {
    expect(linkPath(10, 40, 90, 40)).toBe('M 10 40 H 90');
  });

  it('turns halfway along the gap with rounded corners between lanes', () => {
    expect(linkPath(0, 40, 100, 88)).toBe('M 0 40 H 42 Q 50 40 50 48 V 80 Q 50 88 58 88 H 100');
    // Going up a lane bends the other way.
    expect(linkPath(0, 88, 100, 40)).toBe('M 0 88 H 42 Q 50 88 50 80 V 48 Q 50 40 58 40 H 100');
  });

  it('falls back to an S-curve when the blocks leave no room for an elbow', () => {
    expect(linkPath(100, 40, 104, 88)).toBe('M 100 40 C 118 40, 86 88, 104 88');
  });
});

describe('pickPeeks', () => {
  const visible = { left: 100, right: 1000, top: 50, bottom: 600 };
  const block = (id: string, left: number, width = 30, top = 100) => ({
    id,
    rect: { left, right: left + width, top, bottom: top + 42 },
  });

  it('takes every one on screen, left to right', () => {
    const picked = pickPeeks(
      [block('d', 700), block('a', 150), block('c', 500), block('b', 300), block('e', 900)],
      visible
    );
    expect(picked.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('skips blocks scrolled out of sight, but keeps one half on screen', () => {
    const picked = pickPeeks(
      [block('gone-left', 20, 40), block('half', 80, 40), block('below', 300, 30, 700)],
      visible
    );
    expect(picked.map((p) => p.id)).toEqual(['half']);
  });
});

describe('cardsThatFit', () => {
  it('counts the cards that fit side by side with their gaps', () => {
    expect(cardsThatFit(1600, 260, 8)).toBe(6);
    // The last card needs no gap after it.
    expect(cardsThatFit(3 * 260 + 2 * 8, 260, 8)).toBe(3);
    expect(cardsThatFit(3 * 260 + 2 * 8 - 1, 260, 8)).toBe(2);
  });

  it('fits none in too little room', () => {
    expect(cardsThatFit(200, 260, 8)).toBe(0);
    expect(cardsThatFit(-50, 260, 8)).toBe(0);
  });
});

describe('peekBand', () => {
  const row = { top: 200, bottom: 400 };

  it('hangs the peeks under the lanes, and the row reaches as far as they do', () => {
    expect(peekBand(row, 300, 120, 900)).toEqual({ below: true, edge: 308, over: 200, under: 428 });
    // Short ones that stay inside the row leave it as it is.
    expect(peekBand(row, 300, 60, 900).under).toBe(400);
  });

  it('puts them over the row when they would run off the bottom of the screen', () => {
    expect(peekBand(row, 300, 120, 420)).toEqual({ below: false, edge: 192, over: 72, under: 400 });
  });

  it('keeps them on screen over a row at the very top', () => {
    const top = { top: 40, bottom: 400 };
    expect(peekBand(top, 380, 120, 420)).toEqual({ below: false, edge: 128, over: 8, under: 400 });
  });
});

describe('cardsBelow', () => {
  it('opens the day cards under a row with room below it', () => {
    expect(cardsBelow(100, 180, 900, 18)).toBe(true);
  });

  it('opens them over a row near the bottom of the screen', () => {
    expect(cardsBelow(700, 800, 900, 18)).toBe(false);
  });

  it('takes the roomier side when neither has enough', () => {
    // A 300px-high window: 84px under the row against 64 over it, then the
    // other way round.
    expect(cardsBelow(90, 190, 300, 18)).toBe(true);
    expect(cardsBelow(110, 210, 300, 18)).toBe(false);
  });
});

describe('spreadCards', () => {
  const bounds = { left: 8, right: 1192 };

  it('centres a lone card on what it points at', () => {
    expect(spreadCards([600], bounds, 288, 180, 8)).toEqual({ width: 288, lefts: [456] });
  });

  it('pushes cards that would overlap apart, in order', () => {
    const { lefts } = spreadCards([500, 520], bounds, 288, 180, 8);
    expect(lefts).toEqual([356, 652]);
  });

  it('keeps cards near either edge on screen', () => {
    expect(spreadCards([20], bounds, 288, 180, 8).lefts).toEqual([8]);
    expect(spreadCards([1180], bounds, 288, 180, 8).lefts).toEqual([904]);
    // Two crowding the right edge are pulled back together.
    expect(spreadCards([1150, 1180], bounds, 288, 180, 8).lefts).toEqual([608, 904]);
  });

  it('narrows the cards when there are many, down to the smallest width', () => {
    const five = spreadCards([100, 200, 300, 400, 500], { left: 0, right: 1000 }, 288, 180, 10);
    expect(five.width).toBe(192);
    expect(five.lefts[4] + five.width).toBeLessThanOrEqual(1000);
    expect(spreadCards([1, 2, 3, 4, 5, 6, 7], { left: 0, right: 1000 }, 288, 180, 10).width).toBe(180);
  });

  it('lays out nothing for no cards', () => {
    expect(spreadCards([], bounds, 288, 180, 8)).toEqual({ width: 288, lefts: [] });
  });
});

describe('dropPath', () => {
  it('leaves the row straight down and arrives straight down', () => {
    expect(dropPath(100, 50, 140, 100)).toBe('M 100 50 C 100 71, 140 79, 140 100');
  });

  it('rises the same way to a card over the row', () => {
    expect(dropPath(100, 100, 140, 50)).toBe('M 100 100 C 100 79, 140 71, 140 50');
  });
});

describe('hoverCardUnder', () => {
  const card = { width: 260, height: 120 };
  const viewport = { width: 1200, height: 800 };

  it('opens under the block, lined up with its left edge', () => {
    expect(hoverCardUnder({ left: 300, top: 100, bottom: 142 }, card, viewport)).toEqual({
      left: 300,
      top: 150,
      origin: 'left top',
    });
  });

  it('opens over a block too low on the screen', () => {
    expect(hoverCardUnder({ left: 300, top: 700, bottom: 742 }, card, viewport)).toEqual({
      left: 300,
      top: 572,
      origin: 'left bottom',
    });
  });

  it('stays on screen when the block starts off either edge', () => {
    expect(hoverCardUnder({ left: -500, top: 100, bottom: 142 }, card, viewport).left).toBe(8);
    expect(hoverCardUnder({ left: 1100, top: 100, bottom: 142 }, card, viewport).left).toBe(932);
  });
});
