import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from './types';
import { DEFAULT_COLOR } from './types';
import { formatTime, formatDelta } from './format';
import { SpiralThermometer } from './SpiralThermometer';
import { ListView } from './ListView';
import { primeMotivationImages } from './motivation';
import HomePage from './HomePage';
import CalendarPage from './CalendarPage';
import { useDayStore } from './dayStore';
import type { Chain } from './schedule';
import {
  MIN_MS,
  buildChains,
  buildGroups,
  chainOfTask,
  isDone,
  shiftPatches,
  taskEndMs,
} from './schedule';
import { computeCredit } from './credit';
import { buildChainRun } from './chainRun';
import { newTaskId, spawnNextOccurrence } from './tasks';
import { useAuth } from './auth';
import './App.css';
import './calendar.css';

const MIN_BLOCK_PX = 72;
const MAX_BLOCK_PX = 200;

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

  // ── the plan, its groups, its sequences and the overtake ─────────

  const groups = useMemo(() => buildGroups(store.tasks), [store.tasks]);
  const chains = useMemo(() => buildChains(groups), [groups]);
  const credit = useMemo(() => computeCredit(groups, now), [groups, now]);

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
        />
      )}

      {page === 'home' && (
        <HomePage
          onOpenCalendar={() => leaveHome('calendar')}
          onOpenChain={(chain) => {
            void store.reload();
            openSequence(chain);
          }}
          chains={chains}
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

                <div className="timeline-tracks" style={{ height: timelineHeight }}>
                  {runTasks.map((task, idx) => {
                    const layout = taskLayout[idx];
                    const completed = task.completedAt !== null;
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
                        } ${task.type === 'rest' ? 'rest' : ''}`}
                        style={
                          {
                            top: layout.offset,
                            height: layout.height,
                            '--task-color': task.color,
                          } as React.CSSProperties
                        }
                      >
                        <div className="block-left">
                          <span className="task-emoji">{task.emoji}</span>
                          <span className="task-color-swatch" style={{ background: task.color }} />
                          {task.type === 'rest' && (
                            <span className="task-type-badge" title="Rest / break">
                              ☕ Rest
                            </span>
                          )}
                          <div className="block-info">
                            <span className="task-name">{task.name}</span>
                            <div className="block-timers">
                              <span className="task-planned-lg">
                                {formatTime(task.plannedTime * 1000, false)}
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
                      </div>
                    );
                  })}

                  <div className="finish-line" style={{ top: timelineHeight }}>
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
