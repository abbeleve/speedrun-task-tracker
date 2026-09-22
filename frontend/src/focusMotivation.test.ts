import { describe, expect, it } from 'vitest';
import { FOCUS_MOTIVATIONS, focusMotivation } from './focusMotivation';

describe('focusMotivation', () => {
  it('offers 50 distinct short messages', () => {
    expect(FOCUS_MOTIVATIONS).toHaveLength(50);
    expect(new Set(FOCUS_MOTIVATIONS)).toHaveLength(50);
    expect(FOCUS_MOTIVATIONS.every((message) => message.length <= 58)).toBe(true);
  });

  it('keeps the message stable for a sequence', () => {
    const message = focusMotivation('sequence-42');
    expect(focusMotivation('sequence-42')).toBe(message);
    expect(FOCUS_MOTIVATIONS).toContain(message);
  });
});
