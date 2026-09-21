import { describe, expect, it } from 'vitest';
import {
  SEQUENCE_GRADIENT_PRESETS,
  isSequenceGradient,
  makeSequenceGradient,
  randomSequenceGradient,
  sequenceGradientColors,
  sequenceGradientForTasks,
} from './sequenceGradients';

describe('sequence gradients', () => {
  it('creates and parses a safe custom gradient', () => {
    const gradient = makeSequenceGradient('#AABBCC', '#112233');
    expect(gradient).toBe('linear-gradient(180deg, #aabbcc, #112233)');
    expect(sequenceGradientColors(gradient)).toEqual(['#aabbcc', '#112233']);
    expect(isSequenceGradient(gradient)).toBe(true);
  });

  it('falls back to safe preset colours for invalid custom values', () => {
    const gradient = makeSequenceGradient('red', 'url(example)');
    expect(sequenceGradientColors(gradient)).toEqual([
      SEQUENCE_GRADIENT_PRESETS[0].start,
      SEQUENCE_GRADIENT_PRESETS[0].end,
    ]);
  });

  it('uses a saved task gradient and otherwise picks a stable preset', () => {
    const saved = SEQUENCE_GRADIENT_PRESETS[2].value;
    expect(sequenceGradientForTasks([{ sequenceGradient: saved }], 'session-1')).toBe(saved);

    const first = sequenceGradientForTasks([], 'legacy-session');
    expect(sequenceGradientForTasks([], 'legacy-session')).toBe(first);
    expect(SEQUENCE_GRADIENT_PRESETS.map((preset) => preset.value)).toContain(first);
  });

  it('randomizes to another preset', () => {
    const current = SEQUENCE_GRADIENT_PRESETS[0].value;
    const next = randomSequenceGradient(current, () => 0);
    expect(next).not.toBe(current);
    expect(SEQUENCE_GRADIENT_PRESETS.map((preset) => preset.value)).toContain(next);
  });
});
