import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Task, SessionState } from './types';
import { TASK_COLORS } from './types';
import { formatDelta } from './useTimer';

// Spiral geometry — starts at the outer edge, winds inward to the center.
// One hour of time = one full turn (2π): the star sweeps exactly one turn
// per hour at full screen scale, and the portion of the spiral ahead — a
// self-similar continuation toward the center — expands to full screen as
// the time approaches it.
const OUTER_R = 350;
const VIEW = 800;
const HALF = VIEW / 2;
const THETA_STEP = 0.015;
// The continuous zoom grows with each turn; the cap is only a safety net.
const MAX_SCALE = 1e9;

// Deterministic pseudo-random (stable per index) for the starfield — the
// stars must not move between renders.
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

// Self-similar (logarithmic) spiral — like a zooming fractal. One full turn
// shrinks the radius by a constant factor K_TURN, so each task's turn visually
// comes to the center, and zooming in reveals the inner continuation.
const K_TURN = 0.18;
const rAtTheta = (th: number) => OUTER_R * Math.pow(K_TURN, th / (Math.PI * 2));

// Polar guide rays: one full turn = one hour, so 30° steps mark 5 minutes.
const POLAR_STEP = Math.PI / 6;

// Deterministic spin parameters per planet (stable for the task's lifetime),
// so neighbouring planets rotate at their own rate, direction and phase —
// never in sync. Only the ANGLE is time-driven: planets turn while the run
// advances and freeze on pause / before start / after reset.
const spinParams = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const period = 8 + (h % 1600) / 100; // seconds per full turn (8–24)
  const dir = (h >>> 7) & 1 ? 1 : -1;
  const phase = ((h >>> 13) % 360) * (Math.PI / 180);
  return { period, dir, phase };
};

interface SpiralThermometerProps {
  tasks: Task[];
  cumulativeTimes: number[];
  totalPlannedSec: number;
  elapsedSec: number;
  sessionState: SessionState;
  currentTaskColor: string;
  currentTaskIdx: number;
  deltaMs: number | null;
  onCompleteTask: (id: string) => void;
  onUncompleteTask: (id: string) => void;
  onRenameTask: (id: string, name: string) => void;
  onChangeTaskTime: (id: string, plannedTime: number) => void;
  onChangeTaskColor: (id: string, color: string) => void;
  onSeek: (ms: number) => void;
}

interface GeoPt {
  x: number;
  y: number;
  t: number; // cumulative arc length
  th: number; // angle
}

const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

// ── Planet sphere artwork ────────────────────────────────────────────────
// A planet is drawn as a shaded gas-giant sphere, not a flat disc: latitude
// bands + limb darkening give the round volume, and a *cloud texture* (wavy
// strips + storm ovals) scrolls horizontally inside a circular clip. The
// scroll is driven by the planet's axial spin angle, so the planet really
// turns around its axis — features drift across the disk and wrap around
// the limb — instead of the whole picture rotating in the screen plane.
const PLANET_R = 13;
const CLOUD_PERIOD = 34; // texture repeat width (local units)
const CLOUD_COPIES = [-2, -1, 0, 1, 2]; // repeated strips → seamless wrap
const CLOUD_STEP = 1.3; // polyline sampling for the wavy strips

// Deterministic per-planet "weather" (seeded from the id, stable per render):
// two wavy cloud strips and three storm ovals with their own latitude,
// phase and size.
const planetWeather = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 131 + id.charCodeAt(i)) >>> 0;
  const s = (n: number) => rnd(h * 1.31 + n * 7.77);
  const waves = [0, 1].map((i) => ({
    y0: -4.5 + s(10 + i) * 9, // band latitude
    h: 1.5 + s(20 + i) * 2, // strip thickness
    amp: 0.8 + s(30 + i) * 1.3, // waviness of the cloud edge
    cycles: 1 + Math.floor(s(40 + i) * 3), // waves per texture period
    phase: s(50 + i) * Math.PI * 2,
    dark: s(60 + i) > 0.5,
  }));
  const storms = [0, 1, 2].map((i) => {
    const ry = 0.9 + s(80 + i) * 1.1;
    return {
      x: s(90 + i) * CLOUD_PERIOD,
      y: -7 + s(100 + i) * 14,
      rx: ry * (1.2 + s(110 + i)),
      ry,
      dark: s(120 + i) > 0.5,
      o: 0.5 + s(130 + i) * 0.45,
    };
  });
  return { waves, storms };
};

