import type { TaskColorAnimation, TaskFlowDirection } from './types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DIRECTIONS: TaskFlowDirection[] = ['right', 'left', 'down', 'up'];

export const DEFAULT_FLOW_COLORS = ['#3498db', '#7c4dff', '#00d4ff'];
export const DEFAULT_FLOW_DURATION_SEC = 6;

function safeColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeTaskColorAnimation(
  animation: TaskColorAnimation | null | undefined,
  baseColor: string
): TaskColorAnimation | null {
  if (!animation || animation.type !== 'flow') return null;
  const fallback = safeColor(baseColor, DEFAULT_FLOW_COLORS[0]);
  const colors = animation.colors
    .slice(0, 5)
    .map((color) => safeColor(color, fallback));
  if (colors.length < 2) return null;
  const direction = DIRECTIONS.includes(animation.direction) ? animation.direction : 'right';
  const durationSec = Number.isFinite(animation.durationSec)
    ? Math.min(20, Math.max(2, animation.durationSec))
    : DEFAULT_FLOW_DURATION_SEC;
  return { type: 'flow', colors, direction, durationSec };
}

export function taskColorAnimationClass(
  animation: TaskColorAnimation | null | undefined
): string {
  if (animation?.type !== 'flow') return '';
  const direction = DIRECTIONS.includes(animation.direction) ? animation.direction : 'right';
  return `task-color-flow task-color-flow--${direction}`;
}

export function taskColorStyle(
  baseColor: string,
  animation: TaskColorAnimation | null | undefined
): Record<string, string> {
  const safeBase = safeColor(baseColor, DEFAULT_FLOW_COLORS[0]);
  const normalized = normalizeTaskColorAnimation(animation, safeBase);
  if (!normalized) return { '--task-color': safeBase };
  const angle = normalized.direction === 'left' || normalized.direction === 'right' ? '90deg' : '180deg';
  const cycle = [...normalized.colors, normalized.colors[0]];
  const percent = (value: number) => `${Number(value.toFixed(3))}%`;
  // Two identical cycles fill a background twice the task's size. Moving it by
  // exactly one task length then lands on the same colors, so the loop has no
  // visible jump when it starts over.
  const stops = [
    ...cycle.map(
      (color, index) => `${color} ${percent((index / (cycle.length - 1)) * 50)}`
    ),
    ...cycle.slice(1).map(
      (color, index) =>
        `${color} ${percent(50 + ((index + 1) / (cycle.length - 1)) * 50)}`
    ),
  ].join(', ');
  return {
    '--task-color': safeBase,
    '--task-gradient': `linear-gradient(${angle}, ${stops})`,
    '--task-flow-duration': `${normalized.durationSec}s`,
  };
}
