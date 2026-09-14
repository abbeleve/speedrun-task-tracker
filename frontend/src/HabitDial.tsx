// A semicircle of dots: the visual signature of the habit tracker. One
// component drives two very different sizes — the hero dial on top of the
// page and the tiny "last 7 days" indicator inside each habit row — so the
// two views share a language instead of fighting for attention.
//
// Dots are placed on a 180° arc starting on the lower-left, sweeping over the
// top to the lower-right. That leaves a gap at the bottom where the big
// number sits, so the digits never overlap the artwork. All dots share a
// single colour (the habit's own) — a string of same-hue dots reads more
// clearly as "this habit, lit up" than a rainbow, which would compete with
// the card's identity colour.

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
  // The hue every dot shares. The card passes its own habit colour so the
  // dial reads as "this habit, lit up N times" instead of a generic rainbow.
  color: string;
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
  dot: number,
  color: string
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
        color,
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
      color,
      filled: filled[i],
      index: i,
    });
  }
  return out;
}

function HabitDial(props: HabitDialProps) {
  const { size, dot = 18, className, ariaLabel, color } = props;
  const filled = useMemo<boolean[]>(() => {
    if ('statuses' in props && props.statuses) return props.statuses;
    const total = props.total;
    const clamped = Math.max(0, Math.min(1, props.progress));
    const count = Math.max(0, total);
    return Array.from({ length: count }, (_, i) => (i + 1) / count <= clamped + 1e-6);
  }, [props]);
  const dots = useMemo(() => buildDots(filled, size, dot, color), [filled, size, dot, color]);
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
