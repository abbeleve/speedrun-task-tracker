import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from './types';
import { DEFAULT_COLOR, TASK_COLORS, TASK_EMOJIS } from './types';
import type { DayStore } from './dayStore';
import type { Chain } from './schedule';
import {
  DAY_MIN,
  MIN_MS,
  buildGroups,
  clampStartMin,
  dayStartMs,
  daySegments,
  isDone,
  taskEndMs,
  taskStartMs,
} from './schedule';
import type { CreditSnapshot } from './credit';
import { computeCredit, projectedFinishMs } from './credit';
import { dateKey, shiftDayKey, todayKey } from './history';
import { newTaskId, spawnNextOccurrence } from './tasks';
import TaskDialog from './TaskDialog';

export type CalView = 'day' | 'week' | 'month';

interface CalendarPageProps {
  store: DayStore;
  now: number;
  credit: CreditSnapshot;
  chains: Chain[];
  onOpenChain: (chain: Chain) => void;
}

const PX_PER_HOUR = 52;
const PX_PER_MIN = PX_PER_HOUR / 60;
const SNAP_MIN = 5;
const DEFAULT_LENGTH_MIN = 60;
const MIN_LENGTH_MIN = 10;
const GUTTER_PX = 56; // hour labels on the left of the grid

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

// ── small formatters ───────────────────────────────────────────────

