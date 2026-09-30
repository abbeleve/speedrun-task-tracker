// Which way the calendar's day / 3-day / week grid runs.
//
//   vertical   — a column per day, the hours running down (the original grid)
//   horizontal — a row per day, the hours running across: the timeline, where
//                a busy day spreads into lanes and a session's blocks are tied
//                together by connectors
//
// The month view is a grid of cells either way. The choice belongs to the
// account (/api/prefs), so it follows the user to another device; a copy is
// kept in localStorage only so the calendar opens the right way round before
// the server has answered.

export type CalLayout = 'vertical' | 'horizontal';

export const CAL_LAYOUT_KEY = 'speedrun_cal_layout';

export function parseLayout(value: unknown): CalLayout | null {
  return value === 'vertical' || value === 'horizontal' ? value : null;
}

// The layout to open with: the last one this browser saw, vertical otherwise.
export function cachedLayout(storage: Pick<Storage, 'getItem'> = localStorage): CalLayout {
  try {
    return parseLayout(storage.getItem(CAL_LAYOUT_KEY)) ?? 'vertical';
  } catch {
    return 'vertical';
  }
}

export function cacheLayout(layout: CalLayout, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(CAL_LAYOUT_KEY, layout);
  } catch {
    // Storage full or blocked: the account still has the choice.
  }
}

// What the server's answer should change. It wins over the local copy — that
// is what makes the choice follow the account — unless the user has already
// flipped the switch while the request was out: their fresh click is newer
// than anything the server could be holding. Null means "leave it as it is".
export function adoptServerLayout(prefs: unknown, pickedHere: boolean): CalLayout | null {
  if (pickedHere || typeof prefs !== 'object' || prefs === null) return null;
  return parseLayout((prefs as { calendarLayout?: unknown }).calendarLayout);
}
