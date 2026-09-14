import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Habit, Task } from './types';
import { DEFAULT_COLOR, TASK_COLORS, TASK_EMOJIS } from './types';
import type { DayStore } from './dayStore';
import type { Chain } from './schedule';
import {
  DAY_MIN,
  MIN_MS,
  buildGroups,
  chainOfTask,
  clampStartMin,
  dayStartMs,
  daySegments,
  isDone,
  isSession,
  mergeSuggestions,
  newSessionId,
  shiftPatches,
  shiftedSlot,
  taskEndMs,
  taskStartMs,
} from './schedule';
import type { CreditSnapshot } from './credit';
import { computeCredit, projectedFinishMs } from './credit';
import { clockTime, compactDur } from './format';
import { dateKey, shiftDayKey, todayKey } from './history';
import { newTaskId, spawnNextOccurrence } from './tasks';
import type { DialogAnchor } from './TaskDialog';
import TaskDialog from './TaskDialog';
import SessionPopover from './SessionPopover';

export type CalView = 'day' | 'week' | 'month';

interface CalendarPageProps {
  store: DayStore;
  now: number;
  credit: CreditSnapshot;
  chains: Chain[];
  onOpenChain: (chain: Chain) => void;
  habits: Habit[];
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

const wallTime = clockTime;
const dur = compactDur;

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

function snapMs(ms: number): number {
  return Math.round(ms / (SNAP_MIN * MIN_MS)) * SNAP_MIN * MIN_MS;
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
  | { kind: 'resize'; task: Task; day: string; lengthMin: number }
  // Dragging a session by its spine: every block of it moves by the same
  // delta, so the gaps inside the session are kept.
  | { kind: 'chain'; chain: Chain; anchorMs: number; deltaMs: number; moved: boolean };

function CalendarPage({ store, now, credit, chains, onOpenChain, habits }: CalendarPageProps) {
  const [view, setView] = useState<CalView>(() => {
    const saved = localStorage.getItem('speedrun_cal_view');
    return saved === 'day' || saved === 'month' ? saved : 'week';
  });
  const [anchor, setAnchor] = useState<string>(() => todayKey());
  // The block editor. `anchor` is where on the screen it was opened from: with
  // one it floats next to the block (and the block stays drawn on the grid),
  // without one it is a centred modal.
  const [dialog, setDialog] = useState<
    { task: Task; isNew: boolean; anchor: DialogAnchor | null } | null
  >(null);
  // What the editor currently describes — the grid draws this instead of the
  // saved block, so the rectangle follows the fields as they are typed.
  const [preview, setPreview] = useState<Task | null>(null);
  // The open session editor, addressed by one of its tasks so that renaming or
  // moving the session cannot lose it.
  const [sessionPop, setSessionPop] = useState<{ taskId: string; anchor: DialogAnchor } | null>(
    null
  );
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

  const closeDialog = useCallback(() => {
    setDialog(null);
    setPreview(null);
  }, []);

  const openDialog = useCallback(
    (task: Task, isNew: boolean, at?: { clientX: number; clientY: number } | null) => {
      setPreview(task);
      setDialog({ task, isNew, anchor: at ? { x: at.clientX, y: at.clientY } : null });
    },
    []
  );

  const saveFromDialog = useCallback(
    (task: Task) => {
      store.upsertTask(task);
      closeDialog();
    },
    [store, closeDialog]
  );

  const deleteFromDialog = useCallback(() => {
    if (!dialog) return;
    store.removeTask(dialog.task.id);
    closeDialog();
  }, [dialog, store, closeDialog]);

  // ── sessions ─────────────────────────────────────────────────────

  const openSession = useCallback((chain: Chain, at: { clientX: number; clientY: number }) => {
    setSessionPop({ taskId: chain.tasks[0].id, anchor: { x: at.clientX, y: at.clientY } });
  }, []);

  // Glue a sequence together: every block of it gets the same session id, so it
  // stays one sequence however its blocks are moved later.
  const makeSession = useCallback(
    (chain: Chain, name?: string | null) => {
      const sessionId = chain.sessionId ?? newSessionId();
      const sessionName = name !== undefined ? name || null : (chain.name ?? null);
      store.patchTasks(
        chain.tasks.map((t) => ({ id: t.id, patch: { sessionId, sessionName } }))
      );
    },
    [store]
  );

  const dissolveSession = useCallback(
    (chain: Chain) => {
      store.patchTasks(
        chain.tasks.map((t) => ({ id: t.id, patch: { sessionId: null, sessionName: null } }))
      );
    },
    [store]
  );

  // Close the gap between two neighbouring sequences and make them one session:
  // the later one is pulled up to the moment the earlier one ends.
  const glueChains = useCallback(
    (before: Chain, after: Chain) => {
      const sessionId = before.sessionId ?? after.sessionId ?? newSessionId();
      const sessionName = before.name ?? after.name ?? null;
      const deltaMs = before.endMs - after.startMs;
      store.patchTasks([
        ...before.tasks.map((t) => ({ id: t.id, patch: { sessionId, sessionName } })),
        ...after.tasks.map((t) => ({
          id: t.id,
          patch: { ...shiftedSlot(t, deltaMs), sessionId, sessionName },
        })),
      ]);
      setSessionPop(null);
    },
    [store]
  );

  // Start a session early: the whole thing slides to the current moment, gaps
  // intact, and opens in the tracker.
  const startChainNow = useCallback(
    (chain: Chain) => {
      const deltaMs = Math.round((now - chain.startMs) / MIN_MS) * MIN_MS;
      if (deltaMs !== 0) store.patchTasks(shiftPatches(chain.tasks, deltaMs));
      setSessionPop(null);
      onOpenChain(chain);
    },
    [now, store, onOpenChain]
  );

  const leaveSession = useCallback(
    (task: Task) => {
      store.patchTask(task.id, { sessionId: null, sessionName: null });
      closeDialog();
    },
    [store, closeDialog]
  );

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
      } else if (g.kind === 'chain') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        setGestureState({ ...g, deltaMs: snapMs(cursorMs - g.anchorMs), moved: true });
      } else {
        const lengthMin = Math.max(MIN_LENGTH_MIN, snap(slot.min - (g.task.start ?? 0)));
        setGestureState({ ...g, lengthMin });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      setGestureState(null);
      if (g.kind === 'create') {
        const length = Math.max(MIN_LENGTH_MIN, g.endMin - g.startMin);
        // The block stays on the grid and the editor opens beside it, so the
        // shape just drawn is never lost behind a dialog.
        openDialog(draftTask(g.day, g.startMin, length), true, e);
      } else if (g.kind === 'move') {
        if (!g.moved) {
          openDialog(g.task, false, e);
        } else if (g.day !== g.task.day || g.startMin !== g.task.start) {
          store.patchTask(g.task.id, { day: g.day, start: g.startMin });
        }
      } else if (g.kind === 'chain') {
        if (!g.moved) openSession(g.chain, e);
        else if (g.deltaMs !== 0) store.patchTasks(shiftPatches(g.chain.tasks, g.deltaMs));
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
  }, [slotAt, setGestureState, draftTask, store, openDialog, openSession]);

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

