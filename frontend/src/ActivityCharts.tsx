// The activity card's two line charts for the week / month slices (the bars
// stay in StatsPage). Both are plain SVG drawn at the measured width of their
// box, so text and markers keep their size instead of stretching with it.
//   RaceChart — running totals of the period in view and the two before it.
//   WaveChart — the period's daily values as one smooth curve.
// See activityChart.ts for the maths and what each colour means.

import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import {
  axisLabelIndices,
  cumulative,
  fmtChartValue,
  highlightRanges,
  lastIndexWithValue,
  monotonePath,
  niceTicks,
  paceStatus,
  spreadLabels,
  valueOnDay,
} from './activityChart';
import type { Pace, Point, ValueKind } from './activityChart';

const HEIGHT = 240;
const MARGIN = { top: 26, right: 18, bottom: 30, left: 54 };
// The narrowest gap, in px, that still fits one date label beside the next.
const MIN_LABEL_GAP = { week: 44, month: 22 } as const;

const PACE_COLOR: Record<Pace, string> = {
  ahead: 'var(--accent-green)',
  even: 'var(--accent-gold)',
  behind: 'var(--accent-red)',
};

interface HoverHandlers {
  onEnter: (e: { clientX: number; clientY: number }, text: string) => void;
  onMove: (e: { clientX: number; clientY: number }) => void;
  onLeave: () => void;
}

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// The frame both charts share: where day i and value v land, the value axis
// ticks, and which date labels fit.
function useFrame(width: number, days: number, max: number, kind: ValueKind, span: 'week' | 'month', today: number | null) {
  return useMemo(() => {
    const plotW = Math.max(1, width - MARGIN.left - MARGIN.right);
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const step = days > 1 ? plotW / (days - 1) : plotW;
    const ticks = niceTicks(max, kind);
    const top = ticks[ticks.length - 1];
    const x = (i: number) => MARGIN.left + (days > 1 ? i * step : plotW / 2);
    const y = (v: number) => MARGIN.top + plotH * (1 - v / top);
    const labels = axisLabelIndices(days, step, MIN_LABEL_GAP[span], today);
    return { x, y, step, ticks, labels, base: MARGIN.top + plotH, right: MARGIN.left + plotW };
  }, [width, days, max, kind, span, today]);
}

type Frame = ReturnType<typeof useFrame>;

// Value ticks on the left with faint rules across, date labels underneath.
// Today's date is set in bold.
function Axes({ frame, kind, unit, xLabels, today, dashed }: {
  frame: Frame;
  kind: ValueKind;
  unit: string;
  xLabels: string[];
  today: number | null;
  dashed: boolean;
}) {
  return (
    <g className="act-axes">
      {frame.ticks.map((t) => (
        <g key={t}>
          <line
            className="act-grid"
            x1={MARGIN.left}
            x2={frame.right}
            y1={frame.y(t)}
            y2={frame.y(t)}
            strokeDasharray={dashed ? '2 5' : undefined}
          />
          <text className="act-tick" x={MARGIN.left - 10} y={frame.y(t) + 4} textAnchor="end">
            {fmtChartValue(t, kind)}
          </text>
        </g>
      ))}
      {kind === 'count' && unit && (
        <text className="act-tick act-unit" x={MARGIN.left - 10} y={MARGIN.top - 12} textAnchor="end">
          {unit}
        </text>
      )}
      {frame.labels.map((i) => (
        <g key={i}>
          {dashed && (
            <line className="act-grid" x1={frame.x(i)} x2={frame.x(i)} y1={MARGIN.top} y2={frame.base} strokeDasharray="2 5" />
          )}
          <text
            className={`act-tick act-date${i === today ? ' today' : ''}`}
            x={frame.x(i)}
            y={HEIGHT - 8}
            textAnchor="middle"
          >
            {xLabels[i]}
          </text>
        </g>
      ))}
    </g>
  );
}

