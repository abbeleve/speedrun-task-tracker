import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunRecord } from './types';
import * as api from './api';

// How many session nodes are rendered up front; the timeline lazily appends
// more as the user scrolls towards the bottom of the list.
const PAGE_SIZE = 10;

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(key: string): string {
  const date = parseKey(key);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('ru-RU', opts);
}

function fmtDur(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h <= 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function fmtWall(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// One completed session, drawn as a single gray line on the timeline: the day it
// belongs to, when it started and ended, how long it lasted, and the schedule
// delta versus the plan (the "обгон"). The task breakdown is collapsed by
// default and slides open on hover, focus or tap.
function RunCard({ run, onOpenRun }: { run: RunRecord; onOpenRun: (run: RunRecord) => void }) {
  const [expanded, setExpanded] = useState(false);

  const durSec = (run.endedAt - run.startedAt) / 1000;
  const tasks = run.tasks ?? [];
  const hasTasks = tasks.length > 0;
  const plannedSec = run.plannedSec;

  // Signed difference between the actual session length and the plan.
  const deltaSec = plannedSec > 0 ? Math.round(durSec) - plannedSec : null;
  const deltaText =
    deltaSec === null
      ? '—'
      : deltaSec === 0
        ? 'в график'
        : deltaSec < 0
          ? `обгон ${fmtDur(-deltaSec)}`
          : `отставание ${fmtDur(deltaSec)}`;
  const deltaTitle =
    deltaSec === null
      ? 'Плановое время не задано'
      : deltaSec === 0
        ? 'Закончено ровно по плану'
        : deltaSec < 0
          ? `Обгон: на ${fmtDur(-deltaSec)} быстрее плана`
          : `Отставание: на ${fmtDur(deltaSec)} дольше плана`;

  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      className={`run-row${hasTasks ? ' has-tasks' : ''}${expanded ? ' expanded' : ''}`}
      role={hasTasks ? 'button' : undefined}
      tabIndex={hasTasks ? 0 : undefined}
      aria-expanded={hasTasks ? expanded : undefined}
      onClick={hasTasks ? toggle : undefined}
      onKeyDown={
        hasTasks
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
              }
            }
          : undefined
      }
      title={hasTasks ? 'Показать задачи сессии' : 'Нет сохранённых задач'}
    >
      <div className="run-line">
        <span className="run-day">{fmtDate(run.date)}</span>
        <span className="run-sep" aria-hidden="true">
          ·
        </span>
        <span className="run-time">
          {fmtWall(run.startedAt)}–{fmtWall(run.endedAt)}
        </span>
        <span className="run-sep" aria-hidden="true">
          ·
        </span>
        <span className="run-dur">{fmtDur(durSec)}</span>
        <span className="run-sep" aria-hidden="true">
          ·
        </span>
        <span className="run-delta" title={deltaTitle}>
          {deltaText}
        </span>
        {hasTasks && (
          <span className="dc-sess-chevron" aria-hidden="true">
            ▾
          </span>
        )}
      </div>
      {hasTasks && (
        <div className="dc-sess-details">
          <div className="dc-sess-details-inner">
            <ul className="day-card-tasks">
              {tasks.map((t) => (
                <li key={t.id} className={t.completedAt !== null ? 'done' : ''}>
                  <span className="dc-emoji">{t.emoji}</span>
                  <span className="dc-name">{t.name}</span>
                  <span className="dc-time">{fmtDur(t.plannedTime)}</span>
                  <span className="dc-status">{t.completedAt !== null ? '✓' : '○'}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="dc-sess-open"
              onClick={(e) => {
                e.stopPropagation();
                onOpenRun(run);
              }}
            >
              ↗ Открыть сессию в трекере
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DaysPage({ onOpenRun }: { onOpenRun: (run: RunRecord) => void }) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .loadRuns()
      .then((r) => {
        if (active) setRuns(r);
      })
      .catch((e) => {
        console.error('Failed to load runs', e);
        if (active) setError('Не удалось загрузить сессии');
      });
    return () => {
      active = false;
    };
  }, []);

  // Newest sessions first.
  const sessions = useMemo(
    () => (runs ? [...runs].sort((a, b) => b.startedAt - a.startedAt) : []),
    [runs]
  );

  // ── Lazy loading (infinite scroll) ──
  // Only the first batch of nodes is mounted; a sentinel at the bottom of the
  // timeline appends the next batch once it scrolls into view.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [sessions.length]);

  const hasMore = visibleCount < sessions.length;
  const visibleSessions = hasMore ? sessions.slice(0, visibleCount) : sessions;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!hasMore || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, sessions.length));
        }
      },
      { rootMargin: '300px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, sessions.length]);

  return (
    <div className="days-page">
      <h2 className="days-title">🗓 Таймлайн дней</h2>

      {error && <p className="days-empty">{error}</p>}
      {runs === null && !error && <p className="days-empty">Загрузка…</p>}
      {runs !== null && sessions.length === 0 && (
        <p className="days-empty">
          Пока нет сохранённых сессий. Начни спринт — и они появятся здесь.
        </p>
      )}

      <div className="days-timeline">
        {visibleSessions.map((run) => (
          <RunCard key={run.id} run={run} onOpenRun={onOpenRun} />
        ))}
        {hasMore && <div ref={sentinelRef} className="days-sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}

export default DaysPage;
