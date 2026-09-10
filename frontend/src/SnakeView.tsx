import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Task, SessionState } from './types';
import { TASK_COLORS } from './types';
import { formatDelta } from './useTimer';

interface SnakeViewProps {
  tasks: Task[];
  cumulativeTimes: number[];
  totalPlannedSec: number;
  elapsedSec: number;
  sessionState: SessionState;
  currentTaskColor: string;
  deltaMs: number | null;
  onCompleteTask: (id: string) => void;
  onUncompleteTask: (id: string) => void;
  onRenameTask: (id: string, name: string) => void;
  onChangeTaskTime: (id: string, plannedTime: number) => void;
  onChangeTaskColor: (id: string, color: string) => void;
  onSeek: (ms: number) => void;
}

// Square board drawn in a fixed viewBox — the whole route and every meal are
// always visible (no zoom), so the snake just crawls from meal to meal.
const VIEW = 800;
const HALF = VIEW / 2;
const PAD = 26;

// FNV-1a — tiny string hash, used to steer each leg's turn direction so the
// route looks organic while staying identical for a given task list.
const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

interface Cell {
  x: number; // grid col
  y: number; // grid row
}

// One point of the route with its exact arrival time, in screen coords.
interface Param {
  x: number;
  y: number;
  t: number; // seconds — the head is exactly here at this time
  leg: number; // which leg this point belongs to (0..n-1 = task legs, n = finish)
}

interface SnakeLayout {
  side: number;
  cell: number;
  start: Cell;
  finish: Cell;
  taskCells: Cell[];
  params: Param[];
}

