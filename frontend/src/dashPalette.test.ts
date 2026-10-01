import { describe, expect, it } from 'vitest';
import {
  adoptServerPalettes,
  BUILTIN_PALETTES,
  cachePalettes,
  cachedPalettes,
  DEFAULT_PALETTE_ID,
  isUserPalette,
  MAX_USER_PALETTES,
  newPaletteId,
  normalizePalettes,
  PALETTE_CACHE_KEY,
  resolvePalette,
} from './dashPalette';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const SPRING = { id: 'u-abc123', name: 'Весна', base: '#22a35a', accent: '#ee5a24' };

describe('normalizePalettes', () => {
  it('keeps well-formed palettes of the user', () => {
    expect(normalizePalettes([SPRING])).toEqual([SPRING]);
  });

  it('drops malformed ones, repeats and anything posing as a built-in palette', () => {
    expect(
      normalizePalettes([
        SPRING,
        SPRING,
        { ...SPRING, id: 'ocean' },
        { ...SPRING, id: 'u-x', base: 'green' },
        { ...SPRING, id: 'u-y', name: '   ' },
        'nonsense',
        null,
      ])
    ).toEqual([SPRING]);
    expect(normalizePalettes('nonsense')).toEqual([]);
  });

  it('trims names, lowercases colours and stops at the cap', () => {
    const many = Array.from({ length: MAX_USER_PALETTES + 5 }, (_, i) => ({ ...SPRING, id: `u-${i}` }));
    expect(normalizePalettes(many)).toHaveLength(MAX_USER_PALETTES);
    expect(normalizePalettes([{ ...SPRING, name: '  Весна  ', base: '#22A35A' }])).toEqual([SPRING]);
  });
});

describe('palette ids', () => {
  it('marks the user’s own palettes apart from the built-in ones', () => {
    expect(isUserPalette(newPaletteId())).toBe(true);
    expect(BUILTIN_PALETTES.some((p) => isUserPalette(p.id))).toBe(false);
    expect(newPaletteId()).not.toBe(newPaletteId());
  });
});

describe('resolvePalette', () => {
  it('finds the user’s palettes and the built-in ones', () => {
    expect(resolvePalette('u-abc123', [SPRING])).toBe(SPRING);
    expect(resolvePalette('ocean', [SPRING]).name).toBe('Океан');
  });

  it('falls back to the default for an id that names nothing', () => {
    expect(resolvePalette('u-gone', [SPRING]).id).toBe(DEFAULT_PALETTE_ID);
    expect(resolvePalette(null, []).id).toBe(DEFAULT_PALETTE_ID);
  });
});

describe('the local copy', () => {
  it('opens on the default until something has been chosen', () => {
    expect(cachedPalettes(memoryStorage())).toEqual({ active: DEFAULT_PALETTE_ID, own: [] });
    expect(cachedPalettes(memoryStorage({ [PALETTE_CACHE_KEY]: '{oops' }))).toEqual({
      active: DEFAULT_PALETTE_ID,
      own: [],
    });
  });

  it('reads back what it stored', () => {
    const storage = memoryStorage();
    cachePalettes({ active: 'u-abc123', own: [SPRING] }, storage);
    expect(cachedPalettes(storage)).toEqual({ active: 'u-abc123', own: [SPRING] });
  });
});

describe('adoptServerPalettes', () => {
  it('takes the account’s palettes', () => {
    expect(adoptServerPalettes({ dashPalette: 'u-abc123', dashPalettes: [SPRING] }, false)).toEqual({
      active: 'u-abc123',
      own: [SPRING],
    });
  });

  it('resets to the default when the account has none, whatever this browser held', () => {
    expect(adoptServerPalettes({ calendarDesign: 'cards' }, false)).toEqual({
      active: DEFAULT_PALETTE_ID,
      own: [],
    });
  });

  it('leaves alone a choice made while the request was out', () => {
    expect(adoptServerPalettes({ dashPalette: 'ocean' }, true)).toBeNull();
    expect(adoptServerPalettes(null, false)).toBeNull();
  });
});
