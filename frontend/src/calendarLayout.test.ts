import { describe, expect, it } from 'vitest';
import { CAL_LAYOUT_KEY, adoptServerLayout, cacheLayout, cachedLayout, parseLayout } from './calendarLayout';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('parseLayout', () => {
  it('accepts the two layouts and nothing else', () => {
    expect(parseLayout('vertical')).toBe('vertical');
    expect(parseLayout('horizontal')).toBe('horizontal');
    expect(parseLayout('diagonal')).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout(undefined)).toBeNull();
  });
});

describe('the local copy', () => {
  it('opens vertical until a layout has been chosen', () => {
    expect(cachedLayout(memoryStorage())).toBe('vertical');
    expect(cachedLayout(memoryStorage({ [CAL_LAYOUT_KEY]: 'nonsense' }))).toBe('vertical');
  });

  it('reads back the layout it stored', () => {
    const storage = memoryStorage();
    cacheLayout('horizontal', storage);
    expect(storage.data.get(CAL_LAYOUT_KEY)).toBe('horizontal');
    expect(cachedLayout(storage)).toBe('horizontal');
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
    expect(cachedLayout(broken)).toBe('vertical');
    expect(() => cacheLayout('horizontal', broken)).not.toThrow();
  });
});

describe('adoptServerLayout', () => {
  it('takes the layout the account has stored', () => {
    expect(adoptServerLayout({ calendarLayout: 'horizontal' }, false)).toBe('horizontal');
    expect(adoptServerLayout({ calendarLayout: 'vertical', other: 1 }, false)).toBe('vertical');
  });

  it('keeps the local layout when the account has not chosen one', () => {
    expect(adoptServerLayout({}, false)).toBeNull();
    expect(adoptServerLayout({ calendarLayout: 'diagonal' }, false)).toBeNull();
    expect(adoptServerLayout(null, false)).toBeNull();
  });

  it('never overrides a switch flipped while the request was out', () => {
    expect(adoptServerLayout({ calendarLayout: 'vertical' }, true)).toBeNull();
  });
});
