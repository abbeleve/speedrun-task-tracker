import { describe, expect, it } from 'vitest';
import { CAL_DESIGN_KEY, adoptServerDesign, cacheDesign, cachedDesign, parseDesign } from './calendarDesign';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('parseDesign', () => {
  it('accepts the two designs and nothing else', () => {
    expect(parseDesign('classic')).toBe('classic');
    expect(parseDesign('cards')).toBe('cards');
    expect(parseDesign('neon')).toBeNull();
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign(undefined)).toBeNull();
  });
});

describe('the local copy', () => {
  it('opens on the cards until a design has been chosen', () => {
    expect(cachedDesign(memoryStorage())).toBe('cards');
    expect(cachedDesign(memoryStorage({ [CAL_DESIGN_KEY]: 'nonsense' }))).toBe('cards');
  });

  it('reads back the design it stored', () => {
    const storage = memoryStorage();
    cacheDesign('classic', storage);
    expect(storage.data.get(CAL_DESIGN_KEY)).toBe('classic');
    expect(cachedDesign(storage)).toBe('classic');
  });

  it('survives storage that refuses to be used', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(cachedDesign(broken)).toBe('cards');
    expect(() => cacheDesign('classic', broken)).not.toThrow();
  });
});

describe('adoptServerDesign', () => {
  it('takes the design the account has stored', () => {
    expect(adoptServerDesign({ calendarDesign: 'classic' }, false)).toBe('classic');
    expect(adoptServerDesign({ calendarDesign: 'cards', calendarLayout: 'vertical' }, false)).toBe('cards');
  });

  it('keeps the local design when the account has not chosen one', () => {
    expect(adoptServerDesign({}, false)).toBeNull();
    expect(adoptServerDesign({ calendarDesign: 'neon' }, false)).toBeNull();
    expect(adoptServerDesign(null, false)).toBeNull();
  });

  it('never overrides a switch flipped while the request was out', () => {
    expect(adoptServerDesign({ calendarDesign: 'classic' }, true)).toBeNull();
  });
});
