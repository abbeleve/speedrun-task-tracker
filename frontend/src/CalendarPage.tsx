import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  dayKeyOf,
  dayStartMs,
  daySegments,
  isDone,
  isReminder,
  isScheduled,
  isSession,
  mergeSuggestions,
  newSessionId,
  shiftPatches,
  shiftedSlot,
  taskEndMs,
  taskStartMs,
} from './schedule';
import type { Band } from './selection';
import {
  HOLD_MS,
  HOLD_SLOP_PX,
  chainOfSelection,
  splitPatches,
  tasksInBand,
} from './selection';
import type { CreditSnapshot } from './credit';
import { computeCredit, projectedFinishMs } from './credit';
import { clockTime, compactDur, signedDur } from './format';
import { dateKey, shiftDayKey, startOfWeek, todayKey } from './history';
import { newTaskId, spawnNextOccurrence } from './tasks';
import type { DialogAnchor } from './TaskDialog';
import TaskDialog from './TaskDialog';
import SessionPopover from './SessionPopover';

export type CalView = 'day' | '3day' | 'week' | 'month';

interface CalendarPageProps {
  store: DayStore;
  now: number;
  credit: CreditSnapshot;
  chains: Chain[];
  onOpenChain: (chain: Chain) => void;
  habits: Habit[];
  // Overtake summed across the current calendar week (Mon–Sun), today's
  // contribution live — see weekOvertake.ts.
  weekOvertakeSec: number;
}

const PX_PER_HOUR = 52;
const PX_PER_MIN = PX_PER_HOUR / 60;
const MIN_BLOCK_PX = 16; // shortest a block is ever drawn, however brief the task
const SNAP_MIN = 5;
const DEFAULT_LENGTH_MIN = 60;
const MIN_LENGTH_MIN = 10;
const GUTTER_PX = 56; // hour labels on the left of the grid
// A right-drag shorter than this is a plain right-click — it resets the zoom
// instead of setting a (pointlessly thin) one.
const ZOOM_MIN_MINUTES = 15;

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

const GAP_MENU_WIDTH = 260;
const GAP_MENU_MARGIN = 12;

function gapMenuStyle(anchor: DialogAnchor): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(anchor.x, vw - GAP_MENU_WIDTH - GAP_MENU_MARGIN);
  const top = Math.min(anchor.y, vh - GAP_MENU_MARGIN);
  return { position: 'fixed', left: Math.max(GAP_MENU_MARGIN, left), top, width: GAP_MENU_WIDTH };
}

// ── drag gestures ──────────────────────────────────────────────────

type Gesture =
  // A press on empty canvas, still undecided: drawn away from where it started
  // it becomes a new block, held on the spot for HOLD_MS it becomes the lasso
  // below instead.
  | {
      kind: 'create';
      day: string;
      anchorMin: number;
      startMin: number;
      endMin: number;
      anchorX: number; // where the press landed, for the "held still?" test
      anchorY: number;
      moved: boolean;
      // Shift/Ctrl: the press builds on the batch already selected instead of
      // starting a new one.
      additive: boolean;
    }
  | {
      kind: 'move';
      task: Task;
      grabMin: number; // where inside the block the pointer grabbed it
      day: string;
      startMin: number;
      moved: boolean;
      toBacklog: boolean; // pointer is currently over the backlog rail
    }
  | { kind: 'resize'; task: Task; day: string; lengthMin: number }
  // Dragging a session by its spine: every block of it moves by the same
  // delta, so the gaps inside the session are kept.
  | { kind: 'chain'; chain: Chain; anchorMs: number; deltaMs: number; moved: boolean }
  // Right-drag on the canvas: a vertical time band, ignoring which day/column
  // it started or wandered over — only the minute-of-day matters.
  | { kind: 'zoom'; anchorMin: number; startMin: number; endMin: number }
  // Armed by holding the button still on the canvas: a rectangle swept over
  // the grid that picks up every block it touches (see selection.ts).
  | { kind: 'lasso'; anchorDayIdx: number; anchorMin: number; band: Band; baseIds: string[] }
  // Dragging a selection by one of its blocks: all of them move by the same
  // delta, so the shape of the batch is kept.
  | { kind: 'multi'; tasks: Task[]; anchorMs: number; deltaMs: number; moved: boolean };