function hhmm(minFromMidnight: number): string {
  const m = ((Math.round(minFromMidnight) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function wallTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "1 ч 05 м" / "25 м" / "40 с" — compact, for durations and leads.
function dur(totalSec: number): string {
  const s = Math.max(0, Math.round(Math.abs(totalSec)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} ч ${String(m).padStart(2, '0')} м` : `${h} ч`;
  if (m > 0) return `${m} м`;
  return `${s} с`;
}

function signedDur(sec: number): string {
  if (Math.abs(sec) < 30) return 'ровно';
  return `${sec > 0 ? '+' : '−'}${dur(sec)}`;
}

function startOfWeek(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const shift = (date.getDay() + 6) % 7; // Monday-first
  return shiftDayKey(day, -shift);
}

function monthCells(day: string): string[] {
  const [y, m] = day.split('-').map(Number);
  const first = dateKey(new Date(y, m - 1, 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => shiftDayKey(start, i));
}

function snap(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

// ── drag gestures ──────────────────────────────────────────────────

type Gesture =
  | { kind: 'create'; day: string; anchorMin: number; startMin: number; endMin: number }
  | {
      kind: 'move';
      task: Task;
      grabMin: number; // where inside the block the pointer grabbed it
      day: string;
      startMin: number;
      moved: boolean;
    }
  | { kind: 'resize'; task: Task; day: string; lengthMin: number };

function CalendarPage({ store, now, credit, chains, onOpenChain }: CalendarPageProps) {
  const [view, setView] = useState<CalView>(() => {
    const saved = localStorage.getItem('speedrun_cal_view');
    return saved === 'day' || saved === 'month' ? saved : 'week';
  });
  const [anchor, setAnchor] = useState<string>(() => todayKey());
  const [dialog, setDialog] = useState<{ task: Task; isNew: boolean } | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('speedrun_cal_view', view);
  }, [view]);

  const today = todayKey();
  const tasks = store.tasks;

  const visibleDays = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') {
      const from = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => shiftDayKey(from, i));
    }
    return monthCells(anchor);
  }, [view, anchor]);

  // Scroll the working hours into view when the grid is first shown.
  useEffect(() => {
    if (view === 'month') return;
    const el = scrollerRef.current;
    if (!el) return;
    const nowDate = new Date();
    const focusMin = visibleDays.includes(today) ? nowDate.getHours() * 60 : 8 * 60;
    el.scrollTop = Math.max(0, (focusMin - 60) * PX_PER_MIN);
    // Only when the layout changes, not on every task edit.
  }, [view, today, visibleDays]);

  const openTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'open')
        .sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order),
    [tasks]
  );

  // ── task mutations ───────────────────────────────────────────────

  const completeTask = useCallback(
    (task: Task) => {
      store.patchTask(task.id, { status: 'done', finishedAt: Date.now() });
      const child = spawnNextOccurrence(task, newTaskId, task.day);
      if (child) store.upsertTask(child);
    },
    [store]
  );

  const reopenTask = useCallback(
    (task: Task) => {
      store.patchTask(task.id, { status: 'in-progress', finishedAt: null, completedAt: null });
      // Drop the occurrence this completion had scheduled ahead.
      const child = store.tasks.find((t) => t.repeatOf === task.id && !isDone(t));
      if (child) store.removeTask(child.id);
    },
    [store]
  );

  const saveFromDialog = useCallback(
    (task: Task) => {
      store.upsertTask(task);
      setDialog(null);
    },
    [store]
  );

  const deleteFromDialog = useCallback(() => {
    if (!dialog) return;
    store.removeTask(dialog.task.id);
    setDialog(null);
  }, [dialog, store]);

  const draftTask = useCallback((day: string, startMin: number, lengthMin: number): Task => {
    const i = Math.floor(Math.random() * TASK_COLORS.length);
    return {
      id: newTaskId(),
      name: '',
      plannedTime: Math.max(MIN_LENGTH_MIN, lengthMin) * 60,
      completedAt: null,
      start: clampStartMin(startMin, lengthMin * 60),
      finishedAt: null,
      order: 0,
      emoji: TASK_EMOJIS[i % TASK_EMOJIS.length],
      color: TASK_COLORS[i] ?? DEFAULT_COLOR,
      type: 'task',
      day,
      status: 'in-progress',
    };
  }, []);

  // ── pointer → slot ───────────────────────────────────────────────

  const slotAt = useCallback(
    (clientX: number, clientY: number): { day: string; min: number } | null => {
      const el = columnsRef.current;
      if (!el || visibleDays.length === 0) return null;
      const rect = el.getBoundingClientRect();
      const colWidth = rect.width / visibleDays.length;
      const idx = Math.max(
        0,
        Math.min(visibleDays.length - 1, Math.floor((clientX - rect.left) / colWidth))
      );
      const min = Math.max(0, Math.min(DAY_MIN, (clientY - rect.top) / PX_PER_MIN));
      return { day: visibleDays[idx], min };
    },
    [visibleDays]
  );

  const setGestureState = useCallback((next: Gesture | null) => {
    gestureRef.current = next;
    setGesture(next);
  }, []);

  // One window-level pointer session drives create / move / resize, so the
  // gesture keeps working when the pointer leaves the block it started on.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      if (g.kind === 'create') {
        const min = snap(slot.min);
        setGestureState({
          ...g,
          startMin: Math.min(g.anchorMin, min),
          endMin: Math.max(g.anchorMin + SNAP_MIN, min),
        });
      } else if (g.kind === 'move') {
        const startMin = snap(slot.min - g.grabMin);
        setGestureState({
          ...g,
          day: slot.day,
          startMin: clampStartMin(startMin, g.task.plannedTime),
          moved: true,
        });
      } else {
        const lengthMin = Math.max(MIN_LENGTH_MIN, snap(slot.min - (g.task.start ?? 0)));
        setGestureState({ ...g, lengthMin });
      }
    };

    const onUp = () => {
      const g = gestureRef.current;
      if (!g) return;
      setGestureState(null);
      if (g.kind === 'create') {
        const length = Math.max(MIN_LENGTH_MIN, g.endMin - g.startMin);
        setDialog({ task: draftTask(g.day, g.startMin, length), isNew: true });
      } else if (g.kind === 'move') {
        if (!g.moved) {
          setDialog({ task: g.task, isNew: false });
        } else if (g.day !== g.task.day || g.startMin !== g.task.start) {
          store.patchTask(g.task.id, { day: g.day, start: g.startMin });
        }
      } else if (g.lengthMin * 60 !== g.task.plannedTime) {
        store.patchTask(g.task.id, { plannedTime: g.lengthMin * 60 });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [slotAt, setGestureState, draftTask, store]);

  const startCreate = useCallback(
    (e: React.PointerEvent, day: string) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      const anchorMin = snap(slot.min);
      e.preventDefault();
      setGestureState({
        kind: 'create',
        day,
        anchorMin,
        startMin: anchorMin,
        endMin: anchorMin + DEFAULT_LENGTH_MIN,
      });
    },
    [slotAt, setGestureState]
  );

  const startMove = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'move',
        task,
        grabMin: slot.min - (task.day === slot.day ? (task.start ?? 0) : 0),
        day: task.day,
        startMin: task.start ?? 0,
        moved: false,
      });
    },
    [slotAt, setGestureState]
  );

  const startResize = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'resize',
        task,
        day: task.day,
        lengthMin: Math.round(task.plannedTime / 60),
      });
    },
    [setGestureState]
  );

  // Dropping a backlog card on the grid gives it a slot.
  const dropFromBacklog = useCallback(
    (e: React.DragEvent, day: string) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      store.patchTask(id, {
        day,
        start: clampStartMin(snap(slot.min), task.plannedTime),
        status: 'in-progress',
      });
    },
    [slotAt, store]
  );

  // ── navigation ───────────────────────────────────────────────────

  const step = useCallback(
    (dir: number) => {
      setAnchor((prev) => {
        if (view === 'day') return shiftDayKey(prev, dir);
        if (view === 'week') return shiftDayKey(prev, dir * 7);
        const [y, m] = prev.split('-').map(Number);
        return dateKey(new Date(y, m - 1 + dir, 1));
      });
    },
    [view]
  );

  const title = useMemo(() => {
    const [y, m, d] = anchor.split('-').map(Number);
    if (view === 'month') return `${MONTHS[m - 1]} ${y}`;
    if (view === 'day') {
      return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
    const from = visibleDays[0];
    const to = visibleDays[visibleDays.length - 1];
    const [, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const left = fm === tm ? `${fd}` : `${fd} ${MONTHS[fm - 1].slice(0, 3)}`;
    return `${left} – ${td} ${MONTHS[tm - 1].slice(0, 3)} ${ty}`;
  }, [anchor, view, visibleDays]);

  const nowMin = useMemo(() => {
    const d = new Date(now);
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }, [now]);

  const activeIds = useMemo(
    () => new Set(credit.active?.tasks.map((t) => t.id) ?? []),
    [credit.active]
  );

  // ── grid ─────────────────────────────────────────────────────────

  const renderGrid = () => (
    <div className="cal-grid" ref={scrollerRef}>
      <div className="cal-grid-inner" style={{ height: DAY_MIN * PX_PER_MIN }}>
        <div className="cal-hours" style={{ width: GUTTER_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal-hour" style={{ top: h * PX_PER_HOUR }}>
              <span>{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>
        <div className="cal-lines">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal-line" style={{ top: h * PX_PER_HOUR }} />
          ))}
        </div>
        <div className="cal-columns" ref={columnsRef} style={{ left: GUTTER_PX }}>
          {visibleDays.map((day) => renderColumn(day))}
        </div>
      </div>
    </div>
  );

  const renderColumn = (day: string) => {
    const segments = daySegments(tasks, day);
    const dayFrom = dayStartMs(day);
    const dayTo = dayFrom + DAY_MIN * MIN_MS;
    const dayChains = chains.filter(
      (c) => c.groups.length > 1 && c.endMs > dayFrom && c.startMs < dayTo
    );
    const isToday = day === today;
    const g = gesture;

    return (
      <div
        key={day}
        className={`cal-col${isToday ? ' today' : ''}`}
        data-day={day}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.cal-block')) return;
          startCreate(e, day);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropFromBacklog(e, day)}
      >
        {dayChains.map((chain) => {
          const top = Math.max(0, (chain.startMs - dayFrom) / MIN_MS) * PX_PER_MIN;
          const bottom = Math.min(DAY_MIN, (chain.endMs - dayFrom) / MIN_MS) * PX_PER_MIN;
          return (
            <button
              key={chain.id}
              type="button"
              className="cal-chain"
              style={{ top, height: Math.max(12, bottom - top) }}
              title={`Секвенция из ${chain.tasks.length} задач — открыть в трекере`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onOpenChain(chain)}
            >
              <span className="cal-chain-dot" />
            </button>
          );
        })}

        <div className="cal-col-body">
        {segments
          .filter((seg) => !(g?.kind === 'move' && g.task.id === seg.task.id))
          .map((seg) => {
          const task = seg.task;
          const resizing = g?.kind === 'resize' && g.task.id === task.id;
          const topMin = seg.topMin;
          const lengthMin = resizing ? g.lengthMin : seg.bottomMin - seg.topMin;
          const height = Math.max(16, lengthMin * PX_PER_MIN);
          const done = isDone(task);
          const active = activeIds.has(task.id);
          const width = 100 / seg.cols;
          const delta =
            done && task.finishedAt !== null ? (taskEndMs(task) - task.finishedAt) / 1000 : null;

          return (
            <div
              key={task.id}
              className={[
                'cal-block',
                done ? 'done' : '',
                active ? 'active' : '',
                task.type === 'rest' ? 'rest' : '',
                resizing ? 'dragging' : '',
                !seg.startsHere ? 'cont-top' : '',
                !seg.endsHere ? 'cont-bottom' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top: topMin * PX_PER_MIN,
                height,
                left: `${seg.col * width}%`,
                width: `${width}%`,
                '--task-color': task.color,
              } as React.CSSProperties}
              onPointerDown={(e) => startMove(e, task)}
              title={`${task.name} · ${hhmm(task.start ?? 0)}–${wallTime(taskEndMs(task))}`}
            >
              <div className="cal-block-head">
                <span className="cal-block-emoji">{task.emoji}</span>
                <span className="cal-block-name">{task.name || 'Без названия'}</span>
                <button
                  type="button"
                  className="cal-block-check"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (done) reopenTask(task);
                    else completeTask(task);
                  }}
                  title={done ? 'Вернуть в работу' : 'Закрыть задачу'}
                >
                  {done ? '↺' : '✓'}
                </button>
              </div>
              {height > 34 && (
                <div className="cal-block-meta">
                  <span>
                    {hhmm(seg.topMin)}–{hhmm(seg.topMin + lengthMin)}
                  </span>
                  {delta !== null && (
                    <span className={`cal-block-delta ${delta >= 0 ? 'ahead' : 'behind'}`}>
                      {signedDur(delta)}
                    </span>
                  )}
                </div>
              )}
              {done && task.finishedAt !== null && task.finishedAt < taskEndMs(task) && (
                <div
                  className="cal-block-actual"
                  style={{
                    top: Math.max(
                      0,
                      ((task.finishedAt - taskStartMs(task)) / MIN_MS) * PX_PER_MIN
                    ),
                  }}
                  title={`Закрыто в ${wallTime(task.finishedAt)}`}
                />
              )}
              <div
                className="cal-block-resize"
                onPointerDown={(e) => startResize(e, task)}
                title="Потянуть — изменить длительность"
              />
            </div>
          );
        })}

        {g?.kind === 'move' && g.day === day && (
          <div
            className="cal-block dragging"
            style={{
              top: g.startMin * PX_PER_MIN,
              height: Math.max(16, (g.task.plannedTime / 60) * PX_PER_MIN),
              '--task-color': g.task.color,
            } as React.CSSProperties}
          >
            <div className="cal-block-head">
              <span className="cal-block-emoji">{g.task.emoji}</span>
              <span className="cal-block-name">{g.task.name}</span>
            </div>
            <div className="cal-block-meta">
              <span>
                {hhmm(g.startMin)}–{hhmm(g.startMin + g.task.plannedTime / 60)}
              </span>
            </div>
          </div>
        )}

        {g?.kind === 'create' && g.day === day && (
          <div
            className="cal-block draft"
            style={{
              top: g.startMin * PX_PER_MIN,
              height: Math.max(16, (g.endMin - g.startMin) * PX_PER_MIN),
            }}
          >
            <div className="cal-block-meta">
              <span>
                {hhmm(g.startMin)}–{hhmm(g.endMin)}
              </span>
            </div>
          </div>
        )}

        {isToday && renderNowMarkers()}
        </div>
      </div>
    );
  };

  // The current time, plus a band showing the lead: how much of the plan the
  // overtake has already bought back (green ahead of now, red when behind).
  const renderNowMarkers = () => {
    const leadMin = credit.lead / 60;
    const bandTop = leadMin >= 0 ? nowMin : nowMin + leadMin;
    const bandHeight = Math.abs(leadMin);
    return (
      <>
        {bandHeight >= 1 && (
          <div
            className={`cal-lead-band ${leadMin >= 0 ? 'ahead' : 'behind'}`}
            style={{ top: bandTop * PX_PER_MIN, height: bandHeight * PX_PER_MIN }}
            title={`Обгон ${signedDur(credit.lead)}`}
          />
        )}
        <div className="cal-now" style={{ top: nowMin * PX_PER_MIN }}>
          <span className="cal-now-dot" />
        </div>
      </>
    );
  };

  // ── month ────────────────────────────────────────────────────────

  const renderMonth = () => {
    const [, anchorMonth] = anchor.split('-').map(Number);
    return (
      <div className="cal-month">
        <div className="cal-month-head">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="cal-month-grid">
          {visibleDays.map((day) => {
            const [, m] = day.split('-').map(Number);
            const dayTasks = (store.days[day] ?? []).filter((t) => t.status !== 'open');
            const sorted = [...dayTasks].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
            const endOfDay = dayStartMs(day) + DAY_MIN * MIN_MS;
            const dayCredit = computeCredit(buildGroups(dayTasks), endOfDay);
            const closed = dayTasks.some(isDone);
            return (
              <div
                key={day}
                className={[
                  'cal-cell',
                  m === anchorMonth ? '' : 'other-month',
                  day === today ? 'today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setAnchor(day);
                  setView('day');
                }}
              >
                <div className="cal-cell-head">
                  <span className="cal-cell-num">{Number(day.split('-')[2])}</span>
                  {closed && (
                    <span
                      className={`cal-cell-lead ${dayCredit.banked >= 0 ? 'ahead' : 'behind'}`}
                      title="Обгон на конец дня"
                    >
                      {signedDur(dayCredit.banked)}
                    </span>
                  )}
                </div>
                <div className="cal-cell-list">
                  {sorted.slice(0, 3).map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={`cal-chip${isDone(task) ? ' done' : ''}`}
                      style={{ '--task-color': task.color } as React.CSSProperties}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ task, isNew: false });
                      }}
                    >
                      <span className="cal-chip-time">{hhmm(task.start ?? 0)}</span>
                      <span className="cal-chip-emoji">{task.emoji}</span>
                      <span className="cal-chip-name">{task.name}</span>
                    </button>
                  ))}
                  {sorted.length > 3 && (
                    <span className="cal-cell-more">+{sorted.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── header / HUD ─────────────────────────────────────────────────

  const finishMs = projectedFinishMs(credit);
  const activeName = credit.active?.tasks.map((t) => t.name).join(' + ') ?? null;
  const nextGroup = credit.remaining[0] ?? null;
  const leadClass = credit.lead >= 0 ? 'ahead' : 'behind';

  return (
    <div className="cal-page">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="cal-btn" onClick={() => setAnchor(today)}>
            Сегодня
          </button>
          <button type="button" className="cal-btn cal-btn--icon" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="cal-btn cal-btn--icon" onClick={() => step(1)}>
            ›
          </button>
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="cal-seg cal-seg--views">
          {(['day', 'week', 'month'] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'active' : ''}
              onClick={() => setView(v)}
            >
              {v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
      </div>

      <div className={`cal-hud ${leadClass}${credit.frozen ? ' frozen' : ''}`}>
        <div className="cal-hud-main">
          <span className="cal-hud-label">
            {credit.lead >= 0 ? 'Обгон' : 'Отставание'}
          </span>
          <span className="cal-hud-value">{signedDur(credit.lead)}</span>
        </div>
        <div className="cal-hud-lines">
          <span className="cal-hud-state">
            {activeName
              ? `▶ идёт: ${activeName}`
              : nextGroup
                ? `⏸ заморожен до ${wallTime(nextGroup.startMs - credit.banked * 1000)}`
                : credit.epochStartMs !== null
                  ? '✓ всё запланированное закрыто'
                  : '— в плане пока пусто'}
          </span>
          {credit.active && (
            <span className="cal-hud-sub">
              закрыть сейчас → {signedDur(credit.projected)}
            </span>
          )}
          {finishMs !== null && (
            <span className="cal-hud-sub">
              финиш плана ≈ {wallTime(finishMs)}
            </span>
          )}
        </div>
      </div>

      <div className="cal-body">
        {view === 'month' ? renderMonth() : (
          <div className="cal-sheet">
            <div className="cal-days-head" style={{ paddingLeft: GUTTER_PX }}>
              {visibleDays.map((day) => {
                const [y, m, d] = day.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                return (
                  <button
                    key={day}
                    type="button"
                    className={`cal-day-head${day === today ? ' today' : ''}`}
                    onClick={() => {
                      setAnchor(day);
                      setView('day');
                    }}
                  >
                    <span className="cal-day-name">{WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                    <span className="cal-day-num">{d}</span>
                  </button>
                );
              })}
            </div>
            {renderGrid()}
          </div>
        )}

        <aside className="cal-backlog">
          <header className="cal-backlog-head">
            <h3>🗂 Бэклог</h3>
            <button
              type="button"
              className="cal-btn cal-btn--icon"
              title="Новая задача в бэклог"
              onClick={() =>
                setDialog({
                  task: { ...draftTask(anchor, 9 * 60, 60), status: 'open', start: null },
                  isNew: true,
                })
              }
            >
              ＋
            </button>
          </header>
          <p className="cal-backlog-hint">Перетащи карточку на сетку, чтобы поставить время</p>
          <div className="cal-backlog-list">
            {openTasks.map((task) => (
              <div
                key={task.id}
                className="cal-backlog-card"
                style={{ '--task-color': task.color } as React.CSSProperties}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                onClick={() => setDialog({ task, isNew: false })}
              >
                <span className="cal-chip-emoji">{task.emoji}</span>
                <span className="cal-chip-name">{task.name}</span>
                <span className="cal-chip-time">{dur(task.plannedTime)}</span>
              </div>
            ))}
            {openTasks.length === 0 && <p className="cal-backlog-empty">Пусто</p>}
          </div>
        </aside>
      </div>

      {dialog && (
        <TaskDialog
          task={dialog.task}
          isNew={dialog.isNew}
          onSave={saveFromDialog}
          onDelete={dialog.isNew ? undefined : deleteFromDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default CalendarPage;
