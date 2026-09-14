// A semicircle of dots: the visual signature of the habit tracker. One
// component drives two very different sizes — the hero dial on top of the
// page and the tiny "last 7 days" indicator inside each habit row — so the
// two views share a language instead of fighting for attention.
//
// Dots are placed on a 180° arc starting on the lower-left, sweeping over the
// top to the lower-right. That leaves a gap at the bottom where the big
// number sits, so the digits never overlap the artwork. Each dot's hue comes
// from a discrete rainbow palette (ROYGBIV-ish), so the dial reads as "this is
// a rainbow, not a progress bar".

import { useMemo } from 'react';

interface HabitDialBaseProps {
  // Edge length of the square SVG canvas, in CSS pixels. The dial renders
  // inside this box with a tiny bit of padding.
  size: number;
  // Dot diameter, in CSS pixels. The hero is 18px-ish; the row indicator
  // is 9px-ish. Independent from `size` so the call site picks both.
  dot?: number;
  // Optional class to extend the root <svg> with (theming, animations, …).
  className?: string;
  // Accessible name; falls back to a generic "Progress" so screen readers
  // always get something.
  ariaLabel?: string;
}

// Fill each dot proportionally from the left. Use this for the hero — the
// fill is a single fraction (0..1) of how many dots should appear on.
interface HabitDialProgressProps extends HabitDialBaseProps {
  progress: number;
  total: number;
  statuses?: never;
}

// Drive each dot's filled state independently. Use this for the per-row
// "last 7 days" indicator — past days light up only if the habit was hit
// that day, no aggregation needed.
interface HabitDialStatusesProps extends HabitDialBaseProps {
  statuses: boolean[];
  progress?: never;
  total?: never;
}

type HabitDialProps = HabitDialProgressProps | HabitDialStatusesProps;

// Eight stops from cool to warm, matching the palette in the reference image
// (teal → mint → lime → yellow → orange → pink → violet). Reused at every
// size, so the hero and the row indicator stay in lockstep.
const RAINBOW = [
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#4ade80', // green
  '#a3e635', // lime
  '#facc15', // yellow
  '#fb923c', // orange
  '#f472b6', // pink
  '#a78bfa', // violet
];

function dotColor(index: number, total: number): string {
  if (total <= 1) return RAINBOW[0];
  const t = index / (total - 1); // 0..1 across the arc
  const pos = t * (RAINBOW.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(RAINBOW.length - 1, lo + 1);
  const frac = pos - lo;
  return mixHex(RAINBOW[lo], RAINBOW[hi], frac);
}

// Linearly mix two #RRGGBB hex colours. Keeps saturation intact so the
// gradient doesn't go muddy in the middle.
function mixHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  const r = m(ar, br);
  const g = m(ag, bg);
  const bl = m(ab, bb);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

interface DotGeom {
  cx: number;
  cy: number;
  r: number;
  color: string;
  filled: boolean;
  index: number;
}

function buildDots(
  filled: boolean[],
  size: number,
  dot: number
): DotGeom[] {
  const count = filled.length;
  // Geometry: arc starts at the lower-left (angle = π) and sweeps clockwise
  // over the top to the lower-right (angle = 0). Centre sits a bit below
  // the geometric centre of the box so the gap for the number feels right.
  const cx = size / 2;
  const cy = size * 0.86;
  const radius = size * 0.42;
  // The filled dots get a small radius bump so the eye lands on them first.
  const baseR = dot / 2;
  const filledR = baseR * 1.18;
  if (count === 0) return [];
  if (count === 1) {
    return [
      {
        cx,
        cy: cy - radius,
        r: baseR,
        color: RAINBOW[0],
        filled: filled[0],
        index: 0,
      },
    ];
  }
  const out: DotGeom[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI - (i / (count - 1)) * Math.PI;
    const x = cx + radius * Math.cos(angle);
    const y = cy - radius * Math.sin(angle);
    out.push({
      cx: x,
      cy: y,
      r: filled[i] ? filledR : baseR,
      color: dotColor(i, count),
      filled: filled[i],
      index: i,
    });
  }
  return out;
}

function HabitDial(props: HabitDialProps) {
  const { size, dot = 18, className, ariaLabel } = props;
  const filled = useMemo<boolean[]>(() => {
    if ('statuses' in props && props.statuses) return props.statuses;
    const total = props.total;
    const clamped = Math.max(0, Math.min(1, props.progress));
    const count = Math.max(0, total);
    return Array.from({ length: count }, (_, i) => (i + 1) / count <= clamped + 1e-6);
  }, [props]);
  const dots = useMemo(() => buildDots(filled, size, dot), [filled, size, dot]);
  return (
    <svg
      className={className}
      width={size}
      height={size * 0.92}
      viewBox={`0 0 ${size} ${size * 0.92}`}
      role="img"
      aria-label={ariaLabel ?? 'Progress'}
    >
      {dots.map((d) => (
        <circle
          key={d.index}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill={d.color}
          opacity={d.filled ? 1 : 0.18}
        />
      ))}
    </svg>
  );
}

export default HabitDial;