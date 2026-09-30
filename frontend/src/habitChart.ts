// Pure helpers for the two ways a habit card can draw today's progress (see
// HabitChart): the dotted arc (HabitDial) and the capsule gauge (HabitGauge).

import type { Habit, HabitChart } from './types';

export const HABIT_CHARTS: { value: HabitChart; label: string }[] = [
  { value: 'dots', label: 'Точки' },
  { value: 'gauge', label: 'Шкала' },
];

// The chart a habit's card draws. Habits saved before the choice existed (or
// carrying a value this client does not know) keep the original dots.
export function habitChartOf(habit: Habit): HabitChart {
  return habit.chart === 'gauge' ? 'gauge' : 'dots';
}

// A day's progress as a whole percentage of that day's quota. Not clamped —
// 130% is a real read-out — but never negative, and 0 without a quota.
export function habitPercent(value: number, target: number): number {
  return target > 0 ? Math.round(Math.max(0, value / target) * 100) : 0;
}

// The gauge is a fan of capsules a little wider than a half circle, so its two
// lowest capsules frame the number between them.
export const GAUGE_SEGMENTS = 13;
export const GAUGE_SWEEP_DEG = 200;

export interface GaugeSegment {
  // Radians in the usual math orientation: 0 points right, π/2 straight up.
  angle: number;
  lit: boolean;
  // 0 at the first capsule … 1 at the last. The capsules fade along the sweep,
  // so the arc reads as having a direction rather than as a flat band.
  position: number;
}

// Capsules from the lower left, over the top, to the lower right. Only whole
// capsules light up, so the gauge never looks full before the quota is met.
export function gaugeSegments(
  count: number,
  progress: number,
  sweepDeg: number = GAUGE_SWEEP_DEG
): GaugeSegment[] {
  if (count <= 0) return [];
  const clamped = Math.max(0, Math.min(1, progress));
  const lit = Math.floor(clamped * count + 1e-6);
  const sweep = (sweepDeg * Math.PI) / 180;
  const start = Math.PI / 2 + sweep / 2;
  return Array.from({ length: count }, (_, i) => {
    const position = count === 1 ? 0 : i / (count - 1);
    return { angle: start - position * sweep, lit: i < lit, position };
  });
}

export interface GaugeStatus {
  done: boolean;
  text: string;
}

// The pill inside the gauge: either the quota is met, or how much of it is
// still left today. No pill at all for a habit without a quota.
export function gaugeStatus(value: number, target: number, unit: string): GaugeStatus | null {
  if (target <= 0) return null;
  if (value >= target) return { done: true, text: 'Норма выполнена' };
  const left = Math.round((target - value) * 100) / 100;
  return { done: false, text: `Ещё ${left}${unit ? ` ${unit}` : ''}` };
}
