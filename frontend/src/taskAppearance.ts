import type { TaskColorAnimation } from './types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LEGACY_DIRECTIONS: Record<string, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

export const DEFAULT_FLOW_COLORS = ['#3498db', '#7c4dff', '#00d4ff'];
export const DEFAULT_FLOW_DURATION_SEC = 6;

function safeColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function normalizeDirection(value: unknown): number {
  if (typeof value === 'string' && value in LEGACY_DIRECTIONS) {
    return LEGACY_DIRECTIONS[value];
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
}

export function normalizeTaskColorAnimation(
  animation: TaskColorAnimation | null | undefined,
  baseColor: string
): TaskColorAnimation | null {
  if (!animation || animation.type !== 'flow') return null;
  const fallback = safeColor(baseColor, DEFAULT_FLOW_COLORS[0]);
  const colors = (Array.isArray(animation.colors) ? animation.colors : [])
    .slice(0, 5)
    .map((color) => safeColor(color, fallback));
  if (colors.length < 2) return null;
  const direction = normalizeDirection(animation.direction);
  const durationSec = Number.isFinite(animation.durationSec)
    ? Math.min(20, Math.max(2, animation.durationSec))
    : DEFAULT_FLOW_DURATION_SEC;
  return { type: 'flow', colors, direction, durationSec };
}

export function taskColorAnimationClass(
  animation: TaskColorAnimation | null | undefined
): string {
  return animation?.type === 'flow' ? 'task-color-flow' : '';
}

export function taskColorStyle(
  baseColor: string,
  animation: TaskColorAnimation | null | undefined
): Record<string, string> {
  const safeBase = safeColor(baseColor, DEFAULT_FLOW_COLORS[0]);
  const normalized = normalizeTaskColorAnimation(animation, safeBase);
  if (!normalized) return { '--task-color': safeBase };
  // CSS gradient angles use 0° for up; the editor uses the more intuitive
  // screen-space convention where 0° points right.
  const angle = (normalized.direction + 90) % 360;
  const cycle = [...normalized.colors, normalized.colors[0]];
  const percent = (value: number) => `${Number(value.toFixed(3))}%`;
  // Moving every stop by one complete repeating-gradient period gives a
  // seamless loop at any angle, including diagonals.
  const stops = cycle
    .map(
      (color, index) =>
        `${color} calc(var(--task-flow-phase) + ${percent(
          (index / (cycle.length - 1)) * 100
        )})`
    )
    .join(', ');
  return {
    '--task-color': safeBase,
    '--task-gradient': `repeating-linear-gradient(${angle}deg, ${stops})`,
    '--task-flow-duration': `${normalized.durationSec}s`,
  };
}
