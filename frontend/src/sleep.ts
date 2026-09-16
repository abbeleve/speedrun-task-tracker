// The sleep log's shape and the arithmetic over it.
//
// A day's entry is one continuous stretch of sleep held as two clock moments,
// in minutes from that day's midnight: `bed` (when the person lay down) and
// `wake` (when they got up). `wake <= bed` means the stretch ran through
// midnight and ended the next morning — lying down at 23:40 and waking at
// 07:20 is the ordinary case, so it has to be expressible.
//
// `hours` is the list of whole-hour cells the stretch touches. It is derived,
// never authoritative, and is saved alongside the range so entries written
// before minutes existed and entries written after stay readable by each
// other: an old entry has only `hours` and reads back as a whole-hour range,
// a new one carries both.

export const MIN_PER_DAY = 24 * 60;
export const MIN_PER_HOUR = 60;

// A stretch of sleep. `bed` is 0..1439; `wake` is 1..1440, where 1440 is the
// midnight closing the day. `wake <= bed` wraps past midnight.
export interface SleepRange {
  bed: number;
  wake: number;
}

export interface SleepData {
  hours: number[]; // derived hour indices 0..23 the range touches
  quality: number | null; // 0..5
  bed?: number | null; // minutes from midnight
  wake?: number | null; // minutes from midnight
}

// How long the stretch lasted, in minutes. A range that ends exactly where it
// starts is a full 24 hours — there is no zero-length sleep to confuse it with,
// since an empty log is `null` instead.
export function sleepDuration(range: SleepRange | null | undefined): number {
  if (!range) return 0;
  const d = range.wake - range.bed;
  return d > 0 ? d : d + MIN_PER_DAY;
}

// The range an entry stands for: its own minutes when it has them, otherwise
// the whole hours an older entry selected.
export function rangeOf(entry: SleepData | null | undefined): SleepRange | null {
  if (!entry) return null;
  const { bed, wake } = entry;
  if (typeof bed === 'number' && typeof wake === 'number') {
    return { bed: clampMin(bed), wake: clampMin(wake) };
  }
  return rangeFromHours(entry.hours);
}

// Reads a legacy whole-hour selection as a range. The list may run through
// midnight (…22, 23, 0, 1…), so the first and last cells are found by the one
// gap in the circle rather than by min/max.
export function rangeFromHours(hours: number[] | null | undefined): SleepRange | null {
  const set = new Set(
    (hours ?? []).filter((h) => typeof h === 'number' && h >= 0 && h < 24).map((h) => Math.floor(h))
  );
  if (set.size === 0) return null;
  if (set.size === 24) return { bed: 0, wake: MIN_PER_DAY };
  // The first hour of the stretch is the one whose predecessor is missing.
  let first = -1;
  for (const h of set) {
    if (!set.has((h + 23) % 24)) {
      // More than one starting edge means the selection is not contiguous;
      // take the earliest so the result stays deterministic.
      if (first === -1 || h < first) first = h;
    }
  }
  if (first === -1) first = Math.min(...set);
  return { bed: first * MIN_PER_HOUR, wake: ((first + set.size) % 24) * MIN_PER_HOUR || MIN_PER_DAY };
}

// The hour cells a range paints, in the order they are slept through.
export function hoursOf(range: SleepRange | null | undefined): number[] {
  if (!range) return [];
  const dur = sleepDuration(range);
  const first = Math.floor(range.bed / MIN_PER_HOUR);
  const last = Math.ceil((range.bed + dur) / MIN_PER_HOUR); // exclusive
  const out: number[] = [];
  for (let h = first; h < last && out.length < 24; h++) out.push(((h % 24) + 24) % 24);
  return out;
}

