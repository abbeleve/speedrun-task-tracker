import { describe, expect, it } from 'vitest';
import {
  adoptServerPalettes,
  BUILTIN_PALETTES,
  cachePalettes,
  cachedPalettes,
  DEFAULT_BACKDROP_FLOW,
  DEFAULT_BACKDROP_SEED,
  DEFAULT_GLASS,
  DEFAULT_PALETTE_ID,
  isUserPalette,
  MAX_BACKDROP_SEED,
  MAX_USER_PALETTES,
  newPaletteId,
  normalizePalettes,
  PALETTE_CACHE_KEY,
  paletteStyle,
  parseBackdropFlow,
  parseBackdropSeed,
  parseGlass,
  randomBackdropSeed,
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

describe('parseGlass', () => {
  it('puts the look on both pages until the user says otherwise', () => {
    expect(parseGlass(undefined)).toEqual(DEFAULT_GLASS);
    expect(DEFAULT_GLASS).toEqual({ calendar: true, tracker: true });
  });

  it('keeps each page’s own choice and fills in a missing or malformed one', () => {
    expect(parseGlass({ calendar: false, tracker: true })).toEqual({ calendar: false, tracker: true });
    expect(parseGlass({ tracker: false })).toEqual({ calendar: true, tracker: false });
    expect(parseGlass({ calendar: 'no', tracker: 0 })).toEqual(DEFAULT_GLASS);
    expect(parseGlass('nonsense')).toEqual(DEFAULT_GLASS);
  });
});

describe('backdrop positions', () => {
  it('accepts saved integer seeds and defaults malformed or missing values', () => {
    expect(parseBackdropSeed(0)).toBe(DEFAULT_BACKDROP_SEED);
    expect(parseBackdropSeed(123456)).toBe(123456);
    expect(parseBackdropSeed(MAX_BACKDROP_SEED)).toBe(MAX_BACKDROP_SEED);
    for (const value of [undefined, null, false, '123', -1, 1.5, NaN, Infinity, MAX_BACKDROP_SEED + 1]) {
      expect(parseBackdropSeed(value)).toBe(DEFAULT_BACKDROP_SEED);
    }
  });

  it('picks a new non-default seed even when the random result repeats', () => {
    expect(randomBackdropSeed(0, () => 0)).toBe(1);
    expect(randomBackdropSeed(1, () => 0)).toBe(2);
    expect(randomBackdropSeed(MAX_BACKDROP_SEED, () => 1 - Number.EPSILON)).toBe(1);
  });

  it('keeps the original layout when reset and keeps the palette colors when shuffled', () => {
    expect(paletteStyle(SPRING)).toEqual({ '--dash-base': SPRING.base, '--dash-accent': SPRING.accent });
    expect(paletteStyle(SPRING, 0)).toEqual(paletteStyle(SPRING));
    for (const seed of [1, 123456, MAX_BACKDROP_SEED]) {
      const style = paletteStyle(SPRING, seed);
      expect(style).toEqual(paletteStyle(SPRING, seed));
      expect(style['--dash-base']).toBe(SPRING.base);
      expect(style['--dash-accent']).toBe(SPRING.accent);
      const centers = Object.entries(style).filter(([key]) => key.startsWith('--dash-glow-'));
      expect(centers).toHaveLength(8);
      for (const [, value] of centers) {
        expect(value.endsWith('%')).toBe(true);
        expect(parseFloat(value)).toBeGreaterThanOrEqual(5);
        expect(parseFloat(value)).toBeLessThanOrEqual(95);
      }
    }
    expect(paletteStyle(SPRING, 1)).not.toEqual(paletteStyle(SPRING, 123456));
  });
});

describe('the living backdrop', () => {
  it('keeps still until the user turns it on', () => {
    expect(DEFAULT_BACKDROP_FLOW).toBe(false);
    expect(parseBackdropFlow(true)).toBe(true);
    expect(parseBackdropFlow(false)).toBe(false);
    for (const value of [undefined, null, 1, 'true', {}]) {
      expect(parseBackdropFlow(value)).toBe(DEFAULT_BACKDROP_FLOW);
    }
  });
});

describe('the local copy', () => {
  it('opens on the default until something has been chosen', () => {
    const fresh = {
      active: DEFAULT_PALETTE_ID,
      own: [],
      glass: DEFAULT_GLASS,
      backdropSeed: DEFAULT_BACKDROP_SEED,
      backdropFlow: DEFAULT_BACKDROP_FLOW,
    };
    expect(cachedPalettes(memoryStorage())).toEqual(fresh);
    expect(cachedPalettes(memoryStorage({ [PALETTE_CACHE_KEY]: '{oops' }))).toEqual(fresh);
  });

  it('reads back what it stored', () => {
    const storage = memoryStorage();
    const state = {
      active: 'u-abc123',
      own: [SPRING],
      glass: { calendar: false, tracker: true },
      backdropSeed: 123456,
      backdropFlow: true,
    };
    cachePalettes(state, storage);
    expect(cachedPalettes(storage)).toEqual(state);
  });
});

describe('adoptServerPalettes', () => {
  it('takes the account’s palettes and pages', () => {
    expect(
      adoptServerPalettes(
        {
          dashPalette: 'u-abc123',
          dashPalettes: [SPRING],
          dashGlass: { calendar: true, tracker: false },
          dashBackdropSeed: 123456,
          dashBackdropFlow: true,
        },
        false
      )
    ).toEqual({
      active: 'u-abc123',
      own: [SPRING],
      glass: { calendar: true, tracker: false },
      backdropSeed: 123456,
      backdropFlow: true,
    });
  });

  it('resets to the default when the account has none, whatever this browser held', () => {
    expect(adoptServerPalettes({ calendarDesign: 'cards' }, false)).toEqual({
      active: DEFAULT_PALETTE_ID,
      own: [],
      glass: DEFAULT_GLASS,
      backdropSeed: DEFAULT_BACKDROP_SEED,
      backdropFlow: DEFAULT_BACKDROP_FLOW,
    });
  });

  it('leaves alone a choice made while the request was out', () => {
    expect(adoptServerPalettes({ dashPalette: 'ocean' }, true)).toBeNull();
    expect(adoptServerPalettes(null, false)).toBeNull();
  });
});
