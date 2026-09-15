// The overtake engine's weekly total — Monday..Sunday of the calendar week
// `todayKey` falls in, added up from each closed day's saved history plus
// today's live number (today has not closed yet, so credit.ts has nothing
// saved for it — see overtakeHistory.ts).

import { shiftDayKey, startOfWeek } from './history';

export function weekKeysOf(todayKey: string): string[] {
  const monday = startOfWeek(todayKey);
  return Array.from({ length: 7 }, (_, i) => shiftDayKey(monday, i));
}

export function sumWeekOvertakeSec(
  overtakeByDay: Record<string, number>,
  todayKey: string,
  todayLiveSec: number
): number {
  let total = 0;
  for (const key of weekKeysOf(todayKey)) {
    total += key === todayKey ? todayLiveSec : overtakeByDay[key] ?? 0;
  }
  return total;
}

// Splits a total overtake/lag into whole-hour blocks for the segmented bar on
// the home page: one entry of 1 per full hour, plus a trailing fractional
// entry (0..1) for a partial hour so e.g. 50 minutes still shows as a
// partly-filled block instead of rounding away.
export function overtakeSegments(totalSec: number): number[] {
  const absHours = Math.abs(totalSec) / 3600;
  const full = Math.floor(absHours + 1e-9);
  const rem = absHours - full;
  const segments = Array<number>(full).fill(1);
  if (rem > 1e-9) segments.push(rem);
  return segments;
}
