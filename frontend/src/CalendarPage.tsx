import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Habit, Task, TaskTemplate, TaskType } from './types';
import { DEFAULT_COLOR, TASK_COLORS, TASK_EMOJIS } from './types';
import * as api from './api';
import type { CalLayout } from './calendarLayout';
import { adoptServerLayout, cacheLayout, cachedLayout } from './calendarLayout';
import type { DayStore } from './dayStore';
import { IconLayoutColumns, IconLayoutRows } from './icons';
import type { Chain, DaySegment, ScheduleGap } from './schedule';
import type { Box } from './timeline';
import {
  DAY_MIN,
  MIN_MS,
  chainOfTask,
  clampStartMin,
  dayKeyOf,
  dayStartMs,
  daySegments,
  firstGapAfterCurrent,
  isDone,
  isReminder,
  isScheduled,
  isSession,
  mergeSuggestions,
  newSessionId,
  shiftPatches,
  shiftedSlot,
  slotAtMs,
  taskEndMs,
  taskStartMs,
} from './schedule';
import type { Marquee, Point, SelectionBlock, SelectionRect } from './selection';
import {
  HOLD_MS,
  chainOfSelection,
  clampMarquee,
  marqueeRect,
  onTheSpot,
  splitPatches,
  sweep,
  toggled,
} from './selection';
import {
  TL_GUTTER_PX,
  TL_LANE_PX,
  TL_MIN_BLOCK_PX,
  TL_PX_PER_MIN,
  TL_RAIL_PX,
  TL_REMINDER_PX,
  TL_RULER_PX,
  blockDetail,
  cardsBelow,
  dropPath,
  hourLabelStep,
  hoverCardUnder,
  landingLanes,
  laneCount,
  laneMiddle,
  laneTop,
  lanesHeight,
  layoutRows,
  linkPath,
  peekBand,
  cardsThatFit,
  pickPeeks,
  reminderRailCount,
  rowAt,
  rowContentHeight,
  sessionLinks,
  spreadCards,
  timelineScale,
} from './timeline';
import type { CreditSnapshot } from './credit';
import { computeCredit, creditGroups, projectedFinishMs } from './credit';
import { clockTime, compactDur, signedDur } from './format';
import { focusMotivation } from './focusMotivation';
import { dateKey, shiftDayKey, startOfWeek, todayKey } from './history';
import { newTaskId, spawnNextOccurrence } from './tasks';
import { taskFromTemplate } from './taskTemplates';
import type { DialogAnchor } from './TaskDialog';
import TaskDialog from './TaskDialog';
import SessionPopover from './SessionPopover';
import { sequenceGradientColors, sequenceGradientForTasks } from './sequenceGradients';
import { taskColorAnimationClass, taskColorStyle } from './taskAppearance';
import {
  TOUCH_HOLD_MS,
  edgeScrollStep,
  isTouchPointer,
  landsOnFling,
  touchWandered,
} from './touchGesture';
import { isPhoneScreen } from './viewport';

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

type TemplateDraft = {
  id: string | null;
  name: string;
  minutes: string;
  emoji: string;
  color: string;
  type: TaskType;
};

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
  const width = Math.min(GAP_MENU_WIDTH, vw - 2 * GAP_MENU_MARGIN);
  const left = Math.min(anchor.x, vw - width - GAP_MENU_MARGIN);
  const top = Math.min(anchor.y, vh - GAP_MENU_MARGIN);
  return { position: 'fixed', left: Math.max(GAP_MENU_MARGIN, left), top, width };
}

// One of the cards a hovered day opens: a reminder, or the first real break,
// with the on-screen rectangle its connector starts from.
type DayDetailItem =
  | { kind: 'reminder'; key: string; taskId: string; rect: Box; segment: DaySegment }
  | { kind: 'gap'; key: string; gap: ScheduleGap; rect: Box };

// A block drawn from a gesture or from the open editor rather than from the
// saved plan, clipped to one day. `task` carries the slot it is shown at.
type Ghost = {
  key: string;
  task: Task;
  topMin: number;
  lengthMin: number;
  startsHere: boolean;
  endsHere: boolean;
  live: boolean;
};

// ── drag gestures ──────────────────────────────────────────────────

// A finger press that has not taken hold yet (see touchGesture.ts): where it
// landed, which finger it is, and whether it has been held long enough to drag.
// Mouse presses carry no `touch` at all.
type TouchHold = { pointerId: number; x: number; y: number; armed: boolean };

