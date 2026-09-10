import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Task, SessionState } from './types';
import { formatTime, formatDelta } from './useTimer';
import { progressPct } from './listProgress';
import { taskDeltaMs } from './listDelta';
import { motivationImage, useMotivationImages } from './motivation';

interface ListViewProps {
  tasks: Task[];
  cumulativeTimes: number[];
  elapsedSec: number;
  sessionState: SessionState;
  currentTaskIdx: number;
  // Live schedule delta of the current task, in ms (negative = ahead), same
  // value the other views show.
  deltaMs: number | null;
  onCompleteTask: (id: string) => void;
  onSeek: (ms: number) => void;
  // Wall-clock time (HH:MM) at a given planned offset from the run start.
  formatEnd: (secondsFromStart: number) => string;
}

// How long the previous task's tube takes to collapse. Kept in sync with the
// exit keyframes so the row is swapped to its compact form only once done.
const EXIT_MS = 420;

// Flask silhouette for the expanded tube, in object-bounding-box units: a
// narrow neck at the top and bottom that flares into the body in the middle,
// so the tube grows out of the timeline spine and narrows back into it.
const TUBE_PATH =
  'M 0.5 0 C 0.5 0.05 0 0.085 0 0.22 L 0 0.78 C 0 0.915 0.5 0.95 0.5 1 ' +
  'C 0.5 0.95 1 0.915 1 0.78 L 1 0.22 C 1 0.085 0.5 0.05 0.5 0 Z';
const TUBE_CLIP_ID = 'liquid-tube-clip';

