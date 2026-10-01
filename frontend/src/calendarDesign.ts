// How the calendar sheet is drawn — the same grid and gestures either way,
// inside the same toolbar, HUD and backlog.
//
//   classic — the original sheet: ruled columns, small solid blocks
//   cards   — no rules, big day numbers and every block a rounded pastel
//             card (calendarCards.css)
//
// The choice belongs to the account (/api/prefs), so it follows the user to
// another device; a copy is kept in localStorage only so the calendar opens
// in the right look before the server has answered.

export type CalDesign = 'classic' | 'cards';

export const CAL_DESIGN_KEY = 'speedrun_cal_design';

export function parseDesign(value: unknown): CalDesign | null {
  return value === 'classic' || value === 'cards' ? value : null;
}

// The design to open with: the last one this browser saw, the cards otherwise.
export function cachedDesign(storage: Pick<Storage, 'getItem'> = localStorage): CalDesign {
  try {
    return parseDesign(storage.getItem(CAL_DESIGN_KEY)) ?? 'cards';
  } catch {
    return 'cards';
  }
}

export function cacheDesign(design: CalDesign, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(CAL_DESIGN_KEY, design);
  } catch {
    // Storage full or blocked: the account still has the choice.
  }
}

// What the server's answer should change. It wins over the local copy unless
// the user has already flipped the switch while the request was out. Null
// means "leave it as it is".
export function adoptServerDesign(prefs: unknown, pickedHere: boolean): CalDesign | null {
  if (pickedHere || typeof prefs !== 'object' || prefs === null) return null;
  return parseDesign((prefs as { calendarDesign?: unknown }).calendarDesign);
}
