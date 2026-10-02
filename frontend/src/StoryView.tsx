import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SessionState, Task } from './types';
import { formatDelta, formatTime } from './format';
import { focusMotivation } from './focusMotivation';
import { taskDeltaMs } from './listDelta';
import { progressPct } from './listProgress';
import { useMotivationImages } from './motivation';
import { pageStoryImages, storyImage } from './storyImages';
import { storyRailPath } from './storyRail';
import type { RailFrame } from './storyRail';
import { IconRewind, IconStopwatch } from './icons';
import './StoryView.css';

interface StoryViewProps {
  tasks: Task[];
  cumulativeTimes: number[];
  elapsedSec: number;
  sessionState: SessionState;
  currentTaskIdx: number;
  deltaMs: number | null;
  onCompleteTask: (id: string) => void;
  onUncompleteTask: (id: string) => void;
  onSeek: (ms: number) => void;
  formatEnd: (secondsFromStart: number) => string;
}

function StoryPicture({ src, emoji }: { src: string | null; emoji: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div className="story-picture">
      {src && failedSrc !== src ? (
        <img src={src} alt="Вдохновение для следующего шага" loading="lazy" decoding="async"
          onError={() => setFailedSrc(src)} />
      ) : (
        <div className="story-picture-placeholder" aria-label="Вдохновение">
          <span aria-hidden="true">{emoji || '✦'}</span>
        </div>
      )}
    </div>
  );
}

// Until the row is measured (and when rendering without layout), assume a
// desktop row whose square picture sets its height.
const FALLBACK_FRAME: RailFrame = { width: 1000, height: 500, inset: 22, picture: 456 };