// One wavy cloud strip (drawn in the strip's own coordinates, 0..PERIOD).
const stripPath = (w: ReturnType<typeof planetWeather>['waves'][number]) => {
  let d = `M 0 ${w.y0 + w.amp * Math.sin(w.phase)}`;
  for (let x = CLOUD_STEP; x <= CLOUD_PERIOD + 0.001; x += CLOUD_STEP) {
    const y = w.y0 + w.amp * Math.sin((x / CLOUD_PERIOD) * w.cycles * Math.PI * 2 + w.phase);
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return `${d} L ${CLOUD_PERIOD} ${w.y0 + w.h} L 0 ${w.y0 + w.h} Z`;
};

interface PlanetBodyProps {
  id: string;
  color: string;
  angle: number; // axial spin angle — drives the cloud scroll
}

function PlanetBody({ id, color, angle }: PlanetBodyProps) {
  const { waves, storms } = planetWeather(id);
  // One full 2π rotation scrolls the texture by exactly one period, so the
  // wrap is seamless. Angle grows with the run; idle/paused keep it frozen.
  const scroll = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * CLOUD_PERIOD;
  const wavePaths = waves.map(stripPath);
  return (
    <>
      <defs>
        <clipPath id={`planet-clip-${id}`}>
          <circle cx={0} cy={0} r={PLANET_R} />
        </clipPath>
        {/* Limb lighting: bright top-left, dark rim — sells the sphere */}
        <radialGradient id={`planet-lite-${id}`} cx="32%" cy="26%" r="82%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.42)" />
          <stop offset="26%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="55%" stopColor="rgba(0,0,0,0)" />
          <stop offset="78%" stopColor="rgba(0,0,0,0.1)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </radialGradient>
      </defs>
      {/* Base sphere — flat color shading comes from the gradient + lighting */}
      <circle cx={0} cy={0} r={PLANET_R} fill={`url(#planet-grad-${id})`} />
      {/* Surface, clipped to the disk */}
      <g clipPath={`url(#planet-clip-${id})`}>
        {/* Static latitude bands — rotation-invariant, they frame the sphere */}
        <rect x={-PLANET_R} y={-9.2} width={PLANET_R * 2} height={3.4} fill="rgba(0,0,0,0.18)" />
        <rect x={-PLANET_R} y={-5.2} width={PLANET_R * 2} height={2.6} fill="rgba(255,255,255,0.12)" />
        <rect x={-PLANET_R} y={1.6} width={PLANET_R * 2} height={1.3} fill="rgba(255,255,255,0.18)" />
        <rect x={-PLANET_R} y={3.4} width={PLANET_R * 2} height={1.4} fill="rgba(0,0,0,0.14)" />
        <rect x={-PLANET_R} y={7.4} width={PLANET_R * 2} height={3} fill="rgba(0,0,0,0.2)" />
        {/* Cloud texture — scrolls with the spin, wraps seamlessly */}
        <g transform={`translate(${-scroll})`}>
          {CLOUD_COPIES.map((k) => (
            <g key={k} transform={`translate(${k * CLOUD_PERIOD})`}>
              {wavePaths.map((d, i) => (
                <path key={i} d={d} fill={waves[i].dark ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.14)'} />
              ))}
              {storms.map((st, i) => (
                <ellipse
                  key={i}
                  cx={st.x}
                  cy={st.y}
                  rx={st.rx}
                  ry={st.ry}
                  fill={st.dark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.28)'}
                  opacity={st.o}
                />
              ))}
            </g>
          ))}
        </g>
      </g>
      {/* Lighting overlay + rim + specular highlight */}
      <circle cx={0} cy={0} r={PLANET_R} fill={`url(#planet-lite-${id})`} />
      <circle cx={0} cy={0} r={PLANET_R} fill="none" stroke={color} strokeWidth={2} />
      <circle cx={-4.5} cy={-4.5} r={3.8} fill="rgba(255,255,255,0.55)" />
    </>
  );
}

export function SpiralThermometer({
  tasks,
  cumulativeTimes,
  totalPlannedSec,
  elapsedSec,
  sessionState,
  currentTaskColor,
  currentTaskIdx,
  deltaMs,
  onCompleteTask,
  onUncompleteTask,
  onRenameTask,
  onChangeTaskTime,
  onChangeTaskColor,
  onSeek,
}: SpiralThermometerProps) {
  const totalSec = Math.max(totalPlannedSec, 1);

  // Edit popup — opened by clicking a planet while idle/paused. Lets the user
  // rename the task, change its planned duration and its color (same fields
  // the timeline edits inline).
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTime, setEditTime] = useState('');

  // Build the spiral path once per task list. One hour = one full turn, so
  // the path's angular extent is the TOTAL planned time of the run.
  // Point density is modest (~500 points total regardless of run length):
  // the line is thin, so extra points only make per-frame rebuilds heavier
  // (which showed up as jank/flicker while the run advances).
  const geometry = useMemo(() => {
    const thetaMax = (totalSec / 3600) * Math.PI * 2;
    const step = thetaMax > 20 ? thetaMax / 500 : THETA_STEP;
    const pts: GeoPt[] = [];
    const segs: string[] = [];
    let cum = 0;
    for (let th = 0; th <= thetaMax + 1e-9; th += step) {
      const r = rAtTheta(th);
      const x = r * Math.cos(th);
      const y = r * Math.sin(th);
      if (pts.length === 0) {
        segs.push(`M ${x} ${y}`);
      } else {
        const p = pts[pts.length - 1];
        cum += Math.hypot(x - p.x, y - p.y);
        segs.push(`L ${x} ${y}`);
      }
      pts.push({ x, y, t: cum, th });
    }
    // Snap the tail exactly to the end radius when thetaMax is not a multiple of step.
    const rEnd = rAtTheta(thetaMax);
    const xEnd = rEnd * Math.cos(thetaMax);
    const yEnd = rEnd * Math.sin(thetaMax);
    const last = pts[pts.length - 1];
    if (Math.hypot(xEnd - last.x, yEnd - last.y) > 0.01) {
      cum += Math.hypot(xEnd - last.x, yEnd - last.y);
      segs.push(`L ${xEnd} ${yEnd}`);
      pts.push({ x: xEnd, y: yEnd, t: cum, th: thetaMax });
    }
    const totalLen = cum;

    // Arc length along the tube at a given angle (binary search + lerp).
    const lenAtTheta = (th: number): number => {
      if (th <= 0) return 0;
      if (th >= thetaMax) return totalLen;
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].th <= th) lo = mid;
        else hi = mid;
      }
      const a = pts[lo];
      const b = pts[hi];
      const span = b.th - a.th || 1e-9;
      const k = (th - a.th) / span;
      return a.t + (b.t - a.t) * k;
    };

    // Point on the spiral at a given angle (binary search + lerp).
    const pointAtTheta = (th: number) => {
      if (th <= 0) return { x: pts[0].x, y: pts[0].y };
      if (th >= thetaMax) return { x: xEnd, y: yEnd };
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].th <= th) lo = mid;
        else hi = mid;
      }
      const a = pts[lo];
      const b = pts[hi];
      const span = b.th - a.th || 1e-9;
      const k = (th - a.th) / span;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };

    return { thetaMax, totalLen, pts, d: segs.join(' '), lenAtTheta, pointAtTheta };
  }, [totalSec]);

  // Time ⇄ angle: one hour of planned time = one full turn (2π) of the
  // spiral. The star sweeps a constant arc per second, so a planet sits at
  // its task's planned start time (a 30-min task spans half a turn, a
  // 2-hour task spans two turns).
  const angleFromSec = useCallback(
    (s: number): number => {
      const clamped = Math.max(0, Math.min(s, totalSec));
      return (clamped / 3600) * Math.PI * 2;
    },
    [totalSec]
  );

  const secFromAngle = useCallback(
    (th: number): number => Math.max(0, Math.min((th / (Math.PI * 2)) * 3600, totalSec)),
    [totalSec]
  );

  const liquidTheta = angleFromSec(elapsedSec);
  const liquidThetaSec = Math.min(Math.max(elapsedSec, 0), totalSec);
  const fillLen = geometry.lenAtTheta(liquidTheta);
  const frontier = geometry.pointAtTheta(liquidTheta);

  // Zoom: fully continuous, no jumps. scale = K^(-turns) keeps the star at a
  // constant on-screen radius while the spiral continuously unwinds toward the
  // center. A planet (or boundary) ahead starts small near the center and
  // gradually grows to full size as the star approaches it — then, once
  // passed, it recedes behind the star and leaves the screen.
  const turns = liquidTheta / (Math.PI * 2);
  const scale = Math.min(Math.pow(K_TURN, -turns), MAX_SCALE);

  // Visible portion of the path, rendered directly in *screen* viewBox units
  // (data coords × scale). No SVG transform is applied to the spiral: huge
  // transform scales (which grow exponentially as the run deepens) are what
  // made the page flicker and break. Only the on-screen angular range is
  // rasterized, so the numbers stay small and stable at any depth.
  const visible = useMemo(() => {
    const screenLimit = 480; // half-viewBox + margin, in viewBox units
    const arg = screenLimit / (OUTER_R * scale);
    let a = 0;
    if (arg < 1) {
      // screen radius r*scale = OUTER_R*scale*K^(th/2π) → th for screenLimit
      const thVis = (2 * Math.PI) * (Math.log(arg) / Math.log(K_TURN));
      a = Math.max(0, thVis - 0.6); // small margin so caps/glow aren't clipped
    }
    const S = scale;
    const off = a > 0 ? geometry.lenAtTheta(a) : 0;
    const len = geometry.totalLen - off;
    if (a <= 0) {
      // whole path, scaled to screen units
      const segs: string[] = [];
      geometry.pts.forEach((p, i) => {
        segs.push(`${i === 0 ? 'M' : 'L'} ${(p.x * S).toFixed(2)} ${(p.y * S).toFixed(2)}`);
      });
      return { d: segs.join(' '), offset: 0, len: len * S };
    }

    const pts = geometry.pts;
    // first index with th >= a
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].th < a) lo = mid;
      else hi = mid;
    }
    const segs: string[] = [];
    const startPt = geometry.pointAtTheta(a);
    segs.push(`M ${(startPt.x * S).toFixed(2)} ${(startPt.y * S).toFixed(2)}`);
    for (let i = hi; i < pts.length; i++) {
      segs.push(`L ${(pts[i].x * S).toFixed(2)} ${(pts[i].y * S).toFixed(2)}`);
    }
    return { d: segs.join(' '), offset: off * S, len: len * S };
  }, [geometry, scale]);

  // UI elements (dots, labels, frontier head) get their positions directly in
  // screen units (data coords × scale) — no counter-scale pinning needed.

  // Static starfield for the space background — deterministic per index so it
  // never flickers between renders.
  const starfield = useMemo(() => {
    const stars: { x: number; y: number; r: number; o: number; key: number }[] = [];
    for (let i = 0; i < 170; i++) {
      stars.push({
        x: (rnd(i) - 0.5) * VIEW * 1.15,
        y: (rnd(i + 1) - 0.5) * VIEW * 1.15,
        r: 0.5 + rnd(i + 2) * 1.4,
        o: 0.2 + rnd(i + 3) * 0.65,
        key: i,
      });
    }
    return stars;
  }, []);

  // Near stars — an endless approach flow. Each star has a fixed ray
  // direction, period and phase, and every cycle it is reborn at a fresh
  // random spot near the spiral's center, drifts outward past the screen
  // edge, and is reborn again. Cycles are long (8–16 min) so the drift is a
  // slow, calm motion that never stops, no matter how long the run goes.
  const nearStars = useMemo(() => {
    const stars: { th: number; period: number; phase: number; key: number }[] = [];
    for (let i = 0; i < 42; i++) {
      stars.push({
        th: rnd(i + 301) * Math.PI * 2,
        period: 480 + rnd(i + 302) * 480, // 8–16 min per cycle
        phase: rnd(i + 303),
        key: i,
      });
    }
    return stars;
  }, []);

  // Constellation clusters — far, fixed star groups, deterministic per index
  // so they never shift between renders. They stay pinned in place while the
  // nearer star layer moves around them.
  const constellations = useMemo(() => {
    const groups: { stars: { x: number; y: number; r: number; o: number }[]; path: string; key: number }[] = [];
    for (let g = 0; g < 7; g++) {
      const cx = (rnd(g * 13 + 101) - 0.5) * VIEW * 1.15;
      const cy = (rnd(g * 13 + 102) - 0.5) * VIEW * 1.15;
      const n = 3 + Math.floor(rnd(g * 13 + 103) * 3); // 3–5 stars per cluster
      const stars: { x: number; y: number; r: number; o: number }[] = [];
      const segs: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd(g * 13 + i * 7 + 104) - 0.5) * 150;
        const y = cy + (rnd(g * 13 + i * 7 + 105) - 0.5) * 150;
        stars.push({
          x,
          y,
          r: 0.6 + rnd(g * 13 + i * 7 + 106) * 1.3,
          o: 0.3 + rnd(g * 13 + i * 7 + 107) * 0.55,
        });
        segs.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      groups.push({ stars, path: segs.join(' '), key: g });
    }
    return groups;
  }, []);

  // Polar guide lines — a static trig-circle backdrop: faint rays from the
  // spiral's center at multiples of 30°. One full turn equals one hour, so
  // each ray marks 5 minutes of the run; the 90° axes are drawn brighter.
  const polarLines = useMemo(() => {
    const lines: { x2: number; y2: number; major: boolean; key: number }[] = [];
    const R = VIEW * 0.72; // reaches past the square's corners; clipped by the SVG
    for (let i = 0; i < 12; i++) {
      const th = i * POLAR_STEP;
      lines.push({
        x2: R * Math.cos(th),
        y2: R * Math.sin(th),
        major: i % 3 === 0,
        key: i,
      });
    }
    return lines;
  }, []);

  // Background depth layers: far starfield and constellations are fixed in
  // place. Near stars recompute every frame from their cycle progress: born
  // near the center → drift outward → fade → reborn at a fresh spot. Loop
  // length doesn't matter — the approach never stalls.
  const nearField = useMemo(
    () =>
      nearStars.map((st) => {
        const prog = ((elapsedSec / st.period) + st.phase) % 1; // 0 born → 1 off-screen
        const cycle = Math.floor((elapsedSec / st.period) + st.phase);
        // A tiny deterministic reshuffle per cycle gives each rebirth a
        // fresh spot instead of retracing the same ray.
        const th = st.th + (rnd(cycle * 107 + 312) - 0.5) * 0.35;
        const R = (90 + rnd(cycle * 101 + st.key * 13 + 311) * 150) + prog * 1500;
        // Fade in right after birth, fade out before the off-screen handoff.
        const o =
          (0.4 + rnd(st.key + 304) * 0.5) *
          Math.min(1, prog * 12) *
          Math.min(1, (1 - prog) * 10);
        // Stars grow slightly as they approach, then vanish.
        const r = (0.9 + rnd(st.key + 305) * 1.7) * (1 + prog * 1.3);
        return { x: R * Math.cos(th), y: R * Math.sin(th), r, o, key: st.key };
      }),
    [elapsedSec, nearStars]
  );

  // Filled portion of the spiral: from the start up to the current frontier,
  // painted with the current task's color. All in *screen* units aligned with
  // the visible path (dash offsets are relative to the clipped path start).
  const fillDash =
    visible.len > 0
      ? `0 0 ${Math.max(0, fillLen * scale - visible.offset)} ${Math.max(0, visible.len - Math.max(0, fillLen * scale - visible.offset))}`
      : '';

  // Time to the next task — the label sits ON the spiral at the midpoint of
  // the arc between the star (current position) and the end of the current
  // task, written along the spiral.
  // The current task is the one containing the star's elapsed time (a task
  // spans a fraction of a turn, a full turn, or several turns, depending on
  // its planned duration).
  const curTaskIdx = (() => {
    const raw = tasks.findIndex((t, i) => elapsedSec < (cumulativeTimes[i] ?? 0) + t.plannedTime);
    return raw === -1 ? tasks.length - 1 : raw;
  })();
  const curTaskEndSec = curTaskIdx >= 0 ? (cumulativeTimes[curTaskIdx] ?? 0) + (tasks[curTaskIdx]?.plannedTime ?? 0) : 0;
  const curTaskEndTheta = (curTaskEndSec / 3600) * Math.PI * 2;
  const nextTaskStart = curTaskIdx + 1 < tasks.length ? cumulativeTimes[curTaskIdx + 1] : null;
  const timeToNext = nextTaskStart !== null ? Math.max(0, nextTaskStart - elapsedSec) : null;
  const nextLabelText = timeToNext !== null ? `Время до следующей задачи: ${fmtTime(timeToNext)}` : '';
  // Arc midpoint of the remaining segment: binary search on the monotonic
  // lenAtTheta between the star and the end of the current task.
  let nextMidTheta = liquidTheta;
  if (timeToNext !== null) {
    const endTheta = curTaskEndTheta;
    const targetLen = (geometry.lenAtTheta(liquidTheta) + geometry.lenAtTheta(endTheta)) / 2;
    let lo = liquidTheta;
    let hi = endTheta;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (geometry.lenAtTheta(m) < targetLen) lo = m;
      else hi = m;
    }
    nextMidTheta = (lo + hi) / 2;
  }
  // Estimated on-screen text width (13px mono ≈ 0.6em per char) — used to
  // center the text on the midpoint and pin it exactly to the path.
  const nextLabelLen = nextLabelText.length * 7.8;
  const nextLabelOffset = Math.max(
    0,
    geometry.lenAtTheta(nextMidTheta) * scale - visible.offset - nextLabelLen / 2
  );
  // Room check: the arc between the star and the end of the current task must
  // comfortably fit the on-spiral label (plus clearance for the star and the
  // next planet). When there's no room, the label is dropped from the spiral
  // and a plain timer appears under the task timer instead.
  const nextGapLen =
    timeToNext !== null
      ? (geometry.lenAtTheta(curTaskEndTheta) - geometry.lenAtTheta(liquidTheta)) * scale
      : 0;
  const nextLabelFits = timeToNext !== null && nextGapLen >= nextLabelLen + 48;

  // Star labels (elapsed time + delta + fallback timer + "Выполнить?" button)
  // must stay inside the viewport. They sit to the right of the star when
  // there's room, otherwise to the left (the star starts each task at the
  // right edge, so the right side overflows).
  const elapsedText = fmtTime(elapsedSec);
  const deltaText = deltaMs !== null ? formatDelta(deltaMs) : '—';
  const nextTimerText = timeToNext !== null && !nextLabelFits ? `До следующей: ${fmtTime(timeToNext)}` : '';
  // 15px mono ≈ 9px/char, 12px mono ≈ 7.2px/char.
  const starLabelW = Math.max(elapsedText.length * 9, deltaText.length * 7.2, nextTimerText.length * 7.2);
  // Pill near the star: "✓ Выполнить?" once we've crossed the current task's
  // planet (complete it early), switching to "↩ Отменить?" if it was already
  // completed — mirrors the timeline's ✓ / ↩ buttons. The pill is only a
  // fallback: while the planet itself is on screen it can be clicked directly,
  // so the pill shows only when the planet is NOT visible (it flies off-screen
  // as the turn progresses).
  const curTask = curTaskIdx >= 0 && curTaskIdx < tasks.length ? tasks[curTaskIdx] : null;
  const turnStartSec = curTaskIdx >= 0 && curTaskIdx < cumulativeTimes.length ? cumulativeTimes[curTaskIdx] : 0;
  const curPlanetTheta = ((cumulativeTimes[curTaskIdx] ?? 0) / 3600) * Math.PI * 2;
  const curPlanetR = rAtTheta(curPlanetTheta) * scale;
  const curPlanetX = curPlanetR * Math.cos(curPlanetTheta);
  const curPlanetY = curPlanetR * Math.sin(curPlanetTheta);
  const curPlanetOnScreen =
    Math.abs(curPlanetX) < HALF - 40 && Math.abs(curPlanetY) < HALF - 40;
  const starPillUndo =
    (sessionState === 'running' || sessionState === 'paused') &&
    curTask !== null &&
    curTask.completedAt !== null &&
    elapsedSec > turnStartSec + 0.5 &&
    !curPlanetOnScreen;
  const starPillComplete =
    sessionState === 'running' &&
    curTask !== null &&
    curTask.completedAt === null &&
    elapsedSec > turnStartSec + 0.5 &&
    !curPlanetOnScreen;
  const starPillVisible = starPillUndo || starPillComplete;
  const pillText = starPillUndo ? '↩ Отменить?' : '✓ Выполнить?';
  const doneTextW = pillText.length * 7.2;
  const doneW = doneTextW + 16; // pill: text + padding
  const starLabelWAll = Math.max(starLabelW, doneW);
  const starX = frontier.x * scale;
  const starY = frontier.y * scale;
  const starMargin = 8;
  let starLabelX = 28;
  let starLabelAnchor: 'start' | 'end' = 'start';
  if (starX + 28 + starLabelWAll > HALF - starMargin) {
    // Flip to the left of the star: the label's right edge sits 28 units left
    // of the star. All values here are in the star group's LOCAL coordinates
    // (the group is translated to the star's position), so the text's global
    // position is star + local — the old formula mixed the two spaces and put
    // the labels at global ~2×starX, clipping them off-screen on the right.
    const localRight = -28;
    // Keep the text's left edge inside the viewport when the star itself is
    // near the left edge (rare, but the star orbits the full screen).
    const minLocalX = -HALF + starMargin + starLabelWAll - starX;
    starLabelX = Math.max(minLocalX, localRight);
    starLabelAnchor = 'end';
  }
  // Vertical clamp for the whole label stack (elapsed above the star, delta /
  // fallback / button below it) — the star orbits the screen, so at the top
  // or bottom edge the stack would otherwise go off-screen.
  let starLabelDy = 0;
  if (starY - 16 < -HALF + starMargin) starLabelDy = -HALF + starMargin - starY + 16;
  if (starY + 66 > HALF - starMargin) starLabelDy = HALF - starMargin - starY - 66;

  // Task boundary dots — every task's planet is shown along the spiral at its
  // planned start time. Size is proportional to on-screen distance: planets
  // further ahead are smaller. Below MIN_PLANET_SIZE the planet art is
  // sub-pixel noise, so those are culled instead of rendered.
  const MIN_PLANET_SIZE = 0.1;
  const dots = useMemo(
    () =>
      tasks.map((t, i) => {
        const start = cumulativeTimes[i] ?? 0;
        const th = (start / 3600) * Math.PI * 2;
        const r = rAtTheta(th) * scale;
        const screenR = r;
        // Size: nearer = bigger — linear in screen radius, top-clamped only.
        const size = Math.min(1.6, screenR / 220);
        const visible = size >= MIN_PLANET_SIZE;
        // Label placement: the name must stay inside the viewport. It sits to
        // the right of the planet when there's room, otherwise to the left.
        // The text is inside the scaled planet group, so its on-screen width
        // is the estimate × size.
        const px = r * Math.cos(th);
        const labelW = t.name.length * 8 * size;
        const margin = 8;
        let lx = 16;
        let anchor: 'start' | 'end' = 'start';
        if (px + 16 * size + labelW > HALF - margin) {
          lx = -16;
          anchor = 'end';
        }
        // Even on the left side, keep the text inside the viewport.
        if (anchor === 'end' && px - 16 * size - labelW < -HALF + margin) {
          lx = Math.max(-16, (-HALF + margin + labelW - px) / size);
        }
        // Axial spin — elapsed run time drives the turn; paused/idle keep the
        // current (or initial) angle. Per-planet period/direction/phase come
        // from the task's stable id.
        const spin = spinParams(t.id);
        const spinAngle = spin.phase + spin.dir * ((elapsedSec / spin.period) * Math.PI * 2);
        return {
          id: t.id,
          x: px,
          y: r * Math.sin(th),
          emoji: t.emoji,
          color: t.color,
          name: t.name,
          passed: sessionState !== 'idle' && elapsedSec >= start,
          completed: t.completedAt !== null,
          visible,
          size,
          spinAngle,
          lx,
          anchor,
          // Names only on planets big enough to host readable text — a sea
          // of tiny labels would drown the map.
          labelVisible: visible && size >= 0.45 && (sessionState === 'idle' || screenR > 105),
        };
      }),
    [tasks, cumulativeTimes, sessionState, elapsedSec, scale]
  );

  // Finish planet — the goal of the LAST task. The last task's end has no
  // planet of its own (planets sit at task *starts*), so without this the
  // screen would have no goal marker during the final task. It sits at the
  // very end of the spiral and, like every boundary ahead, grows from small
  // to full size during the last task.
  const finishPt = geometry.pointAtTheta(geometry.thetaMax);
  const finish = {
    x: finishPt.x * scale,
    y: finishPt.y * scale,
    visible: elapsedSec >= (cumulativeTimes[tasks.length - 1] ?? 0),
    screenR: Math.hypot(finishPt.x, finishPt.y) * scale,
  };

  // Click / drag on the spiral to scrub the timer (mirrors the timeline
  // thermo scrubbing). The moving frontier ball is always grabbable — a press
  // within a generous screen-space radius around it grabs it regardless of
  // zoom. Otherwise the press must land on the tube itself (gaps between turns
  // and the surrounding area are ignored). Once dragging, the ball follows the
  // cursor anywhere, freely leaving the spiral; the time follows its angle
  // around the current turn so crossing a full-turn boundary keeps moving.
  //
  // All hit tests happen in *screen* space: the spiral content is scaled by
  // `scale` inside the SVG, so the cursor is first converted to viewBox units
  // (which include the zoom) and only then divided by `scale` to compare
  // against the unscaled geometry.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const lastTimeRef = useRef(0);
  // Set by planet / "Выполнить?" presses: their pointerdown runs before the
  // svg's (bubbling), and signals the scrub handler to ignore this press —
  // the press is a click-to-complete, not a drag.
  const suppressDragRef = useRef(false);

  // Screen-space tolerance (px) for pressing on the tube centerline, and for
  // grabbing the frontier ball. Both are constant at any zoom.
  const TUBE_HIT_PX = 34;
  const BALL_HIT_PX = 42;

  // Map a client point into viewBox coordinates. The viewBox is square while
  // the SVG element itself may be wide/short; with the default
  // preserveAspectRatio="xMidYMid meet" the drawn content is a centered
  // square inside the element. All hit tests must use that content square,
  // otherwise the grab zone drifts from the drawn spiral (worse as the
  // container gets wider than tall).
  const viewBoxFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const content = Math.min(rect.width, rect.height);
    const offX = (rect.width - content) / 2;
    const offY = (rect.height - content) / 2;
    const pxPerUnit = content / VIEW;
    return {
      rawX: ((clientX - rect.left - offX) / content) * VIEW - HALF,
      rawY: ((clientY - rect.top - offY) / content) * VIEW - HALF,
      pxPerUnit,
      content,
      offX,
      offY,
      left: rect.left,
      top: rect.top,
    };
  }, []);

  // True when a client point is within the star's grab radius (screen px).
  const nearStarClient = useCallback(
    (clientX: number, clientY: number) => {
      const m = viewBoxFromClient(clientX, clientY);
      if (!m) return false;
      const dx = (m.rawX - frontier.x * scale) * m.pxPerUnit;
      const dy = (m.rawY - frontier.y * scale) * m.pxPerUnit;
      return Math.hypot(dx, dy) <= BALL_HIT_PX;
    },
    [viewBoxFromClient, frontier, scale]
  );

  const timeFromPoint = useCallback(
    (clientX: number, clientY: number, prevSec: number | null) => {
      const m = viewBoxFromClient(clientX, clientY);
      if (!m) return null;
      // Raw viewBox coordinates — the spiral is drawn directly in these units.
      const rawX = m.rawX;
      const rawY = m.rawY;
      const S = scale;

      if (prevSec === null) {
        const pts = geometry.pts;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const dx = pts[i].x * S - rawX;
          const dy = pts[i].y * S - rawY;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        // viewBox distance × pxPerUnit = screen px.
        if (Math.sqrt(bestD) * m.pxPerUnit > TUBE_HIT_PX) return null;
        return secFromAngle(pts[best].th);
      }

      // Angle is invariant under uniform scaling — use the raw coordinates.
      // Candidates are clamped to the spiral's angular range instead of being
      // discarded: the end of the last turn and the start of it share the same
      // ray (angle 0), so a plain skip would snap the drag from the finish
      // back to the beginning of the last turn. Clamping keeps the drag
      // pinned at the ends of the path. Branches are one hour wide now, so
      // the previous position's branch ±1 covers any reachable ray.
      const thetaC = Math.atan2(rawY, rawX);
      const k = Math.floor(angleFromSec(prevSec) / (Math.PI * 2));
      const kkMax = Math.ceil(geometry.thetaMax / (Math.PI * 2));
      let bestTh = 0;
      let bestD = Infinity;
      for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk > kkMax) continue;
        const thRaw = thetaC + kk * Math.PI * 2;
        const th = Math.max(0, Math.min(thRaw, geometry.thetaMax));
        const p = geometry.pointAtTheta(th);
        const dx = p.x * S - rawX;
        const dy = p.y * S - rawY;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestTh = th;
        }
      }
      if (!isFinite(bestD)) return null;
      return secFromAngle(bestTh);
    },
    [geometry, scale, viewBoxFromClient, angleFromSec, secFromAngle]
  );

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (sessionState === 'idle') return;

    // A planet or the "Выполнить?" pill claimed this press (click-to-complete).
    if (suppressDragRef.current) {
      suppressDragRef.current = false;
      return;
    }

    // 1) Grab the frontier ball. The ball is pinned to a constant screen size
    //    but its *center* moves with the zoom — it renders at frontier × scale
    //    in viewBox units, so the hit test must use that scaled position.
    if (showLiquid && nearStarClient(e.clientX, e.clientY)) {
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer may already be gone — dragging still works via move/up
      }
      lastTimeRef.current = liquidThetaSec;
      return;
    }

    // 2) Otherwise the press must land on the tube.
    const t = timeFromPoint(e.clientX, e.clientY, null);
    if (t === null) return; // press outside the tube — ignore
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer may already be gone — dragging still works via move/up events
    }
    lastTimeRef.current = t;
    onSeek(t * 1000);
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const t = timeFromPoint(e.clientX, e.clientY, lastTimeRef.current);
    if (t !== null) {
      lastTimeRef.current = t;
      onSeek(t * 1000);
    }
  };

  const stopDrag = () => {
    draggingRef.current = false;
  };

  // Clicking a planet while running completes that task (or undoes it if it's
  // already completed) — mirrors the timeline's ✓ / ↩ buttons. While idle or
  // paused, the click opens the edit popup instead (rename / duration / color).
  // The press is claimed so it doesn't also start a scrub; the only exception
  // is when the press lands on/near the star — the star grab must win, since
  // at a task boundary the star sits exactly on its planet.
  const handlePlanetPointerDown = (e: ReactPointerEvent) => {
    if (!nearStarClient(e.clientX, e.clientY)) suppressDragRef.current = true;
  };

  const openEdit = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    setEditingTaskId(id);
    setEditName(task.name);
    const h = Math.floor(task.plannedTime / 3600);
    const m = Math.floor((task.plannedTime % 3600) / 60);
    const s = task.plannedTime % 60;
    setEditTime(
      h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    );
  };

  const handlePlanetClick = (id: string, completed: boolean) => {
    if (sessionState === 'idle' || sessionState === 'paused') {
      openEdit(id);
      return;
    }
    if (completed) onUncompleteTask(id);
    else onCompleteTask(id);
  };

  const commitEdit = () => {
    if (editingTaskId === null) return;
    onRenameTask(editingTaskId, editName);
    const parts = editTime.split(':').map((p) => parseInt(p) || 0);
    let total: number;
    if (parts.length === 3) {
      total = Math.min(parts[0], 99) * 3600 + Math.min(parts[1], 59) * 60 + Math.min(parts[2], 59);
    } else if (parts.length === 2) {
      total = Math.min(parts[0], 99) * 60 + Math.min(parts[1], 59);
    } else {
      total = Math.max(1, Math.round(parseFloat(editTime) * 60));
    }
    if (total > 0) onChangeTaskTime(editingTaskId, total);
    setEditingTaskId(null);
  };

  const editingTask = editingTaskId !== null ? tasks.find((t) => t.id === editingTaskId) ?? null : null;

  // The pill near the star — always claims its press (it's a button, not a drag).
  const handleDonePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    suppressDragRef.current = true;
  };

  const handleDoneClick = () => {
    if (curTask === null) return;
    if (curTask.completedAt !== null) onUncompleteTask(curTask.id);
    else onCompleteTask(curTask.id);
  };

  const showLiquid = fillLen > 0.5;

  // Mouse wheel scrubbing: scroll up/away = forward in time, scroll down =
  // back. Each notch moves ~20 seconds, clamped to the run. Latest values are
  // read from a ref updated in an effect, so the listener binds only once.
  const wheelStateRef = useRef({ elapsedSec, totalSec, sessionState, onSeek });
  const WHEEL_STEP = 20; // seconds per wheel notch

  useEffect(() => {
    wheelStateRef.current = { elapsedSec, totalSec, sessionState, onSeek };
  }, [elapsedSec, totalSec, sessionState, onSeek]);

  // Safety net: never leave the drag state stuck (release outside the window,
  // OS gesture stealing the pointer, blur, etc.).
  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

  // Wheel scrubbing — bound once to the SVG element so we can preventDefault
  // (React's onWheel is passive here and can't stop scrolling).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = wheelStateRef.current;
      if (st.sessionState === 'idle' || st.sessionState === 'finished') return;
      const delta = e.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP;
      const next = Math.max(0, Math.min(st.elapsedSec + delta, st.totalSec));
      st.onSeek(next * 1000);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="spiral-stage">
      <svg
        ref={svgRef}
        className="spiral-svg"
        viewBox={`${-HALF} ${-HALF} ${VIEW} ${VIEW}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <defs>
          {/* Gold gradient for the finish planet */}
          <radialGradient id="planet-grad-finish" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#ffe9a8" />
            <stop offset="55%" stopColor="var(--accent-gold)" />
            <stop offset="100%" stopColor="#8a6a10" />
          </radialGradient>
        </defs>

        {/* Starfield — static background stars; a good share twinkles slowly */}
        <g className="spiral-starfield">
          {starfield.map((s) => {
            // Slow twinkle on every third or fifth star: a noticeable opacity
            // breathing (≈±30%) over a 2.4–5.6 s period, phase per star.
            const tw =
              s.key % 3 === 0 || s.key % 5 === 0
                ? 0.7 + 0.3 * Math.sin((elapsedSec * 2 * Math.PI) / (2.4 + (s.key % 5) * 0.8) + s.key * 1.7)
                : 1;
            return <circle key={s.key} cx={s.x} cy={s.y} r={s.r} fill="rgba(255,255,255,0.85)" opacity={s.o * tw} />;
          })}
        </g>

        {/* Constellation clusters — linked stars fixed in the background */}
        <g className="spiral-constellations">
          {constellations.map((c) => (
            <g key={c.key}>
              <path d={c.path} fill="none" stroke="rgba(150,165,215,0.28)" strokeWidth={1} />
              {c.stars.map((s, i) => (
                <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="rgba(205,215,255,0.9)" opacity={s.o} />
              ))}
            </g>
          ))}
        </g>

        {/* Near stars — endless approach: born near the center, drift out, reborn */}
        <g className="spiral-near-stars">
          {nearField.map((s) => (
            <circle key={s.key} cx={s.x} cy={s.y} r={s.r} fill="rgba(255,255,255,0.9)" opacity={s.o} />
          ))}
        </g>

        {/* Polar guide lines — static trig-circle backdrop, behind the spiral */}
        <g className="spiral-polar">
          {polarLines.map((l) => (
            <line
              key={l.key}
              x1={0}
              y1={0}
              x2={l.x2}
              y2={l.y2}
              className={l.major ? 'major' : ''}
            />
          ))}
        </g>

        {/* Spiral + overlays, drawn directly in screen units */}
        <g style={{ '--spiral-liquid-color': currentTaskColor } as CSSProperties}>
          {/* The spiral — a thin grey dashed line only */}
          <path
            id="spiral-visible-path"
            d={visible.d}
            fill="none"
            stroke="rgba(160,170,185,0.5)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="3 9"
          />

          {/* Filled portion — the traveled part of the spiral glows like neon:
              pulsing outer halo + bright core in the current task's color */}
          {showLiquid && fillDash && (
            <>
              <path
                className="spiral-fill-halo"
                d={visible.d}
                fill="none"
                stroke={currentTaskColor}
                strokeWidth={26}
                strokeLinecap="butt"
                strokeDasharray={fillDash}
                opacity={0.3}
              />
              <path
                d={visible.d}
                fill="none"
                stroke={currentTaskColor}
                strokeWidth={12}
                strokeLinecap="butt"
                strokeDasharray={fillDash}
                opacity={0.45}
              />
              <path
                d={visible.d}
                fill="none"
                stroke="#ffffff"
                strokeWidth={3}
                strokeLinecap="butt"
                strokeDasharray={fillDash}
                opacity={0.9}
              />
            </>
          )}

          {/* Time-left label — written ALONG the spiral, centered on the
              midpoint of the arc between the star and the end of the current
              task. Only shown when the remaining arc has room for it;
              otherwise a plain timer appears under the task timer. */}
          {nextLabelFits && (
            <text className="spiral-next-label" dominantBaseline="central">
              <textPath
                href="#spiral-visible-path"
                startOffset={nextLabelOffset}
                textLength={nextLabelLen}
                lengthAdjust="spacingAndGlyphs"
              >
                {nextLabelText}
              </textPath>
            </text>
          )}

          {/* Task dots — planets along the route; far ones small, sub-pixel ones culled */}
          {dots.map((dot, i) => {
            if (!dot.visible) return null;
            return (
              <g
                key={dot.id}
                className={`spiral-dot ${i === currentTaskIdx && sessionState !== 'idle' ? 'current' : ''} ${dot.passed ? 'passed' : ''}`}
                transform={`translate(${dot.x} ${dot.y}) scale(${dot.size})`}
                style={{ '--dot-color': dot.color } as CSSProperties}
                onPointerDown={handlePlanetPointerDown}
                onClick={() => handlePlanetClick(dot.id, dot.completed)}
              >
                {/* atmospheric glow */}
                <circle cx={0} cy={0} r={17} fill={dot.color} opacity={0.16} />
                <defs>
                  <radialGradient id={`planet-grad-${dot.id}`} cx="38%" cy="32%" r="75%">
                    <stop offset="0%" stopColor={`color-mix(in srgb, ${dot.color} 55%, #ffffff)`} />
                    <stop offset="55%" stopColor={dot.color} />
                    <stop offset="100%" stopColor={`color-mix(in srgb, ${dot.color} 55%, #000000)`} />
                  </radialGradient>
                </defs>
                {/* 3D sphere — shaded body whose cloud layer turns with the
                    planet's axial angle (real rotation, not a flat spin) */}
                <PlanetBody id={dot.id} color={dot.color} angle={dot.spinAngle} />
                {/* small ring for some planets */}
                {dot.id.charCodeAt(dot.id.length - 1) % 2 === 0 && (
                  <ellipse cx={0} cy={0} rx={21} ry={6} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.8} transform="rotate(-18)" />
                )}
                {dot.labelVisible && (
                  <text
                    x={dot.lx}
                    y={4}
                    textAnchor={dot.anchor}
                    className="spiral-task-label"
                  >
                    {dot.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* The star — static light ball at the current position (no blink) */}
          {showLiquid && (
            <g transform={`translate(${frontier.x * scale} ${frontier.y * scale})`} style={{ '--star-color': currentTaskColor } as CSSProperties}>
              {/* subtle colored halo (flat, no blur — cheap on the moving star) */}
              <circle cx={0} cy={0} r={11} fill={currentTaskColor} opacity={0.25} />
              {/* bright core */}
              <circle cx={0} cy={0} r={6} fill="#ffffff" />
            </g>
          )}

          {/* Timer readouts near the current position — always visible, even
              before the run starts or when the star isn't drawn yet */}
          <g transform={`translate(${frontier.x * scale} ${frontier.y * scale})`}>
              {/* elapsed time next to the star */}
              <text x={starLabelX} y={-10 + starLabelDy} textAnchor={starLabelAnchor} dominantBaseline="central" className="spiral-elapsed-label">
                {elapsedText}
              </text>
              {/* ahead/behind schedule — same value as the timeline's delta */}
              <text
                x={starLabelX}
                y={10 + starLabelDy}
                textAnchor={starLabelAnchor}
                dominantBaseline="central"
                className={`spiral-delta-label ${deltaMs !== null && deltaMs < 0 ? 'ahead' : deltaMs !== null ? 'behind' : ''}`}
              >
                {deltaText}
              </text>
              {/* fallback timer: time left until the next task, shown under the
                  task timer when the on-spiral label doesn't fit */}
              {!nextLabelFits && timeToNext !== null && (
                <text x={starLabelX} y={28 + starLabelDy} textAnchor={starLabelAnchor} dominantBaseline="central" className="spiral-next-timer">
                  {nextTimerText}
                </text>
              )}
              {/* "Выполнить?" / "Отменить?" — complete or undo the current task */}
              {starPillVisible && (
                <g
                  onPointerDown={handleDonePointerDown}
                  onClick={handleDoneClick}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={starLabelAnchor === 'start' ? starLabelX - 8 : starLabelX - doneW + 8}
                    y={38 + starLabelDy}
                    width={doneW}
                    height={24}
                    rx={12}
                    className={`spiral-done-btn-bg ${starPillUndo ? 'undo' : ''}`}
                  />
                  <text
                    x={starLabelX}
                    y={50 + starLabelDy}
                    textAnchor={starLabelAnchor}
                    dominantBaseline="central"
                    className={`spiral-done-label ${starPillUndo ? 'undo' : ''}`}
                  >
                    {pillText}
                  </text>
                </g>
              )}
          </g>

          {/* Finish planet — the goal of the last task (appears during the
              final turn so the screen never ends up without a planet) */}
          {finish.visible && (
            <g
              className="spiral-finish"
              transform={`translate(${finish.x} ${finish.y})`}
              style={{ opacity: Math.min(1, finish.screenR / 80) } as CSSProperties}
            >
              <circle cx={0} cy={0} r={17} fill="var(--accent-gold)" opacity={0.18} />
              <circle cx={0} cy={0} r={13} fill="url(#planet-grad-finish)" stroke="var(--accent-gold)" strokeWidth={2} />
              <path d="M -13 -2 A 13 13 0 0 0 13 -2" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2.4} />
              <path d="M -13 3 A 13 13 0 0 0 13 3" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={1.6} />
              <path d="M -13 0 A 13 13 0 0 0 13 0 A 11 13 0 0 1 -13 0 Z" fill="rgba(0,0,0,0.4)" />
              <circle cx={-4.5} cy={-4.5} r={3.8} fill="rgba(255,255,255,0.6)" />
              <ellipse cx={0} cy={0} rx={22} ry={6.5} fill="none" stroke="rgba(255,215,120,0.55)" strokeWidth={1.8} transform="rotate(-14)" />
            </g>
          )}
        </g>
      </svg>

      {/* Task edit popup — opened by clicking a planet while idle/paused */}
      {editingTask !== null && (
        <div className="spiral-edit-overlay" onClick={() => setEditingTaskId(null)}>
          <div className="spiral-edit-popup" onClick={(e) => e.stopPropagation()}>
            <div className="spiral-edit-header">
              <span>
                Редактировать <strong>{editingTask.emoji}</strong> {editingTask.name}
              </span>
              <button
                className="emoji-overlay-close"
                onClick={() => setEditingTaskId(null)}
                title="Cancel"
              >
                ✕
              </button>
            </div>
            <label className="spiral-edit-label">Название</label>
            <input
              className="edit-name-input"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditingTaskId(null);
              }}
              autoFocus
            />
            <label className="spiral-edit-label">Длительность (m:ss или h:mm:ss)</label>
            <input
              className="edit-time-input"
              type="text"
              inputMode="decimal"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditingTaskId(null);
              }}
            />
            <label className="spiral-edit-label">Цвет</label>
            <div className="color-picker">
              {TASK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-opt ${editingTask.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => onChangeTaskColor(editingTask.id, c)}
                />
              ))}
              <input
                type="color"
                className="color-input"
                value={editingTask.color}
                onChange={(e) => onChangeTaskColor(editingTask.id, e.target.value)}
                title="Pick any color"
              />
            </div>
            <div className="spiral-edit-actions">
              <button className="btn spiral-edit-save" onClick={commitEdit}>
                Сохранить
              </button>
              <button className="btn" onClick={() => setEditingTaskId(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
