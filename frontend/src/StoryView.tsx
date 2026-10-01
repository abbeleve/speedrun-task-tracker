import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SessionState, Task } from './types';
import { formatDelta, formatTime } from './format';
import { focusMotivation } from './focusMotivation';
import { taskDeltaMs } from './listDelta';
import { progressPct } from './listProgress';
import { useMotivationImages } from './motivation';
import { pageStoryImages, storyImage } from './storyImages';
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

export function StoryView({
  tasks, cumulativeTimes, elapsedSec, sessionState, currentTaskIdx, deltaMs,
  onCompleteTask, onUncompleteTask, onSeek, formatEnd,
}: StoryViewProps) {
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
          const arc = reverse
            ? 'M 860 0 A 130 130 0 0 1 860 260 H 140'
            : `${idx === 0 ? 'M 480 0 H 140' : 'M 140 0'} A 130 130 0 0 0 140 260 H 860`;
          return (
            <li key={task.id}
              className={`story-step${reverse ? ' story-step--reverse' : ''}${active ? ' story-step--active' : ''}${done ? ' story-step--done' : ''}`}
              aria-current={active ? 'step' : undefined}
              style={{ '--story-task-color': task.color } as CSSProperties}>
              <svg className="story-line" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true">
                <path d={arc} />
              </svg>
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
