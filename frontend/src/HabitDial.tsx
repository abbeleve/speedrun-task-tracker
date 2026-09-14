// A semicircle of dots: the visual signature of the habit tracker. One
// component drives two very different sizes — the hero dial on top of the
// page and the tiny "last 7 days" indicator inside each habit row — so the
// two views share a language instead of fighting for attention.
//
// Dots are placed on a 180° arc starting on the lower-left, sweeping over the
// top to the lower-right. Two concentric rings of same-size dots give the arc
// visual depth instead of reading as a single thin string — uniform size
// keeps the band calm rather than a scatter of unevenly-sized balls. Each
// ring's dot count is derived from its own radius so the spacing between
// adjacent dots is consistent ring to ring (the outer ring has a longer arc
// to cover, so it gets more dots, not wider gaps). All dots share a single
// colour (the habit's own) — a string of same-hue dots reads more clearly as
// "this habit, lit up" than a rainbow, which would compete with the card's
// identity colour. The viewBox is cropped tightly around the arc itself so
// the dial doesn't carry dead space above or below the dots — callers that
// want a number under/over the arc position it themselves, outside this
// component.

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

// Fill dots proportionally from the left. Use this for the hero — the fill
// is a single fraction (0..1) of how much of the arc should be lit.
interface HabitDialProgressProps extends HabitDialBaseProps {
  progress: number;
  // Kept for API compatibility with callers that used to pick an explicit
  // dot count; each ring now derives its own count from its radius, so this
  // only nudges the overall density up or down.
  total: number;
  statuses?: never;
}

// Drive each dot's filled state independently. Use this for the per-row
// "last 7 days" indicator — past days light up only if the habit was hit
// that day, no aggregation needed. Both rings mirror the same statuses (one
// dot per day has a fixed meaning, so it can't be resampled to a different
// count the way the proportional fill can).
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
  filled: boolean;
  key: string;
  delay: number;
}

function fillSequence(count: number, fraction: number): boolean[] {
  if (count <= 0) return [];
  const clamped = Math.max(0, Math.min(1, fraction));
  return Array.from({ length: count }, (_, i) => (i + 1) / count <= clamped + 1e-6);
}

interface Ring {
  radius: number;
  filled: boolean[];
  r: number;
  keyPrefix: string;
  delayStart: number;
}

function ringDots(cx: number, cy: number, ring: Ring): DotGeom[] {
  const { filled, radius, r } = ring;
  const count = filled.length;
  if (count === 0) return [];
  if (count === 1) {
    return [
      {
        cx,
        cy: cy - radius,
        r,
        filled: filled[0],
        key: `${ring.keyPrefix}-0`,
        delay: ring.delayStart,
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
      r,
      filled: filled[i],
      key: `${ring.keyPrefix}-${i}`,
      delay: ring.delayStart + i * 12,
    });
  }
  return out;
}

// Roughly how many dots fit around a semicircle of this radius at this
// spacing, so ring density stays consistent no matter how tight the radius.
function densityCount(radius: number, spacing: number, minCount: number): number {
  return Math.max(minCount, Math.round((radius * Math.PI) / spacing) + 1);
}

// Geometry: arc starts at the lower-left (angle = π) and sweeps clockwise
// over the top to the lower-right (angle = 0). The viewBox is cropped to the
// arc's own bounding box (plus a small pad for the dots) so the dial carries
// no dead space around it.
function buildLayout(
  fraction: number,
  statuses: boolean[] | null,
  size: number,
  dot: number,
  minCount: number
) {
  const cx = size / 2;
  const outerRadius = size * 0.4;
  // The inner ring sits a clear step behind the outer one so the two read as
  // two distinct rings, not a smear.
  const innerRadius = outerRadius * 0.72;
  // Every dot — both rings, filled or not — is the same size. Only opacity
  // marks progress, so the arc never reads as an uneven mix of ball sizes.
  const r = dot / 2;
  // Dots on the same ring sit about one diameter apart, centre to centre.
  const spacing = dot * 1.05;
  const outerFilled = statuses ?? fillSequence(densityCount(outerRadius, spacing, minCount), fraction);
  const innerFilled = statuses ?? fillSequence(densityCount(innerRadius, spacing, minCount), fraction);
  const pad = r + 3;
  const cy = outerRadius + pad;
  const outer: Ring = { radius: outerRadius, filled: outerFilled, r, keyPrefix: 'o', delayStart: 0 };
  const inner: Ring = { radius: innerRadius, filled: innerFilled, r, keyPrefix: 'i', delayStart: 40 };
  const dots = [...ringDots(cx, cy, outer), ...ringDots(cx, cy, inner)];
  const height = cy + pad;
  return { dots, width: size, height };
}

function HabitDial(props: HabitDialProps) {
  const { size, dot = 18, className, ariaLabel, color } = props;
  const isStatuses = 'statuses' in props && !!props.statuses;
  const fraction = isStatuses ? 0 : Math.max(0, Math.min(1, (props as HabitDialProgressProps).progress));
  const statuses = isStatuses ? (props as HabitDialStatusesProps).statuses : null;
  const minCount = isStatuses ? 0 : Math.max(0, (props as HabitDialProgressProps).total);
  const { dots, width, height } = useMemo(
    () => buildLayout(fraction, statuses, size, dot, minCount),
    [fraction, statuses, size, dot, minCount]
  );
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? 'Progress'}
    >
      {dots.map((d) => (
        <circle
          key={d.key}
          className="habit-dial-dot"
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill={color}
          opacity={d.filled ? 1 : 0.18}
          style={{ transitionDelay: `${d.delay}ms` }}
        />
      ))}
    </svg>
  );
}

export default HabitDial;
