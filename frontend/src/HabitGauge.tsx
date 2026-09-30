// The habit card's second chart style: a fan of radial capsules, a little
// wider than a half circle, lit in the habit's colour up to today's progress.
// Lit capsules deepen towards the start of the fan and the unlit ones fade out
// towards its end, so the gauge reads as travelling left to right. Like
// HabitDial, the viewBox is cropped to the fan itself and the read-out inside
// it is positioned by the card, not here.

import { useMemo } from 'react';
import { GAUGE_SEGMENTS, gaugeSegments } from './habitChart';

interface HabitGaugeProps {
  // The habit's own colour.
  color: string;
  // 0..1 — how much of today's quota is done.
  progress: number;
  // Tip-to-tip width of the fan in CSS pixels; the height follows from it.
  size: number;
  className?: string;
  ariaLabel?: string;
}

// The capsules keep the proportions of the reference design: each is about
// a sixteenth of the gauge's width thick and a little over twice as long as
// it is thick, round ends included — stubby petals, not thin spokes.
const THICKNESS = 0.062; // × size
const LENGTH = 2.3; // × thickness, tip to tip

function buildLayout(size: number, progress: number) {
  const tip = size / 2; // from the centre to a capsule's outer tip
  const thickness = size * THICKNESS;
  const length = thickness * LENGTH;
  // A round cap reaches half the thickness past the end of its line, so the
  // lines themselves stop that far short of the tips.
  const outer = tip - thickness / 2;
  const inner = tip - length + thickness / 2;
  const capsules = gaugeSegments(GAUGE_SEGMENTS, progress).map((s) => {
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    return {
      x1: inner * cos,
      y1: -inner * sin,
      x2: outer * cos,
      y2: -outer * sin,
      lit: s.lit,
      position: s.position,
    };
  });
  // Crop the canvas to the capsules themselves (the fan dips below its centre
  // line at both ends), with room for the round caps.
  const pad = thickness / 2 + 1;
  const xs = capsules.flatMap((c) => [c.x1, c.x2]);
  const ys = capsules.flatMap((c) => [c.y1, c.y2]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) + pad - minX;
  const height = Math.max(...ys) + pad - minY;
  return { capsules, thickness, viewBox: `${minX} ${minY} ${width} ${height}`, width, height };
}

// Drawn at its own pixel size rather than stretched to the card, so the
// capsules look the same whatever the card's width (CSS only shrinks it on a
// screen too narrow to hold it).
function HabitGauge({ color, progress, size, className, ariaLabel }: HabitGaugeProps) {
  const { capsules, thickness, viewBox, width, height } = useMemo(
    () => buildLayout(size, progress),
    [size, progress]
  );
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={viewBox}
      role="img"
      aria-label={ariaLabel ?? 'Progress'}
    >
      {capsules.map((c, i) => (
        <line
          key={i}
          className="habit-gauge-capsule"
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          strokeWidth={thickness}
          strokeLinecap="round"
          style={{
            // Mixed with the card's surface rather than made transparent, so
            // the shades stay solid and read the same in both themes.
            stroke: c.lit
              ? `color-mix(in srgb, ${color} ${Math.round(100 - 42 * c.position)}%, var(--bg-surface))`
              : `color-mix(in srgb, var(--text-dim) ${Math.round(52 - 26 * c.position)}%, var(--bg-surface))`,
            transitionDelay: `${i * 16}ms`,
          }}
        />
      ))}
    </svg>
  );
}

export default HabitGauge;
