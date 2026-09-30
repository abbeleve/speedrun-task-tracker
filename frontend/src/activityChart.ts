// Pure helpers for the activity card's week / month charts. Besides the
// original bars there are two line charts:
//   • race — running totals of the period and the two before it, one line
//            each, so "am I ahead of last week by this day?" is read straight
//            off the chart. The current line is green where it is ahead of the
//            period before, red where it is behind.
//   • wave — the daily values as a smooth curve, with the days that reached
//            the reference (the habit's quota, or an average working day)
//            dotted in under the curve and underlined on the date axis.

export type ActivityChart = 'bars' | 'race' | 'wave';

export const ACTIVITY_CHARTS: { value: ActivityChart; label: string }[] = [
  { value: 'bars', label: 'Столбцы' },
  { value: 'race', label: 'Нарастающий итог против прошлых периодов' },
  { value: 'wave', label: 'Кривая по дням' },
];

// A stored choice this client does not know falls back to the bars.
export function activityChartOf(raw: unknown): ActivityChart {
  return raw === 'race' || raw === 'wave' ? raw : 'bars';
}

// What a chart's numbers are: seconds of time (work, time habits) or a plain
// count of units (count habits).
export type ValueKind = 'duration' | 'count';

const MIN = 60;
const HOUR = 3600;
const DURATION_STEPS = [5, 10, 15, 30].map((m) => m * MIN).concat([1, 2, 3, 4, 6, 8, 12].map((h) => h * HOUR));

// The step between axis ticks: the smallest round step that covers `max` in
// at most `maxTicks` intervals. Durations step through clock-friendly sizes
// (15 min, 1 h, 6 h, …), counts through 1 / 2 / 5 × 10ⁿ.
function tickStep(max: number, kind: ValueKind, maxTicks: number): number {
  if (kind === 'duration') {
    for (const step of DURATION_STEPS) if (max / step <= maxTicks) return step;
    return decimalStep(max / (24 * HOUR), maxTicks) * 24 * HOUR;
  }
  return decimalStep(max, maxTicks);
}

function decimalStep(max: number, maxTicks: number): number {
  for (let exp = 0; ; exp++) {
    for (const base of [1, 2, 5]) {
      const step = base * 10 ** exp;
      if (max / step <= maxTicks) return step;
    }
  }
}

// Axis ticks from 0 up to the first round value at or above `max`. An empty
// chart still gets a readable scale instead of a single 0.
export function niceTicks(max: number, kind: ValueKind, maxTicks = 4): number[] {
  const top = max > 0 ? max : kind === 'duration' ? HOUR : 4;
  const step = tickStep(top, kind, maxTicks);
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

// "45м", "2ч", "1ч 30м" for durations; counts with a thin space between
// thousands ("1 250") and at most two decimals, written like the habit
// cards write them ("2.5").
export function fmtChartValue(value: number, kind: ValueKind): string {
  if (kind === 'duration') {
    const totalMin = Math.round(value / MIN);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}м`;
    return m === 0 ? `${h}ч` : `${h}ч ${m}м`;
  }
  const rounded = Math.round(value * 100) / 100;
  const [int, frac] = String(rounded).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped}.${frac}` : grouped;
}

// Running totals. A missing day (one still in the future) stays missing, and
// the total carries on past it unchanged.
export function cumulative(values: (number | null)[]): (number | null)[] {
  let sum = 0;
  return values.map((v) => {
    if (v === null) return null;
    sum += v;
    return sum;
  });
}

// The last index that has a value, or -1.
export function lastIndexWithValue(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return -1;
}

// A line's running total on day `i`. A shorter period (February against
// March) has finished by then, so its final total stands; a day it has not
// reached yet has no value.
export function valueOnDay(totals: (number | null)[], i: number): number | null {
  if (totals.length === 0) return null;
  return i < totals.length ? totals[i] : totals[totals.length - 1];
}

export type Pace = 'ahead' | 'even' | 'behind';

// Where one running total stands against another. Within `tolerance` (a share
// of the larger of the two) they count as level, so a few minutes' difference
// on a long day does not flip the colour back and forth.
export function paceStatus(current: number, previous: number, tolerance = 0.05): Pace {
  const scale = Math.max(Math.abs(current), Math.abs(previous));
  if (scale === 0 || Math.abs(current - previous) <= tolerance * scale) return 'even';
  return current > previous ? 'ahead' : 'behind';
}

// Runs of consecutive `true` days, as inclusive index ranges.
export function highlightRanges(flags: boolean[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  flags.forEach((flag, i) => {
    if (!flag) return;
    const last = out[out.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else out.push({ from: i, to: i });
  });
  return out;
}

// The mean of the days that had any activity — an average *working* day, so
// days off do not drag the bar the other days are measured against down to
// nothing. null when nothing was done at all.
export function activeAverage(values: (number | null)[]): number | null {
  const active = values.filter((v): v is number => v !== null && v > 0);
  if (active.length === 0) return null;
  return active.reduce((a, b) => a + b, 0) / active.length;
}

// Which days get a date label on the axis, given the px between neighbouring
// days. Every day when they fit; otherwise every 2nd, 5th or 10th day of the
// month (the 1st too, once the step is wide enough to leave room for it).
// `pinned` — today — is always labelled, and neighbours it would crowd out
// give way to it.
export function axisLabelIndices(
  count: number,
  spacing: number,
  minSpacing: number,
  pinned: number | null = null
): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  let picked = all;
  if (spacing < minSpacing) {
    const every = [2, 5, 10, 15].find((k) => k * spacing >= minSpacing) ?? 15;
    picked = all.filter((i) => (i + 1) % every === 0 || (i === 0 && every >= 5));
  }
  if (pinned !== null && pinned >= 0 && pinned < count && !picked.includes(pinned)) {
    picked = [...picked.filter((i) => Math.abs(i - pinned) * spacing >= minSpacing), pinned].sort(
      (a, b) => a - b
    );
  }
  return picked;
}

// Nudges label positions (y, in px) apart so no two are closer than `gap`,
// keeping their order and staying inside [top, bottom]. Returned in the order
// the positions were given.
export function spreadLabels(ys: number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 0; k < order.length; k++) {
    const floor = k === 0 ? top : order[k - 1].y + gap;
    order[k].y = Math.max(order[k].y, floor);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const ceil = k === order.length - 1 ? bottom : order[k + 1].y - gap;
    order[k].y = Math.max(top, Math.min(order[k].y, ceil));
  }
  const out = new Array<number>(ys.length);
  for (const { y, i } of order) out[i] = y;
  return out;
}

export interface Point {
  x: number;
  y: number;
}

// An SVG path through the points as a monotone cubic (Fritsch–Carlson): smooth
// like the reference designs, but it never swings past a point — a running
// total never appears to dip, and a day of zero never draws below the axis.
export function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (n === 1) return `M${f(points[0].x)},${f(points[0].y)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]);
  }
  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangent[i] = tau * a * slope[i];
      tangent[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const h = dx[i] / 3;
    d += `C${f(p.x + h)},${f(p.y + tangent[i] * h)},${f(q.x - h)},${f(q.y - tangent[i + 1] * h)},${f(q.x)},${f(q.y)}`;
  }
  return d;
}
