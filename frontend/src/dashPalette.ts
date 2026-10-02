// The dashboard's look: a colour scheme, and the pages that wear it. A palette
// is two colours — the page's own hue and a second one for accents (the sleep
// tracker's squares) — and App.css works the rest of the page out of them (see
// `.app--glass`). A few palettes ship with the app; the user makes their own
// on top. The home page always wears the look; the calendar and the sequence
// tracker each take it or keep their own. All of it belongs to the account
// (/api/prefs), so it follows the user to another device; a copy is kept in
// localStorage only so the page opens in the right colours before the server
// has answered.

export interface DashPalette {
  id: string;
  name: string;
  base: string; // '#rrggbb' — backdrop, glass, heatmap, buttons
  accent: string; // '#rrggbb' — the sleep tracker's squares, small accents
}

// Which of the other pages wear the look too.
export interface GlassPages {
  calendar: boolean;
  tracker: boolean;
}

export const DEFAULT_GLASS: GlassPages = { calendar: true, tracker: true };

// A stored choice, with a missing or malformed page falling back to the
// default for it.
export function parseGlass(value: unknown): GlassPages {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    calendar: typeof raw.calendar === 'boolean' ? raw.calendar : DEFAULT_GLASS.calendar,
    tracker: typeof raw.tracker === 'boolean' ? raw.tracker : DEFAULT_GLASS.tracker,
  };
}

// A seed keeps a shuffled backdrop stable across reloads and devices.
// Zero preserves the original arrangement, including each theme's positions.
export const DEFAULT_BACKDROP_SEED = 0;
export const MAX_BACKDROP_SEED = 0xffffffff;

export function parseBackdropSeed(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_BACKDROP_SEED
    ? value
    : DEFAULT_BACKDROP_SEED;
}

export function randomBackdropSeed(previous: number, random: () => number = Math.random): number {
  const seed = 1 + Math.floor(random() * MAX_BACKDROP_SEED);
  return seed === previous ? (seed % MAX_BACKDROP_SEED) + 1 : seed;
}

// Whether the backdrop's glows wander (backdropFlow.ts) or keep still. Off
// until the user turns it on.
export const DEFAULT_BACKDROP_FLOW = false;

export function parseBackdropFlow(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_BACKDROP_FLOW;
}

// How fast the glows wander, as a multiple of the normal pace, in steps of a
// quarter: from a slow drift to a lively swirl.
export const BACKDROP_SPEED_MIN = 0.25;
export const BACKDROP_SPEED_MAX = 4;
export const BACKDROP_SPEED_STEP = 0.25;
export const DEFAULT_BACKDROP_SPEED = 1;

// A stored speed, snapped to the slider's steps; anything else is the normal
// pace.
export function parseBackdropSpeed(value: unknown): number {
  if (typeof value !== 'number' || !(value >= BACKDROP_SPEED_MIN && value <= BACKDROP_SPEED_MAX)) {
    return DEFAULT_BACKDROP_SPEED;
  }
  return Math.round(value / BACKDROP_SPEED_STEP) * BACKDROP_SPEED_STEP;
}

// "1,5×" — the speed as the slider reads it out.
export const formatBackdropSpeed = (speed: number) => `${String(speed).replace('.', ',')}×`;

export const BUILTIN_PALETTES: readonly DashPalette[] = [
  { id: 'mint', name: 'Мята', base: '#22a35a', accent: '#ee5a24' },
  { id: 'ocean', name: 'Океан', base: '#2f7fd8', accent: '#f59e0b' },
  { id: 'sunset', name: 'Закат', base: '#ea6a2c', accent: '#6d4ae6' },
  { id: 'lavender', name: 'Лаванда', base: '#8b5cf6', accent: '#ec4899' },
  { id: 'graphite', name: 'Графит', base: '#64748b', accent: '#f97316' },
];

export const DEFAULT_PALETTE_ID = BUILTIN_PALETTES[0].id;
export const MAX_USER_PALETTES = 24;
export const PALETTE_NAME_MAX = 30;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const USER_ID_RE = /^u-[a-z0-9]{1,24}$/;
const ANY_ID_RE = /^[a-z0-9-]{1,40}$/;

// The user's own palettes carry a "u-" id, so they can never shadow one of
// the built-in ones.
export const isUserPalette = (id: string) => USER_ID_RE.test(id);