type Gesture = (
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
      // Shift: the press builds on the batch already selected instead of
      // starting a new one. (Ctrl skips this gesture and goes straight to the
      // lasso.)
      additive: boolean;
    }
  | {
      kind: 'move';
      task: Task;
      grabMs: number; // how far into the block the pointer grabbed it
      day: string;
      startMin: number;
      moved: boolean;
      toBacklog: boolean; // pointer is currently over the backlog rail
    }
  | { kind: 'resize'; task: Task; day: string; lengthMin: number }
  // Dragging the top edge keeps the planned end fixed while changing start and
  // duration together. Unlike bottom resize, this is a placement change.
  | {
      kind: 'resize-start';
      task: Task;
      endMs: number;
      day: string;
      startMin: number;
      lengthMin: number;
    }
  // Dragging a session by its spine: every block of it moves by the same
  // delta, so the gaps inside the session are kept.
  | { kind: 'chain'; chain: Chain; anchorMs: number; deltaMs: number; moved: boolean }
  // Right-drag on the canvas: a vertical time band, ignoring which day/column
  // it started or wandered over — only the minute-of-day matters.
  | { kind: 'zoom'; anchorMin: number; startMin: number; endMin: number }
  // Armed by holding the button still on the canvas, or at once by a press
  // with Ctrl: a rectangle swept over the grid that picks up every block it
  // touches (see selection.ts).
  | {
      kind: 'lasso';
      marquee: Marquee;
      baseIds: string[];
      // Ctrl-pressed on a block and not yet dragged off the spot: let go here
      // it is a Ctrl+click that toggles that block; only a drag makes it a
      // sweep.
      pending: { taskId: string; x: number; y: number } | null;
    }
  // Dragging a selection by one of its blocks: all of them move by the same
  // delta, so the shape of the batch is kept.
  | { kind: 'multi'; tasks: Task[]; anchorMs: number; deltaMs: number; moved: boolean }
) & { touch?: TouchHold };

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
    if (saved === 'day' || saved === '3day' || saved === 'week' || saved === 'month') return saved;
    // A phone starts on one day: seven columns there are too narrow to read.
    return isPhoneScreen() ? 'day' : 'week';
  });
  // Columns or the timeline (see calendarLayout.ts). Opens the way this browser
  // last saw it, then follows the account once /api/prefs answers — unless the
  // switch has been flipped here in the meantime.
  const [layout, setLayout] = useState<CalLayout>(() => cachedLayout());
  const layoutPicked = useRef(false);
  useEffect(() => {
    let active = true;
    void api.loadPrefs().then(
      (prefs) => {
        const next = adoptServerLayout(prefs, layoutPicked.current);
        if (!active || !next) return;
        setLayout(next);
        cacheLayout(next);
      },
      (error) => console.error('Failed to load display preferences', error)
    );
    return () => {
      active = false;
    };
  }, []);
  const chooseLayout = useCallback((next: CalLayout) => {
    layoutPicked.current = true;
    setLayout(next);
    cacheLayout(next);
    api.savePrefs({ calendarLayout: next }).catch((error) => {
      console.error('Failed to save the calendar layout', error);
    });
  }, []);
  // The month is a grid of cells either way.
  const horizontal = layout === 'horizontal' && view !== 'month';
  const [anchor, setAnchor] = useState<string>(() => todayKey());
  const [backlogVisible, setBacklogVisible] = useState(() => {
    const saved = localStorage.getItem('speedrun_backlog_visible');
    // Folded away on a phone until asked for, so the grid keeps the screen.
    return saved === null ? !isPhoneScreen() : saved !== 'false';
  });
  const [backlogTab, setBacklogTab] = useState<'tasks' | 'templates'>('tasks');
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [templateDay, setTemplateDay] = useState(() => todayKey());
  const [templateBusy, setTemplateBusy] = useState(false);
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

  // Right-drag zoom: picks a minutes-per-pixel scale that makes the selected
  // band fill the scroller (its height in columns, its width in the
  // timeline), but the day is still rendered in full (0..DAY_MIN) at that
  // scale and stays normally scrollable — zooming only changes *how much* an
  // hour takes up, never what's reachable. Null means the default scale.
  const [zoomRange, setZoomRange] = useState<{ startMin: number; endMin: number } | null>(null);
  const [scrollerSize, setScrollerSize] = useState({ width: 0, height: 0 });

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

  // In compact multi-day views reminders are deliberately drawn as thin
  // rails. Hovering a day gives every visible rail its own detail card and a
  // connector, so several reminders stay visually tied to their real slots.
  const reminderStripRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // In the timeline the same cards open under (or over) the hovered row.
  const [dayReminderCard, setDayReminderCard] = useState<{
    day: string;
    rect: Box; // the column, or the visible part of the timeline row
    anchors: { key: string; taskId: string; rect: Box }[];
    gapAnchor: { key: string; gap: ScheduleGap; rect: Box } | null;
    // Timeline only: blocks whose name is cut short, and where on the screen
    // the row's lanes end (their peeks hang under there).
    peeks: { taskId: string; rect: Box }[];
    lanesBottom: number;
  } | null>(null);
  const reminderDetailRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [reminderDetailHeights, setReminderDetailHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    reminderDetailRefs.current.forEach((element, key) => {
      next[key] = element.offsetHeight;
    });
    setReminderDetailHeights((previous) => {
      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      const unchanged =
        previousKeys.length === nextKeys.length &&
        nextKeys.every((key) => previous[key] === next[key]);
      return unchanged ? previous : next;
    });
  }, [dayReminderCard, hoverCard, store.tasks]);

  useEffect(() => {
    localStorage.setItem('speedrun_cal_view', view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem('speedrun_backlog_visible', String(backlogVisible));
  }, [backlogVisible]);

  useEffect(() => {
    let active = true;
    void api.loadTaskTemplates().then(
      (items) => {
        if (active) setTemplates(items);
      },
      (error) => {
        console.error('Failed to load task templates', error);
        if (active) setTemplateError('Не удалось загрузить шаблоны');
      }
    );
    return () => { active = false; };
  }, []);

  // Re-attached whenever the grid may have been swapped for another element
  // (the month has none, the timeline its own). Measured once straight away,
  // before the first paint, so a zoomed grid never shows up at a guessed
  // scale for a frame first.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = (width: number, height: number) => {
      if (!width || !height) return;
      setScrollerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    measure(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) measure(box.width, box.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, horizontal]);

  // Touch: when the grid last scrolled (a finger landing on a gliding grid only
  // stops it — see landsOnFling), and where the dragging pointer last was, so
  // the edge auto-scroll can replay it after each step.
  const lastScrollAt = useRef(-Infinity);
  const lastPointer = useRef<{ x: number; y: number; id: number; type: string } | null>(null);

  // A finger held on a block drags it, so from then on the grid must not
  // scroll under it. The listener is non-passive and always there, which is
  // what lets the browser hold every touch on the grid for it to cancel.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      lastScrollAt.current = performance.now();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (gestureRef.current?.touch?.armed && e.cancelable) e.preventDefault();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [view, horizontal]);

  // Hover cards are anchored to snapshots of screen geometry — once the grid
  // scrolls those rectangles are stale, so just close both cards.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || (!hoverCard && !dayReminderCard)) return;
    const close = () => {
      setHoverCard(null);
      setDayReminderCard(null);
    };
    el.addEventListener('scroll', close, { passive: true });
    return () => el.removeEventListener('scroll', close);
  }, [hoverCard, dayReminderCard]);

  // A drag/resize/selection gesture in flight makes a lingering hover card
  // (from before the gesture started) misleading — drop it. Same once the
  // editor opens over the same block, or the view scrolls to another day.
  useEffect(() => {
    if (gesture) {
      setHoverCard(null);
      setDayReminderCard(null);
    }
  }, [gesture]);
  useEffect(() => {
    if (dialog) {
      setHoverCard(null);
      setDayReminderCard(null);
    }
  }, [dialog]);
  useEffect(() => {
    setHoverCard(null);
    setDayReminderCard(null);
  }, [view, anchor, horizontal]);

  const zoomLenMin = zoomRange ? Math.max(1, zoomRange.endMin - zoomRange.startMin) : DAY_MIN;
  // The timeline zooms across the room right of its day labels; unzoomed it
  // keeps a fixed scale and scrolls sideways through the day.
  const trackViewPx = horizontal ? scrollerSize.width - TL_GUTTER_PX : scrollerSize.height;
  const pxPerMin = horizontal
    ? timelineScale(trackViewPx, zoomRange ? zoomLenMin : null)
    : zoomRange && trackViewPx > 0
      ? trackViewPx / zoomLenMin
      : PX_PER_MIN;
  const minToPx = useCallback((min: number) => min * pxPerMin, [pxPerMin]);
  const lenToPx = useCallback((lenMin: number) => lenMin * pxPerMin, [pxPerMin]);
  // How short a block can be before it must be pushed into its own column to
  // stay readable — in *minutes*, so it shrinks as zooming in makes every
  // minute taller, letting blocks that no longer visually clash sit back to
  // back instead of staying forced side by side (see daySegments). The
  // timeline's lanes work the same way along the row.
  const minBlockMin = (horizontal ? TL_MIN_BLOCK_PX : MIN_BLOCK_PX) / pxPerMin;

  const today = todayKey();
  const tasks = store.tasks;
  const reminderTasks = useMemo(() => tasks.filter(isReminder), [tasks]);
  // Everything that is drawn as a block — reminders get rails of their own.
  const blockTasks = useMemo(() => tasks.filter((t) => !isReminder(t)), [tasks]);

  const visibleDays = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === '3day') return Array.from({ length: 3 }, (_, i) => shiftDayKey(anchor, i));
    if (view === 'week') {
      const from = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => shiftDayKey(from, i));
    }
    return monthCells(anchor);
  }, [view, anchor]);

  // The timeline's rows: how many lanes and reminder rails each day needs,
  // and where each row sits once the spare height is shared out. Counted
  // from the saved plan, so a row keeps its height while a block is dragged
  // out of it or into it.
  const timeline = useMemo(() => {
    if (!horizontal) return null;
    const lanes = visibleDays.map((day) => laneCount(daySegments(blockTasks, day, minBlockMin)));
    const rails = visibleDays.map((day) =>
      reminderRailCount(daySegments(reminderTasks, day, minBlockMin))
    );
    const rows = layoutRows(
      lanes.map((n, i) => rowContentHeight(n, rails[i])),
      Math.max(0, scrollerSize.height - TL_RULER_PX)
    );
    return { lanes, rails, rows };
  }, [horizontal, visibleDays, blockTasks, reminderTasks, minBlockMin, scrollerSize.height]);
  // Read by the scroll-into-view effect below without making it re-run (and
  // jump the sheet) on every edit that changes a row's height.
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  // Scroll the working hours into view when the grid is first shown. Zooming
  // in changes the scale, not what's reachable, so scroll to bring the band
  // that was just selected to the top instead — the rest of the (now taller)
  // day is still one scroll away. The timeline does the same across, and
  // brings today's row into view when the week is taller than the sheet.
  useEffect(() => {
    if (view === 'month') return;
    const el = scrollerRef.current;
    if (!el) return;
    const nowDate = new Date();
    const focusMin = visibleDays.includes(today) ? nowDate.getHours() * 60 : 8 * 60;
    if (horizontal) {
      el.scrollLeft = zoomRange
        ? zoomRange.startMin * pxPerMin
        : Math.max(0, (focusMin - 60) * TL_PX_PER_MIN);
      const todayIdx = visibleDays.indexOf(today);
      const rows = timelineRef.current?.rows;
      el.scrollTop = todayIdx > 0 && rows ? rows.tops[todayIdx] : 0;
      return;
    }
    if (zoomRange) {
      el.scrollTop = zoomRange.startMin * pxPerMin;
      return;
    }
    el.scrollTop = Math.max(0, (focusMin - 60) * PX_PER_MIN);
    // Only when the layout changes, not on every task edit.
  }, [view, today, visibleDays, zoomRange, pxPerMin, horizontal]);

  const openTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'open')
        .sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order),
    [tasks]
  );

  const startTemplate = useCallback((task?: Task) => {
    setTemplateDraft({
      id: null,
      name: task?.name ?? '',
      minutes: task ? String(task.plannedTime / 60) : '30',
      emoji: task?.emoji ?? TASK_EMOJIS[0],
      color: task?.color ?? DEFAULT_COLOR,
      type: task?.type ?? 'task',
    });
    setTemplateError(null);
    setBacklogTab('templates');
  }, []);

  const editTemplate = useCallback((template: TaskTemplate) => {
    setTemplateDraft({
      id: template.id,
      name: template.name,
      minutes: String(template.plannedTime / 60),
      emoji: template.emoji,
      color: template.color,
      type: template.type,
    });
    setTemplateError(null);
  }, []);

  const saveTemplate = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateDraft || templateBusy) return;
    const name = templateDraft.name.trim();
    const minutes = Number(templateDraft.minutes);
    if (!name || !Number.isFinite(minutes) || minutes <= 0) return;
    const template: TaskTemplate = {
      id: templateDraft.id ?? `template-${newTaskId()}`,
      name,
      plannedTime: Math.round(minutes * 60),
      emoji: templateDraft.emoji || TASK_EMOJIS[0],
      color: templateDraft.color,
      type: templateDraft.type,
    };
    setTemplateBusy(true);
    try {
      await api.saveTaskTemplate(template);
      setTemplates((previous) => {
        const others = (previous ?? []).filter((item) => item.id !== template.id);
        return [...others, template];
      });
      setTemplateDraft(null);
      setTemplateError(null);
    } catch (error) {
      console.error('Failed to save task template', error);
      setTemplateError('Не удалось сохранить шаблон');
    } finally {
      setTemplateBusy(false);
    }
  }, [templateDraft, templateBusy]);

  const deleteTemplate = useCallback(async (id: string) => {
    if (templateBusy) return;
    setTemplateBusy(true);
    try {
      await api.deleteTaskTemplate(id);
      setTemplates((previous) => (previous ?? []).filter((item) => item.id !== id));
      if (templateDraft?.id === id) setTemplateDraft(null);
      setTemplateError(null);
    } catch (error) {
      console.error('Failed to delete task template', error);
      setTemplateError('Не удалось удалить шаблон');
    } finally {
      setTemplateBusy(false);
    }
  }, [templateBusy, templateDraft]);

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
      const sequenceGradient = sequenceGradientForTasks(chain.tasks, chain.sessionId ?? chain.id);
      store.patchTasks(
        chain.tasks.map((t) => ({ id: t.id, patch: { sessionId, sessionName, sequenceGradient } }))
      );
    },
    [store]
  );

  const setChainGradient = useCallback(
    (chain: Chain, sequenceGradient: string) => {
      store.patchTasks(
        chain.tasks.map((task) => ({ id: task.id, patch: { sequenceGradient } }))
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
      const sequenceGradient = sequenceGradientForTasks([...before.tasks, ...after.tasks], sessionId);
      const deltaMs = before.endMs - after.startMs;
      store.patchTasks([
        ...before.tasks.map((t) => ({ id: t.id, patch: { sessionId, sessionName, sequenceGradient } })),
        ...after.tasks.map((t) => ({
          id: t.id,
          patch: { ...shiftedSlot(t, deltaMs), sessionId, sessionName, sequenceGradient },
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

  // Every gesture (drawing, moving, resizing, the lasso, zooming) reads the
  // pointer through this one mapping, so they all work the same way in the
  // timeline: there the row gives the day and the distance across the minute.
  const slotAt = useCallback(
    (clientX: number, clientY: number): { day: string; dayIdx: number; min: number } | null => {
      const el = columnsRef.current;
      if (!el || visibleDays.length === 0) return null;
      const rect = el.getBoundingClientRect();
      if (timeline) {
        const idx = rowAt(clientY - rect.top, timeline.rows);
        const min = Math.max(0, Math.min(DAY_MIN, (clientX - rect.left) / pxPerMin));
        return { day: visibleDays[idx], dayIdx: idx, min };
      }
      const colWidth = rect.width / visibleDays.length;
      const idx = Math.max(
        0,
        Math.min(visibleDays.length - 1, Math.floor((clientX - rect.left) / colWidth))
      );
      const min = Math.max(0, Math.min(DAY_MIN, (clientY - rect.top) / pxPerMin));
      return { day: visibleDays[idx], dayIdx: idx, min };
    },
    [visibleDays, pxPerMin, timeline]
  );

  const marqueeGeometry = useCallback((dayIdx: number) => {
    const grid = columnsRef.current;
    if (!grid) return null;
    const day = Array.from(grid.querySelectorAll<HTMLElement>('.cal-col[data-day], .tl-row[data-day]'))
      .find((element) => element.dataset.day === visibleDays[dayIdx]);
    if (!day) return null;
    const origin = grid.getBoundingClientRect();
    const relativeRect = (rect: DOMRect): SelectionRect => ({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    });
    const blocks: SelectionBlock[] = Array.from(
      day.querySelectorAll<HTMLElement>('.cal-block[data-task-id], .cal-reminder[data-reminder-id]')
    ).map((element) => ({
      ...relativeRect(element.getBoundingClientRect()),
      taskId: (element.dataset.taskId ?? element.dataset.reminderId)!,
      dayIdx,
    }));
    return { origin, bounds: relativeRect(day.getBoundingClientRect()), blocks };
  }, [visibleDays]);

  const setGestureState = useCallback((next: Gesture | null) => {
    gestureRef.current = next;
    if (!next) lastPointer.current = null;
    setGesture(next);
  }, []);

  // A finger press on the grid, not yet holding anything: it becomes a real
  // drag once held still for TOUCH_HOLD_MS (see touchGesture.ts). Returns
  // what the gesture should carry, or null for a finger that only landed to
  // stop the grid gliding — that press is ignored altogether.
  const holdTouch = useCallback(
    (e: React.PointerEvent): TouchHold | null => {
      cancelHold();
      if (landsOnFling(lastScrollAt.current, performance.now())) return null;
      // The drag redraws the block it holds elsewhere, which detaches the
      // element the finger landed on — and the browser keeps sending that
      // finger's touchmoves to it. So the no-scroll guard goes on the element
      // itself as well as on the grid.
      const target = e.target;
      if (target instanceof Element) {
        const onTouchMove = (ev: Event) => {
          if (gestureRef.current?.touch?.armed && ev.cancelable) ev.preventDefault();
        };
        const release = () => {
          target.removeEventListener('touchmove', onTouchMove);
          target.removeEventListener('touchend', release);
          target.removeEventListener('touchcancel', release);
        };
        target.addEventListener('touchmove', onTouchMove, { passive: false });
        target.addEventListener('touchend', release);
        target.addEventListener('touchcancel', release);
      }
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        const g = gestureRef.current;
        if (!g?.touch || g.touch.armed) return;
        navigator.vibrate?.(10);
        setGestureState({ ...g, touch: { ...g.touch, armed: true } });
      }, TOUCH_HOLD_MS);
      return { pointerId: e.pointerId, x: e.clientX, y: e.clientY, armed: false };
    },
    [setGestureState, cancelHold]
  );

  // One window-level pointer session drives create / move / resize, so the
  // gesture keeps working when the pointer leaves the block it started on.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.touch) {
        // Another finger (a pinch) is not this press.
        if (e.pointerId !== g.touch.pointerId) return;
        if (!g.touch.armed) {
          // Moving before the hold took: the finger is scrolling the grid.
          if (touchWandered(g.touch.x, g.touch.y, e.clientX, e.clientY)) {
            cancelHold();
            setGestureState(null);
          }
          return;
        }
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
      if (g.kind === 'create') {
        // Still within a few pixels of where it landed: the press is holding,
        // not drawing — leave the draft at its default size and let the hold
        // timer turn it into a lasso.
        if (!g.moved && onTheSpot(g.anchorX, g.anchorY, e.clientX, e.clientY)) return;
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
      const placementLocked =
        (g.kind === 'move' && Boolean(g.task.pinned)) ||
        (g.kind === 'chain' && g.chain.tasks.some((task) => task.pinned)) ||
        (g.kind === 'multi' && g.tasks.some((task) => task.pinned));
      if (placementLocked) return;
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
      // A Ctrl press on a block stays a click until the pointer leaves the
      // spot, so a hand that twitches while clicking still just toggles it.
      if (g.kind === 'lasso' && g.pending && onTheSpot(g.pending.x, g.pending.y, e.clientX, e.clientY)) {
        return;
      }
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      if (g.kind === 'move') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        const next = slotAtMs(snapMs(cursorMs - g.grabMs));
        setGestureState({ ...g, day: next.day, startMin: next.start, moved: true, toBacklog: false });
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
        const geometry = marqueeGeometry(g.marquee.dayIdx);
        if (!geometry) return;
        const marquee = clampMarquee({
          ...g.marquee,
          cursor: { x: e.clientX - geometry.origin.left, y: e.clientY - geometry.origin.top },
        }, geometry.bounds);
        setGestureState({ ...g, marquee, pending: null });
        setSelection(sweep(geometry.blocks, marquee, g.baseIds));
      } else if (g.kind === 'multi') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        setGestureState({ ...g, deltaMs: snapMs(cursorMs - g.anchorMs), moved: true });
      } else if (g.kind === 'resize') {
        const lengthMin = Math.max(MIN_LENGTH_MIN, snap(slot.min - (g.task.start ?? 0)));
        setGestureState({ ...g, lengthMin });
      } else if (g.kind === 'resize-start') {
        const cursorMs = dayStartMs(slot.day) + slot.min * MIN_MS;
        const startMs = Math.min(snapMs(cursorMs), g.endMs - MIN_LENGTH_MIN * MIN_MS);
        const next = slotAtMs(startMs);
        setGestureState({
          ...g,
          day: next.day,
          startMin: next.start,
          lengthMin: (g.endMs - startMs) / MIN_MS,
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.touch && e.pointerId !== g.touch.pointerId) return;
      cancelHold();
      setGestureState(null);
      // A finger let go before the hold took is a tap: it falls through to the
      // same not-moved branches a click takes — open the block or the session,
      // or draft a new block where it landed.
      if (g.kind === 'create') {
        // A plain click on the canvas while a batch is selected drops the
        // selection rather than dropping a new block on top of it. Held with
        // Shift the click is part of composing that batch, so it keeps it —
        // and never drops a new block either way.
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
      } else if (g.kind === 'lasso') {
        // Ctrl+clicked a block without dragging: it joins the batch, or drops
        // back out of it. A swept lasso has already committed as it moved.
        if (g.pending) setSelection(toggled(selectedRef.current, g.pending.taskId));
      } else if (g.kind === 'multi') {
        // Clicked rather than dragged: the batch opens its own menu.
        if (!g.moved) setGroupMenu({ x: e.clientX, y: e.clientY });
        else if (g.deltaMs !== 0) store.patchTasks(shiftPatches(g.tasks, g.deltaMs));
      } else if (g.kind === 'resize' && g.lengthMin * 60 !== g.task.plannedTime) {
        store.patchTask(g.task.id, { plannedTime: g.lengthMin * 60 });
      } else if (
        g.kind === 'resize-start' &&
        (g.day !== g.task.day ||
          g.startMin !== g.task.start ||
          g.lengthMin * 60 !== g.task.plannedTime)
      ) {
        store.patchTask(g.task.id, {
          day: g.day,
          start: g.startMin,
          plannedTime: g.lengthMin * 60,
        });
      }
    };

    // The browser took the pointer over — a finger that started scrolling or
    // pinching, or the system interrupting — so nothing is committed.
    const onCancel = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.touch && e.pointerId !== g.touch.pointerId) return;
      cancelHold();
      setGestureState(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [
    slotAt,
    setGestureState,
    setSelection,
    cancelHold,
    draftTask,
    store,
    marqueeGeometry,
    openDialog,
    openSession,
  ]);

  // Anchor at the exact pointer position within the starting day.
  const armLasso = useCallback(
    (
      dayIdx: number,
      pointer: Point,
      baseIds: string[],
      pending: { taskId: string; x: number; y: number } | null = null
    ) => {
      const geometry = marqueeGeometry(dayIdx);
      if (!geometry) return;
      const anchor = { x: pointer.x - geometry.origin.left, y: pointer.y - geometry.origin.top };
      setGestureState({
        kind: 'lasso',
        marquee: clampMarquee({ dayIdx, anchor, cursor: anchor }, geometry.bounds),
        baseIds,
        pending,
      });
    },
    [setGestureState, marqueeGeometry]
  );

  // A press on the canvas starts as a block being drawn. Held on the spot for
  // a second instead — the ring under the cursor fills to say so — it turns
  // into a lasso over the grid, and dragging from there picks up blocks rather
  // than drawing a new one. Shift adds to what is already selected. With Ctrl
  // (⌘) there is no second to wait: the press is a lasso straight away, adding
  // to the batch.
  //
  // A finger has no lasso: a tap drafts a block where it landed, and held
  // still first it draws one — dragged up or down from there, like a mouse.
  const startCreate = useCallback(
    (e: React.PointerEvent, day: string) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      if (isTouchPointer(e.pointerType)) {
        const touch = holdTouch(e);
        if (!touch) return;
        const anchorMin = snap(slot.min);
        setGestureState({
          kind: 'create',
          day,
          anchorMin,
          startMin: anchorMin,
          endMin: anchorMin + DEFAULT_LENGTH_MIN,
          anchorX: e.clientX,
          anchorY: e.clientY,
          moved: false,
          additive: false,
          touch,
        });
        return;
      }
      e.preventDefault();
      cancelHold();
      if (e.ctrlKey || e.metaKey) {
        armLasso(slot.dayIdx, { x: e.clientX, y: e.clientY }, [...selectedRef.current]);
        return;
      }
      const anchorMin = snap(slot.min);
      const additive = e.shiftKey;
      setGestureState({
        kind: 'create',
        day,
        anchorMin,
        startMin: anchorMin,
        endMin: anchorMin + DEFAULT_LENGTH_MIN,
        anchorX: e.clientX,
        anchorY: e.clientY,
        moved: false,
        additive,
      });
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        const held = gestureRef.current;
        if (!held || held.kind !== 'create' || held.moved) return;
        const baseIds = additive ? [...selectedRef.current] : [];
        setSelection(new Set(baseIds));
        armLasso(slot.dayIdx, { x: held.anchorX, y: held.anchorY }, baseIds);
      }, HOLD_MS);
    },
    [slotAt, setGestureState, setSelection, cancelHold, armLasso, holdTouch]
  );

  const startMove = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      // A finger takes hold of the block only once held still — see holdTouch.
      let touch: TouchHold | undefined;
      if (isTouchPointer(e.pointerType)) {
        const held = holdTouch(e);
        if (!held) return;
        touch = held;
      }
      // Ctrl (⌘) means "compose the batch": nothing is dragged and no editor
      // opens. Let go on the spot, it picks this one block — adds it, or drops
      // it back out if it was already in; dragged off, it sweeps a lasso from
      // here that adds every block it touches, without the hold the bare canvas
      // needs.
      if (!touch && (e.ctrlKey || e.metaKey)) {
        armLasso(slot.dayIdx, { x: e.clientX, y: e.clientY }, [...selectedRef.current],
          { taskId: task.id, x: e.clientX, y: e.clientY });
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
          touch,
        });
        return;
      }
      if (selectedRef.current.size > 0) setSelection(new Set());
      setGestureState({
        kind: 'move',
        task,
        grabMs: dayStartMs(slot.day) + slot.min * MIN_MS - taskStartMs(task),
        day: task.day,
        startMin: task.start ?? 0,
        moved: false,
        toBacklog: false,
        touch,
      });
    },
    [slotAt, setGestureState, setSelection, store, armLasso, holdTouch]
  );

  const startChainDrag = useCallback(
    (e: React.PointerEvent, chain: Chain) => {
      if (e.button !== 0) return;
      const slot = slotAt(e.clientX, e.clientY);
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      let touch: TouchHold | undefined;
      if (isTouchPointer(e.pointerType)) {
        const held = holdTouch(e);
        if (!held) return;
        touch = held;
      }
      setGestureState({
        kind: 'chain',
        chain,
        anchorMs: dayStartMs(slot.day) + slot.min * MIN_MS,
        deltaMs: 0,
        moved: false,
        touch,
      });
    },
    [slotAt, setGestureState, holdTouch]
  );

  const startResize = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      if (!isTouchPointer(e.pointerType) && (e.ctrlKey || e.metaKey)) {
        startMove(e, task);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'resize',
        task,
        day: task.day,
        lengthMin: Math.round(task.plannedTime / 60),
      });
    },
    [setGestureState, startMove]
  );

  const startResizeTop = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (e.button !== 0) return;
      if (!isTouchPointer(e.pointerType) && (e.ctrlKey || e.metaKey)) {
        startMove(e, task);
        return;
      }
      if (task.pinned) return;
      e.preventDefault();
      e.stopPropagation();
      setGestureState({
        kind: 'resize-start',
        task,
        endMs: taskEndMs(task),
        day: task.day,
        startMin: task.start ?? 0,
        lengthMin: task.plannedTime / 60,
      });
    },
    [setGestureState, startMove]
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
      if (!task || task.pinned) return;
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

    const candidates = openTasks.filter(
      (t) => t.plannedTime * 1000 <= gapMs && !isReminder(t) && !t.pinned
    );
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
      if (task.pinned) return;
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

  // A finger that has not taken hold yet is still just a tap or a scroll, so
  // the grid is drawn as if nothing were being dragged.
  const liveGesture = gesture?.touch && !gesture.touch.armed ? null : gesture;

  // Whether something is being carried across the grid right now — what the
  // edge auto-scroll below waits for.
  const carrying =
    liveGesture !== null &&
    (liveGesture.kind === 'resize' ||
      liveGesture.kind === 'resize-start' ||
      (liveGesture.kind === 'lasso' && !liveGesture.pending) ||
      ((liveGesture.kind === 'create' ||
        liveGesture.kind === 'move' ||
        liveGesture.kind === 'chain' ||
        liveGesture.kind === 'multi') &&
        (liveGesture.moved || Boolean(liveGesture.touch))));

  // Carried up to the top or bottom edge, the grid scrolls on by itself, so a
  // block can be taken to an hour that is off screen — on a phone that is most
  // of the day. The timeline scrolls sideways through the hours the same way,
  // and up or down through its rows; its edges are where the sticky ruler and
  // day labels end, not the scroller's own. After each step the pointer's
  // last position is replayed, so what is carried follows the content that
  // scrolled under it.
  useEffect(() => {
    if (!carrying) return;
    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step);
      const el = scrollerRef.current;
      const p = lastPointer.current;
      if (!el || !p) return;
      const rect = el.getBoundingClientRect();
      const dx = horizontal ? edgeScrollStep(p.x, rect.left + TL_GUTTER_PX, rect.right) : 0;
      const dy = edgeScrollStep(p.y, rect.top + (horizontal ? TL_RULER_PX : 0), rect.bottom);
      if (dx === 0 && dy === 0) return;
      const beforeX = el.scrollLeft;
      const beforeY = el.scrollTop;
      el.scrollLeft += dx;
      el.scrollTop += dy;
      if (el.scrollLeft === beforeX && el.scrollTop === beforeY) return;
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: p.x,
          clientY: p.y,
          pointerId: p.id,
          pointerType: p.type,
        })
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [carrying, horizontal]);

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
            {visibleDays.includes(today) && (
              <div className="cal-hour cal-now-label" style={{ top: minToPx(nowMin) }}>
                <span>{hhmm(nowMin)}</span>
              </div>
            )}
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
            {g?.kind === 'lasso' && !g.pending && renderMarquee(g.marquee)}
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

  // Both orientations draw the same rectangle in grid pixels.
  const renderMarquee = (marquee: Marquee) => {
    const { left, right, top, bottom } = marqueeRect(marquee);
    return (
      <div
        className="cal-marquee"
        style={{ left, top, width: right - left, height: bottom - top }}
      >
        <span>Выделено · {selectedIds.size}</span>
      </div>
    );
  };

  const showDayReminders = (day: string, target: HTMLElement) => {
    if (view !== '3day' && view !== 'week') return;
    const segments = daySegments(reminderTasks, day);
    const gap = firstGapAfterCurrent(tasks, day, now);
    const column = target.classList.contains('cal-col')
      ? target
      : Array.from(columnsRef.current?.querySelectorAll<HTMLElement>('.cal-col') ?? []).find(
          (candidate) => candidate.dataset.day === day
        );
    const scrollerRect = scrollerRef.current?.getBoundingClientRect();
    if (!column || !scrollerRect) {
      setDayReminderCard(null);
      return;
    }
    const columnRect = column.getBoundingClientRect();
    const anchors = segments.flatMap((segment) => {
      const key = `${day}:${segment.task.id}`;
      const rect = reminderStripRefs.current.get(key)?.getBoundingClientRect();
      // A connector only makes sense for a rail that is actually visible in
      // the scrolled portion of the timeline.
      if (!rect || rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) return [];
      return [{ key, taskId: segment.task.id, rect }];
    });
    const gapAnchor = gap
      ? (() => {
          const dayFrom = dayStartMs(day);
          const rawTop = columnRect.top + minToPx((gap.currentEndMs - dayFrom) / MIN_MS);
          const rawBottom = columnRect.top + minToPx((gap.nextStartMs - dayFrom) / MIN_MS);
          const middle = Math.min(
            scrollerRect.bottom,
            Math.max(scrollerRect.top, (rawTop + rawBottom) / 2)
          );
          return {
            key: `gap:${day}`,
            gap,
            rect: {
              left: columnRect.left,
              right: columnRect.right,
              top: middle,
              bottom: middle,
            },
          };
        })()
      : null;
    if (anchors.length === 0 && !gapAnchor) {
      setDayReminderCard(null);
      return;
    }
    setDayReminderCard({ day, rect: columnRect, anchors, gapAnchor, peeks: [], lanesBottom: 0 });
  };

  const hideDayReminders = (day: string) => {
    setDayReminderCard((card) => (card?.day === day ? null : card));
  };

  // The timeline's version of showDayReminders. In the 3-day and week views
  // it opens the same reminder and break cards; in every view it also opens
  // the hover cards of the blocks too short to show their own name.
  // Where each rail and the break sit is already known from the row's
  // geometry; which names are cut short is read straight off the row's own
  // blocks — one pass over a handful of elements that are laid out already.
  // Anything scrolled out of sight gets no card.
  const showTimelineDay = (day: string, idx: number, rowEl: HTMLElement) => {
    // A drag passing over rows is not a hover.
    if (gestureRef.current) return;
    const tracks = columnsRef.current;
    const scroller = scrollerRef.current;
    if (!timeline || !tracks || !scroller) return;
    const origin = tracks.getBoundingClientRect();
    const sheet = scroller.getBoundingClientRect();
    const rowTop = origin.top + timeline.rows.tops[idx];
    const rowBottom = rowTop + timeline.rows.heights[idx];
    // The part of the row actually on screen, right of the pinned labels and
    // under the pinned ruler.
    const row: Box = {
      left: Math.max(sheet.left + TL_GUTTER_PX, origin.left),
      right: Math.min(sheet.right, origin.left + DAY_MIN * pxPerMin),
      top: Math.max(sheet.top + TL_RULER_PX, rowTop),
      bottom: Math.min(sheet.bottom, rowBottom),
    };

    // A compact block shows no name at all; any other may be cutting its
    // name short with an ellipsis.
    const cut: { taskId: string; rect: Box }[] = [];
    rowEl.querySelectorAll<HTMLElement>('.cal-block[data-task-id]').forEach((el) => {
      const name = el.querySelector<HTMLElement>('.cal-block-name');
      const hidden =
        el.classList.contains('compact') || (name !== null && name.scrollWidth > name.clientWidth);
      if (hidden && el.dataset.taskId) {
        cut.push({ taskId: el.dataset.taskId, rect: el.getBoundingClientRect() });
      }
    });
    const peeks = pickPeeks(cut, row);
    const lanesBottom = Math.min(
      row.bottom,
      Math.max(row.top, rowTop + TL_RAIL_PX + lanesHeight(timeline.lanes[idx]))
    );

    // As in the columns, a single day has no reminder or break cards: each of
    // its rails brings its own.
    const dayCards = view === '3day' || view === 'week';
    const segments = dayCards ? daySegments(reminderTasks, day, minBlockMin) : [];
    const gap = dayCards ? firstGapAfterCurrent(tasks, day, now) : null;
    const anchors = segments.flatMap((seg) => {
      const left = origin.left + minToPx(seg.topMin);
      const right = left + Math.max(TL_MIN_BLOCK_PX / 2, lenToPx(seg.bottomMin - seg.topMin));
      if (right < row.left || left > row.right) return [];
      const bottom = rowBottom - 4 - seg.col * TL_REMINDER_PX;
      return [{ key: `${day}:${seg.task.id}`, taskId: seg.task.id, rect: { left, right, top: bottom - 6, bottom } }];
    });
    const dayFrom = dayStartMs(day);
    const gapAnchor = gap
      ? (() => {
          const from = origin.left + minToPx(Math.max(0, (gap.currentEndMs - dayFrom) / MIN_MS));
          const to = origin.left + minToPx(Math.min(DAY_MIN, (gap.nextStartMs - dayFrom) / MIN_MS));
          const middle = rowTop + TL_RAIL_PX + lanesHeight(timeline.lanes[idx]) / 2;
          return { key: `gap:${day}`, gap, rect: { left: from, right: to, top: middle, bottom: middle } };
        })()
      : null;
    if (anchors.length === 0 && !gapAnchor && peeks.length === 0) {
      setDayReminderCard(null);
      return;
    }
    setDayReminderCard({ day, rect: row, anchors, gapAnchor, peeks, lanesBottom });
  };

  // Everything one day shows, whichever way the grid runs: its blocks and
  // reminders packed from the saved plan, the sessions and glue handles that
  // touch it, and the ghosts — blocks drawn from a gesture or from the open
  // editor rather than from the plan.
  const dayLayers = (day: string) => {
    const dayFrom = dayStartMs(day);
    const dayTo = dayFrom + DAY_MIN * MIN_MS;
    const g = liveGesture;
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
            : g?.kind === 'resize-start'
              ? [g.task.id]
            : []
    );
    if (livePreview) ghostIds.add(livePreview.id);

    // Reminders never share the normal blocks' column-packed layout — they are
    // a read-only overlay pinned to the column's right edge, or along the
    // bottom of a timeline row — so they are laid out separately, from their
    // own subset of the day's tasks.
    const segments = daySegments(blockTasks, day, minBlockMin).filter(
      (seg) => !ghostIds.has(seg.task.id)
    );

    const reminderSegments = daySegments(
      reminderTasks,
      day,
      minBlockMin
    ).filter((seg) => !ghostIds.has(seg.task.id));

    // Sessions and sequences, drawn as a spine to the left of the column (a
    // rail over the lanes in the timeline). While one is dragged it is shown
    // where it would land.
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
    const ghosts: Ghost[] = [];
    const reminderGhosts: Ghost[] = [];
    // A block being dragged may hang over midnight, so its ghost is clipped to
    // this day and drawn in every day it touches — the same seam a saved block
    // gets from daySegments.
    const pushGhost = (key: string, task: Task, slot: { day: string; start: number }, live: boolean) => {
      const startMs = dayStartMs(slot.day) + slot.start * MIN_MS;
      const endMs = startMs + task.plannedTime * 1000;
      if (endMs <= dayFrom || startMs >= dayTo) return;
      const top = Math.max(startMs, dayFrom);
      const bottom = Math.min(endMs, dayTo);
      (isReminder(task) ? reminderGhosts : ghosts).push({
        key,
        task: { ...task, day: slot.day, start: slot.start },
        topMin: (top - dayFrom) / MIN_MS,
        lengthMin: (bottom - top) / MIN_MS,
        startsHere: startMs >= dayFrom,
        endsHere: endMs <= dayTo,
        live,
      });
    };
    if (dragChain) {
      for (const task of dragChain.chain.tasks) {
        pushGhost(task.id, task, shiftedSlot(task, dragChain.deltaMs), false);
      }
    } else if (dragMulti) {
      for (const task of dragMulti.tasks) {
        pushGhost(task.id, task, shiftedSlot(task, dragMulti.deltaMs), false);
      }
    } else if (g?.kind === 'move' && !g.toBacklog) {
      pushGhost(g.task.id, g.task, { day: g.day, start: g.startMin }, false);
    } else if (g?.kind === 'resize-start') {
      pushGhost(
        g.task.id,
        { ...g.task, plannedTime: g.lengthMin * 60 },
        { day: g.day, start: g.startMin },
        false
      );
    }
    if (livePreview) {
      pushGhost(
        `preview-${livePreview.id}`,
        livePreview,
        { day: livePreview.day, start: livePreview.start ?? 0 },
        true
      );
    }

    return {
      dayFrom,
      dragChain,
      segments,
      reminderSegments,
      daySessions,
      glueSpots,
      ghosts,
      reminderGhosts,
    };
  };

  // One saved block, in a day column or in a timeline row (`across`). Where
  // it goes and whether its times fit come from `place`, given the length it
  // is drawn at (live while its end is being dragged); its state, its ✓ and
  // its edges are the same either way.
  const renderBlock = (
    seg: DaySegment,
    day: string,
    across: boolean,
    place: (lengthMin: number) => {
      style: React.CSSProperties;
      showMeta: boolean;
      compact?: boolean;
    }
  ) => {
    const g = liveGesture;
    const task = seg.task;
    const resizing = g?.kind === 'resize' && g.task.id === task.id;
    const topMin = seg.topMin;
    const lengthMin = resizing ? g.lengthMin : seg.bottomMin - seg.topMin;
    const { style, showMeta, compact } = place(lengthMin);
    const done = isDone(task);
    // Just clicked: the block plays its grow-and-sweep flourish while
    // the bullet itself already reflects the real (instant) done state.
    const justCompleted = completingIds.has(task.id);
    // A closed block reads as closed even while the rest of its
    // parallel group is still being worked on.
    const active = activeIds.has(task.id) && !done;
    // How far the clock is through the block, for its elapsed shade.
    const elapsed = !active
      ? 0
      : day === today
        ? (nowMin - topMin) / Math.max(1, lengthMin)
        : day < today
          ? 1
          : 0;

    return (
      <div
        key={task.id}
        data-task-id={task.id}
        className={[
          'cal-block',
          across ? 'cal-block--across' : '',
          compact ? 'compact' : '',
          done ? 'done' : '',
          justCompleted ? 'completing' : '',
          active ? 'active' : '',
          active && elapsed > 0 && elapsed < 1 ? 'now-inside' : '',
          task.type === 'rest' ? 'rest' : '',
          task.sessionId ? 'in-session' : '',
          task.pinned ? 'pinned' : '',
          taskColorAnimationClass(task.colorAnimation),
          selectedIds.has(task.id) ? 'selected' : '',
          resizing ? 'dragging' : '',
          !seg.startsHere ? (across ? 'cont-start' : 'cont-top') : '',
          !seg.endsHere ? (across ? 'cont-end' : 'cont-bottom') : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          ...style,
          ...(active ? { '--elapsed': `${Math.min(1, Math.max(0, elapsed)) * 100}%` } : {}),
          ...taskColorStyle(task.color, task.colorAnimation),
        } as React.CSSProperties}
        onPointerDown={(e) => startMove(e, task)}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') {
            setHoverCard({ task, rect: e.currentTarget.getBoundingClientRect() });
          }
        }}
        onPointerLeave={() => setHoverCard((c) => (c?.task.id === task.id ? null : c))}
      >
        <div className="cal-block-head">
          <span className="cal-block-emoji">{task.emoji}</span>
          <span className="cal-block-name">{task.name || 'Без названия'}</span>
          {task.pinned && (
            <span className="cal-block-pin" title="Закреплено — снимите флажок в редакторе, чтобы перенести">
              📌
            </span>
          )}
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
        {showMeta && (
          <div className="cal-block-meta">
            <span>
              {hhmm(seg.topMin)}–{hhmm(seg.topMin + lengthMin)}
            </span>
            <strong className="cal-block-duration">{dur(lengthMin * 60)}</strong>
          </div>
        )}
        {seg.startsHere && !task.pinned && (
          <div
            className={`cal-block-resize ${across ? 'cal-block-resize--start' : 'cal-block-resize--top'}`}
            onPointerDown={(e) => startResizeTop(e, task)}
            title="Потянуть — изменить начало и длительность"
          />
        )}
        <div
          className={`cal-block-resize ${across ? 'cal-block-resize--end' : 'cal-block-resize--bottom'}`}
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
  };

  // A block drawn from a drag or from the open editor: it rises off the grid
  // (or, followed by the editor, is outlined) where it would land.
  const renderGhost = (
    ghost: Ghost,
    across: boolean,
    style: React.CSSProperties,
    { showMeta = true, compact = false }: { showMeta?: boolean; compact?: boolean } = {}
  ) => (
    <div
      key={ghost.key}
      className={[
        'cal-block',
        across ? 'cal-block--across' : '',
        compact ? 'compact' : '',
        ghost.live ? 'live' : 'dragging',
        taskColorAnimationClass(ghost.task.colorAnimation),
        ghost.startsHere ? '' : across ? 'cont-start' : 'cont-top',
        ghost.endsHere ? '' : across ? 'cont-end' : 'cont-bottom',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...style,
        ...taskColorStyle(ghost.task.color, ghost.task.colorAnimation),
      } as React.CSSProperties}
    >
      <div className="cal-block-head">
        <span className="cal-block-emoji">{ghost.task.emoji}</span>
        <span className="cal-block-name">{ghost.task.name || 'Без названия'}</span>
      </div>
      {showMeta && (
        <div className="cal-block-meta">
          <span>
            {hhmm(ghost.topMin)}–{hhmm(ghost.topMin + ghost.lengthMin)}
          </span>
          <strong className="cal-block-duration">{dur(ghost.lengthMin * 60)}</strong>
        </div>
      )}
    </div>
  );

  // What a session's spine (or rail) says under the pointer.
  const chainHint = (chain: Chain) =>
    chain.tasks.some((task) => task.pinned)
      ? `${chain.name ?? 'Секвенция'} · содержит закреплённую задачу — перенос заблокирован`
      : `${chain.name ?? 'Секвенция'} · ${chain.tasks.length} задач — открыть настройки сессии, потянуть — перенести целиком`;

  const renderColumn = (day: string) => {
    const {
      dayFrom,
      dragChain,
      segments,
      reminderSegments,
      daySessions,
      glueSpots,
      ghosts,
      reminderGhosts,
    } = dayLayers(day);
    const isToday = day === today;
    const g = liveGesture;

    return (
      <div
        key={day}
        className={`cal-col${isToday ? ' today' : ''}`}
        data-day={day}
        // Hover cards are for a mouse: a tap fires enter events too, and would
        // leave a card standing over the editor it opens.
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') showDayReminders(day, e.currentTarget);
        }}
        onPointerLeave={() => hideDayReminders(day)}
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
          const sequenceGradient = sequenceGradientForTasks(chain.tasks, chain.sessionId ?? chain.id);
          const [sequenceAccent] = sequenceGradientColors(sequenceGradient);
          return (
            <div
              key={chain.id}
              className={[
                'cal-chain',
                chain.sessionId ? 'session' : '',
                chain.name ? 'named' : '',
                chain.tasks.some((task) => task.pinned) ? 'locked' : '',
                dragChain?.chain.id === chain.id ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top,
                height,
                '--sequence-gradient': sequenceGradient,
                '--sequence-accent': sequenceAccent,
              } as React.CSSProperties}
              title={chainHint(chain)}
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
            column, thin on purpose. Hovering the day gives every visible rail
            its own connected detail card. Past its own end it fades to a
            dashed grey outline instead of disappearing. */}
        {reminderSegments.map((seg) => {
          const task = seg.task;
          const lengthMin = seg.bottomMin - seg.topMin;
          const height = Math.max(MIN_BLOCK_PX, lenToPx(lengthMin));
          const expired = taskEndMs(task) <= now;
          return (
            <div
              key={task.id}
              ref={(element) => {
                const key = `${day}:${task.id}`;
                if (element) reminderStripRefs.current.set(key, element);
                else reminderStripRefs.current.delete(key);
              }}
              data-reminder-id={task.id}
              className={`cal-reminder ${taskColorAnimationClass(task.colorAnimation)}${expired ? ' expired' : ''}${
                selectedIds.has(task.id) ? ' selected' : ''
              }`}
              style={{
                top: minToPx(seg.topMin),
                height,
                right: 2 + seg.col * 11,
                ...taskColorStyle(task.color, task.colorAnimation),
              } as React.CSSProperties}
              onPointerDown={(e) => startMove(e, task)}
              title={`${task.pinned ? '📌 ' : ''}🔔 ${task.name || 'Напоминание'} · ${hhmm(seg.topMin)}–${hhmm(
                seg.topMin + lengthMin
              )}${expired ? ' · окно закрыто' : ''} — нажми, чтобы посмотреть`}
            />
          );
        })}

        {reminderGhosts.map((ghost) => (
          <div
            key={ghost.key}
            className={`${ghost.live ? 'cal-reminder live' : 'cal-reminder dragging'} ${taskColorAnimationClass(ghost.task.colorAnimation)}`}
            style={{
              top: minToPx(ghost.topMin),
              height: Math.max(MIN_BLOCK_PX, lenToPx(ghost.lengthMin)),
              right: 2,
              ...taskColorStyle(ghost.task.color, ghost.task.colorAnimation),
            } as React.CSSProperties}
          />
        ))}

        <div className="cal-col-body">
        {segments.map((seg) =>
          renderBlock(seg, day, false, (lengthMin) => {
            const height = Math.max(MIN_BLOCK_PX, lenToPx(lengthMin));
            const width = 100 / seg.cols;
            return {
              style: {
                top: minToPx(seg.topMin),
                height,
                left: `${seg.col * width}%`,
                width: `${width}%`,
              },
              showMeta: height > 34,
            };
          })
        )}

        {ghosts.map((ghost) =>
          renderGhost(ghost, false, {
            top: minToPx(ghost.topMin),
            height: Math.max(MIN_BLOCK_PX, lenToPx(ghost.lengthMin)),
          })
        )}

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
              <strong className="cal-block-duration">{dur((g.endMin - g.startMin) * 60)}</strong>
            </div>
          </div>
        )}

        {gapSlot && gapSlot.day === day && !liveGesture && (
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
            title={
              spot.gapMs === 0
                ? 'Блоки идут подряд, но не связаны — склеить в одну сессию'
                : `Между блоками ${dur(spot.gapMs / 1000)} — склеить в одну сессию`
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => glueChains(spot.before, spot.after)}
          >
            🔗 {spot.gapMs === 0 ? 'подряд' : dur(spot.gapMs / 1000)}
          </button>
        ))}

        {isToday && renderNowMarkers()}
        </div>
      </div>
    );
  };

  // ── timeline (the horizontal layout) ─────────────────────────────

  // The sheet turned on its side: a row per day with the hours running
  // across, an hour ruler along the top and the days down the left, both
  // pinned while the sheet scrolls under them. Blocks that run at once stack
  // into lanes, and a session's blocks hang under one rail, tied step to step
  // by connectors.
  const renderTimeline = () => {
    if (!timeline) return null;
    const { rows } = timeline;
    const g = gesture;
    const trackPx = DAY_MIN * pxPerMin;
    const labelStep = hourLabelStep(pxPerMin);
    // Half-hour lines only once an hour is wide enough to be split by eye.
    const lineStep = pxPerMin * 60 >= 90 ? 30 : 60;
    const showNow = visibleDays.includes(today);
    return (
      <div
        className="cal-grid cal-grid--timeline"
        ref={scrollerRef}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="tl-ruler" style={{ width: TL_GUTTER_PX + trackPx, height: TL_RULER_PX }}>
          <div className="tl-corner" style={{ width: TL_GUTTER_PX }} />
          <div className="tl-ticks" style={{ width: trackPx }}>
            {Array.from({ length: 24 / labelStep }, (_, i) => i * labelStep).map((h) => (
              <span key={h} className="tl-tick" style={{ left: minToPx(h * 60) }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
            {showNow && (
              // Kept whole in the first and last minutes of the day.
              <span
                className="tl-now-label"
                style={{ left: Math.min(trackPx - 22, Math.max(22, minToPx(nowMin))) }}
              >
                {hhmm(nowMin)}
              </span>
            )}
          </div>
        </div>
        <div className="tl-body" style={{ width: TL_GUTTER_PX + trackPx, height: rows.total }}>
          <div className="tl-labels" style={{ width: TL_GUTTER_PX }}>
            {visibleDays.map((day, idx) => renderTimelineLabel(day, idx))}
          </div>
          <div className="tl-tracks" ref={columnsRef} style={{ width: trackPx }}>
            {Array.from({ length: DAY_MIN / lineStep }, (_, i) => i * lineStep).map((min) => (
              <div
                key={min}
                className={`tl-hour-line${min % 60 ? ' half' : ''}`}
                style={{ left: minToPx(min) }}
              />
            ))}
            {visibleDays.map((day, idx) => renderTimelineRow(day, idx))}
            {/* The same minute on the other days, faint: today's own row
                carries the real now line. */}
            {showNow && <div className="tl-now-guide" style={{ left: minToPx(nowMin) }} />}
            {g?.kind === 'lasso' && !g.pending && renderMarquee(g.marquee)}
            {g?.kind === 'zoom' && (
              <div
                className="cal-zoom-select cal-zoom-select--across"
                style={{ left: minToPx(g.startMin), width: lenToPx(g.endMin - g.startMin) }}
              >
                <span>{hhmm(g.startMin)}–{hhmm(g.endMin)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // A day's label, pinned to the left edge: the weekday over the date, as in
  // the columns' header. Pressed, it opens that day on its own.
  const renderTimelineLabel = (day: string, idx: number) => {
    const { rows } = timeline!;
    const [y, m, d] = day.split('-').map(Number);
    const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
    const reminderCount = daySegments(reminderTasks, day).length;
    return (
      <button
        key={day}
        type="button"
        className={['tl-day', day === today ? 'today' : '', weekday >= 5 ? 'weekend' : '']
          .filter(Boolean)
          .join(' ')}
        style={{ top: rows.tops[idx], height: rows.heights[idx] }}
        title={view === 'day' ? undefined : 'Открыть день'}
        onClick={() => {
          setAnchor(day);
          setView('day');
        }}
      >
        <span className="tl-day-name">{WEEKDAYS[weekday]}</span>
        <span className="tl-day-num">{d}</span>
        {reminderCount > 0 && <span className="cal-day-reminder-badge">🔔 {reminderCount}</span>}
      </button>
    );
  };

  const renderTimelineRow = (day: string, idx: number) => {
    const { rows, lanes: laneCounts } = timeline!;
    const lanes = laneCounts[idx];
    const {
      dayFrom,
      dragChain,
      segments,
      reminderSegments,
      daySessions,
      glueSpots,
      ghosts,
      reminderGhosts,
    } = dayLayers(day);
    const isToday = day === today;
    const g = liveGesture;
    const [y, m, d] = day.split('-').map(Number);
    const weekend = new Date(y, m - 1, d).getDay() % 6 === 0;
    const lanesPx = lanesHeight(lanes);
    const minX = (ms: number) => minToPx(Math.max(0, Math.min(DAY_MIN, (ms - dayFrom) / MIN_MS)));
    // A carried block rides in the lane it will drop into.
    const ghostLanes = landingLanes(
      blockTasks,
      ghosts.map((ghost) => ghost.task),
      day,
      minBlockMin,
      lanes
    );
    // Each session's colours run along its rail, and its connectors take the
    // colour of the stretch they cross.
    const sessionColors = new Map(
      daySessions.map(({ chain }) => [
        chain.id,
        sequenceGradientColors(sequenceGradientForTasks(chain.tasks, chain.sessionId ?? chain.id)),
      ])
    );
    const breakShown = dayReminderCard?.day === day ? dayReminderCard.gapAnchor?.gap : null;
    const links = sessionLinks(chains, segments, day).filter((link) => {
      // Back to back in one lane there is nothing to draw between them.
      const run = minToPx(link.toMin) - minToPx(link.fromMin);
      return link.fromLane !== link.toLane || run >= 8;
    });

    return (
      <div
        key={day}
        className={['tl-row', isToday ? 'today' : '', weekend ? 'weekend' : '']
          .filter(Boolean)
          .join(' ')}
        data-day={day}
        style={{ top: rows.tops[idx], height: rows.heights[idx] }}
        // As in the columns: a mouse hovering the day opens its reminders and
        // its first break (a tap fires enter events too, and would leave the
        // cards standing over the editor it opens).
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') showTimelineDay(day, idx, e.currentTarget);
        }}
        onPointerLeave={() => hideDayReminders(day)}
        onPointerDown={(e) => {
          // Right-drag picks a stretch of hours to zoom into, whatever is under it.
          if (e.button === 2) {
            startZoomSelect(e);
            return;
          }
          if ((e.target as HTMLElement).closest('.cal-block, .tl-rail, .cal-glue, .cal-reminder')) return;
          startCreate(e, day);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropFromBacklog(e, day)}
      >
        {links.length > 0 && (
          <svg className="tl-links" width={DAY_MIN * pxPerMin} height={rows.heights[idx]} aria-hidden="true">
            <defs>
              {daySessions.map(({ chain, startMs, endMs }, i) => {
                const [from, to] = sessionColors.get(chain.id)!;
                return (
                  <linearGradient
                    key={chain.id}
                    id={`tl-link-${day}-${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={minX(startMs)}
                    x2={Math.max(minX(startMs) + 1, minX(endMs))}
                    y1={0}
                    y2={0}
                  >
                    <stop offset="0" stopColor={from} />
                    <stop offset="1" stopColor={to} />
                  </linearGradient>
                );
              })}
            </defs>
            {links.map((link) => {
              const i = daySessions.findIndex(({ chain }) => chain.id === link.chainId);
              if (i < 0) return null;
              const x1 = minToPx(link.fromMin);
              const y1 = laneMiddle(link.fromLane);
              const x2 = minToPx(link.toMin);
              const y2 = laneMiddle(link.toLane);
              const stroke = `url(#tl-link-${day}-${i})`;
              return (
                <g key={link.key} stroke={stroke}>
                  <path d={linkPath(x1, y1, x2, y2)} />
                  <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
                  <circle cx={x2} cy={y2} r={3} className="tl-link-end" />
                </g>
              );
            })}
          </svg>
        )}

        {daySessions.map(({ chain, startMs, endMs }) => {
          const left = minX(startMs);
          const width = Math.max(12, minX(endMs) - left);
          const [from, to] = sessionColors.get(chain.id)!;
          const locked = chain.tasks.some((task) => task.pinned);
          return (
            <div
              key={chain.id}
              className={[
                'tl-rail',
                chain.sessionId ? 'session' : '',
                chain.name ? 'named' : '',
                locked ? 'locked' : '',
                dragChain?.chain.id === chain.id ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left,
                width,
                '--sequence-accent': from,
                '--sequence-across': `linear-gradient(90deg, ${from}, ${to})`,
              } as React.CSSProperties}
              title={chainHint(chain)}
              onPointerDown={(e) => startChainDrag(e, chain)}
            >
              {chain.name && width > 56 && <span className="tl-rail-label">{chain.name}</span>}
            </div>
          );
        })}

        {segments.map((seg) =>
          renderBlock(seg, day, true, (lengthMin) => {
            const width = Math.max(TL_MIN_BLOCK_PX, lenToPx(lengthMin));
            const detail = blockDetail(width);
            return {
              style: {
                left: minToPx(seg.topMin),
                width,
                top: laneTop(seg.col),
                height: TL_LANE_PX,
              },
              showMeta: detail === 'full',
              compact: detail === 'compact',
            };
          })
        )}

        {ghosts.map((ghost) => {
          const width = Math.max(TL_MIN_BLOCK_PX, lenToPx(ghost.lengthMin));
          const detail = blockDetail(width);
          return renderGhost(
            ghost,
            true,
            {
              left: minToPx(ghost.topMin),
              width,
              top: laneTop(ghostLanes.get(ghost.task.id) ?? 0),
              height: TL_LANE_PX,
            },
            { showMeta: detail === 'full', compact: detail === 'compact' }
          );
        })}

        {g?.kind === 'create' && g.day === day && (
          <div
            className="cal-block cal-block--across draft"
            style={{
              left: minToPx(g.startMin),
              width: Math.max(TL_MIN_BLOCK_PX, lenToPx(g.endMin - g.startMin)),
              top: laneTop(0),
              height: lanesPx,
            }}
          >
            <div className="cal-block-meta">
              <span>
                {hhmm(g.startMin)}–{hhmm(g.endMin)}
              </span>
              <strong className="cal-block-duration">{dur((g.endMin - g.startMin) * 60)}</strong>
            </div>
          </div>
        )}

        {gapSlot && gapSlot.day === day && !liveGesture && (
          <button
            type="button"
            className="cal-block cal-gap-slot"
            style={{
              left: minX(gapSlot.startMs),
              width: Math.max(16, lenToPx((gapSlot.endMs - gapSlot.startMs) / MIN_MS)),
              top: laneTop(0),
              height: lanesPx,
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
            style={{ left: minX(spot.atMs), top: TL_RAIL_PX / 2 }}
            title={
              spot.gapMs === 0
                ? 'Блоки идут подряд, но не связаны — склеить в одну сессию'
                : `Между блоками ${dur(spot.gapMs / 1000)} — склеить в одну сессию`
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => glueChains(spot.before, spot.after)}
          >
            🔗 {spot.gapMs === 0 ? 'подряд' : dur(spot.gapMs / 1000)}
          </button>
        ))}

        {/* Reminders: thin rails along the bottom of the row, stacked when
            they overlap. Hovered, each shows its own card. */}
        {reminderSegments.map((seg) => {
          const task = seg.task;
          const lengthMin = seg.bottomMin - seg.topMin;
          const expired = taskEndMs(task) <= now;
          return (
            <div
              key={task.id}
              data-reminder-id={task.id}
              className={`cal-reminder tl-reminder ${taskColorAnimationClass(task.colorAnimation)}${
                expired ? ' expired' : ''
              }${selectedIds.has(task.id) ? ' selected' : ''}`}
              style={{
                left: minToPx(seg.topMin),
                width: Math.max(TL_MIN_BLOCK_PX / 2, lenToPx(lengthMin)),
                bottom: 4 + seg.col * TL_REMINDER_PX,
                ...taskColorStyle(task.color, task.colorAnimation),
              } as React.CSSProperties}
              aria-label={`🔔 ${task.name || 'Напоминание'} · ${hhmm(seg.topMin)}–${hhmm(
                seg.topMin + lengthMin
              )}${expired ? ' · окно закрыто' : ''}`}
              onPointerDown={(e) => startMove(e, task)}
              // In the 3-day and week views the day's own cards already
              // describe every rail; a single day has none, so the rail
              // brings its own.
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse' && view === 'day') {
                  setHoverCard({ task, rect: e.currentTarget.getBoundingClientRect() });
                }
              }}
              onPointerLeave={() => setHoverCard((c) => (c?.task.id === task.id ? null : c))}
            />
          );
        })}

        {reminderGhosts.map((ghost) => (
          <div
            key={ghost.key}
            className={`${ghost.live ? 'cal-reminder live' : 'cal-reminder dragging'} tl-reminder ${taskColorAnimationClass(ghost.task.colorAnimation)}`}
            style={{
              left: minToPx(ghost.topMin),
              width: Math.max(TL_MIN_BLOCK_PX / 2, lenToPx(ghost.lengthMin)),
              bottom: 4,
              ...taskColorStyle(ghost.task.color, ghost.task.colorAnimation),
            } as React.CSSProperties}
          />
        ))}

        {/* While its card is open, the first break is marked out in the row
            itself, so the card's connector points at a stretch, not a dot. */}
        {breakShown && (
          <div
            className="tl-break-band"
            style={{
              left: minX(breakShown.currentEndMs),
              width: Math.max(2, minX(breakShown.nextStartMs) - minX(breakShown.currentEndMs)),
              top: laneTop(0),
              height: lanesPx,
            }}
          />
        )}

        {isToday && renderTimelineNow()}
      </div>
    );
  };

  // Today's now line, standing across the row, and the lead band laid along
  // it: green ahead of now, red behind.
  const renderTimelineNow = () => {
    const leadMin = credit.lead / 60;
    const bandStart = leadMin >= 0 ? nowMin : nowMin + leadMin;
    const bandLength = Math.abs(leadMin);
    return (
      <>
        {bandLength >= 1 && (
          <div
            className={`cal-lead-band cal-lead-band--across ${leadMin >= 0 ? 'ahead' : 'behind'}`}
            style={{ left: minToPx(bandStart), width: lenToPx(bandLength) }}
            title={`Обгон ${signedDur(credit.lead)}`}
          />
        )}
        <div className="tl-now" style={{ left: minToPx(nowMin) }}>
          <span className="cal-now-dot" />
        </div>
      </>
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

  // The card itself, wherever it is placed: a hovered block's own, or one of
  // the peeks a timeline row opens for the blocks too short to show it.
  const taskHoverCard = (
    task: Task,
    style: React.CSSProperties,
    ref: React.Ref<HTMLDivElement>,
    key?: string
  ) => {
    const taskChain = chainOfTask(chains, task.id);
    const focusSequence = taskChain && isSession(taskChain) ? taskChain : null;
    const sequenceDuration = focusSequence
      ? dur((focusSequence.endMs - focusSequence.startMs) / 1000)
      : null;
    return (
      <div
        key={key}
        ref={ref}
        className="cal-hover-card"
        style={{ ...style, '--task-color': task.color } as React.CSSProperties}
        aria-hidden="true"
      >
        {focusSequence && sequenceDuration && (
          <div className="cal-hover-card-focus">
            <div className="cal-hover-card-focus-title">
              DEEP FOCUS FOR <span>{sequenceDuration}</span>
            </div>
            <div className="cal-hover-card-motivation">
              {focusMotivation(focusSequence.id)}
            </div>
          </div>
        )}
        <div className="cal-hover-card-head">
          <span className="cal-hover-card-emoji">{task.emoji}</span>
          <span className="cal-hover-card-name">{task.name || 'Без названия'}</span>
        </div>
        <div className="cal-hover-card-time">
          {hhmm(task.start ?? 0)}–{wallTime(taskEndMs(task))}
        </div>
        {task.description && (
          <div className="cal-hover-card-desc">{task.description}</div>
        )}
      </div>
    );
  };

  const renderHoverCard = () => {
    if (!hoverCard) return null;
    const { task, rect } = hoverCard;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsRight = rect.right + HOVER_CARD_GAP + HOVER_CARD_WIDTH <= vw - 8;
    // A timeline block is wide and short: its card opens under it (or over
    // it, low on the screen) rather than beside it.
    const { left, top, origin } = horizontal
      ? hoverCardUnder(rect, { width: HOVER_CARD_WIDTH, height: hoverCardHeight }, { width: vw, height: vh })
      : {
          left: fitsRight
            ? rect.right + HOVER_CARD_GAP
            : Math.max(8, rect.left - HOVER_CARD_GAP - HOVER_CARD_WIDTH),
          // Clamped against the card's own (measured) height so a long name or
          // description never pushes it past the bottom of the screen.
          top: Math.min(Math.max(8, rect.top), Math.max(8, vh - 8 - hoverCardHeight)),
          origin: fitsRight ? 'left top' : 'right top',
        };
    return taskHoverCard(
      task,
      { left, top, width: HOVER_CARD_WIDTH, maxHeight: vh - 16, transformOrigin: origin },
      hoverCardRef
    );
  };

  const DAY_REMINDER_CARD_WIDTH = 288;
  const DAY_REMINDER_CARD_MIN_WIDTH = 180;
  const DAY_REMINDER_CARD_GAP = 18;
  const DAY_REMINDER_STACK_GAP = 8;

  // What one of a day's detail cards says, and in which colour — the same
  // whether it opens beside a column or under a timeline row.
  const dayDetailCard = (item: DayDetailItem, label: string) => {
    if (item.kind === 'gap') {
      const currentNames = item.gap.currentTasks.map((task) => task.name).join(', ');
      const nextNames = item.gap.nextTasks.map((task) => task.name).join(', ');
      return {
        className: 'cal-gap-detail-card',
        color: 'var(--accent-gold)',
        body: (
          <>
            <div className="cal-reminder-detail-main">
              <span className="cal-reminder-detail-emoji">⏳</span>
              <span className="cal-reminder-detail-name">
                Первый перерыв · {dur(item.gap.gapMs / 1000)}
              </span>
            </div>
            <div className="cal-reminder-detail-time">
              {label} · {wallTime(item.gap.currentEndMs)}–{wallTime(item.gap.nextStartMs)}
            </div>
            <p className="cal-reminder-detail-desc">
              После {currentNames || 'текущей серии'} · дальше {nextNames || 'следующая задача'}
            </p>
          </>
        ),
      };
    }
    const seg = item.segment;
    const task = seg.task;
    const expired = taskEndMs(task) <= now;
    const start = seg.startsHere ? hhmm(seg.topMin) : '↳ 00:00';
    const end = seg.endsHere
      ? seg.bottomMin >= DAY_MIN
        ? '24:00'
        : hhmm(seg.bottomMin)
      : '24:00 ↪';
    return {
      className: expired ? 'expired' : '',
      color: task.color,
      body: (
        <>
          <div className="cal-reminder-detail-main">
            <span className="cal-reminder-detail-emoji">{task.emoji || '🔔'}</span>
            <span className="cal-reminder-detail-name">{task.name || 'Напоминание'}</span>
          </div>
          <div className="cal-reminder-detail-time">
            🔔 {label} · {start}–{end}
            {expired && <span> · окно закрыто</span>}
          </div>
          <p className={`cal-reminder-detail-desc${task.description ? '' : ' empty'}`}>
            {task.description || 'Без описания'}
          </p>
        </>
      ),
    };
  };

  const renderDayReminderCard = () => {
    // The task-specific card has priority while a regular block is hovered;
    // the reminder cards return as soon as it is left.
    if (!dayReminderCard || hoverCard) return null;
    const { day, rect, anchors, gapAnchor, peeks, lanesBottom } = dayReminderCard;
    const segmentsByTask = new Map(
      daySegments(reminderTasks, day).map((segment) => [segment.task.id, segment])
    );
    const reminderItems = anchors.flatMap((anchor): DayDetailItem[] => {
      const segment = segmentsByTask.get(anchor.taskId);
      return segment ? [{ kind: 'reminder', ...anchor, segment }] : [];
    });
    const items: DayDetailItem[] = [
      ...reminderItems,
      ...(gapAnchor ? [{ kind: 'gap' as const, ...gapAnchor }] : []),
    ];
    if (items.length === 0 && peeks.length === 0) return null;

    const [y, m, d] = day.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
    if (horizontal) return renderTimelineDayCards(items, rect, label, peeks, lanesBottom);
    if (items.length === 0) return null;
    items.sort((a, b) => a.rect.top - b.rect.top);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(DAY_REMINDER_CARD_WIDTH, vw - 16);
    const rightSpace = vw - rect.right;
    const leftSpace = rect.left;
    const onRight =
      rightSpace >= width + DAY_REMINDER_CARD_GAP || rightSpace >= leftSpace;
    const left = onRight
      ? Math.min(vw - 8 - width, rect.right + DAY_REMINDER_CARD_GAP)
      : Math.max(8, rect.left - DAY_REMINDER_CARD_GAP - width);
    const scrollerRect = scrollerRef.current?.getBoundingClientRect();
    const anchorTop = Math.max(8, scrollerRect?.top ?? 8);
    const anchorBottom = Math.min(vh - 8, scrollerRect?.bottom ?? vh - 8);
    const heights = items.map((item) => {
      if (item.kind === 'gap') return reminderDetailHeights[item.key] ?? 88;
      const descriptionLines = Math.ceil((item.segment.task.description?.length ?? 0) / 42);
      return reminderDetailHeights[item.key] ?? 64 + Math.min(5, descriptionLines) * 16;
    });

    // Start each box across from its rail, then push colliding boxes apart.
    // A backwards pass keeps the whole stack inside the viewport without
    // breaking the connector between a reminder and its own card.
    const tops: number[] = [];
    items.forEach((item, index) => {
      const anchorY = Math.min(
        anchorBottom,
        Math.max(anchorTop, (item.rect.top + item.rect.bottom) / 2)
      );
      const desiredTop = Math.min(
        vh - 8 - heights[index],
        Math.max(8, anchorY - heights[index] / 2)
      );
      tops[index] =
        index === 0
          ? desiredTop
          : Math.max(desiredTop, tops[index - 1] + heights[index - 1] + DAY_REMINDER_STACK_GAP);
    });
    const lastIndex = tops.length - 1;
    if (tops[lastIndex] + heights[lastIndex] > vh - 8) {
      tops[lastIndex] = vh - 8 - heights[lastIndex];
      for (let index = lastIndex - 1; index >= 0; index -= 1) {
        tops[index] = Math.min(
          tops[index],
          tops[index + 1] - DAY_REMINDER_STACK_GAP - heights[index]
        );
      }
    }
    if (tops[0] < 8) {
      const shift = 8 - tops[0];
      for (let index = 0; index < tops.length; index += 1) tops[index] += shift;
    }

    return (
      <>
        <svg
          className="cal-reminder-connectors"
          width={vw}
          height={vh}
          viewBox={`0 0 ${vw} ${vh}`}
          aria-hidden="true"
        >
          {items.map((item, index) => {
            const color = item.kind === 'gap' ? 'var(--accent-gold)' : item.segment.task.color;
            const startX = onRight ? item.rect.right : item.rect.left;
            const startY = Math.min(
              anchorBottom,
              Math.max(anchorTop, (item.rect.top + item.rect.bottom) / 2)
            );
            const endX = onRight ? left : left + width;
            const endY = tops[index] + heights[index] / 2;
            const direction = onRight ? 1 : -1;
            const bend = Math.max(16, Math.abs(endX - startX) * 0.42);
            return (
              <g key={item.key} style={{ color }}>
                <path
                  d={`M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`}
                />
                <circle cx={startX} cy={startY} r="3" />
              </g>
            );
          })}
        </svg>

        {items.map((item, index) => {
          const card = dayDetailCard(item, label);
          return (
            <article
              key={item.key}
              ref={(element) => {
                if (element) reminderDetailRefs.current.set(item.key, element);
                else reminderDetailRefs.current.delete(item.key);
              }}
              className={`cal-reminder-detail-card ${card.className} ${onRight ? 'right' : 'left'}`}
              style={{
                left,
                top: tops[index],
                width,
                transformOrigin: onRight ? 'left center' : 'right center',
                '--task-color': card.color,
              } as React.CSSProperties}
              aria-hidden="true"
            >
              {card.body}
            </article>
          );
        })}
      </>
    );
  };

  // The same cards for a timeline row, plus its peeks: the hover card of each
  // block too short to show its own name, the very card it opens itself. They
  // stand in one line under the row's lanes (over the row, low on the
  // screen), each as near under its block as the others let it and tied to
  // it by a guide. The reminder and break cards line up under the row and
  // its peeks, or over both, each dropping a connector from what it
  // describes. Those hang from one shared edge, so their heights never
  // matter; the peeks' heights are measured like the column cards' are.
  const renderTimelineDayCards = (
    items: DayDetailItem[],
    row: Box,
    label: string,
    peeks: { taskId: string; rect: Box }[],
    lanesBottom: number
  ) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // As many as fit across the screen at the card's own width, from the
    // left (one at least, narrowed on a very narrow screen).
    const peekRoom = { left: row.left, right: vw - 8 };
    const peekCards = peeks
      .flatMap(({ taskId, rect }) => {
        const task = tasks.find((t) => t.id === taskId);
        return task ? [{ key: `peek:${task.id}`, task, rect }] : [];
      })
      .slice(
        0,
        Math.max(
          1,
          cardsThatFit(peekRoom.right - peekRoom.left, HOVER_CARD_WIDTH, DAY_REMINDER_STACK_GAP)
        )
      );
    // Each left under its block's, as the block's own card opens.
    const peekLine = spreadCards(
      peekCards.map(({ rect }) => rect.left + HOVER_CARD_WIDTH / 2),
      peekRoom,
      HOVER_CARD_WIDTH,
      Math.min(DAY_REMINDER_CARD_MIN_WIDTH, vw - 16),
      DAY_REMINDER_STACK_GAP
    );
    const peekHeight = peekCards.reduce(
      (most, { key }) => Math.max(most, reminderDetailHeights[key] ?? 64),
      0
    );
    const band =
      peekCards.length > 0 ? peekBand(row, lanesBottom, peekHeight, vh) : null;

    const centreX = (box: Box) =>
      Math.min(row.right, Math.max(row.left, (box.left + box.right) / 2));
    const centreY = (box: Box) =>
      Math.min(row.bottom, Math.max(row.top, (box.top + box.bottom) / 2));
    const sorted = [...items].sort((a, b) => centreX(a.rect) - centreX(b.rect));
    const over = band?.over ?? row.top;
    const under = band?.under ?? row.bottom;
    const below = cardsBelow(over, under, vh, DAY_REMINDER_CARD_GAP);
    const edgeY = below ? under + DAY_REMINDER_CARD_GAP : over - DAY_REMINDER_CARD_GAP;
    const { width, lefts } = spreadCards(
      sorted.map((item) => centreX(item.rect)),
      { left: 8, right: vw - 8 },
      DAY_REMINDER_CARD_WIDTH,
      Math.min(DAY_REMINDER_CARD_MIN_WIDTH, vw - 16),
      DAY_REMINDER_STACK_GAP
    );
    const maxHeight = Math.max(80, below ? vh - 8 - edgeY : edgeY - 8);

    return (
      <>
        {band && (
          // Each guide leaves its block as near its peek's left as the block
          // allows, and runs into the peek's near edge.
          <svg
            className="tl-peek-guides"
            width={vw}
            height={vh}
            viewBox={`0 0 ${vw} ${vh}`}
            aria-hidden="true"
          >
            {peekCards.map(({ key, task, rect }, index) => {
              const left = peekLine.lefts[index];
              const x1 = Math.min(rect.right - 3, Math.max(Math.max(rect.left, row.left) + 3, left + 16));
              const x2 = Math.min(left + peekLine.width - 16, Math.max(left + 16, x1));
              const y1 = band.below ? rect.bottom : rect.top;
              return (
                <g key={key} style={{ color: task.color }}>
                  <path d={dropPath(x1, y1, x2, band.edge)} />
                  <circle cx={x1} cy={y1} r="2.5" />
                </g>
              );
            })}
          </svg>
        )}

        {band &&
          peekCards.map(({ key, task }, index) =>
            taskHoverCard(
              task,
              {
                left: peekLine.lefts[index],
                // Hung from the edge nearest the row, whatever its height.
                top: band.below ? band.edge : undefined,
                bottom: band.below ? undefined : vh - band.edge,
                width: peekLine.width,
                maxHeight: vh - 16,
                transformOrigin: band.below ? 'left top' : 'left bottom',
              },
              (element) => {
                if (element) reminderDetailRefs.current.set(key, element);
                else reminderDetailRefs.current.delete(key);
              },
              key
            )
          )}

        {sorted.length > 0 && (
          <svg
            className="cal-reminder-connectors"
            width={vw}
            height={vh}
            viewBox={`0 0 ${vw} ${vh}`}
            aria-hidden="true"
          >
            {sorted.map((item, index) => {
              const color = item.kind === 'gap' ? 'var(--accent-gold)' : item.segment.task.color;
              const x1 = centreX(item.rect);
              const y1 = centreY(item.rect);
              // Into the card as straight as its place in the line allows.
              const x2 = Math.min(lefts[index] + width - 16, Math.max(lefts[index] + 16, x1));
              return (
                <g key={item.key} style={{ color }}>
                  <path d={dropPath(x1, y1, x2, edgeY)} />
                  <circle cx={x1} cy={y1} r="3" />
                </g>
              );
            })}
          </svg>
        )}

        {sorted.map((item, index) => {
          const card = dayDetailCard(item, label);
          return (
            <article
              key={item.key}
              className={`cal-reminder-detail-card ${card.className} ${below ? 'below' : 'above'}`}
              style={{
                left: lefts[index],
                // Hung from the edge nearest the row, whatever its height.
                top: below ? edgeY : undefined,
                bottom: below ? undefined : vh - edgeY,
                width,
                maxHeight,
                transformOrigin: below ? 'center top' : 'center bottom',
                '--task-color': card.color,
              } as React.CSSProperties}
              aria-hidden="true"
            >
              {card.body}
            </article>
          );
        })}
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
            // Reminders are a service overlay, not a planning item — the month
            // view's compact chip list is for real tasks only.
            const sorted = dayTasks
              .filter((t) => !isReminder(t))
              .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
            const endOfDay = dayStartMs(day) + DAY_MIN * MIN_MS;
            const dayCredit = computeCredit(creditGroups(dayTasks), endOfDay);
            // An expired reminder is completed too, and a break can be closed,
            // but neither is work — the overtake never saw them.
            const closed = sorted.some((t) => isDone(t) && t.type !== 'rest');
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
                      className={`cal-chip ${taskColorAnimationClass(task.colorAnimation)}${isDone(task) ? ' done' : ''}`}
                      style={taskColorStyle(task.color, task.colorAnimation) as React.CSSProperties}
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

  // What the batch menu can offer — the other half of the approval, next to
  // the 🔗 handle: any batch of blocks can be declared a session, whether or
  // not they touch. The only batch with nothing to do is one that already *is*
  // a whole explicit session. A batch that is part of a bigger sequence is cut
  // out of it instead of merely joined.
  const selectionWholeChain =
    selectionChain !== null && selectedTasks.length === selectionChain.tasks.length;
  const canSplit =
    selectedTasks.length >= 2 &&
    !(selectionWholeChain && selectionChain !== null && selectionChain.sessionId !== null);
  const splitLabel =
    selectionChain !== null && !selectionWholeChain
      ? '✂ Вынести в отдельную секвенцию'
      : '🔗 Собрать в отдельную сессию';
  const selectionSpan =
    selectedTasks.length > 0
      ? `${wallTime(taskStartMs(selectedTasks[0]))}–${wallTime(
          Math.max(...selectedTasks.map(taskEndMs))
        )}`
      : '';
  const selectionSec = selectedTasks.reduce((sum, t) => sum + t.plannedTime, 0);
  const splitHint =
    selectedTasks.length < 2 ? 'Выдели хотя бы два блока' : 'Эти блоки уже отдельная сессия';

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
        <div
          className="cal-seg cal-seg--layout"
          role="group"
          aria-label="Как идёт сетка"
          title={view === 'month' ? 'В месяце сетка одна — раскладка для дня, 3 дней и недели' : undefined}
        >
          {(
            [
              ['vertical', 'Колонки: часы сверху вниз', <IconLayoutColumns key="v" size={16} />],
              ['horizontal', 'Лента: часы слева направо', <IconLayoutRows key="h" size={16} />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              className={layout === value ? 'active' : ''}
              aria-pressed={layout === value}
              aria-label={label}
              title={view === 'month' ? undefined : label}
              disabled={view === 'month'}
              onClick={() => {
                if (layout !== value) chooseLayout(value);
              }}
            >
              {icon}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="cal-btn cal-backlog-toggle"
          aria-pressed={backlogVisible}
          aria-label={backlogVisible ? 'Скрыть бэклог' : 'Показать бэклог'}
          onClick={() => setBacklogVisible((visible) => !visible)}
        >
          🗂<span className="cal-backlog-toggle-label">
            {backlogVisible ? 'Скрыть бэклог' : 'Показать бэклог'}
          </span>
        </button>
      </div>

      <div className={`cal-hud ${leadClass}${credit.frozen ? ' frozen' : ''}`}>
        <div className="cal-hud-main">
          <span className="cal-hud-label">
            {credit.lead >= 0 ? 'Обгон' : 'Отставание'}
          </span>
          <span className="cal-hud-value">{signedDur(credit.lead)}</span>
        </div>
        <div className={`cal-hud-week ${weekOvertakeSec >= 0 ? 'ahead' : 'behind'}`}>
          <span className="cal-hud-label">За неделю</span>
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
        {/* Keyed apart, so flipping the layout mounts a fresh scroller
            instead of reusing the columns' header as the timeline's. */}
        {view === 'month' ? renderMonth() : horizontal ? (
          <div key="timeline" className="cal-sheet cal-sheet--timeline">{renderTimeline()}</div>
        ) : (
          <div key="columns" className="cal-sheet">
            <div className="cal-days-head" style={{ paddingLeft: GUTTER_PX }}>
              {visibleDays.map((day) => {
                const [y, m, d] = day.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                const reminderCount = daySegments(reminderTasks, day).length;
                return (
                  <button
                    key={day}
                    type="button"
                    className={`cal-day-head${day === today ? ' today' : ''}`}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') showDayReminders(day, e.currentTarget);
                    }}
                    onPointerLeave={() => hideDayReminders(day)}
                    onClick={() => {
                      setAnchor(day);
                      setView('day');
                    }}
                  >
                    <span className="cal-day-name">{WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                    <span className="cal-day-num">{d}</span>
                    {(view === '3day' || view === 'week') && reminderCount > 0 && (
                      <span className="cal-day-reminder-badge">🔔 {reminderCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {renderGrid()}
          </div>
        )}

        {backlogVisible && <aside
          className={`cal-backlog${gesture?.kind === 'move' && gesture.toBacklog ? ' drop-target' : ''}`}
          ref={backlogTab === 'tasks' ? backlogRef : null}
        >
          <header className="cal-backlog-head">
            <h3>🗂 Бэклог</h3>
            {backlogTab === 'tasks' && <button
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
              </button>}
          </header>
          <div className="cal-backlog-tabs" role="tablist" aria-label="Разделы бэклога">
            <button type="button" role="tab" aria-selected={backlogTab === 'tasks'} className={backlogTab === 'tasks' ? 'active' : ''} onClick={() => setBacklogTab('tasks')}>Задачи</button>
            <button type="button" role="tab" aria-selected={backlogTab === 'templates'} className={backlogTab === 'templates' ? 'active' : ''} onClick={() => setBacklogTab('templates')}>Шаблоны</button>
          </div>
          {backlogTab === 'tasks' ? <>
            <p className="cal-backlog-hint cal-backlog-hint--mouse">
              Перетащи карточку на сетку, чтобы поставить время. Перетащи блок с сетки сюда — вернуть в бэклог.
              Зажми ЛКМ на пустом месте сетки на секунду и веди — выделишь пачку блоков.
              С Ctrl веди сразу, без ожидания — хоть с пустого места, хоть с блока.
              Рамка выделяет только задетые блоки внутри одного дня — параллельные можно выбрать по отдельности.
              Ctrl + клик по блоку — добавить его в пачку или убрать
            </p>
            <p className="cal-backlog-hint cal-backlog-hint--touch">
              Нажми на карточку и выбери «В календарь», чтобы поставить время. Удерживай блок на
              сетке, чтобы перетащить его — в том числе сюда, обратно в бэклог.
            </p>
            <div className="cal-backlog-list" role="tabpanel">
              {openTasks.map((task) => (
                <div
                  key={task.id}
                  className={`cal-backlog-card ${taskColorAnimationClass(task.colorAnimation)}${task.pinned ? ' pinned' : ''}`}
                  style={taskColorStyle(task.color, task.colorAnimation) as React.CSSProperties}
                  draggable={!task.pinned}
                  onDragStart={(e) => {
                    if (task.pinned) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData('text/plain', task.id);
                  }}
                  onClick={(e) => openDialog(task, false, e)}
                >
                  <span className="cal-chip-emoji">{task.emoji}</span>
                  <span className="cal-chip-name">{task.name}</span>
                  <span className="cal-chip-time">{dur(task.plannedTime)}</span>
                  {task.pinned && <span className="cal-backlog-pin" title="Закреплено">📌</span>}
                  <button
                    type="button"
                    className="cal-backlog-save-template"
                    title="Сохранить как шаблон"
                    aria-label={`Сохранить «${task.name}» как шаблон`}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); startTemplate(task); }}
                  >☆</button>
                </div>
              ))}
              {openTasks.length === 0 && <p className="cal-backlog-empty">Пусто</p>}
            </div>
          </> : <div className="cal-template-page" role="tabpanel">
            <p className="cal-backlog-hint">Шаблон хранит параметры задачи без даты и времени. Создай из него новую задачу в бэклоге, когда она понадобится.</p>
            <label className="cal-template-day">День для новой задачи
              <input type="date" value={templateDay} onChange={(e) => setTemplateDay(e.target.value)} />
            </label>
            {templateError && <p className="cal-template-error" role="alert">{templateError}</p>}
            {templates === null && !templateError && <p className="cal-backlog-empty">Загрузка…</p>}
            {templateDraft ? <form className="cal-template-form" onSubmit={(event) => void saveTemplate(event)}>
              <h4>{templateDraft.id ? 'Изменить шаблон' : 'Новый шаблон'}</h4>
              <label>Название<input autoFocus type="text" maxLength={120} required value={templateDraft.name} onChange={(e) => setTemplateDraft({ ...templateDraft, name: e.target.value })} placeholder="Например, Приём пищи" /></label>
              <label>Длительность, мин<input type="number" min="1" step="1" required value={templateDraft.minutes} onChange={(e) => setTemplateDraft({ ...templateDraft, minutes: e.target.value })} /></label>
              <label>Тип<select value={templateDraft.type} onChange={(e) => setTemplateDraft({ ...templateDraft, type: e.target.value as TaskType })}><option value="task">Задача</option><option value="rest">Отдых</option><option value="reminder">Напоминание</option></select></label>
              <div className="cal-template-form-row">
                <label>Иконка<input type="text" maxLength={8} value={templateDraft.emoji} onChange={(e) => setTemplateDraft({ ...templateDraft, emoji: e.target.value })} /></label>
                <label>Цвет<input type="color" value={templateDraft.color} onChange={(e) => setTemplateDraft({ ...templateDraft, color: e.target.value })} /></label>
              </div>
              <div className="cal-template-actions">
                <button type="submit" className="cal-btn cal-btn--primary" disabled={templateBusy}>Сохранить</button>
                <button type="button" className="cal-btn" disabled={templateBusy} onClick={() => setTemplateDraft(null)}>Отмена</button>
              </div>
            </form> : <button type="button" className="cal-btn cal-template-add" disabled={templateBusy} onClick={() => startTemplate()}>＋ Новый шаблон</button>}
            <div className="cal-template-list">
              {(templates ?? []).map((template) => (
                <article className="cal-template-card" key={template.id} style={{ borderLeftColor: template.color }}>
                  <div className="cal-template-summary">
                    <span className="cal-template-emoji">{template.emoji}</span>
                    <div><strong>{template.name}</strong><small>{dur(template.plannedTime)} · {template.type === 'rest' ? 'Отдых' : template.type === 'reminder' ? 'Напоминание' : 'Задача'}</small></div>
                  </div>
                  <div className="cal-template-actions">
                    <button type="button" className="cal-btn cal-btn--primary" disabled={!templateDay} onClick={() => { store.upsertTask(taskFromTemplate(template, templateDay)); setBacklogTab('tasks'); }}>＋ В бэклог</button>
                    <button type="button" className="cal-btn cal-btn--icon" title="Изменить шаблон" disabled={templateBusy} onClick={() => editTemplate(template)}>✎</button>
                    <button type="button" className="cal-btn cal-btn--icon cal-btn--danger" title="Удалить шаблон" disabled={templateBusy} onClick={() => void deleteTemplate(template.id)}>✕</button>
                  </div>
                </article>
              ))}
              {templates?.length === 0 && <p className="cal-backlog-empty">Пока нет шаблонов</p>}
            </div>
          </div>}
        </aside>}
      </div>

      {renderHoverCard()}
      {renderDayReminderCard()}

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
          onGradientChange={(gradient) => setChainGradient(popChain, gradient)}
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
      {gesture?.kind === 'create' && !gesture.moved && !gesture.touch && (
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
                    ? 'Выделенные блоки станут одной сессией — остальные останутся сами по себе'
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