  const startChainDrag = useCallback(
    (e: React.PointerEvent, chain: Chain) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'chain',
        chain,
        anchorMs: dayStartMs(slot.day) + slot.min * MIN_MS,
        deltaMs: 0,
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

  // Pairs of sequences close enough to be one session — the grid offers to glue
  // each of them, and the session editor offers the same on its neighbours.
  const suggestions = useMemo(() => mergeSuggestions(chains), [chains]);

  const popChain = useMemo(
    () => (sessionPop ? chainOfTask(chains, sessionPop.taskId) : null),
    [chains, sessionPop]
  );

  // The session editor closes by itself once its sequence is gone (dissolved,
  // emptied or merged away).
  useEffect(() => {
    if (sessionPop && !popChain) setSessionPop(null);
  }, [sessionPop, popChain]);

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
    const dayFrom = dayStartMs(day);
    const dayTo = dayFrom + DAY_MIN * MIN_MS;
    const isToday = day === today;
    const g = gesture;
    const dragChain = g?.kind === 'chain' ? g : null;

    // A block the editor is open on is drawn from the fields being typed, so
    // long as it has a slot at all (a backlog task has none).
    const livePreview =
      preview && preview.status !== 'open' && preview.start !== null ? preview : null;

    // Blocks that are being dragged (or edited in the popover) are drawn from
    // the gesture / the editor instead of from the plan.
    const ghostIds = new Set<string>(
      dragChain
        ? dragChain.chain.tasks.map((t) => t.id)
        : g?.kind === 'move'
          ? [g.task.id]
          : []
    );
    if (livePreview) ghostIds.add(livePreview.id);

    const segments = daySegments(tasks, day).filter((seg) => !ghostIds.has(seg.task.id));

    // Sessions and sequences, drawn as a spine to the left of the column. While
    // one is dragged it is shown where it would land.
    const daySessions = chains
      .filter(isSession)
      .map((chain) => {
        const shift = dragChain?.chain.id === chain.id ? dragChain.deltaMs : 0;
        return { chain, startMs: chain.startMs + shift, endMs: chain.endMs + shift };
      })
      .filter((c) => c.endMs > dayFrom && c.startMs < dayTo);

    // Sequences that nearly touch: the handle in the gap glues them together.
    const glueSpots = suggestions
      .map((s) => ({ ...s, atMs: (s.before.endMs + s.after.startMs) / 2 }))
      .filter((s) => s.atMs >= dayFrom && s.atMs < dayTo);

    // Everything drawn from a gesture or from the open editor rather than from
    // the saved plan.
    const ghosts: {
      key: string;
      task: Task;
      startMin: number;
      lengthMin: number;
      live: boolean; // the editor's block, not a dragged one
    }[] = [];
    if (dragChain) {
      for (const task of dragChain.chain.tasks) {
        const slot = shiftedSlot(task, dragChain.deltaMs);
        if (slot.day !== day) continue;
        ghosts.push({
          key: task.id,
          task,
          startMin: slot.start,
          lengthMin: task.plannedTime / 60,
          live: false,
        });
      }
    } else if (g?.kind === 'move' && g.day === day) {
      ghosts.push({
        key: g.task.id,
        task: g.task,
        startMin: g.startMin,
        lengthMin: g.task.plannedTime / 60,
        live: false,
      });
    }
    if (livePreview && livePreview.day === day) {
      ghosts.push({
        key: `preview-${livePreview.id}`,
        task: livePreview,
        startMin: livePreview.start ?? 0,
        lengthMin: livePreview.plannedTime / 60,
        live: true,
      });
    }

    return (
      <div
        key={day}
        className={`cal-col${isToday ? ' today' : ''}`}
        data-day={day}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.cal-block, .cal-chain, .cal-glue')) return;
          startCreate(e, day);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropFromBacklog(e, day)}
      >
        {daySessions.map(({ chain, startMs, endMs }) => {
          const top = Math.max(0, (startMs - dayFrom) / MIN_MS) * PX_PER_MIN;
          const bottom = Math.min(DAY_MIN, (endMs - dayFrom) / MIN_MS) * PX_PER_MIN;
          const height = Math.max(12, bottom - top);
          return (
            <div
              key={chain.id}
              className={[
                'cal-chain',
                chain.sessionId ? 'session' : '',
                chain.name ? 'named' : '',
                dragChain?.chain.id === chain.id ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ top, height }}
              title={`${chain.name ?? 'Секвенция'} · ${chain.tasks.length} задач — открыть настройки сессии, потянуть — перенести целиком`}
              onPointerDown={(e) => startChainDrag(e, chain)}
            >
              {chain.name && height > 40 && (
                <span className="cal-chain-label">{chain.name}</span>
              )}
              <span className="cal-chain-dot" />
            </div>
          );
        })}

        <div className="cal-col-body">
        {segments.map((seg) => {
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
                task.sessionId ? 'in-session' : '',
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

        {ghosts.map((ghost) => (
          <div
            key={ghost.key}
            className={ghost.live ? 'cal-block live' : 'cal-block dragging'}
            style={{
              top: ghost.startMin * PX_PER_MIN,
              height: Math.max(16, ghost.lengthMin * PX_PER_MIN),
              '--task-color': ghost.task.color,
            } as React.CSSProperties}
          >
            <div className="cal-block-head">
              <span className="cal-block-emoji">{ghost.task.emoji}</span>
              <span className="cal-block-name">{ghost.task.name || 'Без названия'}</span>
            </div>
            <div className="cal-block-meta">
              <span>
                {hhmm(ghost.startMin)}–{hhmm(ghost.startMin + ghost.lengthMin)}
              </span>
            </div>
          </div>
        ))}

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

        {glueSpots.map((spot) => (
          <button
            key={`${spot.before.id}-${spot.after.id}`}
            type="button"
            className="cal-glue"
            style={{ top: ((spot.atMs - dayFrom) / MIN_MS) * PX_PER_MIN }}
            title={`Между блоками ${dur(spot.gapMs / 1000)} — склеить в одну сессию`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => glueChains(spot.before, spot.after)}
          >
            🔗 {dur(spot.gapMs / 1000)}
          </button>
        ))}

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
                        openDialog(task, false, e);
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
                openDialog(
                  { ...draftTask(anchor, 9 * 60, 60), status: 'open', start: null },
                  true
                )
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
                onClick={(e) => openDialog(task, false, e)}
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
          anchor={dialog.anchor}
          sessionName={
            dialog.task.sessionId
              ? (dialog.task.sessionName ?? 'без названия')
              : null
          }
          onLeaveSession={
            dialog.task.sessionId ? () => leaveSession(dialog.task) : undefined
          }
          habits={habits}
          onPreview={setPreview}
          onSave={saveFromDialog}
          onDelete={dialog.isNew ? undefined : deleteFromDialog}
          onClose={closeDialog}
        />
      )}

      {sessionPop && popChain && (
        <SessionPopover
          chain={popChain}
          anchor={sessionPop.anchor}
          now={now}
          glueBefore={suggestions.find((s) => s.after.id === popChain.id)?.before ?? null}
          glueAfter={suggestions.find((s) => s.before.id === popChain.id)?.after ?? null}
          onRename={(name) => makeSession(popChain, name)}
          onMakeSession={() => makeSession(popChain)}
          onDissolve={() => {
            dissolveSession(popChain);
            setSessionPop(null);
          }}
          onGlue={glueChains}
          onStartNow={() => startChainNow(popChain)}
          onOpen={() => {
            setSessionPop(null);
            onOpenChain(popChain);
          }}
          onClose={() => setSessionPop(null)}
        />
      )}
    </div>
  );
}

export default CalendarPage;