function CalendarPage({
  store,
  now,
  credit,
  chains,
  onOpenChain,
  habits,
  weekOvertakeSec,
}: CalendarPageProps) {
  const [view, setView] = useState<CalView>(() => {
    const saved = localStorage.getItem('speedrun_cal_view');
    return saved === 'day' || saved === '3day' || saved === 'month' ? saved : 'week';
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
  // Blocks picked with the lasso. They are drawn with a ring, drag as one
  // batch, and can be split off into a sequence of their own.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<Set<string>>(new Set());
  // The menu on the selection, opened by clicking the batch without dragging it.
  const [groupMenu, setGroupMenu] = useState<DialogAnchor | null>(null);
  const holdTimer = useRef<number | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const backlogRef = useRef<HTMLDivElement>(null);

  // Right-drag zoom: picks a vertical minutes-per-pixel scale that makes the
  // selected band fill the scroller, but the day is still rendered in full
  // (0..DAY_MIN) at that scale and stays normally scrollable — zooming only
  // changes *how much* an hour takes up, never what's reachable. Null means
  // the default scale.
  const [zoomRange, setZoomRange] = useState<{ startMin: number; endMin: number } | null>(null);
  const [scrollerHeight, setScrollerHeight] = useState(0);

  // Custom hover card for a task block: shows instantly (no OS tooltip delay)
  // and is anchored to the block's own screen rect, so it can grow out of the
  // block's edge instead of just fading in. Fixed-positioned (not clipped by
  // .cal-grid's own overflow) rather than portalled — no ancestor here sets a
  // transform, so `position: fixed` already escapes the grid's clipping.
  const [hoverCard, setHoverCard] = useState<{ task: Task; rect: DOMRect } | null>(null);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  // The card must show the full name/description/time, so its height varies
  // with content — measured after each render so it can be kept fully inside
  // the viewport instead of running off the bottom.
  const [hoverCardHeight, setHoverCardHeight] = useState(0);
  useLayoutEffect(() => {
    setHoverCardHeight(hoverCardRef.current?.offsetHeight ?? 0);
  }, [hoverCard]);

  useEffect(() => {
    localStorage.setItem('speedrun_cal_view', view);
  }, [view]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setScrollerHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The hover card is anchored to a snapshot of the block's screen rect —
  // once the grid scrolls that rect is stale, so just close it.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !hoverCard) return;
    const close = () => setHoverCard(null);
    el.addEventListener('scroll', close, { passive: true });
    return () => el.removeEventListener('scroll', close);
  }, [hoverCard]);

  // A drag/resize/selection gesture in flight makes a lingering hover card
  // (from before the gesture started) misleading — drop it. Same once the
  // editor opens over the same block, or the view scrolls to another day.
  useEffect(() => {
    if (gesture) setHoverCard(null);
  }, [gesture]);
  useEffect(() => {
    if (dialog) setHoverCard(null);
  }, [dialog]);
  useEffect(() => {
    setHoverCard(null);
  }, [view, anchor]);

  const zoomLenMin = zoomRange ? Math.max(1, zoomRange.endMin - zoomRange.startMin) : DAY_MIN;
  const pxPerMin = zoomRange && scrollerHeight > 0 ? scrollerHeight / zoomLenMin : PX_PER_MIN;
  const minToPx = useCallback((min: number) => min * pxPerMin, [pxPerMin]);
  const lenToPx = useCallback((lenMin: number) => lenMin * pxPerMin, [pxPerMin]);
  // How short a block can be before it must be pushed into its own column to
  // stay readable — in *minutes*, so it shrinks as zooming in makes every
  // minute taller, letting blocks that no longer visually clash sit back to
  // back instead of staying forced side by side (see daySegments).
  const minBlockMin = MIN_BLOCK_PX / pxPerMin;

  const today = todayKey();
  const tasks = store.tasks;

  const visibleDays = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === '3day') return Array.from({ length: 3 }, (_, i) => shiftDayKey(anchor, i));
    if (view === 'week') {
      const from = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => shiftDayKey(from, i));
    }
    return monthCells(anchor);
  }, [view, anchor]);

  // Scroll the working hours into view when the grid is first shown. Zooming
  // in changes the scale, not what's reachable, so scroll to bring the band
  // that was just selected to the top instead — the rest of the (now taller)
  // day is still one scroll away.
  useEffect(() => {
    if (view === 'month') return;
    const el = scrollerRef.current;
    if (!el) return;
    if (zoomRange) {
      el.scrollTop = zoomRange.startMin * pxPerMin;
      return;
    }
    const nowDate = new Date();
    const focusMin = visibleDays.includes(today) ? nowDate.getHours() * 60 : 8 * 60;
    el.scrollTop = Math.max(0, (focusMin - 60) * PX_PER_MIN);
    // Only when the layout changes, not on every task edit.
  }, [view, today, visibleDays, zoomRange, pxPerMin]);

  const openTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'open')
        .sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order),
    [tasks]
  );

  // ── task mutations ───────────────────────────────────────────────

  // Tasks mid-way through the "just completed" flourish — grown slightly
  // while a gold dashed line sweeps clockwise around them. Kept in sync with
  // the CSS animation durations in calendar.css (cal-block-pop / cal-sweep-*)
  // so the sweep overlay unmounts right as the animation finishes.
  const COMPLETE_FX_MS = 1400;
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const completingTimers = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const timers = completingTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const markCompleting = useCallback((taskId: string) => {
    const prevTimer = completingTimers.current.get(taskId);
    if (prevTimer) window.clearTimeout(prevTimer);
    setCompletingIds((prev) => new Set(prev).add(taskId));
    const timer = window.setTimeout(() => {
      completingTimers.current.delete(taskId);
      setCompletingIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }, COMPLETE_FX_MS);
    completingTimers.current.set(taskId, timer);
  }, []);

  const clearCompleting = useCallback((taskId: string) => {
    const timer = completingTimers.current.get(taskId);
    if (timer) {
      window.clearTimeout(timer);
      completingTimers.current.delete(taskId);
    }
    setCompletingIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  const completeTask = useCallback(
    (task: Task) => {
      markCompleting(task.id);
      store.patchTask(task.id, { status: 'done', finishedAt: Date.now() });
      const child = spawnNextOccurrence(task, newTaskId, task.day);
      if (child) store.upsertTask(child);
    },
    [store, markCompleting]
  );

  const reopenTask = useCallback(
    (task: Task) => {
      clearCompleting(task.id);
      store.patchTask(task.id, { status: 'in-progress', finishedAt: null, completedAt: null });
      // Drop the occurrence this completion had scheduled ahead.
      const child = store.tasks.find((t) => t.repeatOf === task.id && !isDone(t));
      if (child) store.removeTask(child.id);
    },
    [store, clearCompleting]
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setPreview(null);
  }, []);

  // A copy of `task`, ready to drop into the dialog as a draft: fresh id, not
  // done, no session (a copy never silently joins the original's session) and
  // placed right after the original so the two don't sit on top of each other.
  const duplicateTask = useCallback((task: Task): Task => {
    const placed = task.start !== null && task.start !== undefined;
    return {
      ...task,
      id: newTaskId(),
      name: `${task.name} (копия)`,
      order: 0,
      completedAt: null,
      finishedAt: null,
      status: task.status === 'done' ? 'in-progress' : task.status,
      start: placed ? clampStartMin(task.start! + task.plannedTime / 60, task.plannedTime) : null,
      sessionId: null,
      sessionName: null,
      repeatIndex: undefined,
      repeatOf: undefined,
    };
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
      // The dialog can flip done ↔ not-done (including a backdated finishedAt)
      // as well as ordinary field edits — mirror completeTask/reopenTask's
      // repeat side effect exactly when that flip actually happened.
      const wasDone = dialog ? isDone(dialog.task) : false;
      const nowDone = isDone(task);
      store.upsertTask(task);
      if (!wasDone && nowDone) {
        const child = spawnNextOccurrence(task, newTaskId, task.day);
        if (child) store.upsertTask(child);
      } else if (wasDone && !nowDone) {
        const child = store.tasks.find((t) => t.repeatOf === task.id && !isDone(t));
        if (child) store.removeTask(child.id);
      }
      closeDialog();
    },
    [store, closeDialog, dialog]
  );

  const deleteFromDialog = useCallback(() => {
    if (!dialog) return;
    store.removeTask(dialog.task.id);
    closeDialog();
  }, [dialog, store, closeDialog]);

  // Opens the editor on an unsaved copy of the current task — nothing is
  // written until that draft is itself confirmed, so a duplicate started by
  // mistake is dropped the same way a new block would be.
  const duplicateFromDialog = useCallback(() => {
    if (!dialog) return;
    const copy = duplicateTask(dialog.task);
    const at = dialog.anchor ? { clientX: dialog.anchor.x, clientY: dialog.anchor.y } : null;
    openDialog(copy, true, at);
  }, [dialog, duplicateTask, openDialog]);

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

  // ── the selected batch ───────────────────────────────────────────
  const setSelection = useCallback((next: Set<string>) => {
    selectedRef.current = next;
    setSelectedIds(next);
  }, []);

  // The press is no longer waiting to become a lasso.
  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => cancelHold, [cancelHold]);


  const selectedTasks = useMemo(
    () =>
      tasks
        .filter((t) => selectedIds.has(t.id))
        .sort((a, b) => taskStartMs(a) - taskStartMs(b) || a.id.localeCompare(b.id)),
    [tasks, selectedIds]
  );

  // Blocks that have gone — deleted, or sent back to the backlog — leave the
  // selection with them, so nothing is dragged by a ghost id.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const alive = tasks.filter((t) => selectedIds.has(t.id) && isScheduled(t));
    if (alive.length !== selectedIds.size) setSelection(new Set(alive.map((t) => t.id)));
  }, [tasks, selectedIds, setSelection]);

  // A selection describes blocks that are on screen: navigating away ends it.
  useEffect(() => {
    setSelection(new Set());
    setGroupMenu(null);
  }, [view, anchor, setSelection]);

  useEffect(() => {
    if (selectedIds.size === 0 || dialog || sessionPop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelection(new Set());
      setGroupMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, dialog, sessionPop, setSelection]);

  // The sequence every selected block shares, if they share one at all — only
  // then can the batch be cut out of it.
  const selectionChain = useMemo(
    () => chainOfSelection(chains, selectedIds),
    [chains, selectedIds]
  );

  // Cut the batch out of the sequence it sits in and make it a second one:
  // the blocks keep their slots, but a session of their own means they now
  // hold together and move as a separate sequence, leaving the rest of the
  // original behind. The session editor opens on the new sequence straight
  // away, so it can be named while it is still under the cursor.
  const splitSelection = useCallback(
    (at: DialogAnchor) => {
      if (selectedTasks.length === 0) return;
      store.patchTasks(splitPatches(selectedTasks, newSessionId()));
      setGroupMenu(null);
      setSelection(new Set());
      setSessionPop({ taskId: selectedTasks[0].id, anchor: at });
    },
    [selectedTasks, store, setSelection]
  );

  // Delete every selected block at once.
  const deleteSelection = useCallback(() => {
    if (selectedTasks.length === 0) return;
    store.removeTasks(selectedTasks.map((t) => t.id));
    setGroupMenu(null);
    setSelection(new Set());
  }, [selectedTasks, store, setSelection]);

  // Delete/Backspace deletes the selected batch, as long as focus isn't in a
  // text field (renaming a session, say) where the key means something else.
  useEffect(() => {
    if (selectedIds.size === 0 || dialog || sessionPop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, dialog, sessionPop, deleteSelection]);

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
    (clientX: number, clientY: number): { day: string; dayIdx: number; min: number } | null => {
      const el = columnsRef.current;
      if (!el || visibleDays.length === 0) return null;
      const rect = el.getBoundingClientRect();
      const colWidth = rect.width / visibleDays.length;
      const idx = Math.max(
        0,
        Math.min(visibleDays.length - 1, Math.floor((clientX - rect.left) / colWidth))
      );
      const min = Math.max(0, Math.min(DAY_MIN, (clientY - rect.top) / pxPerMin));
      return { day: visibleDays[idx], dayIdx: idx, min };
    },
    [visibleDays, pxPerMin]
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
      if (g.kind === 'create') {
        // Still within a few pixels of where it landed: the press is holding,
        // not drawing — leave the draft at its default size and let the hold
        // timer turn it into a lasso.
        const still =
          Math.abs(e.clientX - g.anchorX) <= HOLD_SLOP_PX &&
          Math.abs(e.clientY - g.anchorY) <= HOLD_SLOP_PX;
        if (still && !g.moved) return;
        cancelHold();
        const slot = slotAt(e.clientX, e.clientY);
        if (!slot) return;
        const min = snap(slot.min);
        setGestureState({
          ...g,
          moved: true,
          startMin: Math.min(g.anchorMin, min),
          endMin: Math.max(g.anchorMin + SNAP_MIN, min),
        });
        return;
      }
      if (g.kind === 'move') {
        const rect = backlogRef.current?.getBoundingClientRect();
        const overBacklog =
          !!rect &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (overBacklog) {
          setGestureState({ ...g, moved: true, toBacklog: true });
          return;
        }
      }
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      if (g.kind === 'move') {
        const startMin = snap(slot.min - g.grabMin);
        setGestureState({
          ...g,
          day: slot.day,
          startMin: clampStartMin(startMin, g.task.plannedTime),
          moved: true,
          toBacklog: false,
        });
      } else if (g.kind === 'chain') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        setGestureState({ ...g, deltaMs: snapMs(cursorMs - g.anchorMs), moved: true });
      } else if (g.kind === 'zoom') {
        const min = snap(slot.min);
        setGestureState({
          ...g,
          startMin: Math.min(g.anchorMin, min),
          endMin: Math.max(g.anchorMin, min),
        });
      } else if (g.kind === 'lasso') {
        // The selection is rebuilt on every move, so the rings follow the
        // rectangle live — by the time the button comes up there is nothing
        // left to commit.
        const band: Band = {
          fromDayIdx: g.anchorDayIdx,
          toDayIdx: slot.dayIdx,
          fromMin: g.anchorMin,
          toMin: slot.min,
        };
        setGestureState({ ...g, band });
        const picked = tasksInBand(store.tasks, visibleDays, band);
        setSelection(new Set([...g.baseIds, ...picked.map((t) => t.id)]));
      } else if (g.kind === 'multi') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        setGestureState({ ...g, deltaMs: snapMs(cursorMs - g.anchorMs), moved: true });
      } else if (g.kind === 'resize') {
        const lengthMin = Math.max(MIN_LENGTH_MIN, snap(slot.min - (g.task.start ?? 0)));
        setGestureState({ ...g, lengthMin });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      cancelHold();
      setGestureState(null);
      if (g.kind === 'create') {
        // A plain click on the canvas while a batch is selected drops the
        // selection rather than dropping a new block on top of it. Held with
        // Shift/Ctrl the click is part of composing that batch, so it keeps it
        // — and never drops a new block either way.
        if (!g.moved && (g.additive || selectedRef.current.size > 0)) {
          if (!g.additive) setSelection(new Set());
          return;
        }
        const length = Math.max(MIN_LENGTH_MIN, g.endMin - g.startMin);
        // The block stays on the grid and the editor opens beside it, so the
        // shape just drawn is never lost behind a dialog.
        openDialog(draftTask(g.day, g.startMin, length), true, e);
      } else if (g.kind === 'move') {
        if (!g.moved) {
          openDialog(g.task, false, e);
        } else if (g.toBacklog) {
          if (g.task.status !== 'open') {
            store.patchTask(g.task.id, { status: 'open', start: null });
          }
        } else if (g.day !== g.task.day || g.startMin !== g.task.start) {
          store.patchTask(g.task.id, { day: g.day, start: g.startMin });
        }
      } else if (g.kind === 'chain') {
        if (!g.moved) openSession(g.chain, e);
        else if (g.deltaMs !== 0) store.patchTasks(shiftPatches(g.chain.tasks, g.deltaMs));
      } else if (g.kind === 'zoom') {
        // A real drag zooms into the band; a plain right-click (no meaningful
        // drag) just snaps back to the full day.
        if (g.endMin - g.startMin >= ZOOM_MIN_MINUTES) {
          setZoomRange({ startMin: g.startMin, endMin: g.endMin });
        } else {
          setZoomRange(null);
        }
      } else if (g.kind === 'multi') {
        // Clicked rather than dragged: the batch opens its own menu.
        if (!g.moved) setGroupMenu({ x: e.clientX, y: e.clientY });
        else if (g.deltaMs !== 0) store.patchTasks(shiftPatches(g.tasks, g.deltaMs));
      } else if (g.kind === 'resize' && g.lengthMin * 60 !== g.task.plannedTime) {
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
  }, [
    slotAt,
    setGestureState,
    setSelection,
    cancelHold,
    draftTask,
    store,
    visibleDays,
    openDialog,
    openSession,
  ]);

  // A press on the canvas starts as a block being drawn. Held on the spot for
  // a second instead — the ring under the cursor fills to say so — it turns
  // into a lasso over the grid, and dragging from there picks up blocks rather
  // than drawing a new one. Shift adds to what is already selected.
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
        anchorX: e.clientX,
        anchorY: e.clientY,
        moved: false,
        additive: e.shiftKey || e.ctrlKey || e.metaKey,
      });
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const { dayIdx, min } = slot;
      cancelHold();
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        const held = gestureRef.current;
        if (!held || held.kind !== 'create' || held.moved) return;
        const baseIds = additive ? [...selectedRef.current] : [];
        setSelection(new Set(baseIds));
        setGestureState({
          kind: 'lasso',
          anchorDayIdx: dayIdx,
          anchorMin: min,
          band: { fromDayIdx: dayIdx, toDayIdx: dayIdx, fromMin: min, toMin: min },
          baseIds,
        });
      }, HOLD_MS);
    },
    [slotAt, setGestureState, setSelection, cancelHold]
  );

  const startMove = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      // Ctrl (⌘) + click picks blocks one by one, whether or not a batch is
      // already standing: it adds the block, or drops it back out if it was
      // already in. Nothing is dragged and no editor opens — the modifier
      // means "compose the batch", so the gesture ends right here.
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedRef.current);
        if (!next.delete(task.id)) next.add(task.id);
        setSelection(next);
        return;
      }
      // Grabbing any block of a selected batch drags the whole batch; grabbing
      // one outside it means the selection is over.
      if (selectedRef.current.size > 1 && selectedRef.current.has(task.id)) {
        setGestureState({
          kind: 'multi',
          tasks: store.tasks.filter((t) => selectedRef.current.has(t.id)),
          anchorMs: dayStartMs(slot.day) + slot.min * MIN_MS,
          deltaMs: 0,
          moved: false,
        });
        return;
      }
      if (selectedRef.current.size > 0) setSelection(new Set());
      setGestureState({
        kind: 'move',
        task,
        grabMin: slot.min - (task.day === slot.day ? (task.start ?? 0) : 0),
        day: task.day,
        startMin: task.start ?? 0,
        moved: false,
        toBacklog: false,
      });
    },
    [slotAt, setGestureState, setSelection, store]
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

  // Right-drag anywhere on the canvas selects a time band to zoom into —
  // which day/column it happens over doesn't matter, only the vertical
  // position. A drag too short to be deliberate is handled as a reset in onUp.
  const startZoomSelect = useCallback(
    (e: React.PointerEvent) => {
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      const anchorMin = snap(slot.min);
      setGestureState({ kind: 'zoom', anchorMin, startMin: anchorMin, endMin: anchorMin });
    },
    [slotAt, setGestureState]
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
        if (view === '3day') return shiftDayKey(prev, dir * 3);
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

  // Idle and ahead of schedule, with everything before now already closed: the
  // gap before the next block is offered as a slot for a backlog task, drawn
  // at the size of the largest task that could still fit in it.
  const gapSlot = useMemo(() => {
    if (!credit.frozen || credit.lead <= 0) return null;
    const nextGroup = credit.remaining[0];
    if (!nextGroup) return null;
    const day = dayKeyOf(now);
    const dayEnd = dayStartMs(day) + DAY_MIN * MIN_MS;
    const freeUntilMs = Math.min(nextGroup.startMs - credit.banked * 1000, dayEnd);
    const gapMs = freeUntilMs - now;
    if (gapMs < 10 * MIN_MS) return null;

    const candidates = openTasks.filter((t) => t.plannedTime * 1000 <= gapMs && !isReminder(t));
    if (candidates.length === 0) return null;

    return { day, startMs: now, endMs: freeUntilMs, gapMs, candidates };
  }, [credit, now, openTasks]);

  const [gapMenu, setGapMenu] = useState<DialogAnchor | null>(null);

  // A gap that has closed up (or lost its candidates) takes its open menu with it.
  useEffect(() => {
    if (gapMenu && !gapSlot) setGapMenu(null);
  }, [gapMenu, gapSlot]);

  const acceptGapTask = useCallback(
    (task: Task, day: string, startMs: number) => {
      const startMin = snap(Math.round((startMs - dayStartMs(day)) / MIN_MS));
      store.patchTask(task.id, {
        day,
        start: clampStartMin(startMin, task.plannedTime),
        status: 'in-progress',
      });
      setGapMenu(null);
    },
    [store]
  );

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

  const renderGrid = () => {
    const g = gesture;
    return (
      <div
        className="cal-grid"
        ref={scrollerRef}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="cal-grid-inner" style={{ height: DAY_MIN * pxPerMin }}>
          <div className="cal-hours" style={{ width: GUTTER_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour" style={{ top: minToPx(h * 60) }}>
                <span>{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          <div className="cal-lines">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-line" style={{ top: minToPx(h * 60) }} />
            ))}
          </div>
          <div
            className="cal-columns"
            ref={columnsRef}
            style={{ left: GUTTER_PX }}
          >
            {visibleDays.map((day) => renderColumn(day))}
            {g?.kind === 'lasso' && renderMarquee(g.band)}
          </div>
          {g?.kind === 'zoom' && (
            <div
              className="cal-zoom-select"
              style={{ top: minToPx(g.startMin), height: lenToPx(g.endMin - g.startMin) }}
            >
              <span>{hhmm(g.startMin)}–{hhmm(g.endMin)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // The rectangle being swept over the grid. It takes whole day columns
  // across — the columns are the only horizontal geometry the grid has — and
  // reports what it is holding while it is dragged.
  const renderMarquee = (band: Band) => {
    const lo = Math.max(0, Math.min(band.fromDayIdx, band.toDayIdx));
    const hi = Math.min(visibleDays.length - 1, Math.max(band.fromDayIdx, band.toDayIdx));
    const topMin = Math.min(band.fromMin, band.toMin);
    const bottomMin = Math.max(band.fromMin, band.toMin);
    const colWidth = 100 / visibleDays.length;
    return (
      <div
        className="cal-marquee"
        style={{
          left: `${lo * colWidth}%`,
          width: `${(hi - lo + 1) * colWidth}%`,
          top: minToPx(topMin),
          height: Math.max(2, lenToPx(bottomMin - topMin)),
        }}
      >
        <span>
          {hhmm(topMin)}–{hhmm(bottomMin)} · {selectedIds.size}
        </span>
      </div>
    );
  };

  const renderColumn = (day: string) => {
    const dayFrom = dayStartMs(day);
    const dayTo = dayFrom + DAY_MIN * MIN_MS;
    const isToday = day === today;
    const g = gesture;
    const dragChain = g?.kind === 'chain' ? g : null;
    const dragMulti = g?.kind === 'multi' ? g : null;

    // A block the editor is open on is drawn from the fields being typed, so
    // long as it has a slot at all (a backlog task has none).
    const livePreview =
      preview && preview.status !== 'open' && preview.start !== null ? preview : null;

    // Blocks that are being dragged (or edited in the popover) are drawn from
    // the gesture / the editor instead of from the plan.
    const ghostIds = new Set<string>(
      dragChain
        ? dragChain.chain.tasks.map((t) => t.id)
        : dragMulti
          ? dragMulti.tasks.map((t) => t.id)
          : g?.kind === 'move'
            ? [g.task.id]
            : []
    );
    if (livePreview) ghostIds.add(livePreview.id);

    // Reminders never share the normal blocks' column-packed layout — they are
    // a read-only overlay pinned to the right edge (see the render below) — so
    // they are laid out separately, from their own subset of the day's tasks.
    const segments = daySegments(
      tasks.filter((t) => !isReminder(t)),
      day,
      minBlockMin
    ).filter((seg) => !ghostIds.has(seg.task.id));

    const reminderSegments = daySegments(
      tasks.filter(isReminder),
      day,
      minBlockMin
    ).filter((seg) => !ghostIds.has(seg.task.id));

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
    // the saved plan. A reminder being dragged/edited goes into its own bucket
    // so it is drawn as a strip rather than a normal block — a chain drag never
    // needs the split, since a reminder can never belong to one.
    type Ghost = { key: string; task: Task; startMin: number; lengthMin: number; live: boolean };
    const ghosts: Ghost[] = [];
    const reminderGhosts: Ghost[] = [];
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
    } else if (dragMulti) {
      for (const task of dragMulti.tasks) {
        const slot = shiftedSlot(task, dragMulti.deltaMs);
        if (slot.day !== day) continue;
        (isReminder(task) ? reminderGhosts : ghosts).push({
          key: task.id,
          task,
          startMin: slot.start,
          lengthMin: task.plannedTime / 60,
          live: false,
        });
      }
    } else if (g?.kind === 'move' && !g.toBacklog && g.day === day) {
      (isReminder(g.task) ? reminderGhosts : ghosts).push({
        key: g.task.id,
        task: g.task,
        startMin: g.startMin,
        lengthMin: g.task.plannedTime / 60,
        live: false,
      });
    }
    if (livePreview && livePreview.day === day) {
      (isReminder(livePreview) ? reminderGhosts : ghosts).push({
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
          // Right-drag selects a time band to zoom into, regardless of what's
          // underneath — left-click still ignores existing blocks/chains.
          if (e.button === 2) {
            startZoomSelect(e);
            return;
          }
          if ((e.target as HTMLElement).closest('.cal-block, .cal-chain, .cal-glue, .cal-reminder')) return;
          startCreate(e, day);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropFromBacklog(e, day)}
      >
        {daySessions.map(({ chain, startMs, endMs }) => {
          const top = minToPx(Math.max(0, (startMs - dayFrom) / MIN_MS));
          const bottom = minToPx(Math.min(DAY_MIN, (endMs - dayFrom) / MIN_MS));
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

        {/* Reminders: a read-only overlay pinned to the right edge of the
            column, thin on purpose — nothing is legible on them, click to
            open the editor and read what one is. Past its own end it fades to
            a dashed grey outline instead of disappearing. */}
        {reminderSegments.map((seg) => {
          const task = seg.task;
          const lengthMin = seg.bottomMin - seg.topMin;
          const height = Math.max(MIN_BLOCK_PX, lenToPx(lengthMin));
          const expired = taskEndMs(task) <= now;
          return (
            <div
              key={task.id}
              className={`cal-reminder${expired ? ' expired' : ''}${
                selectedIds.has(task.id) ? ' selected' : ''
              }`}
              style={{
                top: minToPx(seg.topMin),
                height,
                right: 2 + seg.col * 11,
                '--task-color': task.color,
              } as React.CSSProperties}
              onPointerDown={(e) => startMove(e, task)}
              title={`🔔 ${task.name || 'Напоминание'} · ${hhmm(seg.topMin)}–${hhmm(
                seg.topMin + lengthMin
              )}${expired ? ' · окно закрыто' : ''} — нажми, чтобы посмотреть`}
            />
          );
        })}

        {reminderGhosts.map((ghost) => (
          <div
            key={ghost.key}
            className={ghost.live ? 'cal-reminder live' : 'cal-reminder dragging'}
            style={{
              top: minToPx(ghost.startMin),
              height: Math.max(MIN_BLOCK_PX, lenToPx(ghost.lengthMin)),
              right: 2,
              '--task-color': ghost.task.color,
            } as React.CSSProperties}
          />
        ))}

        <div className="cal-col-body">
        {segments.map((seg) => {
          const task = seg.task;
          const resizing = g?.kind === 'resize' && g.task.id === task.id;
          const topMin = seg.topMin;
          const lengthMin = resizing ? g.lengthMin : seg.bottomMin - seg.topMin;
          const height = Math.max(MIN_BLOCK_PX, lenToPx(lengthMin));
          const done = isDone(task);
          // Just clicked: the block plays its grow-and-sweep flourish while
          // the bullet itself already reflects the real (instant) done state.
          const justCompleted = completingIds.has(task.id);
          const active = activeIds.has(task.id);
          const width = 100 / seg.cols;

          return (
            <div
              key={task.id}
              className={[
                'cal-block',
                done ? 'done' : '',
                justCompleted ? 'completing' : '',
                active ? 'active' : '',
                task.type === 'rest' ? 'rest' : '',
                task.sessionId ? 'in-session' : '',
                selectedIds.has(task.id) ? 'selected' : '',
                resizing ? 'dragging' : '',
                !seg.startsHere ? 'cont-top' : '',
                !seg.endsHere ? 'cont-bottom' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top: minToPx(topMin),
                height,
                left: `${seg.col * width}%`,
                width: `${width}%`,
                '--task-color': task.color,
              } as React.CSSProperties}
              onPointerDown={(e) => startMove(e, task)}
              onMouseEnter={(e) => setHoverCard({ task, rect: e.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setHoverCard((c) => (c?.task.id === task.id ? null : c))}
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
                />
              </div>
              {height > 34 && (
                <div className="cal-block-meta">
                  <span>
                    {hhmm(seg.topMin)}–{hhmm(seg.topMin + lengthMin)}
                  </span>
                </div>
              )}
              {done && task.finishedAt !== null && task.finishedAt < taskEndMs(task) && (
                <div
                  className="cal-block-actual"
                  style={{
                    top: Math.max(
                      0,
                      lenToPx((task.finishedAt - taskStartMs(task)) / MIN_MS)
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
              {justCompleted && (
                <div className="cal-block-sweep" aria-hidden="true">
                  <span className="cal-sweep-top" />
                  <span className="cal-sweep-right" />
                  <span className="cal-sweep-bottom" />
                  <span className="cal-sweep-left" />
                </div>
              )}
            </div>
          );
        })}

        {ghosts.map((ghost) => (
          <div
            key={ghost.key}
            className={ghost.live ? 'cal-block live' : 'cal-block dragging'}
            style={{
              top: minToPx(ghost.startMin),
              height: Math.max(MIN_BLOCK_PX, lenToPx(ghost.lengthMin)),
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
              top: minToPx(g.startMin),
              height: Math.max(MIN_BLOCK_PX, lenToPx(g.endMin - g.startMin)),
            }}
          >
            <div className="cal-block-meta">
              <span>
                {hhmm(g.startMin)}–{hhmm(g.endMin)}
              </span>
            </div>
          </div>
        )}

        {gapSlot && gapSlot.day === day && !gesture && (
          <button
            type="button"
            className="cal-block cal-gap-slot"
            style={{
              top: minToPx((gapSlot.startMs - dayFrom) / MIN_MS),
              height: Math.max(16, lenToPx((gapSlot.endMs - gapSlot.startMs) / MIN_MS)),
            }}
            title={`Свободно ${dur(gapSlot.gapMs / 1000)} до следующей задачи — выбрать задачу из бэклога`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => setGapMenu({ x: e.clientX, y: e.clientY })}
          >
            <span className="cal-gap-slot-label">Предложение</span>
          </button>
        )}

        {glueSpots.map((spot) => (
          <button
            key={`${spot.before.id}-${spot.after.id}`}
            type="button"
            className="cal-glue"
            style={{ top: minToPx((spot.atMs - dayFrom) / MIN_MS) }}
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
            style={{ top: minToPx(bandTop), height: lenToPx(bandHeight) }}
            title={`Обгон ${signedDur(credit.lead)}`}
          />
        )}
        <div className="cal-now" style={{ top: minToPx(nowMin) }}>
          <span className="cal-now-dot" />
        </div>
      </>
    );
  };

  // A hover card describing the block underneath the cursor — appears the
  // instant the pointer enters it (no native-tooltip delay) and is anchored
  // to the block's own screen rect so its entrance animation reads as
  // growing out of the block rather than just fading in somewhere nearby.
  const HOVER_CARD_WIDTH = 260;
  const HOVER_CARD_GAP = 10;

  const renderHoverCard = () => {
    if (!hoverCard) return null;
    const { task, rect } = hoverCard;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsRight = rect.right + HOVER_CARD_GAP + HOVER_CARD_WIDTH <= vw - 8;
    const left = fitsRight
      ? rect.right + HOVER_CARD_GAP
      : Math.max(8, rect.left - HOVER_CARD_GAP - HOVER_CARD_WIDTH);
    // Clamped against the card's own (measured) height so a long name or
    // description never pushes it past the bottom of the screen.
    const top = Math.min(Math.max(8, rect.top), Math.max(8, vh - 8 - hoverCardHeight));
    const origin = fitsRight ? 'left top' : 'right top';
    const start = hhmm(task.start ?? 0);
    const end = wallTime(taskEndMs(task));
    return (
      <div
        ref={hoverCardRef}
        className="cal-hover-card"
        style={{
          left,
          top,
          width: HOVER_CARD_WIDTH,
          maxHeight: vh - 16,
          transformOrigin: origin,
          '--task-color': task.color,
        } as React.CSSProperties}
        aria-hidden="true"
      >
        <div className="cal-hover-card-head">
          <span className="cal-hover-card-emoji">{task.emoji}</span>
          <span className="cal-hover-card-name">{task.name || 'Без названия'}</span>
        </div>
        <div className="cal-hover-card-time">
          {start}–{end}
        </div>
        {task.description && (
          <div className="cal-hover-card-desc">{task.description}</div>
        )}
      </div>
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
            // Reminders are a service overlay, not a planning item — the month
            // view's compact chip list is for real tasks only.
            const sorted = dayTasks
              .filter((t) => !isReminder(t))
              .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
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

  // What the batch menu can offer. Cutting a batch out only means something
  // when its blocks share one sequence: a whole sequence that is already an
  // explicit session has nothing left to be cut out of, and blocks from
  // different sequences are not a sequence to break up in the first place.
  const selectionWholeChain =
    selectionChain !== null && selectedTasks.length === selectionChain.tasks.length;
  const canSplit =
    selectedTasks.length >= 2 &&
    selectionChain !== null &&
    !(selectionWholeChain && selectionChain.sessionId !== null);
  const splitLabel = selectionWholeChain
    ? '🔗 Собрать в отдельную сессию'
    : '✂ Вынести в отдельную секвенцию';
  const selectionSpan =
    selectedTasks.length > 0
      ? `${wallTime(taskStartMs(selectedTasks[0]))}–${wallTime(
          Math.max(...selectedTasks.map(taskEndMs))
        )}`
      : '';
  const selectionSec = selectedTasks.reduce((sum, t) => sum + t.plannedTime, 0);
  const splitHint =
    selectedTasks.length < 2
      ? 'Выдели хотя бы два блока'
      : selectionChain === null
        ? 'Блоки из разных секвенций — вынести можно только соседей по одной'
        : 'Эта секвенция уже отдельная сессия';

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
          {zoomRange && view !== 'month' && (
            <button
              type="button"
              className="cal-btn cal-zoom-badge"
              onClick={() => setZoomRange(null)}
              title="Сбросить приближение — вернуться к суткам целиком"
            >
              🔍 {hhmm(zoomRange.startMin)}–{hhmm(zoomRange.endMin)} · ПКМ — сброс
            </button>
          )}
        </div>
        <div className="cal-seg cal-seg--views">
          {(['day', '3day', 'week', 'month'] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'active' : ''}
              onClick={() => setView(v)}
            >
              {v === 'day' ? 'День' : v === '3day' ? '3 дня' : v === 'week' ? 'Неделя' : 'Месяц'}
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
        <div className={`cal-hud-week ${weekOvertakeSec >= 0 ? 'ahead' : 'behind'}`}>
          <span className="cal-hud-label">за неделю</span>
          <span className="cal-hud-week-value">{signedDur(weekOvertakeSec)}</span>
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

        <aside
          className={`cal-backlog${gesture?.kind === 'move' && gesture.toBacklog ? ' drop-target' : ''}`}
          ref={backlogRef}
        >
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
          <p className="cal-backlog-hint">
            Перетащи карточку на сетку, чтобы поставить время. Перетащи блок с сетки сюда — вернуть в бэклог.
            Зажми ЛКМ на пустом месте сетки на секунду и веди — выделишь пачку блоков.
            Ctrl + клик по блоку — добавить его в пачку или убрать
          </p>
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

      {renderHoverCard()}

      {dialog && (
        <TaskDialog
          // Keyed on the task id: switching from a task to (say) its unsaved
          // duplicate must remount the form so its fields reset from the new
          // task instead of keeping whatever was last typed for the old one.
          key={dialog.task.id}
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
          onDuplicate={dialog.isNew ? undefined : duplicateFromDialog}
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

      {/* The second held on the spot before the lasso arms, drawn under the
          cursor: the ring closes exactly when the selection takes over. */}
      {gesture?.kind === 'create' && !gesture.moved && (
        <div
          className="cal-hold-cue"
          style={{ left: gesture.anchorX, top: gesture.anchorY }}
          aria-hidden="true"
        >
          <span className="cal-hold-ring" />
        </div>
      )}

      {groupMenu && selectedTasks.length > 0 && (
        <div
          className="cal-modal-backdrop cal-modal-backdrop--pop"
          onMouseDown={() => setGroupMenu(null)}
        >
          <div
            className="cal-session-pop cal-group-menu"
            style={gapMenuStyle(groupMenu)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="cal-session-head">
              <span className="cal-session-badge">Выделено · {selectedTasks.length}</span>
              <button
                type="button"
                className="cal-modal-close"
                onClick={() => setGroupMenu(null)}
                title="Закрыть"
              >
                ✕
              </button>
            </header>
            <p className="cal-session-when">
              {selectionSpan} · {dur(selectionSec)}
            </p>
            <div className="cal-session-actions">
              <button
                type="button"
                className="cal-btn"
                disabled={!canSplit}
                onClick={() => splitSelection(groupMenu)}
                title={
                  canSplit
                    ? 'Выделенные блоки станут отдельной секвенцией — остальные останутся своей'
                    : splitHint
                }
              >
                {splitLabel}
              </button>
              <button
                type="button"
                className="cal-btn"
                onClick={() => {
                  setSelection(new Set());
                  setGroupMenu(null);
                }}
              >
                Снять выделение
              </button>
              <button
                type="button"
                className="cal-btn cal-btn--danger"
                onClick={deleteSelection}
              >
                🗑 Удалить{selectedTasks.length > 1 ? ` (${selectedTasks.length})` : ''}
              </button>
            </div>
            <p className="cal-session-hint">
              {canSplit ? 'Потяни за любой выделенный блок — переедут все' : splitHint}
              {' · '}
              Ctrl + клик — добавить блок в пачку или убрать
            </p>
          </div>
        </div>
      )}

      {gapMenu && gapSlot && (
        <div
          className="cal-modal-backdrop cal-modal-backdrop--pop"
          onMouseDown={() => setGapMenu(null)}
        >
          <div
            className="cal-session-pop cal-gap-menu"
            style={gapMenuStyle(gapMenu)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="cal-session-head">
              <span className="cal-session-badge">Вставить из бэклога</span>
              <button
                type="button"
                className="cal-modal-close"
                onClick={() => setGapMenu(null)}
                title="Закрыть"
              >
                ✕
              </button>
            </header>
            <p className="cal-session-when">
              Свободно {dur(gapSlot.gapMs / 1000)} до следующей задачи
            </p>
            <div className="cal-session-actions">
              {gapSlot.candidates.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="cal-btn cal-gap-menu-item"
                  onClick={() => acceptGapTask(task, gapSlot.day, gapSlot.startMs)}
                >
                  <span className="cal-chip-emoji">{task.emoji}</span>
                  <span className="cal-chip-name">{task.name || 'Без названия'}</span>
                  <span className="cal-chip-time">{dur(task.plannedTime)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