// Invisible day columns over the plot: each shows its tooltip and a faint band.
function HitColumns({ frame, count, tooltips, hover }: {
  frame: Frame;
  count: number;
  tooltips: string[];
  hover: HoverHandlers;
}) {
  const half = frame.step / 2;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const x0 = Math.max(MARGIN.left - 6, frame.x(i) - half);
        const x1 = Math.min(frame.right + 6, frame.x(i) + half);
        return (
          <rect
            key={i}
            className="act-hit"
            x={x0}
            y={MARGIN.top}
            width={Math.max(0, x1 - x0)}
            height={frame.base - MARGIN.top}
            onMouseEnter={(e) => tooltips[i] && hover.onEnter(e, tooltips[i])}
            onMouseMove={hover.onMove}
            onMouseLeave={hover.onLeave}
          />
        );
      })}
    </g>
  );
}

export interface RaceSeries {
  name: string; // legend label, e.g. "29 сен – 5 окт" or "Сентябрь"
  values: (number | null)[]; // one per day; null for a day not reached yet
}

// Running totals racing each other: the period in view in colour, the two
// before it in grey. Where the coloured line is ahead of the one before it
// it is green, level is gold, behind is red, blended between days. A rule
// stands at the last day reached, with each line's total there marked and
// written out, so the lead reads as a number too.
interface RaceProps {
  series: RaceSeries[]; // [the period in view, the one before, the one before that]
  xLabels: string[]; // one per day of the longest period
  today: number | null; // today's index in the period in view, if it is in it
  span: 'week' | 'month';
  kind: ValueKind;
  unit: string;
  tooltips: string[];
  hover: HoverHandlers;
}

export const RaceChart = memo(function RaceChart(props: RaceProps) {
  const [ref, width] = useWidth();
  return (
    <div className="act-chart">
      <div className="act-chart-canvas" ref={ref}>
        {width > 0 && <RacePlot {...props} width={width} />}
      </div>
      <div className="act-legend">
        {props.series.map((s, i) => (
          <span key={i} className={`act-legend-item s${i}`}>
            <i className="act-legend-swatch" aria-hidden />
            {s.name}
          </span>
        ))}
        <span className="act-legend-note">зелёный — впереди прошлого периода, красный — позади</span>
      </div>
    </div>
  );
});

