import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import {
  adoptServerPalettes,
  BUILTIN_PALETTES,
  cachePalettes,
  cachedPalettes,
  DEFAULT_BACKDROP_SEED,
  DEFAULT_PALETTE_ID,
  MAX_USER_PALETTES,
  parseBackdropSpeed,
  randomBackdropSeed,
  resolvePalette,
} from './dashPalette';
import type { DashPalette, GlassPages, PaletteState } from './dashPalette';

export interface DashPaletteStore {
  // Every palette to choose from: the built-in ones, then the user's own.
  palettes: DashPalette[];
  activeId: string;
  // What the page is painted with right now — the palette being edited, while
  // it is, so the colours can be judged on the real page.
  current: DashPalette;
  select: (id: string) => void;
  // Adds a new palette or replaces the one with the same id, and selects it.
  save: (palette: DashPalette) => void;
  remove: (id: string) => void;
  setPreview: (palette: DashPalette | null) => void;
  canAdd: boolean;
  // The other pages that wear the look, and the switch for each.
  glass: GlassPages;
  setGlass: (page: keyof GlassPages, on: boolean) => void;
  backdropSeed: number;
  shuffleBackdrop: () => void;
  resetBackdrop: () => void;
  // Whether the backdrop's glows wander, and the switch for it.
  backdropFlow: boolean;
  setBackdropFlow: (on: boolean) => void;
  // How fast they wander, and the slider for it.
  backdropSpeed: number;
  setBackdropSpeed: (speed: number) => void;
}

// A slider sends a change for every step it is dragged over; the account
// hears only where it came to rest.
const SETTLE_SAVE_MS = 400;

// The dashboard's look: opens with this browser's copy, then follows the
// account once /api/prefs answers — unless something was changed here in the
// meantime. Every change is cached locally and sent to the account.
export function useDashPalette(): DashPaletteStore {
  const [state, setState] = useState<PaletteState>(() => cachedPalettes());
  const [preview, setPreview] = useState<DashPalette | null>(null);
  const changedHere = useRef(false);
  // The changes read the current state through this mirror rather than a
  // state updater, so the save they send goes out once, not once per render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api.loadPrefs().then(
      (prefs) => {
        const next = active ? adoptServerPalettes(prefs, changedHere.current) : null;
        if (!next) return;
        setState(next);
        cachePalettes(next);
      },
      (error) => console.error('Failed to load the dashboard palette', error)
    );
    return () => {
      active = false;
    };
  }, []);

  // `settle` holds the save back until the changes stop coming; any other
  // change sends the whole look at once, a held-back one included.
  const commit = useCallback((update: (prev: PaletteState) => PaletteState, settle = false) => {
    const prev = stateRef.current;
    const next = update(prev);
    if (next === prev) return;
    changedHere.current = true;
    stateRef.current = next;
    setState(next);
    cachePalettes(next);
    const save = () =>
      api
        .savePrefs({
          dashPalette: next.active,
          dashPalettes: next.own,
          dashGlass: next.glass,
          dashBackdropSeed: next.backdropSeed,
          dashBackdropFlow: next.backdropFlow,
          dashBackdropSpeed: next.backdropSpeed,
        })
        .catch((error) => {
          console.error('Failed to save the dashboard palette', error);
        });
    clearTimeout(saveTimer.current);
    if (settle) saveTimer.current = setTimeout(save, SETTLE_SAVE_MS);
    else void save();
  }, []);

  const select = useCallback((id: string) => commit((prev) => ({ ...prev, active: id })), [commit]);

  const save = useCallback(
    (palette: DashPalette) =>
      commit((prev) => {
        const exists = prev.own.some((p) => p.id === palette.id);
        if (!exists && prev.own.length >= MAX_USER_PALETTES) return prev;
        const own = exists ? prev.own.map((p) => (p.id === palette.id ? palette : p)) : [...prev.own, palette];
        return { ...prev, active: palette.id, own };
      }),
    [commit]
  );

  const remove = useCallback(
    (id: string) =>
      commit((prev) => ({
        ...prev,
        active: prev.active === id ? DEFAULT_PALETTE_ID : prev.active,
        own: prev.own.filter((p) => p.id !== id),
      })),
    [commit]
  );

  const setGlass = useCallback(
    (page: keyof GlassPages, on: boolean) =>
      commit((prev) => (prev.glass[page] === on ? prev : { ...prev, glass: { ...prev.glass, [page]: on } })),
    [commit]
  );

  const shuffleBackdrop = useCallback(
    () => commit((prev) => ({ ...prev, backdropSeed: randomBackdropSeed(prev.backdropSeed) })),
    [commit]
  );
  const resetBackdrop = useCallback(
    () => commit((prev) => (prev.backdropSeed === DEFAULT_BACKDROP_SEED ? prev : { ...prev, backdropSeed: DEFAULT_BACKDROP_SEED })),
    [commit]
  );
  const setBackdropFlow = useCallback(
    (on: boolean) => commit((prev) => (prev.backdropFlow === on ? prev : { ...prev, backdropFlow: on })),
    [commit]
  );
  const setBackdropSpeed = useCallback(
    (value: number) =>
      commit((prev) => {
        const backdropSpeed = parseBackdropSpeed(value);
        return prev.backdropSpeed === backdropSpeed ? prev : { ...prev, backdropSpeed };
      }, true),
    [commit]
  );

  const palettes = useMemo(() => [...BUILTIN_PALETTES, ...state.own], [state.own]);
  const current = preview ?? resolvePalette(state.active, state.own);

  return {
    palettes,
    activeId: state.active,
    current,
    select,
    save,
    remove,
    setPreview,
    canAdd: state.own.length < MAX_USER_PALETTES,
    glass: state.glass,
    setGlass,
    backdropSeed: state.backdropSeed,
    shuffleBackdrop,
    resetBackdrop,
    backdropFlow: state.backdropFlow,
    setBackdropFlow,
    backdropSpeed: state.backdropSpeed,
    setBackdropSpeed,
  };
}
