// The intro that plays as the app opens — after signing in and on every
// reload. It is one scripted shot, and everything that moves in it is a pure
// function of the time since it began (introFrame), so the three.js scene
// (introScene.ts) and the overlay around it (LoginIntro.tsx) stay in step and
// the timing can be tested without a GPU:
//
//   build  the camera swings round a stopwatch as it builds itself: a bead
//          draws the bezel round from twelve, the ticks pop up one after
//          another, the crown drops on and the hand grows out of the hub;
//   lap    a click of the crown, and the hand runs one lap, filling the dial
//          behind it in the palette's colour;
//   go     a second click closes the lap: a ring pulses out, and the dial's
//          face opens into a window onto the app, which the camera dives
//          through.
import type { IntroScene } from './introScene';
import { cachedPalettes, resolvePalette } from './dashPalette';
import type { DashPalette } from './dashPalette';

// Seconds from the start of the shot.
export const INTRO_TIMES = {
  orbitEnd: 2.4, // the camera has swung round to face the watch, at rest
  bezelStart: 0.05, // the bezel is drawn round from twelve …
  bezelEnd: 0.85, // … and closes
  ticksStart: 0.3, // the first tick pops up at twelve …
  ticksEnd: 1.3, // … and the last one has landed
  crownStart: 0.8, // the crown drops onto the bezel …
  crownEnd: 1.3, // … and has settled
  handStart: 1.05, // the hub and the hand grow out of the middle …
  handEnd: 1.45, // … to their full size
  textIn: 1.6, // the title and the greeting rise in
  lapStart: 1.55, // the hand leaves twelve …
  go: 2.55, // … and is back on it: the lap is closed
  holeStart: 2.62, // the dial's face opens …
  holeEnd: 3.0, // … to its rim
  diveEnd: 3.3, // the camera is through the dial
  end: 3.45, // nothing of the intro is left on screen
} as const;

// How the intro shows itself when it may not move (prefers-reduced-motion) or
// cannot draw (no WebGL): the title fades in, holds, and the overlay fades out.
export const STILL_INTRO_MS = 1100;

// Users who ask for less motion get the still version.
const STILL_QUERY = '(prefers-reduced-motion: reduce)';

export const prefersStill = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(STILL_QUERY).matches;

// How long the overlay waits for the 3D scene's code to arrive before it
// settles for the still version.
export const SCENE_LOAD_TIMEOUT_MS = 2500;

// Skipping (any click, tap or key) fades the overlay out in this long.
export const SKIP_FADE_MS = 260;

// The stopwatch, in world units: the bezel's radius, and the face inside the
// tick marks — the part that becomes the window onto the app.
export const WATCH_RADIUS = 3;
export const FACE_RADIUS = WATCH_RADIUS * 0.78;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x ** 3;
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
export const easeInOutSine = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;
// Past the mark and back: the pop of a part landing in place.
export const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

export interface IntroFrame {
  // 0 → 1: the camera's swing from its opening angle round to face the watch
  // square on, at its resting distance (linear; cameraPose eases it).
  orbit: number;
  // 0 → 1, eased: how far round from twelve the bezel (and the glass inside
  // it) has been drawn.
  bezel: number;
  // 0 → 1: the ticks' clock. Each tick pops up on a slice of it of its own
  // (tickProgress), clockwise from twelve.
  ticks: number;
  // 0 → 1: the crown's drop onto the bezel (the scene bounces it in).
  crown: number;
  // 0 → 1: the hub and the hand growing out of the middle.
  hand: number;
  // 0 → 1: the hand's lap, eased in and out; the dial fills behind it.
  lap: number;
  // 0 → 1: how far the crown is pushed down — a click to start the lap, and
  // one to stop it.
  press: number;
  // 0 → 1: after the go, a ring's run outwards from the bezel (linear; it
  // fades as it goes).
  pulse: number;
  // 0 → 1: the camera's dive from its resting distance through the dial.
  dive: number;
  // 0 → 1: how far the face has opened, as a share of its radius.
  hole: number;
  done: boolean;
}

// A click of the crown: down and back up in this long, centred on its moment,
// which comes just before the hand starts (or stops).
const CLICK = 0.2;
const CLICK_LEAD = 0.04;

function click(t: number, at: number): number {
  const x = 1 - Math.abs(t - at) / (CLICK / 2);
  return x > 0 ? x * x * (3 - 2 * x) : 0;
}