// The race's SVG at a given width.
export function RacePlot({ width, series, xLabels, today, span, kind, unit, tooltips, hover }: RaceProps & { width: number }) {
  const uid = useId().replace(/:/g, '');
  const totals = useMemo(() => series.map((s) => cumulative(s.values)), [series]);
  const max = useMemo(
    () => Math.max(0, ...totals.flat().filter((v): v is number => v !== null)),
    [totals]
  );
  const days = xLabels.length;
  const frame = useFrame(width, days, max, kind, span, today);

  const cursor = totals.length > 0 ? lastIndexWithValue(totals[0]) : -1;
  const lines = totals.map((t) =>
    monotonePath(
      t.flatMap((v, i) => (v === null ? [] : [{ x: frame.x(i), y: frame.y(v) } as Point]))
    )
  );
  const paces = cursor < 0
    ? []
    : totals[0].slice(0, cursor + 1).map((v, i) =>
        paceStatus(v ?? 0, totals[1] ? valueOnDay(totals[1], i) ?? 0 : 0)
      );

  const markers = cursor < 0
    ? []
    : totals.flatMap((t, s) => {
        const v = valueOnDay(t, cursor);
        return v === null ? [] : [{ s, v, y: frame.y(v) }];
      });
  const labelYs = spreadLabels(
    markers.map((m) => m.y - 11),
    15,
    MARGIN.top - 12,
    frame.base - 6
  );
  const cursorX = cursor < 0 ? 0 : frame.x(cursor);
  const labelsLeft = cursorX - MARGIN.left > 80;
  const gradientId = `race-pace-${uid}`;
  const glowId = `race-glow-${uid}`;
  const unitSuffix = kind === 'count' && unit ? ` ${unit}` : '';

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="Нарастающий итог по дням против двух прошлых периодов">
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={frame.x(0)}
          x2={cursor > 0 ? frame.x(cursor) : frame.x(0) + 1}
          y1={0}
          y2={0}
        >
          {paces.map((p, i) => (
            <stop
              key={i}
              offset={cursor > 0 ? i / cursor : 0}
              style={{ stopColor: PACE_COLOR[p] }}
            />
          ))}
        </linearGradient>
        <filter id={glowId} filterUnits="userSpaceOnUse" x={0} y={0} width={width} height={HEIGHT}>
          <feGaussianBlur stdDeviation={7} />
        </filter>
      </defs>

      <Axes frame={frame} kind={kind} unit={unit} xLabels={xLabels} today={today} dashed />

      {lines.slice(1).reverse().map((d, k) => {
        const s = lines.length - 1 - k;
        return <path key={s} className={`act-race-past s${s}`} d={d} />;
      })}

      {cursor >= 0 && (
        <>
          <path
            className="act-race-glow act-draw"
            d={lines[0]}
            stroke={`url(#${gradientId})`}
            filter={`url(#${glowId})`}
            pathLength={1}
          />
          <path className="act-race-now act-draw" d={lines[0]} stroke={`url(#${gradientId})`} pathLength={1} />
          <line className="act-race-cursor" x1={cursorX} x2={cursorX} y1={MARGIN.top - 16} y2={frame.base} />
          {markers.map((m, k) => (
            <g key={m.s}>
              <circle
                className={`act-race-marker s${m.s}`}
                cx={cursorX}
                cy={m.y}
                r={5}
                style={m.s === 0 ? ({ stroke: PACE_COLOR[paces[cursor]] } as CSSProperties) : undefined}
              />
              <text
                className={`act-race-value s${m.s}`}
                x={labelsLeft ? cursorX - 9 : cursorX + 10}
                y={labelYs[k]}
                textAnchor={labelsLeft ? 'end' : 'start'}
              >
                {fmtChartValue(m.v, kind)}
                {unitSuffix}
              </text>
            </g>
          ))}
        </>
      )}

      <HitColumns frame={frame} count={days} tooltips={tooltips} hover={hover} />
    </svg>
  );
}

export interface WaveDay {
  value: number | null; // null for a day not reached yet
  reference: number | null; // the day's quota / the average working day
  hit: boolean; // reached the reference
}

// The daily values as one smooth curve over a soft wash of its colour. Days
// that reached the reference are dotted in under the curve and underlined on
// the date axis; the reference itself is a dashed line.
interface WaveProps {
  days: WaveDay[];
  xLabels: string[];
  today: number | null;
  span: 'week' | 'month';
  kind: ValueKind;
  unit: string;
  color: string;
  name: string; // what the curve is: "Работа" or the habit
  referenceLabel: string;
  hitLabel: string;
  tooltips: string[];
  hover: HoverHandlers;
}

export const WaveChart = memo(function WaveChart(props: WaveProps) {
  const [ref, width] = useWidth();
  return (
    <div className="act-chart" style={{ '--act-color': props.color } as CSSProperties}>
      <div className="act-chart-canvas" ref={ref}>
        {width > 0 && <WavePlot {...props} width={width} />}
      </div>
      <div className="act-legend">
        <span className="act-legend-item act-legend-line">
          <i className="act-legend-swatch" aria-hidden />
          {props.name}
        </span>
        <span className="act-legend-item act-legend-dots">
          <i className="act-legend-swatch" aria-hidden />
          {props.hitLabel}
        </span>
        <span className="act-legend-item act-legend-reference">
          <i className="act-legend-swatch" aria-hidden />
          {props.referenceLabel}
        </span>
      </div>
    </div>
  );
});