export function newPaletteId(): string {
  return `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// The user's palettes as stored, with anything malformed, repeated or past the
// cap dropped.
export function normalizePalettes(value: unknown): DashPalette[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: DashPalette[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PALETTE_NAME_MAX) : '';
    const base = typeof raw.base === 'string' ? raw.base.toLowerCase() : '';
    const accent = typeof raw.accent === 'string' ? raw.accent.toLowerCase() : '';
    if (!isUserPalette(id) || seen.has(id) || !name || !HEX_RE.test(base) || !HEX_RE.test(accent)) continue;
    seen.add(id);
    result.push({ id, name, base, accent });
    if (result.length === MAX_USER_PALETTES) break;
  }
  return result;
}

export function parsePaletteId(value: unknown): string | null {
  return typeof value === 'string' && ANY_ID_RE.test(value) ? value : null;
}

// The palette an id stands for, falling back to the default one when it names
// nothing (a palette deleted on another device, say).
export function resolvePalette(id: string | null, own: readonly DashPalette[]): DashPalette {
  return (
    own.find((p) => p.id === id) ??
    BUILTIN_PALETTES.find((p) => p.id === id) ??
    BUILTIN_PALETTES[0]
  );
}

export interface PaletteState {
  active: string;
  own: DashPalette[];
  glass: GlassPages;
  backdropSeed: number;
  backdropFlow: boolean;
  backdropSpeed: number;
}

export const PALETTE_CACHE_KEY = 'speedrun_dash_palette';

export function cachedPalettes(storage: Pick<Storage, 'getItem'> = localStorage): PaletteState {
  try {
    const raw = JSON.parse(storage.getItem(PALETTE_CACHE_KEY) ?? 'null') as Record<string, unknown> | null;
    return {
      active: parsePaletteId(raw?.active) ?? DEFAULT_PALETTE_ID,
      own: normalizePalettes(raw?.own),
      glass: parseGlass(raw?.glass),
      backdropSeed: parseBackdropSeed(raw?.backdropSeed),
      backdropFlow: parseBackdropFlow(raw?.backdropFlow),
      backdropSpeed: parseBackdropSpeed(raw?.backdropSpeed),
    };
  } catch {
    return {
      active: DEFAULT_PALETTE_ID,
      own: [],
      glass: DEFAULT_GLASS,
      backdropSeed: DEFAULT_BACKDROP_SEED,
      backdropFlow: DEFAULT_BACKDROP_FLOW,
      backdropSpeed: DEFAULT_BACKDROP_SPEED,
    };
  }
}

export function cachePalettes(state: PaletteState, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(PALETTE_CACHE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the account still has the choice.
  }
}

// What the server's answer should change. It wins over the local copy unless
// the user has already changed something while the request was out — even
// when it holds no palette at all, since the local copy belongs to the
// browser and may be another account's. Null means "leave it as it is".
export function adoptServerPalettes(prefs: unknown, changedHere: boolean): PaletteState | null {
  if (changedHere || typeof prefs !== 'object' || prefs === null) return null;
  const raw = prefs as {
    dashPalette?: unknown;
    dashPalettes?: unknown;
    dashGlass?: unknown;
    dashBackdropSeed?: unknown;
    dashBackdropFlow?: unknown;
    dashBackdropSpeed?: unknown;
  };
  return {
    active: parsePaletteId(raw.dashPalette) ?? DEFAULT_PALETTE_ID,
    own: normalizePalettes(raw.dashPalettes),
    glass: parseGlass(raw.dashGlass),
    backdropSeed: parseBackdropSeed(raw.dashBackdropSeed),
    backdropFlow: parseBackdropFlow(raw.dashBackdropFlow),
    backdropSpeed: parseBackdropSpeed(raw.dashBackdropSpeed),
  };
}

// The inline style that hands a palette to the stylesheet.
export function paletteStyle(p: DashPalette, backdropSeed = DEFAULT_BACKDROP_SEED): Record<string, string> {
  const vars: Record<string, string> = { '--dash-base': p.base, '--dash-accent': p.accent };
  let seed = parseBackdropSeed(backdropSeed);
  if (seed === DEFAULT_BACKDROP_SEED) return vars;

  // Separate centers for the four glows, bounded inside the page. The same
  // seed produces the same layout without randomizing again while the clock ticks.
  const position = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.round(5 + (seed / 0x100000000) * 90) + '%';
  };
  for (let i = 1; i <= 4; i++) {
    vars['--dash-glow-' + i + '-x'] = position();
    vars['--dash-glow-' + i + '-y'] = position();
  }
  return vars;
}