// The route's stretch for one step, drawn in the row's own pixels so the bend
// stays a true half-circle around the square picture at any width.
function StoryRail({ first, reverse, pct, maskId }: { first: boolean; reverse: boolean; pct: number; maskId: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [frame, setFrame] = useState<RailFrame>(FALLBACK_FRAME);
  useLayoutEffect(() => {
    const step = ref.current?.parentElement;
    const picture = step?.querySelector<HTMLElement>('.story-picture');
    if (!step || !picture) return;
    const measure = () => {
      // The picture's offset parent is the step content, flush with the row.
      const width = step.clientWidth;
      const size = picture.offsetWidth;
      const next = {
        width, height: step.clientHeight, picture: size,
        inset: reverse ? width - picture.offsetLeft - size : picture.offsetLeft,
      };
      setFrame((prev) => (prev.width === next.width && prev.height === next.height
        && prev.inset === next.inset && prev.picture === next.picture ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(step);
    return () => ro.disconnect();
  }, [reverse]);
  const arc = storyRailPath(frame, reverse, first);
  return (
    <svg ref={ref} className="story-line" viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {/* Normalize the reveal in path coordinates, independently of
            the fixed-width rail stroke on phones and taller rows. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-10" y="-10" width={frame.width + 20} height={frame.height + 20}>
          <path
            className="story-line-reveal"
            d={arc}
            fill="none"
            stroke="white"
            strokeWidth={48}
            strokeLinecap="butt"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - pct}
          />
        </mask>
      </defs>
      <path className="story-line-track" d={arc} />
      <path
        className="story-line-fill"
        d={arc}
        mask={pct < 100 ? `url(#${maskId})` : undefined}
        visibility={pct > 0 ? 'visible' : 'hidden'}
      />
    </svg>
  );
}

export function StoryView({
  tasks, cumulativeTimes, elapsedSec, sessionState, currentTaskIdx, deltaMs,
  onCompleteTask, onUncompleteTask, onSeek, formatEnd,
}: StoryViewProps) {
  const routeMaskId = useId();
  const images = useMotivationImages();
  const deck = useMemo(() => pageStoryImages(images), [images]);
  const completedCount = tasks.filter((task) => task.completedAt !== null).length;
  const activeStart = tasks.reduce((last, task) => Math.max(last, task.completedAt ?? 0), 0);

  if (tasks.length === 0) {
    return <div className="story-empty">Добавьте задачи, чтобы увидеть путь секвенции.</div>;
  }

  return (
    <section className="story-view" aria-label="Путь секвенции">
      <header className="story-heading">
        <div>
          <span className="story-eyebrow">ШАГ ЗА ШАГОМ</span>
          <h1>{tasks[0].sessionName || 'Моя секвенция'}</h1>
        </div>
        <span className="story-count">
          <strong>{completedCount}</strong> / {tasks.length}
          <span>шагов пройдено</span>
        </span>
      </header>
      <ol className="story-route">
        {tasks.map((task, idx) => {
          const endSec = (cumulativeTimes[idx] ?? 0) + task.plannedTime;
          const done = task.completedAt !== null;
          // An overdue sequence still lets its remaining tasks be completed.
          const active = sessionState !== 'idle' && idx === currentTaskIdx && !done;
          const pct = done ? 100 : active ? progressPct(task, activeStart, elapsedSec) : 0;
          const delta = done ? taskDeltaMs(task, endSec) : active ? deltaMs : null;
          const deltaClass = delta !== null && delta < 0 ? 'ahead' : delta !== null && delta > 0 ? 'behind' : '';
          const reverse = idx % 2 === 1;
          const fillMaskId = `${routeMaskId}-${idx}`;
          return (
            <li key={task.id}
              className={`story-step${reverse ? ' story-step--reverse' : ''}${active ? ' story-step--active' : ''}${done ? ' story-step--done' : ''}`}
              aria-current={active ? 'step' : undefined}
              style={{ '--story-task-color': task.color } as CSSProperties}>
              <StoryRail first={idx === 0} reverse={reverse} pct={pct} maskId={fillMaskId} />
              <div className="story-step-content">
                <StoryPicture src={storyImage(deck, idx)} emoji={task.emoji} />
                <div className="story-info">
                  <div className="story-step-top">
                    <span className="story-emoji" aria-hidden="true">{task.emoji || '✦'}</span>
                    <span className="story-step-number">{String(idx + 1).padStart(2, '0')}</span>
                    <span className={`story-status${active ? ' story-status--active' : ''}`}>
                      {done ? '✓ Пройдено' : active ? 'Сейчас' : 'Впереди'}
                    </span>
                  </div>
                  <h2>{task.name}</h2>
                  <p className="story-description">{task.description?.trim() || focusMotivation(task.id)}</p>
                  <div className="story-times">
                    <span><IconStopwatch size={14} /> {formatTime(task.plannedTime * 1000, false)}</span>
                    <span>Финиш {formatEnd(endSec)}</span>
                    {delta !== null && (
                      <span className={`story-delta ${deltaClass}`} title="Обгон / отставание от графика">
                        {formatDelta(delta)}
                      </span>
                    )}
                  </div>
                  {active && (
                    <div className="story-live">
                      <div className="story-progress-label">
                        <label htmlFor={`story-progress-${task.id}`}>Прогресс</label>
                        <strong>{Math.round(pct)}%</strong>
                      </div>
                      <input id={`story-progress-${task.id}`} className="story-progress" type="range"
                        min={0} max={100} step={0.1} value={pct} aria-valuetext={`${Math.round(pct)}%`}
                        onChange={(event) => onSeek((activeStart + Number(event.target.value) / 100 * task.plannedTime) * 1000)}
                        style={{ '--story-progress': `${pct}%` } as CSSProperties} />
                      <button type="button" className="story-complete" onClick={() => onCompleteTask(task.id)}>
                        <span aria-hidden="true">✓</span> Завершить шаг
                      </button>
                    </div>
                  )}
                  {done && (
                    <button type="button" className="story-reopen" onClick={() => onUncompleteTask(task.id)}>
                      <IconRewind size={13} /> Вернуть задачу
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="story-finish">
        <span aria-hidden="true">✦</span>
        {completedCount === tasks.length ? 'Секвенция пройдена. Отличная работа!' : 'Каждый шаг приближает к цели.'}
      </div>
    </section>
  );
}
