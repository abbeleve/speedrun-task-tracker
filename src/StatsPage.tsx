import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DayStats } from './types';
import {
  dateKey,
  heatLevel,
  loadHistory,
  loadSleepLog,
  saveSleepLog,
} from './history';

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

// ── Year selector ──────────────────────────────────────────────────

function YearSelector({ value, onChange, years }: {
  value: number;
  onChange: (v: number) => void;
  years: number[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="year-select">
      {years.map((y) => (<option key={y} value={y}>{y}</option>))}
    </select>
  );
}

// ── Main page ──────────────────────────────────────────────────────

function StatsPage() {
  const [history] = useState<Record<string, DayStats>>(() => loadHistory());
  const [sleepLog, setSleepLog] = useState<Record<string, SleepData>>(() => loadSleepLog());
  const [selYear, setSelYear] = useState(() => new Date().getFullYear());

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
  const heatData = useMemo(() => {
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
        const st = history[key];
        col.push({
          key,
          level: st ? heatLevel(st.workSec) : 0,
          future: d.getTime() > today.getTime(),
          stats: st,
          sleep: sleepLog[key],
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
  }, [history, sleepLog, today, selYear]);

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
        saveSleepLog(dayKey, null);
        setSleepLog((prev) => {
          const n = { ...prev };
          delete n[dayKey];
          return n;
        });
      } else {
        saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      }
    } else if (existing.length === 0) {
      // First click
      saveSleepLog(dayKey, { hours: [hour], quality: null });
      setSleepLog((prev) => ({ ...prev, [dayKey]: { hours: [hour], quality: null } }));
    } else {
      const lo = existing[0];
      const hi = existing[existing.length - 1];

      if (hour > hi) {
        const extend: number[] = [];
        for (let h = hi + 1; h <= hour; h++) extend.push(h);
        const next = { ...cur, hours: [...existing, ...extend] };
        saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      } else if (hour < lo) {
        const extend: number[] = [];
        for (let h = hour; h < lo; h++) extend.push(h);
        const next = { ...cur, hours: [...extend, ...existing] };
        saveSleepLog(dayKey, next);
        setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
      }
      // inside range → no change
    }
  };

  const cycleQuality = (dayKey: string) => {
    const cur = sleepLog[dayKey] ?? { hours: [], quality: null };
    const nq = cur.quality === null ? 1 : cur.quality >= QUALITY_LEVELS - 1 ? null : cur.quality + 1;
    const next = { ...cur, quality: nq };
    saveSleepLog(dayKey, next);
    setSleepLog((prev) => ({ ...prev, [dayKey]: next }));
  };

  const fmtSumSec = (sec: number): string => {
    const hrs = sec / 3600;
    if (hrs >= 100) return `${Math.round(hrs / 10) * 10}ч+`;
    if (hrs >= 10) return `${Math.round(hrs)}ч`;
    return fmtSec(sec);
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

  return (
    <div className="stats-page">
      <h2 className="stats-title">📊 Статистика активности</h2>

      {/* Summary cards */}
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

      {/* Heatmap — full year */}
      <section className="card heat-card">
        <div className="heat-header">
          <h3>🔥 Активность</h3>
          <YearSelector value={selYear} onChange={setSelYear} years={availableYears} />
        </div>
        <div className="heat-scroll">
          <div
            className="heat-months"
            style={{ gridTemplateColumns: `repeat(${heatData.colsCount}, var(--heat-cell))` }}
          >
            {heatData.monthMarks.map((m) => (
              <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-body">
            <div className="heat-days">
              {DOW_LABELS.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            <div className="heatmap" role="img" aria-label="Тепловая карта работы по дням">
              {heatData.cells.flat().map((c) => (
                <div key={c.key} className={`heat-cell l${c.level}${c.future ? ' future' : ''}`} title={cellTitle(c)} />
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
      </section>

      {/* Sleep tracker — monthly scroll, 24h per day */}
      <section className="card sleep-card">
        <div className="sleep-header">
          <h3>😴 Трекер сна</h3>
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
    </div>
  );
}

export default StatsPage;
