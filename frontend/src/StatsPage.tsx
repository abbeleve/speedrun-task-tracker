/* eslint-disable react-refresh/only-export-components --
   This module intentionally exports the shared `useStatsData` hook (plus its
   `StatsData` type) alongside the three view sections that take it as a prop,
   so the sections can be reordered independently on the home page. Fast
   refresh for the components is sacrificed for that sharing on purpose. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DayStats, Habit, HabitEntry, Task } from './types';
import { dateKey, heatLevel, shiftDayKey, startOfWeek, todayKey } from './history';
import { habitHeatLevel, habitTotal } from './habits';
import * as api from './api';

const WEEKS_TO_SHOW = 53; // ~1 year
const HOURS_PER_DAY = 24;
const LOAD_MONTHS = 2; // months appended/prepended per scroll trigger
const MAX_MONTHS = 24; // hard cap on buffered months
const LOAD_TRIGGER_PX = 140; // scroll proximity that triggers loading another batch
const ABOVE_MONTHS = 3; // months before the current one loaded at startup
const BELOW_MONTHS = 3; // months after the current one loaded at startup
const QUALITY_LEVELS = 6; // 0..5
const QUALITY_EMOJIS = ['—', '😞', '😕', '🙂', '😊', '😁'] as const;

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DOW_SHORT_MON = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']; // Monday-first, matches startOfWeek

// ── Helpers ────────────────────────────────────────────────────────

function shiftDate(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtShortDate(key: string): string {
  const d = parseKey(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function fmtDurMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

const fmtSec = (sec: number) => fmtDurMin(Math.round(sec / 60));

function fmtSumSec(sec: number): string {
  const hrs = sec / 3600;
  if (hrs >= 100) return `${Math.round(hrs / 10) * 10}ч+`;
  if (hrs >= 10) return `${Math.round(hrs)}ч`;
  return fmtSec(sec);
}

function hoursWord(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'часов';
  if (last === 1) return 'час';
  if (last >= 2 && last <= 4) return 'часа';
  return 'часов';
}

function sleepCount(selected: number[]): number {
  if (!selected || selected.length === 0) return 0;
  // Guard against non-number values (e.g. old-format data leaking through)
  const nums = selected.filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));
  if (nums.length === 0) return 0;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return hi - lo + 1;
}

// ── Data model ─────────────────────────────────────────────────────

interface SleepData {
  hours: number[]; // selected hour indices 0..23
  quality: number | null; // 0..5
}

interface DayRef {
  key: string;
  date: Date;
}

interface MonthBlock {
  key: string; // 'YYYY-M'
  year: number;
  month: number; // 0..11
  days: DayRef[];
}

// Builds the GitHub-style weeks×days grid for `selYear`, delegating each
// cell's level/stats/sleep to `cellFor` — shared by the default (work-time)
// heatmap and the per-habit slice, which only differ in that function.
function buildHeatGrid(
  today: Date,
  selYear: number,
  cellFor: (key: string) => Omit<HeatCellInfo, 'key' | 'future'>
): { cells: HeatCellInfo[][]; monthMarks: { col: number; label: string }[]; colsCount: number } {
  const dowMon = (today.getDay() + 6) % 7;
  const gridEnd = shiftDate(today, 6 - dowMon); // Sunday of current week
  const cols: HeatCellInfo[][] = [];
  const marks: { col: number; label: string }[] = [];
  let prevMonth = -1;

  for (let w = WEEKS_TO_SHOW - 1; w >= 0; w--) {
    const colStart = shiftDate(gridEnd, -(w * 7 + 6));
    // Skip weeks that belong to other years entirely
    if (colStart.getFullYear() !== selYear) continue;
    if (shiftDate(colStart, 6).getFullYear() !== selYear) continue;

    const col: HeatCellInfo[] = [];
    for (let i = 0; i < 7; i++) {
      const d = shiftDate(colStart, i);
      const key = dateKey(d);
      col.push({
        key,
        future: d.getTime() > today.getTime(),
        ...cellFor(key),
      });
    }
    const m = colStart.getMonth();
    if (m !== prevMonth) {
      marks.push({ col: cols.length, label: MONTHS_SHORT[m] });
      prevMonth = m;
    }
    cols.push(col);
  }
  return { cells: cols, monthMarks: marks, colsCount: cols.length };
}

function buildMonth(year: number, month: number): MonthBlock {
  const count = new Date(year, month + 1, 0).getDate();
  const days: DayRef[] = [];
  for (let d = 1; d <= count; d++) {
    const date = new Date(year, month, d);
    days.push({ key: dateKey(date), date });
  }
  return { key: `${year}-${month}`, year, month, days };
}

interface HeatCellInfo {
  key: string;
  level: number;
  future: boolean;
  stats: DayStats | undefined;
  sleep: SleepData | undefined;
  habitValue?: number; // set only when the heatmap is sliced by a habit
}

function cellTitle(c: HeatCellInfo): string {
  if (c.future) return '';
  const parts = [fmtShortDate(c.key)];
  parts.push(`Работа: ${fmtSec(c.stats?.workSec ?? 0)}`);
  if ((c.stats?.restSec ?? 0) > 0) parts.push(`Отдых: ${fmtSec(c.stats!.restSec)}`);
  const cnt = sleepCount(c.sleep?.hours ?? []);
  if (cnt > 0) {
    let t = `Сон: ${cnt} ${hoursWord(cnt)}`;
    const q = c.sleep?.quality;
    if (q !== undefined && q !== null) t += ` ${QUALITY_EMOJIS[q]}`;
    parts.push(t);
  }
  return parts.join('\n');
}

function habitCellTitle(c: HeatCellInfo, habit: Habit): string {
  if (c.future) return '';
  const value = c.habitValue ?? 0;
  const u = habit.unit ? ` ${habit.unit}` : '';
  return `${fmtShortDate(c.key)}\n${habit.emoji} ${habit.name}: ${value} / ${habit.target}${u}`;
}

// ── Custom hover tooltip ─────────────────────────────────────────────
// A native `title` attribute takes ~1s to show and its popup ignores the
// app's theme (always OS-styled), so heatmap cells and bar-chart bars use
// this instead: a short hover delay and a themed popup that follows the
// cursor.
const TOOLTIP_DELAY_MS = 150;

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

function useHoverTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback((e: { clientX: number; clientY: number }, text: string) => {
    if (!text) return;
    const lines = text.split('\n');
    const { clientX: x, clientY: y } = e;
    clearTimer();
    timerRef.current = window.setTimeout(() => setTooltip({ x, y, lines }), TOOLTIP_DELAY_MS);
  }, [clearTimer]);

  const move = useCallback((e: { clientX: number; clientY: number }) => {
    setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setTooltip(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { tooltip, show, move, hide };
}

// Flips to the cursor's left/top when there isn't ~220px of room on the
// right or ~80px below — the heatmap's rightmost columns and bottom rows
// otherwise push the popup straight off the viewport edge.
function HoverTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  const flipX = tooltip.x > window.innerWidth - 220;
  const flipY = tooltip.y > window.innerHeight - 80;
  const style: CSSProperties = {
    ...(flipX ? { right: window.innerWidth - tooltip.x + 14 } : { left: tooltip.x + 14 }),
    ...(flipY ? { bottom: window.innerHeight - tooltip.y + 14 } : { top: tooltip.y + 14 }),
  };
  return (
    <div className="heat-tooltip" style={style}>
      {tooltip.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

const QUALITY_TITLES = ['Нет оценки', 'Ужасный', 'Плохой', 'Нормальный', 'Хороший', 'Отличный'] as const;

function SleepDayRow({ date, dateKey: dk, entry, disabled, toggleHour, cycleQuality }: {
  date: Date;
  dateKey: string;
  entry?: SleepData;
  disabled: boolean;
  toggleHour: (hour: number) => void;
  cycleQuality: () => void;
}) {
  const hrs = entry?.hours ?? [];
  const qual = entry?.quality ?? null;

  return (
    <div className={`sleep-day-row${disabled ? ' future' : ''}`} data-key={dk}>
      <div className="sleep-day-num">
        {date.getDate()}
        <span className="sleep-day-mon">{MONTHS_SHORT[date.getMonth()].charAt(0)}</span>
      </div>
      {Array.from({ length: HOURS_PER_DAY }, (_, h) => h).map((h) => (
        <button
          key={h}
          type="button"
          className={`sleep-cell${hrs.includes(h) ? ' checked' : ''}`}
          disabled={disabled}
          title={`${h}:00`}
          onClick={() => toggleHour(h)}
        />
      ))}
      <div className="qual-cell">
        <button
          type="button"
          className={`quality-dot${qual !== null ? ` filled q${qual}` : ' empty'}`}
          onClick={cycleQuality}
          title={QUALITY_TITLES[qual ?? 0]}
          aria-label={qual === null ? 'Нет оценки' : QUALITY_EMOJIS[qual]}
        >
          {qual !== null ? QUALITY_EMOJIS[qual] : ''}
        </button>
      </div>
    </div>
  );
}

// Hour labels header, aligned with each day's 24 squares.
function SleepHourHeader() {
  return (
    <div className="sleep-hour-header">
      <div className="sleep-day-num" />
      {Array.from({ length: HOURS_PER_DAY }, (_, h) => h).map((h) => (
        <span key={h} className="sleep-hour-label">{h}</span>
      ))}
      <div className="qual-cell" />
    </div>
  );
}

// A whole month: title + hour header + one row per day.
function SleepMonth({ block, entries, disabledFrom, onToggleHour, onCycleQuality }: {
  block: MonthBlock;
  entries: Record<string, SleepData>;
  disabledFrom: Date;
  onToggleHour: (dayKey: string, hour: number) => void;
  onCycleQuality: (dayKey: string) => void;
}) {
  return (
    <div className="sleep-month" data-month={`${block.year}-${block.month}`}>
      <div className="sleep-month-title">{MONTHS_FULL[block.month]} {block.year}</div>
      <SleepHourHeader />
      {block.days.map((d) => (
        <SleepDayRow
          key={d.key}
          date={d.date}
          dateKey={d.key}
          entry={entries[d.key]}
          disabled={d.date.getTime() > disabledFrom.getTime()}
          toggleHour={(h) => onToggleHour(d.key, h)}
          cycleQuality={() => onCycleQuality(d.key)}
        />
      ))}
    </div>
  );
}

// ── Themed dropdown ──────────────────────────────────────────────────
// Replaces a native <select>: on several platforms the browser's own option
// popup is OS-chrome and ignores the app's dark/light theme, so this renders
// its own menu instead, styled like the rest of the UI everywhere.

interface DropdownOption<T extends string> {
  value: T;
  label: ReactNode;
}

function Dropdown<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: DropdownOption<T>[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={`dd${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className="dd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dd-btn-label">{current?.label}</span>
        <span className="dd-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dd-option${o.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function YearSelector({ value, onChange, years }: {
  value: number;
  onChange: (v: number) => void;
  years: number[];
}) {
  return (
    <Dropdown
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      options={years.map((y) => ({ value: String(y), label: String(y) }))}
      className="dd-year"
    />
  );
}

// ── Shared data/state ────────────────────────────────────────────────
// Everything below is one hook so the three sections that used to be a
// single "Статистика активности" page (the heatmap, the summary cards and
// the sleep tracker) can be reordered independently on the home page while
// still sharing one load of history/sleep data and one scroll state.

export interface StatsData {
  selYear: number;
  setSelYear: (y: number) => void;
  availableYears: number[];
  heatData: { cells: HeatCellInfo[][]; monthMarks: { col: number; label: string }[]; colsCount: number };
  summary: { totalWorkSec: number; avgSleep: number | null; daysWithSleep: number; totalDays: number };
  yearTotalHrs: number;
  months: MonthBlock[];
  history: Record<string, DayStats>;
  sleepLog: Record<string, SleepData>;
  today: Date;
  toggleHour: (dayKey: string, hour: number) => void;
  cycleQuality: (dayKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  targetMonth: (delta: number) => void;
}

export function useStatsData(): StatsData {
  const [history, setHistory] = useState<Record<string, DayStats>>({});
  const [sleepLog, setSleepLog] = useState<Record<string, SleepData>>({});
  const [selYear, setSelYear] = useState(() => new Date().getFullYear());

  // Load the user's history + sleep log from the backend on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [h, s] = await Promise.all([api.loadHistory(), api.loadSleepLog()]);
        if (!active) return;
        setHistory(h);
        setSleepLog(s as Record<string, SleepData>);
      } catch (e) {
        console.error('Failed to load stats', e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Buffered months for the vertical scroll view ──
  // Kept as a list of month blocks; blocks are appended/prepended as the user
  // scrolls near either edge, so navigation works both backward and forward.
  const [months, setMonths] = useState<MonthBlock[]>(() => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMon = now.getMonth();
    // month before the current one, then the current. ABOVE_MONTHS holds
    // history going back; BELOW_MONTHS is prepopulated ahead so both scroll
    // directions feel instant before the first auto-load.
    const cur = new Date(curYear, curMon, 1);
    const list: MonthBlock[] = [];
    for (let k = ABOVE_MONTHS; k >= 0; k--) {
      const d = new Date(cur.getFullYear(), cur.getMonth() - k, 1);
      list.push(buildMonth(d.getFullYear(), d.getMonth()));
    }
    for (let k = 1; k <= BELOW_MONTHS; k++) {
      const d = new Date(cur.getFullYear(), cur.getMonth() + k, 1);
      list.push(buildMonth(d.getFullYear(), d.getMonth()));
    }
    return list;
  });

  // Available years range
  const availableYears = useMemo(() => {
    const cy = today.getFullYear();
    return Array.from({ length: 6 }, (_, i) => cy - 5 + i);
  }, [today]);

  // All days of selected year
  const yearDays = useMemo(() => {
    const arr: { date: Date; key: string }[] = [];
    const end = new Date(selYear, 11, 31);
    for (let d = new Date(selYear, 0, 1); d <= end; d = shiftDate(d, 1)) {
      arr.push({ date: new Date(d), key: dateKey(d) });
    }
    return arr;
  }, [selYear]);

  // Summary for selected year
  const summary = useMemo(() => {
    let totalWorkSec = 0;
    let totalHrs = 0;
    let daysWithSleep = 0;

    for (const [k, e] of Object.entries(sleepLog)) {
      if (!e.hours.length && e.quality === null) continue;
      const dt = parseKey(k);
      if (dt.getFullYear() !== selYear) continue;
      const w = history[k];
      if (w) totalWorkSec += w.workSec;
      daysWithSleep++;
      totalHrs += sleepCount(e.hours);
    }

    return {
      totalWorkSec,
      avgSleep: daysWithSleep > 0 ? Math.round(totalHrs / daysWithSleep * 60) : null,
      daysWithSleep,
      totalDays: yearDays.length,
    };
  }, [history, sleepLog, selYear, yearDays]);

  // Heatmap for current year (GitHub-style daily grid for all 52 weeks)
  const heatData = useMemo(
    () =>
      buildHeatGrid(today, selYear, (key) => {
        const st = history[key];
        return {
          level: st ? heatLevel(st.workSec) : 0,
          stats: st,
          sleep: sleepLog[key],
        };
      }),
    [history, sleepLog, today, selYear]
  );

  // Year totals
  const yearTotalHrs = useMemo(() => {
    let sum = 0;
    for (const d of yearDays) {
      const e = sleepLog[d.key];
      if (e?.hours.length) sum += sleepCount(e.hours);
    }
    return sum;
  }, [yearDays, sleepLog]);

  // ── Actions ──────────────────────────────────────────────────

  const toggleHour = (dayKey: string, hour: number) => {
    const cur = sleepLog[dayKey];
    const existing = cur ? [...cur.hours].sort((a, b) => a - b) : [];

    if (existing.includes(hour)) {
      // Remove contiguous range from edge to this hour
      const pos = existing.indexOf(hour);
      const newHrs = existing.slice(0, pos);
      const next = { ...cur, hours: newHrs };
      if (newHrs.length === 0 && next.quality === null) {
        void api.saveSleepLog(dayKey, null);
        setSleepLog((prev) => {
          const n = { ...prev };
          delete n[dayKey];
          return n;
        });
      } else {
        void api.saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      }
    } else if (existing.length === 0) {
      // First click
      void api.saveSleepLog(dayKey, { hours: [hour], quality: null });
      setSleepLog((prev) => ({ ...prev, [dayKey]: { hours: [hour], quality: null } }));
    } else {
      const lo = existing[0];
      const hi = existing[existing.length - 1];

      if (hour > hi) {
        const extend: number[] = [];
        for (let h = hi + 1; h <= hour; h++) extend.push(h);
        const next = { ...cur, hours: [...existing, ...extend] };
        void api.saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      } else if (hour < lo) {
        const extend: number[] = [];
        for (let h = hour; h < lo; h++) extend.push(h);
        const next = { ...cur, hours: [...extend, ...existing] };
        void api.saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      }
      // inside range → no change
    }
  };

  const cycleQuality = (dayKey: string) => {
    const cur = sleepLog[dayKey] ?? { hours: [], quality: null };
    const nq = cur.quality === null ? 1 : cur.quality >= QUALITY_LEVELS - 1 ? null : cur.quality + 1;
    const next = { ...cur, quality: nq };
    void api.saveSleepLog(dayKey, next);
    setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
  };

  // ── Lazy month loading (infinite scroll, both directions) ──
  // Months buffer around the current one. Scrolling near the top (older) or
  // bottom (newer) edge prepends/appends another batch. Prepending inserts
  // content above, so we compensate the scroll position to avoid a jump.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll offset that must be re-applied after a prepend renders.
  const pendingCompRef = useRef<number | null>(null);
  // Explicit navigation target (prev/next/today) awaiting render.
  const pendingNavRef = useRef<{ year: number; month: number } | null>(null);
  const navGuardRef = useRef(false);

  const loadUp = useCallback(() => {
    setMonths((prev) => {
      if (prev.length >= MAX_MONTHS) return prev;
      const first = prev[0];
      const added: MonthBlock[] = [];
      for (let k = LOAD_MONTHS; k >= 1; k--) {
        const d = new Date(first.year, first.month - k, 1);
        added.push(buildMonth(d.getFullYear(), d.getMonth()));
      }
      const el = scrollRef.current;
      if (el) pendingCompRef.current = el.scrollTop;
      return [...added, ...prev];
    });
  }, []);

  const loadDown = useCallback(() => {
    setMonths((prev) => {
      if (prev.length >= MAX_MONTHS) return prev;
      const last = prev[prev.length - 1];
      const added: MonthBlock[] = [];
      for (let k = 1; k <= LOAD_MONTHS; k++) {
        const d = new Date(last.year, last.month + k, 1);
        added.push(buildMonth(d.getFullYear(), d.getMonth()));
      }
      return [...prev, ...added];
    });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || navGuardRef.current) return;
    if (el.scrollTop <= LOAD_TRIGGER_PX) loadUp();
    else if (el.scrollHeight - el.clientHeight - el.scrollTop <= LOAD_TRIGGER_PX) loadDown();
  }, [loadUp, loadDown]);

  // After months re-render: re-apply prepend compensation, then honour any
  // pending explicit navigation. Runs before paint so there's no flicker.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingCompRef.current !== null) {
      const containerTop = el.getBoundingClientRect().top;
      const firstEl = el.querySelector<HTMLElement>(`[data-month="${months[0].key}"]`);
      if (firstEl) {
        const addedH = firstEl.getBoundingClientRect().top - containerTop;
        el.scrollTop = pendingCompRef.current + Math.max(0, addedH);
      }
      pendingCompRef.current = null;
    }
    if (pendingNavRef.current) {
      const { year, month } = pendingNavRef.current;
      el.querySelector<HTMLElement>(`[data-month="${year}-${month}"]`)?.scrollIntoView({ block: 'start' });
      pendingNavRef.current = null;
    }
  }, [months]);

  // Scroll the buffered view so the current month is the first one visible,
  // then keep "today" in reach.
  useEffect(() => {
    const el = scrollRef.current;
    const now = new Date();
    el?.querySelector<HTMLElement>(`[data-month="${now.getFullYear()}-${now.getMonth()}"]`)?.scrollIntoView({ block: 'start' });
  }, []);

  const gotoMonth = (year: number, month: number) => {
    navGuardRef.current = true;
    pendingNavRef.current = { year, month };
    setMonths((prev) => {
      if (prev.some((b) => b.year === year && b.month === month)) return prev;
      const first = prev[0];
      const last = prev[prev.length - 1];
      const target = year * 12 + month;
      const minI = first.year * 12 + first.month;
      const maxI = last.year * 12 + last.month;
      if (target < minI || prev.length >= MAX_MONTHS) {
        const added: MonthBlock[] = [];
        for (let i = minI - 1; i >= Math.max(target, minI - LOAD_MONTHS); i--) {
          const d = new Date(Math.floor(i / 12), ((i % 12) + 12) % 12, 1);
          added.push(buildMonth(d.getFullYear(), d.getMonth()));
        }
        return [...added, ...prev];
      }
      const added: MonthBlock[] = [];
      for (let i = maxI + 1; i <= Math.min(target, maxI + LOAD_MONTHS); i++) {
        const d = new Date(Math.floor(i / 12), ((i % 12) + 12) % 12, 1);
        added.push(buildMonth(d.getFullYear(), d.getMonth()));
      }
      return [...prev, ...added];
    });
    window.setTimeout(() => { navGuardRef.current = false; }, 120);
  };

  // ── Month navigation helpers (scroll to first visible month of target) ──
  const targetMonth = (delta: number) => {
    const base = new Date();
    const d = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    gotoMonth(d.getFullYear(), d.getMonth());
  };

  return {
    selYear,
    setSelYear,
    availableYears,
    heatData,
    summary,
    yearTotalHrs,
    months,
    history,
    sleepLog,
    today,
    toggleHour,
    cycleQuality,
    scrollRef,
    onScroll,
    targetMonth,
  };
}

// ── Section 1: yearly activity heatmap ────────────────────────────────

const HEAT_CELL_MIN = 10;
const HEAT_CELL_MAX = 26;
const HEAT_CELL_GAP = 3; // matches --heat-gap
const HEAT_BODY_GAP = 6; // matches .heat-body's gap

// Grows the cell size to fill the available row width (up to a cap) instead
// of leaving the card mostly empty when the selected year has few columns —
// falls back to the CSS default (and horizontal scroll) until measured.
function useHeatCellSize(colsCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || colsCount === 0) return;
    const compute = () => {
      const daysWidth = daysRef.current?.getBoundingClientRect().width ?? 20;
      const available = container.clientWidth - daysWidth - HEAT_BODY_GAP;
      const raw = Math.floor((available - (colsCount - 1) * HEAT_CELL_GAP) / colsCount);
      setCell(Math.min(HEAT_CELL_MAX, Math.max(HEAT_CELL_MIN, raw)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [colsCount]);

  return { scrollRef, daysRef, cell };
}

// "" (default) shows total work time, else the id of the habit whose daily
// progress the view is sliced by.
const ALL_ACTIVITY = '';

function habitDropdownOptions(habits: Habit[]): DropdownOption<string>[] {
  return [
    { value: ALL_ACTIVITY, label: 'Вся активность' },
    ...habits.map((h) => ({ value: h.id, label: `${h.emoji} ${h.name}` })),
  ];
}

type Period = 'year' | 'week' | 'month';

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'year', label: 'Год' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="period-toggle" role="tablist">
      {PERIOD_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          className={`period-toggle-btn${value === o.key ? ' active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Bar chart (week / month slices) ────────────────────────────────────

interface BarInfo {
  key: string;
  date: Date;
  value: number;
  ratio: number; // 0..1, clamped bar height
  future: boolean;
  over: boolean; // value exceeds a positive target — shown as a small marker
  label: string;
}

// Bars are scaled against the habit's own target when one is selected (so
// the chart reads as progress towards a goal); without a habit there is no
// target, so they scale against the largest value in view instead — same
// idea as heatLevel's fixed buckets, but continuous for a handful of bars.
function computeBars(
  days: { key: string; date: Date }[],
  today: Date,
  valueFn: (key: string) => number,
  target: number | null,
  labelFn: (date: Date) => string
): BarInfo[] {
  const rawValues = days.map((d) => valueFn(d.key));
  const dynMax = Math.max(1, ...rawValues);
  return days.map((d, i) => {
    const value = rawValues[i];
    const future = d.date.getTime() > today.getTime();
    let ratio: number;
    let over = false;
    if (target !== null && target > 0) {
      ratio = Math.max(0, Math.min(1, value / target));
      over = value > target;
    } else if (target !== null) {
      // zero-target habit: any activity fills the bar, mirroring habitHeatLevel
      ratio = value > 0 ? 1 : 0;
    } else {
      ratio = value / dynMax;
    }
    return { key: d.key, date: d.date, value, ratio, future, over, label: labelFn(d.date) };
  });
}

function barTooltipLines(b: BarInfo, habit: Habit | null): string {
  if (b.future) return '';
  const date = fmtShortDate(b.key);
  if (habit) {
    const u = habit.unit ? ` ${habit.unit}` : '';
    return `${date}\n${habit.emoji} ${habit.name}: ${b.value} / ${habit.target}${u}`;
  }
  return `${date}\nРабота: ${fmtSec(b.value)}`;
}

function BarChart({ bars, color, todayKeyStr, onEnter, onMove, onLeave }: {
  bars: BarInfo[];
  color: string;
  todayKeyStr: string;
  onEnter: (e: { clientX: number; clientY: number }, b: BarInfo) => void;
  onMove: (e: { clientX: number; clientY: number }) => void;
  onLeave: () => void;
}) {
  return (
    <div className="heat-bars-scroll">
      <div className="heat-bars" role="img" aria-label="Столбчатая диаграмма по дням">
        {bars.map((b) => (
          <div key={b.key} className={`heat-bar-col${b.key === todayKeyStr ? ' today' : ''}`}>
            <div
              className="heat-bar-track"
              onMouseEnter={(e) => !b.future && onEnter(e, b)}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
            >
              {b.over && <span className="heat-bar-over-dot" />}
              {!b.future && b.ratio > 0 && (
                <div className="heat-bar-fill" style={{ height: `${Math.max(b.ratio * 100, 4)}%`, background: color }} />
              )}
            </div>
            <span className="heat-bar-label">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function weekRangeLabel(weekStart: string): string {
  const start = parseKey(weekStart);
  const end = parseKey(shiftDayKey(weekStart, 6));
  return `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

export function ActivityHeatmap({ stats, habits, entries, tasks }: {
  stats: StatsData;
  habits: Habit[];
  entries: HabitEntry[];
  tasks: Task[];
}) {
  const { selYear, setSelYear, availableYears, heatData, today, history } = stats;
  const [habitId, setHabitId] = useState(ALL_ACTIVITY);
  const [period, setPeriod] = useState<Period>('year');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey()));
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const selectedHabit = useMemo(() => habits.find((h) => h.id === habitId) ?? null, [habits, habitId]);
  const todayKeyStr = useMemo(() => dateKey(today), [today]);

  const valueFn = useCallback(
    (key: string) => (selectedHabit ? habitTotal(selectedHabit, key, tasks, entries) : (history[key]?.workSec ?? 0)),
    [selectedHabit, tasks, entries, history]
  );
  const barTarget = selectedHabit ? selectedHabit.target : null;
  const barColor = selectedHabit ? selectedHabit.color : 'var(--heat-4)';

  const habitHeatData = useMemo(() => {
    if (!selectedHabit) return null;
    return buildHeatGrid(today, selYear, (key) => {
      const value = habitTotal(selectedHabit, key, tasks, entries);
      return {
        level: habitHeatLevel(value, selectedHabit.target),
        stats: undefined,
        sleep: undefined,
        habitValue: value,
      };
    });
  }, [selectedHabit, today, selYear, tasks, entries]);

  const weekBars = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const key = shiftDayKey(weekStart, i);
      return { key, date: parseKey(key) };
    });
    return computeBars(days, today, valueFn, barTarget, (d) => DOW_SHORT_MON[(d.getDay() + 6) % 7]);
  }, [weekStart, today, valueFn, barTarget]);

  const monthBars = useMemo(() => {
    const block = buildMonth(monthCursor.year, monthCursor.month);
    return computeBars(block.days, today, valueFn, barTarget, (d) => String(d.getDate()));
  }, [monthCursor, today, valueFn, barTarget]);

  const effectiveHeatData = habitHeatData ?? heatData;
  const { scrollRef, daysRef, cell } = useHeatCellSize(effectiveHeatData.colsCount);
  const title = selectedHabit ? (c: HeatCellInfo) => habitCellTitle(c, selectedHabit) : cellTitle;
  const { tooltip, show, move, hide } = useHoverTooltip();

  return (
    <section className="card heat-card" style={cell ? ({ '--heat-cell': `${cell}px` } as CSSProperties) : undefined}>
      <div className="heat-header">
        <h2 className="stats-title">🔥 {selectedHabit ? `${selectedHabit.emoji} ${selectedHabit.name}` : 'Активность'}</h2>
        <div className="heat-header-controls">
          {habits.length > 0 && (
            <Dropdown value={habitId} onChange={setHabitId} options={habitDropdownOptions(habits)} className="dd-habit" />
          )}
          <PeriodToggle value={period} onChange={setPeriod} />
          {period === 'year' && <YearSelector value={selYear} onChange={setSelYear} years={availableYears} />}
        </div>
      </div>

      {period === 'year' && (
        <div className="heat-scroll" ref={scrollRef} onScroll={hide}>
          <div
            className="heat-months"
            style={{ gridTemplateColumns: `repeat(${effectiveHeatData.colsCount}, var(--heat-cell))` }}
          >
            {effectiveHeatData.monthMarks.map((m) => (
              <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-body">
            <div className="heat-days" ref={daysRef}>
              {DOW_LABELS.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            <div className="heatmap" role="img" aria-label="Тепловая карта работы по дням">
              {effectiveHeatData.cells.flat().map((c) => (
                <div
                  key={c.key}
                  className={`heat-cell l${c.level}${c.future ? ' future' : ''}`}
                  onMouseEnter={(e) => !c.future && show(e, title(c))}
                  onMouseMove={move}
                  onMouseLeave={hide}
                />
              ))}
            </div>
          </div>
          <div className="heat-legend">
            <span>Меньше</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat-cell l${l}`} />
            ))}
            <span>Больше</span>
          </div>
        </div>
      )}

      {period === 'week' && (
        <div className="heat-period-body">
          <div className="heat-nav">
            <button type="button" className="btn btn-heat-nav" onClick={() => setWeekStart((w) => shiftDayKey(w, -7))}>
              ← Пред. неделя
            </button>
            <span className="heat-nav-label">{weekRangeLabel(weekStart)}</span>
            <button type="button" className="btn btn-heat-nav" onClick={() => setWeekStart(startOfWeek(todayKey()))}>
              Сегодня
            </button>
            <button type="button" className="btn btn-heat-nav" onClick={() => setWeekStart((w) => shiftDayKey(w, 7))}>
              След. неделя →
            </button>
          </div>
          <BarChart bars={weekBars} color={barColor} todayKeyStr={todayKeyStr} onEnter={(e, b) => show(e, barTooltipLines(b, selectedHabit))} onMove={move} onLeave={hide} />
        </div>
      )}

      {period === 'month' && (
        <div className="heat-period-body">
          <div className="heat-nav">
            <button
              type="button"
              className="btn btn-heat-nav"
              onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
            >
              ← Пред. месяц
            </button>
            <span className="heat-nav-label">{MONTHS_FULL[monthCursor.month]} {monthCursor.year}</span>
            <button
              type="button"
              className="btn btn-heat-nav"
              onClick={() => { const d = new Date(); setMonthCursor({ year: d.getFullYear(), month: d.getMonth() }); }}
            >
              Сегодня
            </button>
            <button
              type="button"
              className="btn btn-heat-nav"
              onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
            >
              След. месяц →
            </button>
          </div>
          <BarChart bars={monthBars} color={barColor} todayKeyStr={todayKeyStr} onEnter={(e, b) => show(e, barTooltipLines(b, selectedHabit))} onMove={move} onLeave={hide} />
        </div>
      )}

      <HoverTooltip tooltip={tooltip} />
    </section>
  );
}

// ── Section 2: yearly summary cards ────────────────────────────────────

export function ActivityStatsSummary({ stats }: { stats: StatsData }) {
  const { summary, yearTotalHrs } = stats;
  return (
    <div className="stats-summary-section">
      <h2 className="stats-title">📊 Статистика активности</h2>
      <div className="stats-summary">
        <div className="stat-card">
          <span className="stat-value">{fmtSumSec(summary.totalWorkSec)}</span>
          <span className="stat-label">Работа за год</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{summary.avgSleep !== null ? fmtDurMin(summary.avgSleep) : '—'}</span>
          <span className="stat-label">Средний сон</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{summary.daysWithSleep}/{summary.totalDays}</span>
          <span className="stat-label">Дней со сном</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{yearTotalHrs}</span>
          <span className="stat-label">Часов сна всего</span>
        </div>
      </div>
    </div>
  );
}

// ── Section 3: sleep tracker — monthly scroll, 24h per day ─────────────

export function SleepTracker({ stats }: { stats: StatsData }) {
  const { months, sleepLog, today, toggleHour, cycleQuality, scrollRef, onScroll, targetMonth, yearTotalHrs } = stats;
  return (
    <section className="card sleep-card">
      <div className="sleep-header">
        <h2 className="stats-title">😴 Трекер сна</h2>
        <div className="sleep-controls-top">
          <button
            type="button"
            className="btn btn-sleep-nav"
            title="К следующему месяцу"
            onClick={() => targetMonth(1)}
          >
            След. месяц →
          </button>
          <button
            type="button"
            className="btn btn-sleep-nav"
            title="К предыдущему месяцу"
            onClick={() => targetMonth(-1)}
          >
            ← Пред. месяц
          </button>
          <button
            type="button"
            className="btn btn-sleep-nav"
            onClick={() => targetMonth(0)}
          >
            Сегодня
          </button>
          <span className="sleep-info-total">Итого: {yearTotalHrs} ч.</span>
        </div>
      </div>

      <div className="sleep-month-scroll" ref={scrollRef} onScroll={onScroll}>
        {months.map((block) => (
          <SleepMonth
            key={block.key}
            block={block}
            entries={sleepLog}
            disabledFrom={today}
            onToggleHour={toggleHour}
            onCycleQuality={cycleQuality}
          />
        ))}
      </div>
    </section>
  );
}
