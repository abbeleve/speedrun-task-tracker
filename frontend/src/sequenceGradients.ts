import type { Task } from './types';

export interface SequenceGradientPreset {
  id: string;
  name: string;
  start: string;
  end: string;
  value: string;
}

function gradientValue(start: string, end: string): string {
  return `linear-gradient(180deg, ${start}, ${end})`;
}

const PRESET_COLORS = [
  ['aurora', 'Аврора', '#00d4ff', '#7c4dff'],
  ['sunset', 'Закат', '#ff5f6d', '#ffb347'],
  ['forest', 'Лес', '#2ecc71', '#0f766e'],
  ['ocean', 'Океан', '#38bdf8', '#2563eb'],
  ['ember', 'Жар', '#facc15', '#ef4444'],
  ['berry', 'Ягоды', '#c084fc', '#ec4899'],
  ['mint', 'Мята', '#5eead4', '#22c55e'],
  ['night', 'Ночь', '#818cf8', '#312e81'],
] as const;

export const SEQUENCE_GRADIENT_PRESETS: SequenceGradientPreset[] = PRESET_COLORS.map(
  ([id, name, start, end]) => ({ id, name, start, end, value: gradientValue(start, end) })
);

const GRADIENT_RE = /^linear-gradient\(180deg,\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function makeSequenceGradient(start: string, end: string): string {
  const safeStart = HEX_RE.test(start) ? start.toLowerCase() : SEQUENCE_GRADIENT_PRESETS[0].start;
  const safeEnd = HEX_RE.test(end) ? end.toLowerCase() : SEQUENCE_GRADIENT_PRESETS[0].end;
  return gradientValue(safeStart, safeEnd);
}

export function sequenceGradientColors(value: string | null | undefined): [string, string] {
  const match = value?.match(GRADIENT_RE);
  return match
    ? [match[1].toLowerCase(), match[2].toLowerCase()]
    : [SEQUENCE_GRADIENT_PRESETS[0].start, SEQUENCE_GRADIENT_PRESETS[0].end];
}

export function isSequenceGradient(value: unknown): value is string {
  return typeof value === 'string' && GRADIENT_RE.test(value);
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

// A saved choice wins. Older sessions have no field yet, so they get a stable
// preset based on their id instead of changing colour on every render.
export function sequenceGradientForTasks(
  tasks: Pick<Task, 'sequenceGradient'>[],
  seed: string
): string {
  const saved = tasks.find((task) => isSequenceGradient(task.sequenceGradient))?.sequenceGradient;
  if (saved) return saved;
  return SEQUENCE_GRADIENT_PRESETS[hashSeed(seed) % SEQUENCE_GRADIENT_PRESETS.length].value;
}

export function randomSequenceGradient(current: string, random = Math.random): string {
  const choices = SEQUENCE_GRADIENT_PRESETS.filter((preset) => preset.value !== current);
  const pool = choices.length > 0 ? choices : SEQUENCE_GRADIENT_PRESETS;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  return pool[index].value;
}
