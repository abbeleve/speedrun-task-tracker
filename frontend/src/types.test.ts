import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI, TASK_EMOJIS, resolveTaskEmoji } from './types';

describe('resolveTaskEmoji', () => {
  it('keeps a chosen emoji as-is', () => {
    expect(resolveTaskEmoji('🚀')).toBe('🚀');
  });

  it('replaces the default square with a random task emoji', () => {
    const result = resolveTaskEmoji(DEFAULT_EMOJI);
    expect(result).not.toBe(DEFAULT_EMOJI);
    expect(TASK_EMOJIS).toContain(result);
  });

  it('replaces an empty emoji with a random task emoji', () => {
    const result = resolveTaskEmoji('');
    expect(result).not.toBe(DEFAULT_EMOJI);
    expect(TASK_EMOJIS).toContain(result);
  });

  it('only ever returns emojis from the task set', () => {
    for (let i = 0; i < 50; i++) {
      expect(TASK_EMOJIS).toContain(resolveTaskEmoji(DEFAULT_EMOJI));
    }
  });
});
