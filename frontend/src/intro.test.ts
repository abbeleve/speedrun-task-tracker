import { describe, expect, it } from 'vitest';
import {
  FACE_RADIUS,
  FLIGHT_LENGTH,
  INTRO_TIMES,
  WATCH_PARTS,
  WATCH_RADIUS,
  cameraDistance,
  dialAngle,
  helixBlocks,
  holeRadiusPx,
  introBackground,
  introFrame,
  introGreeting,
  restDistance,
  seededRandom,
  watchPoints,
} from './intro';

const T = INTRO_TIMES;
const FOV = 55;
const samples = Array.from({ length: 141 }, (_, i) => i * 0.025);

describe('introFrame', () => {
  it('opens at full warp with nothing gathered yet', () => {
    const f = introFrame(0);
    expect(f).toMatchObject({ flight: 0, warp: 1, morph: 0, tilt: 1, lap: 0, burst: 0, hole: 0, done: false });
  });

  it('closes the lap exactly at the go, and only then opens the face', () => {
    expect(introFrame(T.go - 0.01).lap).toBeLessThan(1);
    expect(introFrame(T.go).lap).toBe(1);
    expect(introFrame(T.holeStart).hole).toBe(0);
    expect(introFrame(T.holeEnd).hole).toBe(1);
  });

  it('is done at the end, with the camera through the dial', () => {
    expect(introFrame(T.end - 0.01).done).toBe(false);
    const f = introFrame(T.end);
    expect(f).toMatchObject({ done: true, flight: 1, morph: 1, lap: 1, dive: 1, hole: 1, tilt: 0 });
  });

  it('only ever moves forward', () => {
    for (const key of ['flight', 'morph', 'lap', 'burst', 'shock', 'dive', 'hole'] as const) {
      const values = samples.map((t) => introFrame(t)[key]);
      values.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (i > 0) expect(v).toBeGreaterThanOrEqual(values[i - 1]);
      });
    }
  });

  it('streaks hardest at the start and goes still once the flight lands', () => {
    const warp = samples.filter((t) => t <= T.flightEnd).map((t) => introFrame(t).warp);
    warp.forEach((w, i) => i > 0 && expect(w).toBeLessThanOrEqual(warp[i - 1]));
    expect(introFrame(T.flightEnd).warp).toBe(0);
    expect(introFrame(T.go + 0.1).warp).toBeGreaterThan(0);
  });
});

describe('the camera', () => {
  const projected = (r: number, d: number) => r / d / Math.tan((FOV * Math.PI) / 360);

  it.each([
    ['a wide monitor', 16 / 9],
    ['a square window', 1],
    ['a tablet held upright', 0.75],
    ['a phone held upright', 375 / 812],
  ])('rests where the whole watch fits %s', (_, aspect) => {
    const d = restDistance(aspect, FOV);
    // The crown reaches ~1.25 R above the centre: it fits the height …
    expect(projected(WATCH_RADIUS * 1.25, d)).toBeLessThan(1);
    // … and the bezel fits the width.
    expect(projected(WATCH_RADIUS * 1.05, d) / Math.min(1, aspect)).toBeLessThan(1);
  });

  it('flies in from the far end of the helix, rests, then dives through the dial', () => {
    const rest = restDistance(1.6, FOV);
    expect(cameraDistance(introFrame(0), rest)).toBeCloseTo(rest + FLIGHT_LENGTH);
    expect(cameraDistance(introFrame(T.flightEnd), rest)).toBeCloseTo(rest);
    expect(cameraDistance(introFrame(T.go), rest)).toBeCloseTo(rest);
    expect(cameraDistance(introFrame(T.diveEnd), rest)).toBeCloseTo(0.35);
  });
});

describe('holeRadiusPx', () => {
  it('stays shut until the face starts to open', () => {
    const rest = restDistance(1.6, FOV);
    for (const t of samples.filter((s) => s <= T.holeStart)) {
      expect(holeRadiusPx(introFrame(t), cameraDistance(introFrame(t), rest), 1080, FOV)).toBe(0);
    }
  });

  it('opens to the face as the camera sees it', () => {
    const rest = restDistance(1.6, FOV);
    const f = { ...introFrame(T.go), hole: 1 };
    const expected = (FACE_RADIUS / rest / Math.tan((FOV * Math.PI) / 360)) * 540;
    expect(holeRadiusPx(f, rest, 1080, FOV)).toBeCloseTo(expected);
  });

  it.each([
    [1920, 1080],
    [375, 812],
  ])('uncovers the whole %sx%s screen by the end', (w, h) => {
    const rest = restDistance(w / h, FOV);
    const f = introFrame(T.end);
    expect(holeRadiusPx(f, cameraDistance(f, rest), h, FOV)).toBeGreaterThan(Math.hypot(w, h) / 2);
  });
});

describe('the caption and the sky', () => {
  it('greets a new account and a returning one differently', () => {
    expect(introGreeting('welcome', 'ann')).toBe('Добро пожаловать, ann');
    expect(introGreeting('return', 'ann')).toBe('С возвращением, ann');
    expect(introGreeting('return', null)).toBe('');
  });

  it('darkens the palette almost to night, in sRGB', () => {
    expect(introBackground('#22a35a')).toBe('#061512');
    expect(introBackground('#ffffff')).toBe('#1c1e23');
    expect(introBackground('not a colour')).toBe('#03050a');
  });
});

describe('the watch', () => {
  it('reads the dial clockwise from twelve', () => {
    expect(dialAngle(0, 1)).toBeCloseTo(0);
    expect(dialAngle(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(dialAngle(0, -1)).toBeCloseTo(Math.PI);
    expect(dialAngle(-1, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('shares the particles out between the parts, and places every one on its part', () => {
    const points = watchPoints(5000, seededRandom(7));
    expect(points).toHaveLength(5000);
    const R = WATCH_RADIUS;
    for (const { kind, share } of WATCH_PARTS) {
      expect(points.filter((p) => p.part === kind).length).toBeCloseTo(5000 * share, -1);
    }
    for (const p of points) {
      const r = Math.hypot(p.x, p.y);
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(Math.PI * 2);
      if (p.part === 'bezel') expect(Math.abs(r - R)).toBeLessThanOrEqual(0.141);
      // The ticks and everything inside them stay off the face's rim, which
      // the opening follows.
      if (p.part === 'ticks') {
        expect(r).toBeGreaterThanOrEqual(R * 0.79);
        expect(r).toBeLessThanOrEqual(R * 0.93);
      }
      if (p.part === 'hub') expect(r).toBeLessThanOrEqual(0.2);
      if (p.part === 'hand') expect(r).toBeLessThanOrEqual(R * 0.75);
      if (p.part === 'crown') expect(p.y).toBeGreaterThan(R);
    }
  });

  it('is the same shot every time', () => {
    expect(watchPoints(300, seededRandom(1))).toEqual(watchPoints(300, seededRandom(1)));
  });
});

describe('helixBlocks', () => {
  it('lays twelve blocks to a turn, evenly from near to far', () => {
    const blocks = helixBlocks(25, 6, 54, ['#111111', '#222222'], seededRandom(3));
    expect(blocks).toHaveLength(25);
    expect(blocks[0].distance).toBe(6);
    expect(blocks[24].distance).toBe(54);
    // A full turn later, a block is back where the first one was.
    expect(blocks[12].angle - blocks[0].angle).toBeCloseTo(Math.PI * 2, 0);
    for (const b of blocks) {
      expect(['#111111', '#222222']).toContain(b.color);
      expect(b.length).toBeGreaterThan(0.4);
      expect(b.length).toBeLessThan(1.25);
    }
  });
});
