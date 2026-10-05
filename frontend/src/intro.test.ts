import { describe, expect, it } from 'vitest';
import {
  BLOCK_RING,
  FACE_RADIUS,
  INTRO_TIMES,
  TICK_COUNT,
  WATCH_RADIUS,
  cameraDistance,
  cameraPose,
  cameraPosition,
  easeOutBack,
  floatingBlocks,
  holeRadiusPx,
  introBackground,
  introFrame,
  introGreeting,
  restDistance,
  seededRandom,
  tickProgress,
} from './intro';

const T = INTRO_TIMES;
const FOV = 55;
const samples = Array.from({ length: 141 }, (_, i) => i * 0.025);

describe('introFrame', () => {
  it('opens on an empty sky, with the camera at its opening angle', () => {
    const f = introFrame(0);
    expect(f).toMatchObject({ orbit: 0, bezel: 0, ticks: 0, crown: 0, hand: 0, lap: 0, pulse: 0, hole: 0, done: false });
  });

  it('builds the watch before the hand sets off', () => {
    const f = introFrame(T.lapStart);
    expect(f).toMatchObject({ bezel: 1, ticks: 1, crown: 1, lap: 0 });
    expect(f.hand).toBeGreaterThan(0.9);
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
    expect(f).toMatchObject({ done: true, orbit: 1, bezel: 1, lap: 1, dive: 1, hole: 1, pulse: 1 });
  });

  it('only ever moves forward', () => {
    for (const key of ['orbit', 'bezel', 'ticks', 'crown', 'hand', 'lap', 'pulse', 'dive', 'hole'] as const) {
      const values = samples.map((t) => introFrame(t)[key]);
      values.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (i > 0) expect(v).toBeGreaterThanOrEqual(values[i - 1]);
      });
    }
  });

  it('clicks the crown just before the lap starts and just before it stops', () => {
    expect(introFrame(T.lapStart - 0.04).press).toBeCloseTo(1);
    expect(introFrame(T.go - 0.04).press).toBeCloseTo(1);
    for (const t of [0, T.ticksEnd, (T.lapStart + T.go) / 2, T.end]) expect(introFrame(t).press).toBe(0);
  });
});

describe('the ticks', () => {
  it('pop up one after another, clockwise from twelve', () => {
    expect(tickProgress(0, 0)).toBe(0);
    expect(tickProgress(1, TICK_COUNT - 1)).toBe(1);
    for (const clock of [0.2, 0.5, 0.8]) {
      for (let i = 1; i < TICK_COUNT; i++) {
        expect(tickProgress(clock, i)).toBeLessThanOrEqual(tickProgress(clock, i - 1));
      }
    }
  });

  it('land with a pop past their mark and back', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...samples.map((t) => easeOutBack(t / 3.5)))).toBeGreaterThan(1.05);
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

  it('opens in close and off to the side, and swings round to face the watch square on', () => {
    const rest = restDistance(1.6, FOV);
    const opening = cameraPose(introFrame(0), rest);
    expect(opening.distance).toBeCloseTo(rest / 2);
    expect(Math.abs(opening.azimuth)).toBeGreaterThan(1);
    expect(opening.elevation).toBeGreaterThan(0.3);
    for (const t of [T.orbitEnd, T.go]) {
      const pose = cameraPose(introFrame(t), rest);
      for (const angle of [pose.azimuth, pose.elevation, pose.roll, pose.lookY]) expect(angle).toBeCloseTo(0);
      const [x, y, z] = cameraPosition(pose);
      expect([x, y, z].map((c) => c + 0)).toEqual([0, 0, rest]);
    }
  });

  it('rests, then dives through the dial', () => {
    const rest = restDistance(1.6, FOV);
    expect(cameraDistance(introFrame(T.orbitEnd), rest)).toBeCloseTo(rest);
    expect(cameraDistance(introFrame(T.go), rest)).toBeCloseTo(rest);
    expect(cameraDistance(introFrame(T.diveEnd), rest)).toBeCloseTo(0.35);
  });

  it.each([
    [1920, 1080],
    [375, 812],
  ])('never flies into a drifting block on a %sx%s screen', (w, h) => {
    const rest = restDistance(w / h, FOV);
    const blocks = floatingBlocks(32, seededRandom(0x5eed));
    for (const t of samples) {
      const [x, y, z] = cameraPosition(cameraPose(introFrame(t), rest));
      // In front of the dial all the way, and the blocks are all behind it.
      expect(z).toBeGreaterThan(0.3);
      for (const b of blocks) {
        expect(Math.hypot(x - b.x, y - b.y, z - b.z)).toBeGreaterThan(b.length / 2 + 0.5);
      }
    }
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

describe('floatingBlocks', () => {
  it('rings the watch, off its axis and behind its dial', () => {
    const blocks = floatingBlocks(40, seededRandom(3));
    expect(blocks).toHaveLength(40);
    for (const b of blocks) {
      const r = Math.hypot(b.x, b.y);
      expect(r).toBeGreaterThanOrEqual(BLOCK_RING.inner);
      expect(r).toBeLessThanOrEqual(BLOCK_RING.outer);
      expect(b.z).toBeLessThanOrEqual(BLOCK_RING.near);
      expect(b.z).toBeGreaterThanOrEqual(BLOCK_RING.far);
      expect(b.shade).toBeGreaterThan(0);
      expect(b.shade).toBeLessThanOrEqual(1);
    }
  });

  it('is the same shot every time', () => {
    expect(floatingBlocks(20, seededRandom(1))).toEqual(floatingBlocks(20, seededRandom(1)));
  });
});
