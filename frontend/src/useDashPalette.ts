import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import {
  adoptServerPalettes,
  BUILTIN_PALETTES,
  cachePalettes,
  cachedPalettes,
  DEFAULT_PALETTE_ID,
  MAX_USER_PALETTES,
  resolvePalette,
} from './dashPalette';
import type { DashPalette, PaletteState } from './dashPalette';

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
}

// The dashboard palette: opens with this browser's copy, then follows the
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

  const commit = useCallback((update: (prev: PaletteState) => PaletteState) => {
    const prev = stateRef.current;
    const next = update(prev);
    if (next === prev) return;
    changedHere.current = true;
    stateRef.current = next;
    setState(next);
    cachePalettes(next);
    api.savePrefs({ dashPalette: next.active, dashPalettes: next.own }).catch((error) => {
      console.error('Failed to save the dashboard palette', error);
    });
  }, []);

  const select = useCallback((id: string) => commit((prev) => ({ ...prev, active: id })), [commit]);

  const save = useCallback(
    (palette: DashPalette) =>
      commit((prev) => {
        const exists = prev.own.some((p) => p.id === palette.id);
        if (!exists && prev.own.length >= MAX_USER_PALETTES) return prev;
        const own = exists ? prev.own.map((p) => (p.id === palette.id ? palette : p)) : [...prev.own, palette];
        return { active: palette.id, own };
      }),
    [commit]
  );

  const remove = useCallback(
    (id: string) =>
      commit((prev) => ({
        active: prev.active === id ? DEFAULT_PALETTE_ID : prev.active,
        own: prev.own.filter((p) => p.id !== id),
      })),
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
  };
}
