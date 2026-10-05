// The intro that plays as the app opens — after signing in and on every
// reload. It is one scripted shot, and everything that moves in it is a pure
// function of the time since it began (introFrame), so the three.js scene
// (introScene.ts) and the overlay around it (LoginIntro.tsx) stay in step and
// the timing can be tested without a GPU:
//
//   warp      the camera streaks down a helix of task blocks — twelve to a
//             turn, an hour of five-minute blocks — through hyperspace;
//   assemble  the stars spiral in and settle into a stopwatch, and its hand
//             runs one lap, filling the dial behind it like a split;
//   go        the lap closes: a shockwave, the hub bursts, and the dial's
//             face opens into a window onto the app, which the camera dives
//             through.
import type { IntroScene } from './introScene';
import { cachedPalettes, resolvePalette } from './dashPalette';
import type { DashPalette } from './dashPalette';

// Seconds from the start of the shot.
export const INTRO_TIMES = {
  flightEnd: 2.0, // the warp eases out to the camera's resting distance
  morphStart: 0.45, // the particles start to gather into the watch …
  morphEnd: 1.95, // … and the last of them has landed
  tiltEnd: 2.2, // the watch has turned to face the camera
  textIn: 1.45, // the title and the greeting rise in
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

// How far behind its resting point the camera starts, and so how long the
// warp flight is.
export const FLIGHT_LENGTH = 62;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x ** 3;
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

export interface IntroFrame {
  // 0 → 1: the warp flight, eased; the camera has reached its resting
  // distance at 1.
  flight: number;
  // How hard the stars streak: the flight's speed, 1 at the start, easing to
  // nothing, plus a kick from the dive.
  warp: number;
  // 0 → 1: the gathering clock. Each particle takes its own slice of it (the
  // shader staggers and eases them).
  morph: number;
  // 1 → 0: how far the watch is still turned away from the camera.
  tilt: number;
  // 0 → 1: the hand's lap, eased in and out; the dial fills behind it.
  lap: number;
  // 0 → 1: after the go, the hub and the hand fly apart.
  burst: number;
  // 0 → 1: the shockwave's run outwards (linear; it fades as it goes).
  shock: number;
  // 0 → 1: the camera's dive from its resting distance through the dial.
  dive: number;
  // 0 → 1: how far the face has opened, as a share of its radius.
  hole: number;
  done: boolean;
}

export function introFrame(t: number): IntroFrame {
  const T = INTRO_TIMES;
  const f = span(t, 0, T.flightEnd);
  const dive = easeInCubic(span(t, T.go, T.diveEnd));
  return {
    flight: easeOutCubic(f),
    // The derivative of the ease-out, normalised to 1 at the start.
    warp: (1 - f) ** 2 + 0.6 * dive,
    morph: span(t, T.morphStart, T.morphEnd),
    tilt: 1 - easeOutCubic(span(t, 0.5, T.tiltEnd)),
    lap: easeInOutCubic(span(t, T.lapStart, T.go)),
    burst: easeOutCubic(span(t, T.go, T.go + 0.5)),
    shock: span(t, T.go, T.go + 0.7),
    dive,
    hole: easeOutCubic(span(t, T.holeStart, T.holeEnd)),
    done: t >= T.end,
  };
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
  const { base, accent } = introPalette();
  return loadIntroScene().then(async ({ createIntroScene }) => {
    const scene = createIntroScene({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      base,
      accent,
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

// The camera's distance from the dial at a frame.
export function cameraDistance(frame: IntroFrame, rest: number): number {
  const flying = rest + FLIGHT_LENGTH * (1 - frame.flight);
  // The dive ends just short of the dial's plane, inside the open face.
  return flying - frame.dive * (rest - 0.35);
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

// The parts of the watch the particles gather into, and each one's share of
// them. The hand turns with the lap; the hub and the hand fly apart at the go.
export const WATCH_PARTS = [
  { kind: 'bezel', share: 0.45 },
  { kind: 'back', share: 0.1 },
  { kind: 'ticks', share: 0.2 },
  { kind: 'crown', share: 0.08 },
  { kind: 'button', share: 0.04 },
  { kind: 'hub', share: 0.03 },
  { kind: 'hand', share: 0.1 },
] as const;

export type WatchPart = (typeof WATCH_PARTS)[number]['kind'];

export const PART_INDEX: Record<WatchPart, number> = Object.fromEntries(
  WATCH_PARTS.map((p, i) => [p.kind, i])
) as Record<WatchPart, number>;

export interface WatchPoint {
  x: number;
  y: number;
  z: number;
  part: WatchPart;
  // Clockwise from twelve, 0 → 2π: where on the dial the point sits, so the
  // lap can fill the bezel and the ticks behind the hand.
  angle: number;
}

const TAU = Math.PI * 2;

// Clockwise from twelve, for a point in the dial's plane.
export const dialAngle = (x: number, y: number) => {
  const a = Math.atan2(x, y);
  return a < 0 ? a + TAU : a;
};

// `count` points on the stopwatch, split between its parts by their shares.
// The watch faces +z; twelve o'clock is +y.
export function watchPoints(count: number, random: () => number): WatchPoint[] {
  const R = WATCH_RADIUS;
  const points: WatchPoint[] = [];
  const at = (x: number, y: number, z: number, part: WatchPart) =>
    points.push({ x, y, z, part, angle: dialAngle(x, y) });

  WATCH_PARTS.forEach(({ kind, share }, i) => {
    // The last part takes whatever rounding left over.
    const n = i === WATCH_PARTS.length - 1 ? count - points.length : Math.round(count * share);
    for (let k = 0; k < n; k++) {
      const u = random();
      const v = random();
      const w = random();
      switch (kind) {
        case 'bezel': {
          // A torus: round the dial, and round its tube.
          const a = u * TAU;
          const b = v * TAU;
          const r = R + 0.14 * Math.cos(b);
          at(Math.sin(a) * r, Math.cos(a) * r, 0.2 * Math.sin(b), kind);
          break;
        }
        case 'back': {
          const a = u * TAU;
          const r = R * 0.97 + (v - 0.5) * 0.08;
          at(Math.sin(a) * r, Math.cos(a) * r, -0.38 + (w - 0.5) * 0.06, kind);
          break;
        }
        case 'ticks': {
          // Sixty ticks; every fifth is a long one.
          const tick = Math.floor(u * 60);
          const a = (tick / 60) * TAU + (w - 0.5) * 0.012;
          const inner = tick % 5 === 0 ? 0.8 : 0.86;
          const r = R * (inner + v * (0.92 - inner));
          at(Math.sin(a) * r, Math.cos(a) * r, 0.04, kind);
          break;
        }
        case 'crown': {
          // A stem up from twelve, and the button on top of it.
          if (u < 0.35) at((v - 0.5) * 0.24, R + 0.15 + w * 0.3, (random() - 0.5) * 0.2, kind);
          else at((v - 0.5) * 0.76, R + 0.45 + w * 0.25, (random() - 0.5) * 0.3, kind);
          break;
        }
        case 'button': {
          // The lap button, at about two o'clock.
          const a = 0.85 + (u - 0.5) * 0.12;
          const r = R + 0.12 + v * 0.32;
          at(Math.sin(a) * r, Math.cos(a) * r, (w - 0.5) * 0.24, kind);
          break;
        }
        case 'hub': {
          const a = u * TAU;
          const r = Math.sqrt(v) * 0.2;
          at(Math.sin(a) * r, Math.cos(a) * r, 0.12, kind);
          break;
        }
        case 'hand': {
          // Pointing at twelve: a short tail below the hub, a long needle
          // above it, thickest at the root.
          const along = -0.16 * R + u * 0.9 * R;
          const width = 0.05 * (1 - Math.max(0, along) / (0.8 * R)) + 0.012;
          at((v - 0.5) * width * 2, along, 0.1 + (w - 0.5) * 0.04, kind);
          break;
        }
      }
    }
  });
  return points;
}

// The helix of task blocks the warp flies down: twelve blocks to a turn, one
// turn an hour. Each block sits tangent to the turn, `distance` units ahead
// of the dial, and is as long as its (made-up) task.
export interface HelixBlock {
  angle: number; // around the flight path, radians
  distance: number; // from the dial's plane, world units
  length: number; // along the turn
  color: string;
}

export const HELIX_RADIUS = 2.5;

export function helixBlocks(
  count: number,
  near: number,
  far: number,
  colors: readonly string[],
  random: () => number
): HelixBlock[] {
  const step = (far - near) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / 12) * TAU + (random() - 0.5) * 0.12,
    distance: near + i * step,
    length: 0.45 + random() * 0.75,
    color: colors[Math.floor(random() * colors.length)],
  }));
}