// Plain-text list timeline: every task is a row (emoji avatar on the spine,
// name + duration + finish time to the right). The spine fills with colour as
// the run advances, and the task it has reached expands into a thermometer
// whose tube tapers back into the spine at the top and bottom, with a picture
// card beside it. Drag the tube to scrub through the current task.
export function ListView({
  tasks,
  cumulativeTimes,
  elapsedSec,
  sessionState,
  currentTaskIdx,
  deltaMs,
  onCompleteTask,
  onSeek,
  formatEnd,
}: ListViewProps) {
  const active = sessionState !== 'idle' && currentTaskIdx >= 0 && currentTaskIdx < tasks.length;
  const activeTask = active ? tasks[currentTaskIdx] : null;

  // The current task's progress is measured from when it actually started — the
  // moment the previous task was closed — not from its planned start. Closing a
  // task early must let the next tube start filling immediately.
  const lastCompletedAt = tasks.reduce(
    (m, t) => (t.completedAt !== null && t.completedAt > m ? t.completedAt : m),
    0
  );
  const activeStart = active ? lastCompletedAt : 0;
  const pct = activeTask ? progressPct(activeTask, activeStart, elapsedSec) : 0;
  const images = useMotivationImages();

  // When the run moves on to the next task, keep rendering the previous task's
  // tube for a moment so it can collapse back into the spine before it swaps to
  // its compact "done" row. The fresh task's tube grows out on mount.
  const [exitingIdx, setExitingIdx] = useState<number | null>(null);
  const prevIdxRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevIdxRef.current;
    prevIdxRef.current = currentTaskIdx;
    if (prev === null || prev === currentTaskIdx || prev < 0 || prev >= tasks.length) return;
    const from = prev;
    setExitingIdx(from);
    const timer = window.setTimeout(() => {
      setExitingIdx((cur) => (cur === from ? null : cur));
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [currentTaskIdx, tasks.length]);

  const draggingRef = useRef(false);
  const seekFromTube = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeTask || sessionState === 'idle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, ratio));
    onSeek((activeStart + clamped * activeTask.plannedTime) * 1000);
  };

  if (tasks.length === 0) {
    return (
      <div className="liquid-list liquid-list--empty">
        <p>Добавьте задачи, чтобы увидеть список</p>
      </div>
    );
  }

  return (
    <>
      <svg className="liquid-clip-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <clipPath id={TUBE_CLIP_ID} clipPathUnits="objectBoundingBox">
            <path d={TUBE_PATH} />
          </clipPath>
        </defs>
      </svg>

      <div className="liquid-list">
        {tasks.map((task, idx) => {
          const startSec = cumulativeTimes[idx] ?? 0;
          const endSec = startSec + task.plannedTime;
          const isCompleted = task.completedAt !== null;
          // Everything up to the current task has been reached, so its connector
          // and node are tinted — even if the previous task was closed early.
          const reached = sessionState !== 'idle' && idx <= currentTaskIdx;
          const filled = isCompleted || reached;
          const isActive = active && idx === currentTaskIdx;
          // A just-finished task is still drawn with its tube (full) while it
          // collapses back into the spine.
          const isExit = exitingIdx === idx;
          // Schedule delta: actual once the task is completed, live for the
          // current one, and none for tasks still ahead. Negative = ahead.
          const delta = isCompleted ? taskDeltaMs(task, endSec) : isActive ? deltaMs : null;
          const deltaClass =
            delta !== null && delta < 0 ? 'ahead' : delta !== null && delta > 0 ? 'behind' : '';

          if (isActive || isExit) {
            const cat = motivationImage(images, idx);
            const rowPct = isActive ? pct : 100;
            return (
              <div
                className={
                  'liquid-row liquid-row--active' +
                  (isActive ? ' liquid-row--enter' : ' liquid-row--exit')
                }
                key={task.id}
                style={{ '--thermo-color': task.color, '--node-color': task.color } as CSSProperties}
              >
                <div className="liquid-thermo-wrap">
                  <div className="liquid-connector filled" />
                  <div
                    className="timeline-thermo liquid-thermo"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      draggingRef.current = true;
                      seekFromTube(e);
                    }}
                    onPointerMove={(e) => {
                      if (draggingRef.current) seekFromTube(e);
                    }}
                    onPointerUp={(e) => {
                      draggingRef.current = false;
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    title="Потяните, чтобы перемотать время"
                  >
                    <div className="liquid-thermo-ticks" aria-hidden="true" />
                    <div className="thermo-fill" style={{ height: `${rowPct}%` }} />
                    <svg
                      className="liquid-thermo-outline"
                      viewBox="0 0 1 1"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d={TUBE_PATH} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>
                </div>

                <div className="liquid-active-info">
                  <div className="liquid-active-stats">
                    <div className="liquid-active-name">
                      <span className="liquid-active-emoji">{task.emoji}</span>
                      {task.name}
                    </div>
                    <div className="liquid-progress">
                      Выполнено <strong>{Math.round(rowPct)}%</strong>
                      <span className={`liquid-delta ${deltaClass}`} title="Обгон/отставание от графика">
                        {delta !== null ? formatDelta(delta) : '—'}
                      </span>
                    </div>
                    <div className="liquid-active-end">
                      длительность {formatTime(task.plannedTime * 1000, false)} · закончится в{' '}
                      {formatEnd(endSec)}
                    </div>
                    {isActive && sessionState === 'running' && (
                      <button
                        className="btn btn-complete liquid-complete"
                        onClick={() => onCompleteTask(task.id)}
                        title="Завершить задачу"
                      >
                        ✓ Выполнено
                      </button>
                    )}
                  </div>

                  <div className="liquid-cat">
                    {cat ? (
                      <img className="liquid-cat-img" src={cat} alt="Мотивация" />
                    ) : (
                      <div className="liquid-cat-mock" title="Добавьте картинки в MOTIVATION_DIR на бэкенде">
                        🐱
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              className="liquid-row"
              key={task.id}
              style={{ '--node-color': task.color } as CSSProperties}
            >
              <div className="liquid-marker">
                <div className={`liquid-connector ${reached ? 'filled' : ''}`} />
                <div className={`liquid-node ${filled ? 'filled' : ''} ${isCompleted ? 'done' : ''}`}>
                  <span className="liquid-node-emoji">{task.emoji}</span>
                </div>
              </div>
              <div className="liquid-info">
                <span className="liquid-name">{task.name}</span>
                <span className="liquid-times">
                  <span className="liquid-duration" title="Длительность задачи">
                    ⏱ {formatTime(task.plannedTime * 1000, false)}
                  </span>
                  <span className="liquid-end" title="Время окончания задачи">
                    🏁 {formatEnd(endSec)}
                  </span>
                  <span
                    className={`liquid-delta ${deltaClass}`}
                    title="Обгон/отставание от графика"
                  >
                    {delta !== null ? formatDelta(delta) : '—'}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
