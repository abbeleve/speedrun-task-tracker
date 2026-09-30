import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HabitGauge from './HabitGauge';
import { RacePlot, WavePlot } from './ActivityCharts';
import type { WaveDay } from './ActivityCharts';

// The charts are drawn by hand in SVG; these render them to markup and check
// the pieces are there and every coordinate is a real number.

const H = 3600;
const hover = { onEnter: () => {}, onMove: () => {}, onLeave: () => {} };
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('HabitGauge', () => {
  it('draws 13 capsules and lights them up to the progress', () => {
    const html = renderToStaticMarkup(<HabitGauge color="#3498db" progress={0.5} size={260} />);
    expect(count(html, '<line')).toBe(13);
    expect(count(html, 'color-mix(in srgb, #3498db')).toBe(6);
    expect(html).not.toContain('NaN');
  });

  it('keeps the stubby capsules of the reference design', () => {
    const html = renderToStaticMarkup(<HabitGauge color="#3498db" progress={1} size={260} />);
    const [x1, y1, x2, y2, thickness] = ['x1', 'y1', 'x2', 'y2', 'stroke-width'].map((a) =>
      Number(new RegExp(`${a}="([-\\d.e]+)"`).exec(html)?.[1])
    );
    // Round caps add half the thickness at each end.
    const length = Math.hypot(x2 - x1, y2 - y1) + thickness;
    expect(thickness).toBeGreaterThan(14);
    expect(length / thickness).toBeCloseTo(2.3, 1);
  });

  it('is drawn at its own pixel size, cropped to the fan', () => {
    const html = renderToStaticMarkup(<HabitGauge color="#3498db" progress={1} size={260} />);
    const width = Number(/width="([\d.]+)"/.exec(html)?.[1]);
    const height = Number(/height="([\d.]+)"/.exec(html)?.[1]);
    expect(width).toBeGreaterThan(250);
    expect(width).toBeLessThanOrEqual(262);
    // A little more than the fan's radius, since its ends dip below the
    // centre line — but nowhere near a square canvas.
    expect(height).toBeGreaterThan(130);
    expect(height).toBeLessThan(260 * 0.7);
  });
});

describe('RacePlot', () => {
  const series = [
    { name: 'Эта неделя', values: [2 * H, 3 * H, 1 * H, null, null, null, null] },
    { name: 'Прошлая', values: [1 * H, 1 * H, 1 * H, 2 * H, 0, 0, 0] },
    { name: 'Позапрошлая', values: [0, 0, 0, 0, 0, 0, 0] },
  ];
  const xLabels = ['Пн 29', 'Вт 30', 'Ср 1', 'Чт 2', 'Пт 3', 'Сб 4', 'Вс 5'];

  it('draws each period, the rule and a marker per line at the last day reached', () => {
    const html = renderToStaticMarkup(
      <RacePlot
        width={640}
        series={series}
        xLabels={xLabels}
        today={2}
        span="week"
        kind="duration"
        unit=""
        tooltips={xLabels}
        hover={hover}
      />
    );
    expect(html).not.toContain('NaN');
    expect(count(html, 'act-race-past')).toBe(2);
    expect(count(html, 'act-race-now')).toBe(1);
    expect(count(html, 'act-race-cursor')).toBe(1);
    expect(count(html, 'act-race-marker')).toBe(3);
    // Running totals by Wednesday: 6 h, 3 h and nothing.
    expect(html).toContain('>6ч<');
    expect(html).toContain('>3ч<');
    expect(html).toContain('>0м<');
    // Ahead of last week all along: every stop of the line is green.
    expect(count(html, 'stop-color:var(--accent-green)')).toBe(3);
    // Every date fits at this width; today's is set apart.
    expect(count(html, 'act-date')).toBe(7);
    expect(html).toContain('act-date today');
  });

  it('draws no current line for a period not reached yet', () => {
    const html = renderToStaticMarkup(
      <RacePlot
        width={640}
        series={[{ name: 'Следующая', values: Array(7).fill(null) }, ...series.slice(0, 2)]}
        xLabels={xLabels}
        today={null}
        span="week"
        kind="duration"
        unit=""
        tooltips={xLabels}
        hover={hover}
      />
    );
    expect(html).not.toContain('NaN');
    expect(count(html, 'act-race-now')).toBe(0);
    expect(count(html, 'act-race-marker')).toBe(0);
  });
});

describe('WavePlot', () => {
  const days: WaveDay[] = [
    { value: 8, reference: 10, hit: false },
    { value: 12, reference: 10, hit: true },
    { value: 10, reference: 10, hit: true },
    { value: 3, reference: 15, hit: false },
    { value: 15, reference: 15, hit: true },
    { value: null, reference: 15, hit: false },
    { value: null, reference: 15, hit: false },
  ];
  const xLabels = ['Пн 29', 'Вт 30', 'Ср 1', 'Чт 2', 'Пт 3', 'Сб 4', 'Вс 5'];

  it('draws the curve, the reference and one underline per run of hits', () => {
    const html = renderToStaticMarkup(
      <WavePlot
        width={640}
        days={days}
        xLabels={xLabels}
        today={4}
        span="week"
        kind="count"
        unit="раз"
        color="#9b59b6"
        name="Отжимания"
        referenceLabel="норма"
        hitLabel="норма выполнена"
        tooltips={xLabels}
        hover={hover}
      />
    );
    expect(html).not.toContain('NaN');
    expect(count(html, 'act-wave-line')).toBe(1);
    expect(count(html, 'act-wave-reference"')).toBe(1);
    expect(count(html, 'act-wave-hit-bar')).toBe(2);
    expect(count(html, 'act-wave-hit-dots')).toBe(2);
    expect(count(html, 'act-wave-today')).toBe(1);
    // A count axis carries its unit; ticks stop at the first round value
    // covering the peak (15).
    expect(html).toContain('>раз<');
    expect(html).toContain('>15<');
    expect(html).not.toContain('>20<');
  });

  it('copes with a month where nothing has happened yet', () => {
    const empty: WaveDay[] = Array.from({ length: 30 }, () => ({ value: null, reference: null, hit: false }));
    const html = renderToStaticMarkup(
      <WavePlot
        width={320}
        days={empty}
        xLabels={empty.map((_, i) => String(i + 1))}
        today={null}
        span="month"
        kind="duration"
        unit=""
        color="var(--accent-purple)"
        name="Работа"
        referenceLabel="средний рабочий день"
        hitLabel="не меньше среднего"
        tooltips={empty.map(() => '')}
        hover={hover}
      />
    );
    expect(html).not.toContain('NaN');
    expect(count(html, 'act-wave-line')).toBe(0);
    // Too narrow for 30 dates: only round days are labelled.
    expect(count(html, 'act-date')).toBeLessThan(10);
  });
});
