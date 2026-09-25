/* eslint-disable react-refresh/only-export-components --
   This module intentionally exports the shared `useStatsData` hook (plus its
   `StatsData` type) alongside the three view sections that take it as a prop,
   so the sections can be reordered independently on the home page. Fast
   refresh for the components is sacrificed for that sharing on purpose. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DayStats, Habit, HabitEntry, Task } from './types';
import { dateKey, heatLevel, shiftDayKey, startOfWeek, todayKey } from './history';
import { habitHeatLevel, habitTargetOn, habitTotal } from './habits';
import {
  entryWithRange,
  extendToHour,
  fmtClock,
  hourSpan,
  MIN_PER_DAY,
  parseClock,
  rangeOf,
  sleepDuration,
} from './sleep';
import type { SleepData, SleepRange } from './sleep';
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

// How long a day's sleep lasted, in minutes — 0 when the day is unfilled.
const sleptMin = (entry: SleepData | undefined) => sleepDuration(rangeOf(entry));

// ── Data model ─────────────────────────────────────────────────────

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
  const range = rangeOf(c.sleep);
  if (range) {
    let t = `Сон: ${fmtDurMin(sleepDuration(range))} (${fmtClock(range.bed)}–${fmtClock(range.wake)})`;
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
  return `${fmtShortDate(c.key)}\n${habit.emoji} ${habit.name}: ${value} / ${habitTargetOn(habit, c.key)}${u}`;
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

const NUDGE_MIN = 5; // minutes one press of −/+ (or an arrow key) moves a moment
const POP_WIDTH = 252;
const POP_MARGIN = 10;
const POP_HEIGHT = 190; // enough to decide whether the popover fits below the row

// Moves a moment around the clock, so stepping back from 00:00 lands at 23:55
// rather than before the day starts.
const nudge = (min: number, by: number) => (((min + by) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;

// One editable moment: a clock the user can type into ("7", "730", "7:30" all
// read the same) with a press-to-step control on either side. The text is a
// draft while it has focus and mirrors the range the rest of the time, so
// clicking another cell of the same row moves it too.
function TimeField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (min: number) => void;
}) {
  const [draft, setDraft] = useState(() => fmtClock(value));
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!typing) setDraft(fmtClock(value));
  }, [value, typing]);

  const commit = () => {
    setTyping(false);
    const parsed = parseClock(draft);
    if (parsed !== null && parsed !== value) onChange(parsed);
    else setDraft(fmtClock(value));
  };

  const step = (by: number) => {
    setTyping(false);
    onChange(nudge(value, by));
  };

  return (
    <div className="sleep-time-field">
      <span className="sleep-time-label">{label}</span>
      <div className="sleep-time-row">
        <button
          type="button"
          className="sleep-time-step"
          onClick={() => step(-NUDGE_MIN)}
          aria-label={`${label}: на ${NUDGE_MIN} минут раньше`}
        >
          −
        </button>
        <input
          className="sleep-time-input"
          value={draft}
          inputMode="numeric"
          aria-label={label}
          onChange={(e) => {
            setTyping(true);
            setDraft(e.target.value);
          }}
          onFocus={(e) => {
            setTyping(true);
            e.target.select();
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              step(e.key === 'ArrowUp' ? NUDGE_MIN : -NUDGE_MIN);
            }
          }}
        />
        <button
          type="button"
          className="sleep-time-step"
          onClick={() => step(NUDGE_MIN)}
          aria-label={`${label}: на ${NUDGE_MIN} минут позже`}
        >
          +
        </button>
      </div>
    </div>
  );
}

// The exact moments of one night. Clicking a cell has already laid down the
// whole hours; this is where the two edges get their minutes. Edits apply as
// they are made, so there is nothing to confirm — it closes on Escape or on a
// click anywhere outside, and that click still reaches whatever it landed on,
// which is what lets the grid keep taking clicks while this is open.
function SleepTimePopover({ date, range, anchor, onChange, onClear, onClose }: {
  date: Date;
  range: SleepRange;
  anchor: { x: number; y: number; bottom: number };
  onChange: (range: SleepRange) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.max(
    POP_MARGIN,
    Math.min(anchor.x - POP_WIDTH / 2, window.innerWidth - POP_MARGIN - POP_WIDTH)
  );
  const below = anchor.bottom + POP_MARGIN;
  const top = below + POP_HEIGHT <= window.innerHeight ? below : anchor.y - POP_MARGIN - POP_HEIGHT;

  const dur = sleepDuration(range);
  const overnight = range.wake <= range.bed;

  return (
    <div className="sleep-pop" ref={boxRef} style={{ left, top, width: POP_WIDTH }}>
      <header className="sleep-pop-head">
        <span className="sleep-pop-date">
          {date.getDate()} {MONTHS_SHORT[date.getMonth()]}
        </span>
        <button type="button" className="sleep-pop-close" onClick={onClose} title="Закрыть">
          ✕
        </button>
      </header>

      <div className="sleep-pop-fields">
        <TimeField label="Заснул" value={range.bed} onChange={(bed) => onChange({ ...range, bed })} />
        <span className="sleep-pop-arrow" aria-hidden>
          →
        </span>
        <TimeField label="Проснулся" value={range.wake} onChange={(wake) => onChange({ ...range, wake })} />
      </div>

      <p className="sleep-pop-dur">
        {fmtDurMin(dur)}
        {overnight && <span className="sleep-pop-overnight"> · проснулся на следующий день</span>}
      </p>

      <button type="button" className="btn sleep-pop-clear" onClick={onClear}>
        Убрать сон за этот день
      </button>
    </div>
  );
}

function SleepDayRow({ date, dateKey: dk, entry, disabled, onPickHour, cycleQuality }: {
  date: Date;
  dateKey: string;
  entry?: SleepData;
  disabled: boolean;
  onPickHour: (hour: number, cell: DOMRect) => void;
  cycleQuality: () => void;
}) {
  const range = rangeOf(entry);
  const qual = entry?.quality ?? null;
  const spanTitle = range ? `${fmtClock(range.bed)}–${fmtClock(range.wake)} · ${fmtDurMin(sleepDuration(range))}` : null;

  return (
    <div className={`sleep-day-row${disabled ? ' future' : ''}`} data-key={dk}>
      <div className="sleep-day-num">
        {date.getDate()}
        <span className="sleep-day-mon">{MONTHS_SHORT[date.getMonth()].charAt(0)}</span>
      </div>
      {Array.from({ length: HOURS_PER_DAY }, (_, h) => h).map((h) => {
        const span = hourSpan(range, h);
        return (
          <button
            key={h}
            type="button"
            className={`sleep-cell${span ? ' checked' : ''}`}
            disabled={disabled}
            title={span && spanTitle ? spanTitle : `${h}:00`}
            onClick={(e) => onPickHour(h, e.currentTarget.getBoundingClientRect())}
          >
            {span && (
              <span
                className="sleep-cell-fill"
                style={{ left: `${span.from * 100}%`, width: `${(span.to - span.from) * 100}%` }}
              />
            )}
          </button>
        );
      })}
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
function SleepMonth({ block, entries, disabledFrom, onPickHour, onCycleQuality }: {
  block: MonthBlock;
  entries: Record<string, SleepData>;
  disabledFrom: Date;
  onPickHour: (dayKey: string, date: Date, hour: number, cell: DOMRect) => void;
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
          onPickHour={(h, cell) => onPickHour(d.key, d.date, h, cell)}
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
  pickHour: (dayKey: string, hour: number) => SleepRange | null;
  setRange: (dayKey: string, range: SleepRange | null) => void;
  cycleQuality: (dayKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  targetMonth: (delta: number) => void;
}

export function useStatsData(): StatsData {
  const [history, setHistory] = useState<Record<string, DayStats>>({});
  const [sleepLog, setSleepLog] = useState<Record<string, SleepData>>({});
  const [selYear, setSelYear] = useState(() => new Date().getFullYear());

  // The editing callbacks read the current log through this mirror instead of
  // closing over it, so they keep a stable identity while the popover holds on
  // to them across a stream of edits.
  const sleepLogRef = useRef(sleepLog);
  sleepLogRef.current = sleepLog;

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
    let totalMin = 0;
    let daysWithSleep = 0;

    for (const [k, e] of Object.entries(sleepLog)) {
      if (!e.hours.length && e.quality === null) continue;
      const dt = parseKey(k);
      if (dt.getFullYear() !== selYear) continue;
      const w = history[k];
      if (w) totalWorkSec += w.workSec;
      daysWithSleep++;
      totalMin += sleptMin(e);
    }

    return {
      totalWorkSec,
      avgSleep: daysWithSleep > 0 ? Math.round(totalMin / daysWithSleep) : null,
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
    let min = 0;
    for (const d of yearDays) min += sleptMin(sleepLog[d.key]);
    return Math.round(min / 60);
  }, [yearDays, sleepLog]);

  // ── Actions ──────────────────────────────────────────────────

  // One place where a day's entry reaches the server and the local copy: an
  // entry that has nothing left in it (no sleep, no rating) is deleted rather
  // than stored empty.
  const writeEntry = useCallback((dayKey: string, next: SleepData | null) => {
    void api.saveSleepLog(dayKey, next);
    setSleepLog((prev) => {
      if (next === null) {
        if (!(dayKey in prev)) return prev;
        const n = { ...prev };
        delete n[dayKey];
        return n;
      }
      return { ...prev, [dayKey]: next };
    });
  }, []);

  // Clicking an hour cell lays down whole hours, the same as it always has.
  // The range it leaves behind is returned so the caller can open the editor
  // on it — that is where the minutes are set.
  const pickHour = useCallback(
    (dayKey: string, hour: number): SleepRange | null => {
      const cur = sleepLogRef.current[dayKey];
      const range = extendToHour(rangeOf(cur), hour);
      writeEntry(dayKey, entryWithRange(cur, range));
      return range;
    },
    [writeEntry]
  );

  const setRange = useCallback(
    (dayKey: string, range: SleepRange | null) => {
      writeEntry(dayKey, entryWithRange(sleepLogRef.current[dayKey], range));
    },
    [writeEntry]
  );

  const cycleQuality = useCallback(
    (dayKey: string) => {
      const cur = sleepLogRef.current[dayKey] ?? { hours: [], quality: null };
      const nq = cur.quality === null ? 1 : cur.quality >= QUALITY_LEVELS - 1 ? null : cur.quality + 1;
      const next = { ...cur, quality: nq };
      writeEntry(dayKey, next.hours.length === 0 && nq === null ? null : next);
    },
    [writeEntry]
  );

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
    pickHour,
    setRange,
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
  target: number | null; // that day's habit quota; null without a habit
  label: string;
}

// Bars are scaled against the habit's own target when one is selected (so
// the chart reads as progress towards a goal) — each day against the quota it
// had then, since quotas are versioned. Without a habit there is no target,
// so they scale against the largest value in view instead — same idea as
// heatLevel's fixed buckets, but continuous for a handful of bars.
function computeBars(
  days: { key: string; date: Date }[],
  today: Date,
  valueFn: (key: string) => number,
  targetFn: ((key: string) => number) | null,
  labelFn: (date: Date) => string
): BarInfo[] {
  const rawValues = days.map((d) => valueFn(d.key));
  const dynMax = Math.max(1, ...rawValues);
  return days.map((d, i) => {
    const value = rawValues[i];
    const target = targetFn ? targetFn(d.key) : null;
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
    return { key: d.key, date: d.date, value, ratio, future, over, target, label: labelFn(d.date) };
  });
}

function barTooltipLines(b: BarInfo, habit: Habit | null): string {
  if (b.future) return '';
  const date = fmtShortDate(b.key);
  if (habit) {
    const u = habit.unit ? ` ${habit.unit}` : '';
    return `${date}\n${habit.emoji} ${habit.name}: ${b.value} / ${b.target}${u}`;
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
  const barTarget = useMemo(
    () => (selectedHabit ? (key: string) => habitTargetOn(selectedHabit, key) : null),
    [selectedHabit]
  );
  const barColor = selectedHabit ? selectedHabit.color : 'var(--heat-4)';

  const habitHeatData = useMemo(() => {
    if (!selectedHabit) return null;
    return buildHeatGrid(today, selYear, (key) => {
      const value = habitTotal(selectedHabit, key, tasks, entries);
      return {
        level: habitHeatLevel(value, habitTargetOn(selectedHabit, key)),
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

const SLEEP_CELL_MIN = 16;
const SLEEP_CELL_MAX = 48;

// Widens the hour cells to span the card instead of leaving the grid huddled
// against the left edge on a wide screen. The fixed parts of a row (the day
// number, the quality dot, the gaps) are read from the stylesheet rather than
// repeated here, so the breakpoint that shrinks them stays the one source of
// truth. Falls back to the CSS default until measured.
function useSleepCellWidth(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const [cell, setCell] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const num = (v: string, fallback: number) => parseFloat(cs.getPropertyValue(v)) || fallback;
      const fixed =
        parseFloat(cs.paddingLeft) +
        parseFloat(cs.paddingRight) +
        num('--sleep-num-w', 34) +
        num('--sleep-qual-w', 30) +
        num('--sleep-gap', 3) * (HOURS_PER_DAY + 1);
      const raw = Math.floor((el.clientWidth - fixed) / HOURS_PER_DAY);
      setCell(Math.min(SLEEP_CELL_MAX, Math.max(SLEEP_CELL_MIN, raw)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  return cell;
}

// Which day's exact moments are open for editing, and where over the grid the
// editor should sit. Held here rather than per row so only one is ever open.
interface SleepEdit {
  dayKey: string;
  date: Date;
  range: SleepRange;
  anchor: { x: number; y: number; bottom: number };
}

export function SleepTracker({ stats }: { stats: StatsData }) {
  const { months, sleepLog, today, pickHour, setRange, cycleQuality, scrollRef, onScroll, targetMonth, yearTotalHrs } =
    stats;
  const cellWidth = useSleepCellWidth(scrollRef);
  const [edit, setEdit] = useState<SleepEdit | null>(null);

  // A click on a cell does two things: it lays down the whole hours, and it
  // opens the editor on what that left, so the minutes are one keystroke away.
  // A click that emptied the day has nothing left to edit.
  const onPickHour = useCallback(
    (dayKey: string, date: Date, hour: number, cell: DOMRect) => {
      const range = pickHour(dayKey, hour);
      setEdit(
        range && { dayKey, date, range, anchor: { x: cell.left + cell.width / 2, y: cell.top, bottom: cell.bottom } }
      );
    },
    [pickHour]
  );

  // The popover is anchored to a cell in the scrolling grid, so it follows
  // nothing once the grid moves under it — close it instead of letting it
  // float over an unrelated row.
  const onScrollGrid = useCallback(() => {
    setEdit(null);
    onScroll();
  }, [onScroll]);

  const applyRange = useCallback(
    (range: SleepRange) => {
      setEdit((cur) => (cur ? { ...cur, range } : cur));
      if (edit) setRange(edit.dayKey, range);
    },
    [edit, setRange]
  );

  const clearDay = useCallback(() => {
    if (edit) setRange(edit.dayKey, null);
    setEdit(null);
  }, [edit, setRange]);

  return (
    <section
      className="card sleep-card"
      style={cellWidth !== null ? ({ '--sleep-cell': `${cellWidth}px` } as CSSProperties) : undefined}
    >
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

      <div className="sleep-month-scroll" ref={scrollRef} onScroll={onScrollGrid}>
        {months.map((block) => (
          <SleepMonth
            key={block.key}
            block={block}
            entries={sleepLog}
            disabledFrom={today}
            onPickHour={onPickHour}
            onCycleQuality={cycleQuality}
          />
        ))}
      </div>

      {edit && (
        <SleepTimePopover
          date={edit.date}
          range={edit.range}
          anchor={edit.anchor}
          onChange={applyRange}
          onClear={clearDay}
          onClose={() => setEdit(null)}
        />
      )}
    </section>
  );
}