export function introFrame(t: number): IntroFrame {
  const T = INTRO_TIMES;
  return {
    orbit: span(t, 0, T.orbitEnd),
    bezel: easeInOutCubic(span(t, T.bezelStart, T.bezelEnd)),
    ticks: span(t, T.ticksStart, T.ticksEnd),
    crown: span(t, T.crownStart, T.crownEnd),
    hand: span(t, T.handStart, T.handEnd),
    lap: easeInOutCubic(span(t, T.lapStart, T.go)),
    press: Math.max(click(t, T.lapStart - CLICK_LEAD), click(t, T.go - CLICK_LEAD)),
    pulse: span(t, T.go, T.go + 0.7),
    dive: easeInCubic(span(t, T.go, T.diveEnd)),
    hole: easeOutCubic(span(t, T.holeStart, T.holeEnd)),
    done: t >= T.end,
  };
}

// Sixty ticks round the dial, every fifth a long one.
export const TICK_COUNT = 60;
// Each tick's share of the ticks' clock: they overlap, so the pop runs round
// the dial like a wave.
const TICK_SLICE = 0.25;

// 0 → 1: how far tick `index` (clockwise from twelve) has popped up.
export function tickProgress(clock: number, index: number): number {
  const delay = (index / (TICK_COUNT - 1)) * (1 - TICK_SLICE);
  return clamp01((clock - delay) / TICK_SLICE);
}

// Where the camera rests while the watch is on show: far enough back that the
// whole watch, crown included, fits the narrower side of the screen — a
// phone held upright sees it as whole as a monitor does — with room left
// under it for the caption. Held upright, a phone's width is all that limits
// it, and there is height to spare for the caption, so it may fill more.
export const REST_FIT = 1.9;
export const REST_FIT_PORTRAIT = 1.4;

export function restDistance(aspect: number, fovDeg: number): number {
  const halfV = Math.tan((fovDeg * Math.PI) / 360);
  const half = halfV * Math.min(1, aspect);
  const fit = aspect < 0.8 ? REST_FIT_PORTRAIT : REST_FIT;
  return Math.max(10, (WATCH_RADIUS * fit) / half);
}

// The scene's code: three.js is big and only the intro needs it, so it is a
// chunk of its own.
export const loadIntroScene = () => import('./introScene');

// The colours the app is about to open in — the copy of the account's look
// this browser keeps (dashPalette.ts).
export function introPalette(): DashPalette {
  const cached = cachedPalettes();
  return resolvePalette(cached.active, cached.own);
}

// A scene built and compiled, ready to play. Getting there takes a moment
// (a WebGL context, the shader programs), so it is begun before it is wanted:
// on the sign-in page while the form is filled in, and on a reload while the
// saved session is checked.
function readyIntroScene(): Promise<IntroScene> {
  const { base } = introPalette();
  return loadIntroScene().then(async ({ createIntroScene }) => {
    const scene = createIntroScene({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      base,
    });
    try {
      await scene.warmUp();
    } catch (err) {
      scene.dispose();
      throw err;
    }
    return scene;
  });
}

let prepared: Promise<IntroScene> | null = null;

export function prepareIntroScene(): void {
  // The still version needs no scene.
  if (prepared || prefersStill()) return;
  const p = readyIntroScene();
  prepared = p;
  p.catch(() => {
    if (prepared === p) prepared = null;
  });
}

// The scene prepared earlier, or a new one; either way the caller owns it:
// it disposes of it once played, or hands it back unplayed.
export function takeIntroScene(): Promise<IntroScene> {
  const p = prepared ?? readyIntroScene();
  prepared = null;
  return p;
}

// An overlay gone before its scene was ready (skipped, or mounted twice by
// React's development checks) leaves the scene for the next one.
export function handBackIntroScene(p: Promise<IntroScene>): void {
  if (prepared) {
    p.then((scene) => scene.dispose(), () => undefined);
    return;
  }
  prepared = p;
  p.catch(() => {
    if (prepared === p) prepared = null;
  });
}

// Where the camera opens: in close, up and off to the left of the dial,
// looking a little above its middle (where the bezel starts to draw), and
// rolled a touch. Angles in radians; the distance is a share of the resting
// one. The orbit takes all of it back to nothing: square on, at rest.
export const CAMERA_START = { azimuth: -1.15, elevation: 0.42, roll: 0.2, lookY: 1.2, distance: 0.5 };

// The share of the orbit by which the camera has pulled back to its resting
// distance and centred the watch — well before the caption rises under it.
const PULL_BACK = 0.8;

// How far the camera has pulled back and centred the watch, 0 → 1.
const pulledBack = (frame: IntroFrame) => easeOutCubic(clamp01(frame.orbit / PULL_BACK));