// The wave's SVG at a given width.
export function WavePlot({ width, days, xLabels, today, span, kind, unit, color, name, referenceLabel, tooltips, hover }: WaveProps & { width: number }) {
  const uid = useId().replace(/:/g, '');
  const max = useMemo(
    () => Math.max(0, ...days.flatMap((d) => [d.value ?? 0, d.reference ?? 0])),
    [days]
  );
  const frame = useFrame(width, days.length, max, kind, span, today);

  const last = lastIndexWithValue(days.map((d) => d.value));
  const points: Point[] = days
    .slice(0, last + 1)
    .map((d, i) => ({ x: frame.x(i), y: frame.y(d.value ?? 0) }));
  const line = monotonePath(points);
  const area = points.length > 1
    ? `${line}L${points[points.length - 1].x},${frame.base}L${points[0].x},${frame.base}Z`
    : '';
  const half = frame.step / 2;
  const ranges = highlightRanges(days.map((d, i) => d.hit && i <= last)).map((r) => ({
    x0: Math.max(frame.x(0), frame.x(r.from) - half),
    x1: Math.min(frame.x(Math.max(0, last)), frame.x(r.to) + half),
  }));

  // The reference as a step line: each day's level held across its own
  // column, stepping at the midpoints between days.
  let reference = '';
  days.forEach((d, i) => {
    if (d.reference === null) return;
    const y = frame.y(d.reference);
    const x0 = i === 0 ? frame.x(0) : frame.x(i) - half;
    const x1 = i === days.length - 1 ? frame.right : frame.x(i) + half;
    reference += `${reference && days[i - 1]?.reference !== null ? 'L' : 'M'}${x0},${y}L${x1},${y}`;
  });
  const lastRef = [...days].reverse().find((d) => d.reference !== null)?.reference ?? null;

  const areaId = `wave-area-${uid}`;
  const dotsId = `wave-dots-${uid}`;
  const clipId = `wave-clip-${uid}`;
  const todayPoint = today !== null && today <= last ? points[today] : null;

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label={`${name} по дням`}>
      <defs>
        <linearGradient id={areaId} x1={0} x2={0} y1={0} y2={1}>
          <stop offset={0} style={{ stopColor: color, stopOpacity: 0.3 }} />
          <stop offset={1} style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
        <pattern id={dotsId} width={6} height={6} patternUnits="userSpaceOnUse">
          <circle cx={3} cy={3} r={1.1} style={{ fill: color }} />
        </pattern>
        {area && (
          <clipPath id={clipId}>
            <path d={area} />
          </clipPath>
        )}
      </defs>

      <Axes frame={frame} kind={kind} unit={unit} xLabels={xLabels} today={today} dashed={false} />

      {area && <path d={area} fill={`url(#${areaId})`} />}
      {area && ranges.map((r, k) => (
        <rect
          key={k}
          className="act-wave-hit-dots"
          x={r.x0}
          y={MARGIN.top}
          width={Math.max(0, r.x1 - r.x0)}
          height={frame.base - MARGIN.top}
          fill={`url(#${dotsId})`}
          clipPath={`url(#${clipId})`}
        />
      ))}
      {reference && <path className="act-wave-reference" d={reference} />}
      {reference && lastRef !== null && (
        <text className="act-tick act-wave-reference-label" x={frame.right} y={frame.y(lastRef) - 6} textAnchor="end">
          {referenceLabel}
        </text>
      )}
      {line && <path className="act-wave-line act-draw" d={line} pathLength={1} />}
      {ranges.map((r, k) => (
        <rect
          key={k}
          className="act-wave-hit-bar"
          x={r.x0 + 2}
          y={frame.base - 2}
          width={Math.max(4, r.x1 - r.x0 - 4)}
          height={4}
          rx={2}
        />
      ))}
      {todayPoint && <circle className="act-wave-today" cx={todayPoint.x} cy={todayPoint.y} r={4.5} />}

      <HitColumns frame={frame} count={days.length} tooltips={tooltips} hover={hover} />
    </svg>
  );
}