// How much of one hour cell the range covers, as two fractions of that hour
// (0 = its left edge, 1 = its right). `null` when the cell is untouched.
export function hourSpan(range: SleepRange | null | undefined, hour: number): { from: number; to: number } | null {
  if (!range) return null;
  const start = range.bed;
  const end = start + sleepDuration(range);
  let from = 1;
  let to = 0;
  // A 24-hour stretch can reach the same cell from both sides of midnight, so
  // both placements are unioned rather than the first one winning.
  for (const off of [0, MIN_PER_DAY]) {
    const cellStart = hour * MIN_PER_HOUR + off;
    const lo = Math.max(start, cellStart);
    const hi = Math.min(end, cellStart + MIN_PER_HOUR);
    if (hi <= lo) continue;
    from = Math.min(from, (lo - cellStart) / MIN_PER_HOUR);
    to = Math.max(to, (hi - cellStart) / MIN_PER_HOUR);
  }
  return to > from ? { from, to } : null;
}

// What clicking hour cell `hour` does to the range: opens a one-hour stretch
// when there is none, cuts the stretch short when the cell is already filled,
// and otherwise grows whichever end the cell is nearer to — measured around
// the clock, so a cell just before bedtime moves the bedtime even when it sits
// on the far side of midnight.
export function extendToHour(range: SleepRange | null | undefined, hour: number): SleepRange | null {
  const cellStart = hour * MIN_PER_HOUR;
  if (!range) return { bed: cellStart, wake: cellStart + MIN_PER_HOUR };

  const covered = hoursOf(range);
  const pos = covered.indexOf(hour);
  if (pos === 0) return null; // clicked the cell sleep started in → clear the day
  if (pos > 0) return { bed: range.bed, wake: cellStart }; // cut the tail off here

  // An uncovered cell always lies wholly inside the gap between waking and
  // bedtime, so growing to its far edge can never overrun a full day.
  const growTail = mod(cellStart + MIN_PER_HOUR - range.wake, MIN_PER_DAY);
  const growHead = mod(range.bed - cellStart, MIN_PER_DAY);
  return growTail <= growHead
    ? { bed: range.bed, wake: cellStart + MIN_PER_HOUR }
    : { bed: cellStart, wake: range.wake };
}

// Folds a range back into a storable entry, keeping the quality rating and
// refreshing the derived hours. `null` means the day has nothing left to save.
export function entryWithRange(
  entry: SleepData | null | undefined,
  range: SleepRange | null
): SleepData | null {
  const quality = entry?.quality ?? null;
  if (!range) return quality === null ? null : { hours: [], quality, bed: null, wake: null };
  const norm = { bed: clampMin(range.bed) % MIN_PER_DAY, wake: clampMin(range.wake) };
  return { hours: hoursOf(norm), quality, bed: norm.bed, wake: norm.wake };
}

// "07:30". 1440 is the midnight that closes the day, written 24:00 so it reads
// as the end of this day rather than the start of the same one.
export function fmtClock(min: number): string {
  const m = clampMin(min);
  return `${String(Math.floor(m / MIN_PER_HOUR)).padStart(2, '0')}:${String(m % MIN_PER_HOUR).padStart(2, '0')}`;
}

// Reads what someone typed into a time field: "7", "7:5", "730", "07.30".
// `null` when it is not a time at all, so the field can keep the old value.
export function parseClock(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  let h: number;
  let m: number;
  const split = /^(\d{1,2})\s*[:.,\s-]\s*(\d{1,2})$/.exec(s);
  if (split) {
    h = Number(split[1]);
    m = Number(split[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else {
      h = Number(s.slice(0, s.length - 2));
      m = Number(s.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 24 || m > 59) return null;
  const total = h * MIN_PER_HOUR + m;
  return total > MIN_PER_DAY ? null : total;
}

function clampMin(min: number): number {
  if (!Number.isFinite(min)) return 0;
  return Math.max(0, Math.min(MIN_PER_DAY, Math.round(min)));
}

function mod(n: number, by: number): number {
  return ((n % by) + by) % by;
}
