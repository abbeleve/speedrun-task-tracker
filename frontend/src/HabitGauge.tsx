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
  // Width of the canvas in CSS pixels; the height follows from the geometry.
  size: number;
  className?: string;
  ariaLabel?: string;
}

function buildLayout(size: number, progress: number) {
  const outer = size * 0.42;
  const inner = outer * 0.7;
  const thickness = outer * 0.11;
  const pad = thickness / 2 + 2;
  const cx = size / 2;
  const cy = pad + outer;
  const segments = gaugeSegments(GAUGE_SEGMENTS, progress);
  // The fan dips below its centre line at both ends; the canvas stops just
  // under the lowest capsule.
  const dip = Math.max(0, ...segments.map((s) => -Math.sin(s.angle)));
  const height = cy + dip * outer + pad;
  const capsules = segments.map((s) => {
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    return {
      x1: cx + inner * cos,
      y1: cy - inner * sin,
      x2: cx + outer * cos,
      y2: cy - outer * sin,
      lit: s.lit,
      position: s.position,
    };
  });
  return { capsules, thickness, height };
}

function HabitGauge({ color, progress, size, className, ariaLabel }: HabitGaugeProps) {
  const { capsules, thickness, height } = useMemo(() => buildLayout(size, progress), [size, progress]);
  return (
    <svg
      className={className}
      width={size}
      height={height}
      viewBox={`0 0 ${size} ${height}`}
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