export function SnakeView({
  tasks,
  cumulativeTimes,
  totalPlannedSec,
  elapsedSec,
  sessionState,
  currentTaskColor,
  deltaMs,
  onCompleteTask,
  onUncompleteTask,
  onRenameTask,
  onChangeTaskTime,
  onChangeTaskColor,
  onSeek,
}: SnakeViewProps) {
  const totalSec = Math.max(totalPlannedSec, 1);

  // Edit popup (same fields the spiral view / timeline edit inline).
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTime, setEditTime] = useState('');

  // ── Board layout + route: deterministic per task id, so the geometry is
  // stable for the whole run — only the head position and body length move.
  const layout = useMemo<SnakeLayout | null>(() => {
    const n = tasks.length;
    if (n === 0) return null;
    const side = Math.max(5, Math.min(14, Math.ceil(Math.sqrt(n + 2) * 1.8)));
    const inner = VIEW - PAD * 2;
    const cell = inner / side;

    // Tasks are laid out in a boustrophedon ("snake") sweep over the grid:
    // row 0 goes left → right, row 1 right → left, and so on. Index 0 is the
    // start cell, the next n cells are the meals in task order, and the cell
    // after them is the finish — so board position == task order. The board
    // is fully deterministic (it must not jitter between renders) and the
    // user can predict exactly where every meal is.
    const zigIndex = (k: number): Cell => {
      const row = Math.floor(k / side);
      const col = row % 2 === 0 ? k % side : side - 1 - (k % side);
      return { x: col, y: row };
    };
    const start = zigIndex(0);
    const finish = zigIndex(n + 1);
    const taskCells = tasks.map((_, i) => zigIndex(i + 1));

    const toPx = (c: Cell) => ({
      x: -HALF + PAD + (c.x + 0.5) * cell,
      y: -HALF + PAD + (c.y + 0.5) * cell,
    });

    // A leg = the Manhattan (L-shape) walk from one meal to the next. The
    // head ARRIVES at task i's cell exactly at cumulativeTimes[i] — the
    // moment that task is eaten — and crawls the whole leg to the next meal
    // during the current task's planned duration. Same time→space mapping as
    // the spiral's star sweeping from planet to planet.
    const params: Param[] = [];
    const pushLeg = (from: Cell, to: Cell, fromT: number, toT: number, leg: number) => {
      const steps = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (steps === 0) {
        params.push({ ...toPx(to), t: toT, leg });
        return;
      }
      // horizontal-first or vertical-first turn, seeded per leg — keeps the
      // route from always turning the same corner.
      const verticalFirst = (hashStr(`leg-v-${leg}`) & 1) === 1;
      const mid: Cell = verticalFirst ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
      const uniq: Cell[] = [];
      for (const p of [from, mid, to]) {
        const last = uniq[uniq.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
      }
      // Expand the two segments into unit cell steps so the head moves
      // cell-by-cell with a uniform speed along the whole leg.
      const pts: Cell[] = [];
      for (let k = 0; k < uniq.length - 1; k++) {
        const a = uniq[k];
        const b = uniq[k + 1];
        const dx = Math.sign(b.x - a.x);
        const dy = Math.sign(b.y - a.y);
        let cx = a.x;
        let cy = a.y;
        while (cx !== b.x || cy !== b.y) {
          pts.push({ x: cx, y: cy });
          if (cx !== b.x) cx += dx;
          else cy += dy;
        }
      }
      pts.push(uniq[uniq.length - 1]);
      const stepT = (toT - fromT) / Math.max(1, pts.length - 1);
      pts.forEach((p, k) => {
        const px = toPx(p);
        params.push({ x: px.x, y: px.y, t: fromT + stepT * k, leg });
      });
    };

    let prevCell = start;
    let prevT = 0;
    for (let i = 0; i < n; i++) {
      const endT = cumulativeTimes[i] ?? 0;
      pushLeg(prevCell, taskCells[i], prevT, endT, i);
      prevCell = taskCells[i];
      prevT = endT;
    }
    // After the last meal the snake crawls to the finish flag during the
    // last task's duration.
    pushLeg(prevCell, finish, prevT, totalSec, n);

    return { side, cell, start, finish, taskCells, params };
  }, [tasks, cumulativeTimes, totalSec]);

  const headT = Math.max(0, Math.min(elapsedSec, totalSec));

  // Faint full-route baseline behind the colored body — guard inside so the
  // hook never depends on the layout's existence.
  const routeBase = useMemo(() => {
    if (!layout) return '';
    const p = layout.params;
    const d: string[] = [];
    let i = 0;
    while (i < p.length - 1) {
      const leg = p[i].leg;
      d.push(`M ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)}`);
      while (i + 1 < p.length && p[i + 1].leg === leg) {
        i++;
        d.push(`L ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)}`);
      }
      i++;
    }
    return d.join(' ');
  }, [layout]);

  // Head: exact position + heading at the current time (last param with
  // t <= headT, lerped into the next one). Zero-duration connectors (the
  // anchored pre-first-meal segment and leg joints) collapse to the joint.
  const head = useMemo(() => {
    if (!layout || layout.params.length === 0) return null;
    const p = layout.params;
    let i = 0;
    for (; i < p.length - 1; i++) {
      if (headT <= p[i + 1].t) break;
    }
    const a = p[i];
    const b = p[Math.min(i + 1, p.length - 1)];
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1, (headT - a.t) / span)) : 1;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return { x, y, angle, idx: i, f, leg: b.leg };
  }, [layout, headT]);

  // Body: per-leg colored strokes along the traveled part of the route.
  // Each leg inherits the color of the meal it leads to (the finish leg is
  // gold), so the snake's body shows exactly which meals are inside it.
  const body = useMemo(() => {
    if (!layout || !head) return [];
    const p = layout.params;
    const segs: { leg: number; d: string }[] = [];
    let i = 0;
    while (i < p.length - 1 && p[i].t <= headT) {
      const leg = p[i].leg;
      const d: string[] = [`M ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)}`];
      let j = i;
      let cut = false;
      // Extend over consecutive params of the same leg. The head may cut the
      // segment between p[j] and p[j+1] — then the body ends exactly at the
      // head. Fully-passed legs advance the scan past their last param, so
      // zero-duration joints never send the loop back to the same index.
      while (j + 1 < p.length && p[j + 1].leg === leg) {
        if (headT < p[j + 1].t) {
          d.push(`L ${head.x.toFixed(1)} ${head.y.toFixed(1)}`);
          cut = true;
          break;
        }
        j++;
        d.push(`L ${p[j].x.toFixed(1)} ${p[j].y.toFixed(1)}`);
      }
      segs.push({ leg, d: d.join(' ') });
      if (cut) break; // head sits inside this leg — nothing further to draw
      i = j + 1; // whole leg is behind the head — continue from the next leg
    }
    return segs;
  }, [layout, head, headT]);

  const legColor = (leg: number) => {
    return leg < tasks.length ? tasks[leg].color : 'var(--accent-gold)';
  };

  // First meal the head has not yet reached (the "next target" of the snake).
  const nextMealIdx = useMemo(() => {
    for (let i = 0; i < tasks.length; i++) {
      if (headT < (cumulativeTimes[i] ?? 0)) return i;
    }
    return -1;
  }, [tasks, cumulativeTimes, headT]);

  // ── Edit popup helpers.
  const openEdit = (task: Task) => {
    setEditingTaskId(task.id);
    setEditName(task.name);
    const h = Math.floor(task.plannedTime / 3600);
    const m = Math.floor((task.plannedTime % 3600) / 60);
    const s = task.plannedTime % 60;
    setEditTime(
      h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    );
  };

  const commitEdit = () => {
    if (editingTaskId === null) return;
    const task = tasks.find((t) => t.id === editingTaskId);
    if (task) onRenameTask(editingTaskId, editName);
    const parts = editTime.split(':').map((p) => parseInt(p) || 0);
    let total: number;
    if (parts.length === 3) {
      total = Math.min(parts[0], 99) * 3600 + Math.min(parts[1], 59) * 60 + Math.min(parts[2], 59);
    } else if (parts.length === 2) {
      total = Math.min(parts[0], 99) * 60 + Math.min(parts[1], 59);
    } else {
      total = Math.max(1, Math.round(parseFloat(editTime) * 60));
    }
    if (total > 0) onChangeTaskTime(editingTaskId, total);
    setEditingTaskId(null);
  };

  const editingTask = editingTaskId !== null ? tasks.find((t) => t.id === editingTaskId) ?? null : null;

  // ── Scrubbing: drag along the route / grab the head, + wheel.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const suppressDragRef = useRef(false);
  const lastTRef = useRef(0);
  const TUBE_HIT_PX = 26;
  const HEAD_HIT_PX = 40;

  const viewBoxFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const content = Math.min(rect.width, rect.height);
    const offX = (rect.width - content) / 2;
    const offY = (rect.height - content) / 2;
    return {
      rawX: ((clientX - rect.left - offX) / content) * VIEW - HALF,
      rawY: ((clientY - rect.top - offY) / content) * VIEW - HALF,
      pxPerUnit: content / VIEW,
    };
  }, []);

  const nearHeadClient = useCallback(
    (clientX: number, clientY: number) => {
      const m = viewBoxFromClient(clientX, clientY);
      if (!m || !head) return false;
      return Math.hypot((m.rawX - head.x) * m.pxPerUnit, (m.rawY - head.y) * m.pxPerUnit) <= HEAD_HIT_PX;
    },
    [viewBoxFromClient, head]
  );

  // Snap a press/move point to the nearest route position → time.
  const timeFromPoint = useCallback(
    (clientX: number, clientY: number, prevT: number | null) => {
      const m = viewBoxFromClient(clientX, clientY);
      if (!m || !layout) return null;
      const p = layout.params;
      const rawX = m.rawX;
      const rawY = m.rawY;
      let bestT = prevT ?? 0;
      let bestD = Infinity;
      for (let i = 0; i < p.length; i++) {
        const isEnd = i === p.length - 1;
        const a = p[i];
        const b = isEnd ? p[i] : p[i + 1];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const L2 = vx * vx + vy * vy;
        const f = L2 > 0 ? Math.max(0, Math.min(1, ((rawX - a.x) * vx + (rawY - a.y) * vy) / L2)) : 0;
        const px = a.x + vx * f;
        const py = a.y + vy * f;
        const d = (px - rawX) * (px - rawX) + (py - rawY) * (py - rawY);
        if (d < bestD) {
          bestD = d;
          bestT = a.t + (b.t - a.t) * f;
        }
      }
      if (Math.sqrt(bestD) * m.pxPerUnit > TUBE_HIT_PX) return null;
      return Math.max(0, Math.min(bestT, totalSec));
    },
    [viewBoxFromClient, layout, totalSec]
  );

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (sessionState === 'idle' || sessionState === 'finished') return;
    // A meal or the pill claimed this press (click-to-complete/edit).
    if (suppressDragRef.current) {
      suppressDragRef.current = false;
      return;
    }
    if (head !== null && nearHeadClient(e.clientX, e.clientY)) {
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer may already be gone — dragging still works via move/up
      }
      lastTRef.current = headT;
      return;
    }
    const t = timeFromPoint(e.clientX, e.clientY, null);
    if (t === null) return; // press outside the snake — ignore
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer may already be gone
    }
    lastTRef.current = t;
    onSeek(t * 1000);
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const t = timeFromPoint(e.clientX, e.clientY, lastTRef.current);
    if (t !== null) {
      lastTRef.current = t;
      onSeek(t * 1000);
    }
  };

  const stopDrag = () => {
    draggingRef.current = false;
  };

  // Press on a meal: running → complete / undo; idle/paused → open the popup.
  // The press is claimed so it doesn't also start a scrub.
  const handleMealPointerDown = () => {
    suppressDragRef.current = true;
  };

  const handleMealClick = (t: Task) => {
    if (sessionState === 'idle' || sessionState === 'paused') {
      openEdit(t);
      return;
    }
    if (t.completedAt !== null) onUncompleteTask(t.id);
    else onCompleteTask(t.id);
  };

  // Safety net: never leave the drag state stuck.
  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

  // Wheel scrubbing — scroll away = forward in time, ±20 s per notch.
  const wheelStateRef = useRef({ headT, totalSec, sessionState, onSeek });
  useEffect(() => {
    wheelStateRef.current = { headT, totalSec, sessionState, onSeek };
  }, [headT, totalSec, sessionState, onSeek]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = wheelStateRef.current;
      if (st.sessionState === 'idle' || st.sessionState === 'finished') return;
      const delta = e.deltaY > 0 ? -20 : 20;
      const next = Math.max(0, Math.min(st.headT + delta, st.totalSec));
      st.onSeek(next * 1000);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ── Readouts near the head (mirror the spiral view) ──
  const elapsedText = fmtTime(headT);
  const deltaText = deltaMs !== null ? formatDelta(deltaMs) : '—';
  const nextTxt = nextMealIdx >= 0 ? `До следующей: ${fmtTime(Math.max(0, (cumulativeTimes[nextMealIdx] ?? 0) - headT))}` : '';
  const starLabelW = Math.max(elapsedText.length * 9, deltaText.length * 7.2, nextTxt.length * 7.2);

  // Complete / undo pill for the current meal, mirroring the timeline's ✓ / ↩.
  const curIdx = tasks.findIndex((t) => t.completedAt === null);
  const curTask = curIdx >= 0 ? tasks[curIdx] : tasks[tasks.length - 1] ?? null;
  const pillUndo = curTask !== null && curTask.completedAt !== null && (sessionState === 'running' || sessionState === 'paused');
  const pillComplete = curTask !== null && curTask.completedAt === null && sessionState === 'running';
  const pillVisible = pillUndo || pillComplete;
  const pillText = pillUndo ? '↩ Отменить?' : '✓ Выполнить?';
  const doneW = pillText.length * 7.2 + 16;
  const labelWAll = Math.max(starLabelW, doneW);

  let labelX = 26;
  let labelAnchor: 'start' | 'end' = 'start';
  if (head !== null && head.x + 26 + labelWAll > HALF - 8) {
    // Flip to the left of the head (local coords, like the spiral's labels).
    const minLocalX = -HALF + 8 + labelWAll - head.x;
    labelX = Math.max(minLocalX, -26);
    labelAnchor = 'end';
  }
  let labelDy = 0;
  if (head !== null) {
    if (head.y - 16 < -HALF + 8) labelDy = -HALF + 8 - head.y + 16;
    if (head.y + 66 > HALF - 8) labelDy = HALF - 8 - head.y - 66;
  }

  if (!layout) {
    return (
      <div className="snake-view">
        <div className="snake-empty">Добавьте задачи, чтобы змейка начала охоту 🐍</div>
      </div>
    );
  }

  const { start, finish } = layout;
  const startPx = { x: -HALF + PAD + (start.x + 0.5) * layout.cell, y: -HALF + PAD + (start.y + 0.5) * layout.cell };
  const finishPx = { x: -HALF + PAD + (finish.x + 0.5) * layout.cell, y: -HALF + PAD + (finish.y + 0.5) * layout.cell };

  return (
    <div className="snake-view">
      <svg
        ref={svgRef}
        className="snake-svg"
        viewBox={`${-HALF} ${-HALF} ${VIEW} ${VIEW}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        {/* Grid — the hunting ground */}
        <g className="snake-grid">
          {Array.from({ length: layout.side + 1 }, (_, i) => (
            <line key={`v${i}`} x1={-HALF + PAD + i * layout.cell} y1={-HALF + PAD} x2={-HALF + PAD + i * layout.cell} y2={HALF - PAD} />
          ))}
          {Array.from({ length: layout.side + 1 }, (_, i) => (
            <line key={`h${i}`} x1={-HALF + PAD} y1={-HALF + PAD + i * layout.cell} x2={HALF - PAD} y2={-HALF + PAD + i * layout.cell} />
          ))}
        </g>

        {/* Full route baseline — faint, so the colored body reads clearly */}
        {routeBase && <path className="snake-route-base" d={routeBase} fill="none" />}

        {/* Colored body — the traveled, digested trail */}
        {body.map((seg, i) => (
          <g key={i}>
            <path className="snake-body-outer" d={seg.d} fill="none" style={{ stroke: legColor(seg.leg) } as CSSProperties} />
            <path className="snake-body-core" d={seg.d} fill="none" style={{ stroke: legColor(seg.leg) } as CSSProperties} />
          </g>
        ))}

        {/* Start marker */}
        <g className="snake-start-marker" transform={`translate(${startPx.x} ${startPx.y})`}>
          <circle r={11} className="snake-start-ring" />
        </g>

        {/* Finish flag */}
        <g className="snake-finish-marker" transform={`translate(${finishPx.x} ${finishPx.y})`}>
          <circle r={14} className="snake-finish-ring" />
          <text y={5} textAnchor="middle" dominantBaseline="central" className="snake-finish-emoji">🏁</text>
        </g>

        {/* Meals — the tasks on the board */}
        {tasks.map((task, i) => {
          const c = layout.taskCells[i];
          const cx = -HALF + PAD + (c.x + 0.5) * layout.cell;
          const cy = -HALF + PAD + (c.y + 0.5) * layout.cell;
          const eatenAt = cumulativeTimes[i] ?? 0;
          const eaten = (sessionState !== 'idle' && headT >= eatenAt) || task.completedAt !== null;
          const isCurrent = i === curIdx;
          const recentD = headT - eatenAt;
          const recentEat = sessionState !== 'idle' && recentD >= 0 && recentD < 1.6;
          const ringR = 16 + recentD * 42;
          const ringO = recentEat ? Math.max(0, 0.75 - (recentD / 1.6) * 0.75) : 0;
          return (
            <g
              key={task.id}
              className={`snake-meal ${eaten ? 'eaten' : ''} ${isCurrent ? 'current' : ''}`}
              transform={`translate(${cx} ${cy})`}
              style={{ '--meal-color': task.color } as CSSProperties}
              onPointerDown={handleMealPointerDown}
              onClick={() => handleMealClick(task)}
            >
              <circle r={layout.cell * 0.36} className="snake-meal-disc" />
              {isCurrent && sessionState === 'running' && <circle r={layout.cell * 0.42} className="snake-meal-pulse" />}
              <text y={layout.cell >= 46 ? -layout.cell * 0.14 : 3} textAnchor="middle" dominantBaseline="central" className="snake-meal-emoji">
                {task.emoji}
              </text>
              {layout.cell >= 46 && (
                <text y={layout.cell * 0.36 + 8} textAnchor="middle" dominantBaseline="central" className="snake-meal-name">
                  {task.name}
                </text>
              )}
              {task.completedAt !== null && (
                <g className="snake-meal-check" transform={`translate(${layout.cell * 0.3} ${-layout.cell * 0.3})`}>
                  <circle r={8} />
                  <text y={0.5} textAnchor="middle" dominantBaseline="central">✓</text>
                </g>
              )}
              {ringO > 0 && <circle className="snake-eat-ring" r={ringR} opacity={ringO} />}
            </g>
          );
        })}

        {/* The head — the crawler itself */}
        {head !== null && (
          <g
            transform={`translate(${head.x} ${head.y}) rotate(${(head.angle * 180) / Math.PI})`}
            className="snake-head"
          >
            <circle r={13} className="snake-head-glow" style={{ fill: currentTaskColor } as CSSProperties} />
            <circle r={11} className="snake-head-body" />
            {/* eyes + tongue in heading-local coords (+x = forward) */}
            <g className="snake-tongue">
              <path d="M 11 0 L 16 -1.5 L 19 -3.5 M 16 1.5 L 19 3.5" className="snake-tongue-line" />
            </g>
            <circle cx={4} cy={-6} r={3.1} className="snake-eye" />
            <circle cx={4} cy={6} r={3.1} className="snake-eye" />
            <circle cx={5.3} cy={-6} r={1.4} className="snake-pupil" />
            <circle cx={5.3} cy={6} r={1.4} className="snake-pupil" />
          </g>
        )}

        {/* Readouts near the head */}
        {head !== null && (
          <g transform={`translate(${head.x} ${head.y})`}>
            <text x={labelX} y={-12 + labelDy} textAnchor={labelAnchor} dominantBaseline="central" className="snake-elapsed-label">
              {elapsedText}
            </text>
            <text
              x={labelX}
              y={10 + labelDy}
              textAnchor={labelAnchor}
              dominantBaseline="central"
              className={`snake-delta-label ${deltaMs !== null && deltaMs < 0 ? 'ahead' : deltaMs !== null ? 'behind' : ''}`}
            >
              {deltaText}
            </text>
            {nextTxt && (
              <text x={labelX} y={28 + labelDy} textAnchor={labelAnchor} dominantBaseline="central" className="snake-next-timer">
                {nextTxt}
              </text>
            )}
            {pillVisible && (
              <g
                onPointerDown={(e) => { e.stopPropagation(); suppressDragRef.current = true; }}
                onClick={() => curTask && (curTask.completedAt !== null ? onUncompleteTask(curTask.id) : onCompleteTask(curTask.id))}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={labelAnchor === 'start' ? labelX - 8 : labelX - doneW + 8}
                  y={38 + labelDy}
                  width={doneW}
                  height={24}
                  rx={12}
                  className={`snake-done-btn-bg ${pillUndo ? 'undo' : ''}`}
                />
                <text
                  x={labelX}
                  y={50 + labelDy}
                  textAnchor={labelAnchor}
                  dominantBaseline="central"
                  className={`snake-done-label ${pillUndo ? 'undo' : ''}`}
                >
                  {pillText}
                </text>
              </g>
            )}
          </g>
        )}
      </svg>

      {/* Edit popup — rename / duration / color, like the spiral's */}
      {editingTask !== null && (
        <div className="snake-edit-overlay" onClick={() => setEditingTaskId(null)}>
          <div className="snake-edit-popup" onClick={(e) => e.stopPropagation()}>
            <div className="snake-edit-header">
              <span>
                Редактировать <strong>{editingTask.emoji}</strong> {editingTask.name}
              </span>
              <button className="emoji-overlay-close" onClick={() => setEditingTaskId(null)} title="Cancel">
                ✕
              </button>
            </div>
            <label className="snake-edit-label">Название</label>
            <input
              className="edit-name-input"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditingTaskId(null);
              }}
              autoFocus
            />
            <label className="snake-edit-label">Длительность (m:ss или h:mm:ss)</label>
            <input
              className="edit-time-input"
              type="text"
              inputMode="decimal"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditingTaskId(null);
              }}
            />
            <label className="snake-edit-label">Цвет</label>
            <div className="color-picker">
              {TASK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-opt ${editingTask.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => onChangeTaskColor(editingTask.id, c)}
                />
              ))}
              <input
                type="color"
                className="color-input"
                value={editingTask.color}
                onChange={(e) => onChangeTaskColor(editingTask.id, e.target.value)}
                title="Pick any color"
              />
            </div>
            <div className="snake-edit-actions">
              <button className="btn snake-edit-save" onClick={commitEdit}>
                Сохранить
              </button>
              <button className="btn" onClick={() => setEditingTaskId(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}