import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SessionState, Task } from './types';
import { DEFAULT_COLOR } from './types';
import { formatTime, formatDelta } from './format';
import { SpiralThermometer } from './SpiralThermometer';
import { ListView } from './ListView';
import { primeMotivationImages } from './motivation';
import HomePage from './HomePage';
import CalendarPage from './CalendarPage';
import { useDayStore } from './dayStore';
import { useHabits } from './habitStore';
import type { Chain } from './schedule';
import {
  MIN_MS,
  buildChains,
  buildGroups,
  buildRunChains,
  chainOfTask,
  dayKeyOf,
  isDone,
  reorderPatches,
  resizePatches,
  shiftPatches,
  taskEndMs,
} from './schedule';
import { computeCredit, creditGroups } from './credit';
import { useOvertakeHistorySync } from './overtakeHistory';
import { sumWeekOvertakeSec } from './weekOvertake';
import { buildChainRun } from './chainRun';
import { closeExpiredReminders, newTaskId, spawnNextOccurrence } from './tasks';
import { taskColorAnimationClass, taskColorStyle } from './taskAppearance';
import { useAuth } from './auth';
import './App.css';
import './calendar.css';

const MIN_BLOCK_PX = 72;
const MAX_BLOCK_PX = 200;

// The shortest a task can be dragged down to, and the increment its length
// snaps to once the resize handle is let go.
const MIN_TASK_SEC = 60;
const RESIZE_SNAP_SEC = 15;

// Editing a sequence from its own timeline: dragging a block's grip
// reorders it among its siblings, dragging its bottom edge resizes it. Both
// ride one window-level pointer session (mirrors the calendar's own drag
// gestures) so the gesture survives the pointer leaving the block it started
// on.
type TimelineGesture =
  | { kind: 'reorder'; taskId: string; fromIdx: number; overIdx: number; moved: boolean }
  | {
      kind: 'resize';
      taskId: string;
      startY: number;
      startHeight: number;
      startPlanned: number;
      deltaPx: number;
    };

// How often the wall clock is read. The whole app — the overtake, the playhead,
// the now-line — is a function of this tick, so it is fast enough for the
// spiral to move smoothly and cheap enough to run all day.
const TICK_MS = 500;

function wallTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function App() {
  const { user, logout } = useAuth();
  const store = useDayStore();
  const habits = useHabits();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('speedrun_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  const [view, setView] = useState<'timeline' | 'spiral' | 'list'>(() => {
    const saved = localStorage.getItem('speedrun_view');
    return saved === 'spiral' ? 'spiral' : saved === 'list' ? 'list' : 'timeline';
  });

  // 'calendar' = the plan (main screen), 'home' = kanban + sessions + stats,
  // 'tracker' = one sequence opened in the thermometer/spiral/list views.
  const [page, setPage] = useState<'calendar' | 'home' | 'tracker'>('calendar');

  // The sequence currently open in the tracker, addressed by one of its tasks
  // so that editing the plan cannot lose it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Scrub offset (ms) while dragging the timeline/spiral: the views may be
  // dragged to inspect another moment, and snap back to the wall clock on demand.
  const [previewSec, setPreviewSec] = useState<number | null>(null);

  const [congrats, setCongrats] = useState<{ id: string; name: string } | null>(null);
  const congratsTimerRef = useRef<number | null>(null);
  const [glow, setGlow] = useState<{ id: string; color: string } | null>(null);
  const glowTimerRef = useRef<number | null>(null);
  const prevTaskIdRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  // Renaming a block inline (timeline view): which task is being edited, and
  // the draft text before it is committed.
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Reorder/resize gesture — see TimelineGesture above.
  const [gesture, setGesture] = useState<TimelineGesture | null>(null);
  const gestureRef = useRef<TimelineGesture | null>(null);
  const setGestureState = useCallback((next: TimelineGesture | null) => {
    gestureRef.current = next;
    setGesture(next);
  }, []);

  useEffect(() => {
    localStorage.setItem('speedrun_view', view);
  }, [view]);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    localStorage.setItem('speedrun_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    primeMotivationImages();
  }, []);

  // A reminder is never closed by hand: once its window has passed it closes
  // itself, which is also what schedules a recurring one's next occurrence.
  // Held off while the kanban board (which writes to the backend directly) is
  // open and until the plan has been re-read after it, so a stale copy of a
  // day is never saved over the board's edits.
  const { loading: planLoading, tasks: planTasks, patchTasks, upsertTask } = store;
  useEffect(() => {
    if (planLoading || page === 'home') return;
    const closed = closeExpiredReminders(planTasks, now, newTaskId);
    if (!closed) return;
    patchTasks(closed.patches);
    for (const task of closed.spawned) upsertTask(task);
  }, [planLoading, page, planTasks, now, patchTasks, upsertTask]);

  // ── the plan, its groups, its sequences and the overtake ─────────

  const groups = useMemo(() => buildGroups(store.tasks), [store.tasks]);
  const chains = useMemo(() => buildChains(groups), [groups]);
  // What was worked in one go, which is not the same question as what is glued
  // into a sequence — the history timeline lists stretches, not sessions.
  const runChains = useMemo(() => buildRunChains(groups), [groups]);
  // The overtake reads work only — rest blocks stay in the sequences above but
  // never win or lose lead (see credit.ts, rule 7).
  const leadGroups = useMemo(() => creditGroups(store.tasks), [store.tasks]);
  const credit = useMemo(() => computeCredit(leadGroups, now), [leadGroups, now]);

  // Save each day's final lead to history once it closes — see overtakeHistory.ts.
  const todayKey = useMemo(() => dayKeyOf(now), [now]);
  const overtakeByDay = useOvertakeHistorySync(leadGroups, todayKey);
  const weekOvertakeSec = useMemo(
    () => sumWeekOvertakeSec(overtakeByDay, todayKey, credit.lead),
    [overtakeByDay, todayKey, credit.lead]
  );

  const openChain: Chain | null = useMemo(
    () => (openTaskId ? chainOfTask(chains, openTaskId) : null),
    [chains, openTaskId]
  );

  const run = useMemo(() => (openChain ? buildChainRun(openChain) : null), [openChain]);

  // Start an open sequence early: the whole thing slides to the current moment,
  // keeping the gaps inside it, and the tracker picks it up from there.
  const startOpenChainNow = useCallback(() => {
    if (!openChain) return;
    const deltaMs = Math.round((Date.now() - openChain.startMs) / MIN_MS) * MIN_MS;
    if (deltaMs !== 0) store.patchTasks(shiftPatches(openChain.tasks, deltaMs));
    setPreviewSec(null);
  }, [openChain, store]);

  const openSequence = useCallback((chain: Chain) => {
    setOpenTaskId(chain.tasks[0]?.id ?? null);
    setPreviewSec(null);
    setPage('tracker');
  }, []);

  // The kanban board still talks to the backend directly, so the plan is
  // flushed before handing over and re-read on the way back.
  const goHome = useCallback(() => {
    store.flush();
    setPage('home');
  }, [store]);

  const leaveHome = useCallback(
    (next: 'calendar' | 'tracker') => {
      void store.reload();
      setPage(next);
    },
    [store]
  );

  // ── completing tasks ─────────────────────────────────────────────

  const showCongrats = useCallback((name: string) => {
    if (congratsTimerRef.current !== null) window.clearTimeout(congratsTimerRef.current);
    setCongrats({ id: newTaskId(), name });
    congratsTimerRef.current = window.setTimeout(() => setCongrats(null), 3000);
  }, []);

  const completeTask = useCallback(
    (id: string) => {
      const task = store.tasks.find((t) => t.id === id);
      if (!task || isDone(task)) return;
      store.patchTask(id, { status: 'done', finishedAt: Date.now() });
      const child = spawnNextOccurrence(task, newTaskId, task.day);
      if (child) store.upsertTask(child);
      if (task.type !== 'rest') showCongrats(task.name);
    },
    [store, showCongrats]
  );

  const uncompleteTask = useCallback(
    (id: string) => {
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return;
      store.patchTask(id, { status: 'in-progress', finishedAt: null, completedAt: null });
      const child = store.tasks.find((t) => t.repeatOf === id && !isDone(t));
      if (child) store.removeTask(child.id);
    },
    [store]
  );

  const renameTask = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed) store.patchTask(id, { name: trimmed });
    },
    [store]
  );

  const changeTaskTime = useCallback(
    (id: string, plannedTime: number) => {
      if (plannedTime > 0) store.patchTask(id, { plannedTime });
    },
    [store]
  );

  const changeTaskColor = useCallback(
    (id: string, color: string) => store.patchTask(id, { color }),
    [store]
  );

  // ── editing the timeline view: rename inline, drag to reorder/resize ────

  const startRename = useCallback((task: Task) => {
    setEditingNameId(task.id);
    setEditNameValue(task.name);
  }, []);

  const commitRename = useCallback(() => {
    setEditingNameId((id) => {
      if (id) renameTask(id, editNameValue);
      return null;
    });
  }, [editNameValue, renameTask]);

  const startReorder = useCallback(
    (e: ReactPointerEvent, taskId: string, idx: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({ kind: 'reorder', taskId, fromIdx: idx, overIdx: idx, moved: false });
    },
    [setGestureState]
  );

  const startResize = useCallback(
    (e: ReactPointerEvent, task: Task, height: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'resize',
        taskId: task.id,
        startY: e.clientY,
        startHeight: height,
        startPlanned: task.plannedTime,
        deltaPx: 0,
      });
    },
    [setGestureState]
  );

  // ── the open sequence, as an elapsed-clock run ───────────────────

  const runTasks = useMemo(() => run?.tasks ?? [], [run]);
  const cumulativeTimes = useMemo(() => run?.cumulativeTimes ?? [], [run]);
  const totalPlannedSec = run?.totalSec ?? 0;

  const wallSec = run ? run.toRunSec(now) : 0;
  const elapsedSec = previewSec ?? wallSec;

  const sessionState: SessionState = useMemo(() => {
    if (!openChain) return 'idle';
    if (openChain.tasks.every(isDone)) return 'finished';
    if (now < openChain.startMs) return 'idle';
    if (now > openChain.endMs) return 'finished';
    return 'running';
  }, [openChain, now]);

  const currentTaskIdx = useMemo(
    () => runTasks.findIndex((t) => t.completedAt === null),
    [runTasks]
  );

  const currentTask = useMemo(() => {
    if (runTasks.length === 0) return null;
    return currentTaskIdx >= 0 ? runTasks[currentTaskIdx] : runTasks[runTasks.length - 1];
  }, [runTasks, currentTaskIdx]);

  // The live delta of the sequence: what closing the running group right now
  // would bank. Negative = ahead, matching the views' colour coding.
  const currentDeltaMs = useMemo(() => {
    if (!openChain || !credit.active) return null;
    const inChain = openChain.tasks.some((t) => t.id === credit.active?.tasks[0].id);
    if (!inChain) return null;
    return -credit.projected * 1000;
  }, [openChain, credit]);

  const maxPlannedSec = useMemo(
    () => runTasks.reduce((max, t) => Math.max(max, t.plannedTime), 0),
    [runTasks]
  );

  const blockHeight = useCallback(
    (plannedTime: number) => {
      if (maxPlannedSec <= 0) return MIN_BLOCK_PX;
      return MIN_BLOCK_PX + (MAX_BLOCK_PX - MIN_BLOCK_PX) * Math.sqrt(plannedTime / maxPlannedSec);
    },
    [maxPlannedSec]
  );

  const taskLayout = useMemo(() => {
    const layout: { offset: number; height: number }[] = [];
    let offset = 0;
    for (const t of runTasks) {
      const h = blockHeight(t.plannedTime);
      layout.push({ offset, height: h });
      offset += h;
    }
    return layout;
  }, [runTasks, blockHeight]);

  const timelineHeight = useMemo(
    () => taskLayout.reduce((sum, l) => sum + l.height, 0),
    [taskLayout]
  );

  // Where a task's block actually is on screen while it is being dragged: a
  // reorder previews the new order in place, a resize previews the new
  // height and pushes everything after it down. Nothing here is committed —
  // it only reads back on pointer-up (see the gesture effect below).
  const displayLayout = useMemo(() => {
    if (gesture?.kind === 'reorder') {
      const { fromIdx, overIdx } = gesture;
      return runTasks.map((_, idx) => {
        let target = idx;
        if (idx === fromIdx) target = overIdx;
        else if (fromIdx < overIdx && idx > fromIdx && idx <= overIdx) target = idx - 1;
        else if (fromIdx > overIdx && idx >= overIdx && idx < fromIdx) target = idx + 1;
        return taskLayout[target];
      });
    }
    if (gesture?.kind === 'resize') {
      const idx = runTasks.findIndex((t) => t.id === gesture.taskId);
      if (idx === -1) return taskLayout;
      const newHeight = Math.max(24, gesture.startHeight + gesture.deltaPx);
      const deltaH = newHeight - taskLayout[idx].height;
      return taskLayout.map((l, i) => {
        if (i < idx) return l;
        if (i === idx) return { offset: l.offset, height: newHeight };
        return { offset: l.offset + deltaH, height: l.height };
      });
    }
    return taskLayout;
  }, [gesture, taskLayout, runTasks]);

  // The planned length the resize would commit to if let go right now —
  // mirrors the snapping math the pointer-up handler applies, so the number
  // shown on the block while dragging matches what actually lands.
  const liveResizeSec = useMemo(() => {
    if (gesture?.kind !== 'resize') return null;
    const pxPerSec = gesture.startHeight / Math.max(1, gesture.startPlanned);
    const rawPlanned = gesture.startPlanned + gesture.deltaPx / pxPerSec;
    return Math.max(MIN_TASK_SEC, Math.round(rawPlanned / RESIZE_SNAP_SEC) * RESIZE_SNAP_SEC);
  }, [gesture]);

  const displayTimelineHeight = useMemo(
    () => displayLayout.reduce((sum, l) => sum + l.height, 0),
    [displayLayout]
  );

  // One window-level pointer session drives both the reorder and the resize
  // gesture, so dragging keeps working once the pointer leaves the block (or
  // even the timeline) it started on — same pattern as the calendar's own
  // drag gestures.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.kind === 'reorder') {
        const rect = tracksRef.current?.getBoundingClientRect();
        if (!rect) return;
        const y = e.clientY - rect.top;
        let overIdx = taskLayout.length - 1;
        for (let i = 0; i < taskLayout.length; i++) {
          if (y < taskLayout[i].offset + taskLayout[i].height / 2) {
            overIdx = i;
            break;
          }
        }
        if (overIdx !== g.overIdx || !g.moved) setGestureState({ ...g, overIdx, moved: true });
      } else {
        const deltaPx = e.clientY - g.startY;
        if (deltaPx !== g.deltaPx) setGestureState({ ...g, deltaPx });
      }
    };

    const onUp = () => {
      const g = gestureRef.current;
      if (!g) return;
      setGestureState(null);
      if (g.kind === 'reorder') {
        if (g.moved && g.fromIdx !== g.overIdx) {
          store.patchTasks(reorderPatches(runTasks, g.fromIdx, g.overIdx));
        }
      } else {
        const pxPerSec = g.startHeight / Math.max(1, g.startPlanned);
        const rawPlanned = g.startPlanned + g.deltaPx / pxPerSec;
        const plannedTime = Math.max(
          MIN_TASK_SEC,
          Math.round(rawPlanned / RESIZE_SNAP_SEC) * RESIZE_SNAP_SEC
        );
        if (plannedTime !== g.startPlanned) {
          store.patchTasks(resizePatches(runTasks, g.taskId, plannedTime));
        }
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
  }, [taskLayout, runTasks, store, setGestureState]);

  const playheadPx = useMemo(() => {
    let sec = elapsedSec;
    let px = 0;
    for (let i = 0; i < runTasks.length; i++) {
      const h = taskLayout[i].height;
      const span = runTasks[i].plannedTime;
      if (sec <= span) {
        px += span > 0 ? (sec / span) * h : 0;
        break;
      }
      sec -= span;
      px += h;
    }
    return Math.min(px, timelineHeight);
  }, [elapsedSec, runTasks, taskLayout, timelineHeight]);

  // Scrubbing: dragging the thermometer or the spiral route inspects another
  // moment of the sequence without touching the clock.
  const seek = useCallback(
    (ms: number) => setPreviewSec(Math.max(0, ms / 1000)),
    []
  );

  const rulerMarks = useMemo(() => {
    if (totalPlannedSec <= 0 || runTasks.length === 0) return [];
    const pxPerSec = timelineHeight / totalPlannedSec;
    const nice = [60, 120, 300, 600, 900, 1800, 3600];
    const interval = nice.find((iv) => iv * pxPerSec >= 40) ?? 3600;
    const marks: { sec: number; label: string; px: number }[] = [];
    let nextMark = interval;
    let secAccum = 0;
    let pxAccum = 0;
    for (let i = 0; i < runTasks.length; i++) {
      const span = runTasks[i].plannedTime;
      const h = taskLayout[i].height;
      while (nextMark <= secAccum + span && span > 0) {
        marks.push({
          sec: nextMark,
          label: formatTime(nextMark * 1000, false),
          px: pxAccum + ((nextMark - secAccum) / span) * h,
        });
        nextMark += interval;
      }
      secAccum += span;
      pxAccum += h;
    }
    return marks;
  }, [runTasks, taskLayout, totalPlannedSec, timelineHeight]);

  // Flash the edge glow when the sequence moves on to another task.
  useEffect(() => {
    const task = currentTask;
    const prevId = prevTaskIdRef.current;
    prevTaskIdRef.current = task?.id ?? null;
    if (!task || prevId === null || prevId === task.id) return;
    if (glowTimerRef.current !== null) window.clearTimeout(glowTimerRef.current);
    setGlow({ id: task.id, color: task.color });
    glowTimerRef.current = window.setTimeout(() => setGlow(null), 1800);
  }, [currentTask]);

  // A sequence that has scrolled into the past and is fully closed is dropped
  // from the tracker, so the tab never shows a stale plan.
  useEffect(() => {
    if (page === 'tracker' && openTaskId && !openChain) setPage('calendar');
  }, [page, openTaskId, openChain]);

  const formatEnd = useCallback(
    (secondsFromStart: number) => (run ? wallTime(run.toWallMs(secondsFromStart)) : '—'),
    [run]
  );

  const leadLabel = credit.lead >= 0 ? 'обгон' : 'отставание';
  const remainingSec = openChain ? Math.max(0, (openChain.endMs - now) / 1000 - credit.lead) : 0;

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="icon">⏱</span> SpeedRun Tasks
        </h1>
        <button
          className="theme-toggle"
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {darkMode ? '☀️' : '🌙'}
          <span className="theme-toggle-label">{darkMode ? 'Light' : 'Dark'}</span>
        </button>
        <button
          className="btn btn-logout"
          onClick={() => void logout()}
          title={`Выйти (${user ?? ''})`}
        >
          🚪 Выйти
        </button>

        {page === 'tracker' && (
          <div className="view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`view-toggle-btn ${view === 'timeline' ? 'active' : ''}`}
              onClick={() => setView('timeline')}
              title="Таймлайн в виде термометра"
            >
              🌡️<span className="view-toggle-label">Timeline</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${view === 'spiral' ? 'active' : ''}`}
              onClick={() => setView('spiral')}
              title="Спиральная траектория в космосе"
            >
              🌀<span className="view-toggle-label">Spiral</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
              title="Список задач с разворачивающимся термометром"
            >
              📜<span className="view-toggle-label">List</span>
            </button>
          </div>
        )}

        <button
          className={`btn btn-stats-nav ${page === 'calendar' ? 'active' : ''}`}
          onClick={() => (page === 'home' ? leaveHome('calendar') : setPage('calendar'))}
          title="Календарь: план дня, недели и месяца"
        >
          📅<span className="view-toggle-label">Календарь</span>
        </button>
        <button
          className={`btn btn-stats-nav ${page === 'home' ? 'active' : ''}`}
          onClick={goHome}
          title="Главная: канбан, сессии и статистика"
        >
          🏠<span className="view-toggle-label">Главная</span>
        </button>
        {openChain && (
          <button
            className={`btn btn-stats-nav ${page === 'tracker' ? 'active' : ''}`}
            onClick={() => (page === 'home' ? leaveHome('tracker') : setPage('tracker'))}
            title="Трекер: открытая секвенция"
          >
            ⏱<span className="view-toggle-label">Секвенция</span>
          </button>
        )}

        {page === 'tracker' && openChain && (
          <div className="session-controls">
            <span className="viewing-run-label">
              ▶ {wallTime(openChain.startMs)}–{wallTime(openChain.endMs)} · {leadLabel}{' '}
              {formatDelta(-credit.lead * 1000)}
            </span>
            {now < openChain.startMs && (
              <button
                className="btn btn-resume"
                onClick={startOpenChainNow}
                title="Перенести всю секвенцию на текущее время и начать её сейчас"
              >
                ▶ Начать сейчас
              </button>
            )}
            {previewSec !== null && (
              <button
                className="btn btn-resume"
                onClick={() => setPreviewSec(null)}
                title="Вернуться к текущему времени"
              >
                ⟲ Сейчас
              </button>
            )}
            <button
              className="btn btn-reset"
              onClick={() => {
                setOpenTaskId(null);
                setPage('calendar');
              }}
              title="Закрыть секвенцию"
            >
              ✕ Закрыть
            </button>
          </div>
        )}
      </header>

      {page === 'calendar' && (
        <CalendarPage
          store={store}
          now={now}
          credit={credit}
          chains={chains}
          onOpenChain={openSequence}
          habits={habits.habits}
          weekOvertakeSec={weekOvertakeSec}
        />
      )}

      {page === 'home' && (
        <HomePage
          onOpenCalendar={() => leaveHome('calendar')}
          onOpenChain={(chain) => {
            void store.reload();
            openSequence(chain);
          }}
          runChains={runChains}
          habits={habits}
          tasks={store.tasks}
          weekOvertakeSec={weekOvertakeSec}
        />
      )}

      {page === 'tracker' && (
        <>
          <footer className="footer">
            <div className="timer-block timer-next">
              <span className="timer-label">⏳ Осталось по плану</span>
              <span className="timer-value">{formatTime(remainingSec * 1000, false)}</span>
            </div>
            <div className="timer-block timer-clock">
              <span className="timer-label">🕐 Текущее время</span>
              <span className="timer-value timer-clock-value">{wallTime(now)}</span>
            </div>
            <div className="timer-block timer-finish">
              <span className="timer-label">🎯 Вы закончите в</span>
              <span className="timer-value timer-finish-value">
                {openChain ? wallTime(openChain.endMs - credit.lead * 1000) : '—'}
              </span>
            </div>
            <div className="timer-block timer-session">
              <span className="timer-label">🏁 {leadLabel}</span>
              <span className="timer-value timer-main">{formatDelta(-credit.lead * 1000)}</span>
              <span className="timer-planned">
                Planned: {formatTime(totalPlannedSec * 1000, false)}
              </span>
            </div>
          </footer>

          <div className="timeline-container" ref={timelineRef}>
            {runTasks.length === 0 ? (
              <div className="empty-state">
                <p>Секвенция пуста</p>
                <p className="hint">Поставь задачи подряд в календаре и открой их здесь.</p>
              </div>
            ) : view === 'list' ? (
              <ListView
                tasks={runTasks}
                cumulativeTimes={cumulativeTimes}
                elapsedSec={elapsedSec}
                sessionState={sessionState}
                currentTaskIdx={currentTaskIdx}
                deltaMs={currentDeltaMs}
                onCompleteTask={completeTask}
                onSeek={seek}
                formatEnd={formatEnd}
              />
            ) : view === 'spiral' ? (
              <div className="spiral-view">
                <SpiralThermometer
                  tasks={runTasks}
                  cumulativeTimes={cumulativeTimes}
                  totalPlannedSec={totalPlannedSec}
                  elapsedSec={elapsedSec}
                  sessionState={sessionState}
                  currentTaskColor={currentTask?.color ?? DEFAULT_COLOR}
                  currentTaskIdx={currentTaskIdx}
                  deltaMs={currentDeltaMs}
                  onCompleteTask={completeTask}
                  onUncompleteTask={uncompleteTask}
                  onRenameTask={renameTask}
                  onChangeTaskTime={changeTaskTime}
                  onChangeTaskColor={changeTaskColor}
                  onSeek={seek}
                />
              </div>
            ) : (
              <div className="timeline-inner">
                <div
                  className="timeline-thermo"
                  style={
                    {
                      height: timelineHeight,
                      '--thermo-color': currentTask?.color,
                    } as React.CSSProperties
                  }
                >
                  <div className="thermo-fill" style={{ height: playheadPx }} />
                  <div className="thermo-marks">
                    <div className="thermo-mark" style={{ top: 12 }}>
                      <span className="thermo-mark-label">0:00</span>
                    </div>
                    {rulerMarks.map((m) => (
                      <div key={m.sec} className="thermo-mark" style={{ top: m.px }}>
                        <span className="thermo-mark-label">{m.label}</span>
                      </div>
                    ))}
                  </div>
                  {runTasks.map((task, idx) => (
                    <div
                      key={task.id}
                      className={`thermo-dot ${elapsedSec >= cumulativeTimes[idx] ? 'filled' : ''}`}
                      style={
                        {
                          top: taskLayout[idx].offset,
                          '--dot-color': task.color,
                        } as React.CSSProperties
                      }
                      title={task.name}
                    >
                      <span className="thermo-dot-emoji">{task.emoji}</span>
                    </div>
                  ))}
                  <div
                    className="thermo-marker"
                    style={{ transform: `translateY(${playheadPx}px)` }}
                  />
                </div>

                <div
                  className="timeline-tracks"
                  ref={tracksRef}
                  style={{ height: displayTimelineHeight }}
                >
                  {runTasks.map((task, idx) => {
                    const layout = displayLayout[idx];
                    const completed = task.completedAt !== null;
                    const isResizingThis =
                      gesture?.kind === 'resize' && gesture.taskId === task.id;
                    const isDraggingThis =
                      gesture?.kind === 'reorder' && gesture.taskId === task.id;
                    const isDropTarget =
                      gesture?.kind === 'reorder' &&
                      gesture.overIdx === idx &&
                      gesture.taskId !== task.id;
                    const isCurrent = idx === currentTaskIdx && sessionState !== 'idle';
                    const plannedEndSec = cumulativeTimes[idx] + task.plannedTime;

                    // A closed block's delta is measured against its own slot;
                    // the running one shows the live overtake of the sequence.
                    const delta = completed
                      ? (task.completedAt! - plannedEndSec) * 1000
                      : isCurrent
                        ? currentDeltaMs
                        : null;

                    const segmentTime = completed
                      ? formatTime(
                          (task.completedAt! -
                            (idx > 0 ? (runTasks[idx - 1].completedAt ?? cumulativeTimes[idx]) : 0)) *
                            1000,
                          true
                        )
                      : null;

                    // When the block will really end: its planned end, pulled
                    // forward by the lead that has already been won.
                    const endMs = completed
                      ? run!.toWallMs(task.completedAt!)
                      : taskEndMs(task) - credit.lead * 1000;

                    return (
                      <div
                        key={task.id}
                        className={`task-block ${completed ? 'completed' : ''} ${
                          isCurrent ? 'current' : ''
                        } ${task.type === 'rest' ? 'rest' : ''} ${
                          isDraggingThis ? 'dragging' : ''
                        } ${isResizingThis ? 'resizing' : ''} ${isDropTarget ? 'drag-over' : ''}`}
                        style={
                          {
                            top: layout.offset,
                            height: layout.height,
                            '--task-color': task.color,
                          } as React.CSSProperties
                        }
                      >
                        <div className="block-left">
                          {task.type !== 'rest' && runTasks.length > 1 && (
                            <span
                              className="drag-handle"
                              title="Перетащи, чтобы переместить задачу в секвенции"
                              onPointerDown={(e) => startReorder(e, task.id, idx)}
                            >
                              ⠿
                            </span>
                          )}
                          <span className="task-emoji">{task.emoji}</span>
                          <span
                            className={`task-color-swatch ${taskColorAnimationClass(task.colorAnimation)}`}
                            style={taskColorStyle(task.color, task.colorAnimation) as React.CSSProperties}
                          />
                          {task.type === 'rest' && (
                            <span className="task-type-badge" title="Rest / break">
                              ☕ Rest
                            </span>
                          )}
                          <div className="block-info">
                            {editingNameId === task.id ? (
                              <input
                                className="task-name-input"
                                autoFocus
                                value={editNameValue}
                                onChange={(e) => setEditNameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename();
                                  if (e.key === 'Escape') setEditingNameId(null);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="task-name"
                                title="Двойной клик — переименовать"
                                onDoubleClick={() => startRename(task)}
                              >
                                {task.name}
                              </span>
                            )}
                            <div className="block-timers">
                              <span className={`task-planned-lg ${isResizingThis ? 'live' : ''}`}>
                                {formatTime(
                                  (isResizingThis ? liveResizeSec! : task.plannedTime) * 1000,
                                  false
                                )}
                              </span>
                            </div>
                            <span
                              className={`task-delta ${delta !== null && delta < 0 ? 'ahead' : ''} ${
                                delta !== null && delta > 0 ? 'behind' : ''
                              }`}
                            >
                              {delta !== null ? formatDelta(delta) : '—'}
                            </span>
                          </div>
                        </div>

                        <div className="block-right">
                          <span className="task-segment">{segmentTime ?? '—'}</span>
                          <span className="task-realtime">{wallTime(endMs)}</span>
                          <div className="task-actions">
                            {!completed ? (
                              <button
                                className="btn btn-complete"
                                onClick={() => completeTask(task.id)}
                                title="Закрыть задачу"
                              >
                                ✓
                              </button>
                            ) : (
                              <button
                                className="btn btn-undo"
                                onClick={() => uncompleteTask(task.id)}
                                title="Вернуть в работу"
                              >
                                ↩
                              </button>
                            )}
                          </div>
                        </div>

                        <div
                          className="resize-handle"
                          title="Потяни, чтобы изменить длительность"
                          onPointerDown={(e) => startResize(e, task, layout.height)}
                        />
                      </div>
                    );
                  })}

                  <div className="finish-line" style={{ top: displayTimelineHeight }}>
                    <span className="finish-label">🏁 Finish</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {congrats && (
        <div className="congrats-overlay" key={congrats.id} aria-hidden="true">
          <div className="congrats-text">
            <span className="congrats-emoji">🎉</span>
            <div>
              <div className="congrats-title">Great job!</div>
              <div className="congrats-sub">"{congrats.name}" completed</div>
            </div>
          </div>
        </div>
      )}

      {glow && (
        <div
          key={glow.id}
          className="task-glow"
          style={{ '--glow-color': glow.color } as React.CSSProperties}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default App;