export interface CameraPose {
  azimuth: number; // round the dial's upright axis; 0 is square on
  elevation: number; // above the dial's plane
  roll: number; // about the line of sight
  lookY: number; // how far above the dial's middle the camera looks
  distance: number; // from the point it looks at
}

// The camera pulls back quickly, but swings round all the way through the
// build and the lap, and only comes square on just before the dive — one
// unbroken move.
export function cameraPose(frame: IntroFrame, rest: number): CameraPose {
  const x = frame.orbit;
  const k = 1 - (easeOutCubic(x) + easeInOutSine(x)) / 2;
  return {
    azimuth: CAMERA_START.azimuth * k,
    elevation: CAMERA_START.elevation * k,
    roll: CAMERA_START.roll * k,
    lookY: CAMERA_START.lookY * (1 - pulledBack(frame)),
    distance: cameraDistance(frame, rest),
  };
}

// The camera's position in the world, for a pose: the watch faces +z.
export function cameraPosition(pose: CameraPose): [number, number, number] {
  const flat = Math.cos(pose.elevation) * pose.distance;
  return [
    Math.sin(pose.azimuth) * flat,
    pose.lookY + Math.sin(pose.elevation) * pose.distance,
    Math.cos(pose.azimuth) * flat,
  ];
}

// The camera's distance from the point it looks at, at a frame.
export function cameraDistance(frame: IntroFrame, rest: number): number {
  const orbiting = rest * (1 - (1 - CAMERA_START.distance) * (1 - pulledBack(frame)));
  // The dive ends just short of the dial's plane, inside the open face.
  return orbiting - frame.dive * (rest - 0.35);
}

// The face's opening on screen, in CSS pixels: a circle of the face's radius
// as the camera sees it from `distance`, times how far it has opened.
export function holeRadiusPx(frame: IntroFrame, distance: number, viewportH: number, fovDeg: number): number {
  if (frame.hole <= 0) return 0;
  const halfV = Math.tan((fovDeg * Math.PI) / 360);
  const projected = (FACE_RADIUS / Math.max(distance, 0.05) / halfV) * (viewportH / 2);
  return projected * frame.hole;
}

// Which way the overlay greets: the account just made, or one coming back
// (a sign-in, or the app reopened with a saved session).
export type IntroKind = 'welcome' | 'return';

export function introGreeting(kind: IntroKind, user: string | null): string {
  if (!user) return '';
  return kind === 'welcome' ? `Добро пожаловать, ${user}` : `С возвращением, ${user}`;
}

// The night sky the shot plays against: the palette's hue, almost all the way
// down to black. Mixed in sRGB, like the page's own color-mix(in srgb …), so
// the overlay's CSS ground and the scene's clear colour are the same colour.
export function introBackground(base: string): string {
  const night = [3, 5, 10];
  const m = /^#?([0-9a-f]{6})$/i.exec(base);
  const rgb = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : night;
  return (
    '#' +
    rgb
      .map((c, i) => Math.round(c * 0.1 + night[i] * 0.9).toString(16).padStart(2, '0'))
      .join('')
  );
}

// A small deterministic generator, so the scene is the same shot every time
// (and the tests can check it).
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// The task blocks that drift round the watch, all in one pale tone, fading
// into the night with depth — what gives the camera's swing its parallax.
// They keep behind the dial's plane and off its axis, so the camera, which
// stays in front of the dial, never flies into one.
export interface FloatingBlock {
  x: number;
  y: number;
  z: number;
  length: number; // the block's long side, world units
  shade: number; // 0 → 1: how bright its tone is
  tilt: [number, number, number]; // its resting turn, radians
  spin: number; // how fast it turns about its own axis, radians a second
}

export const BLOCK_RING = { inner: 5, outer: 14, near: -0.6, far: -14 };

const TAU = Math.PI * 2;

export function floatingBlocks(count: number, random: () => number): FloatingBlock[] {
  const { inner, outer, near, far } = BLOCK_RING;
  return Array.from({ length: count }, (_, i) => {
    // Spread evenly round the axis, with a jitter, so no side is left bare.
    const a = ((i + random() * 0.8) / count) * TAU;
    const r = inner + Math.sqrt(random()) * (outer - inner);
    return {
      x: Math.sin(a) * r,
      y: Math.cos(a) * r,
      z: far + random() * (near - far),
      length: 0.6 + random() * 1.1,
      shade: 0.18 + random() * 0.3,
      tilt: [random() * TAU, random() * TAU, random() * TAU],
      spin: (random() - 0.5) * 0.7,
    };
  });
}
