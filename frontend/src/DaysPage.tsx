import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chain } from './schedule';
import { dayKeyOf, isDone, isSession } from './schedule';

// How many sequences are rendered up front; the timeline lazily appends more as
// the user scrolls towards the bottom of the list.
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

// One worked sequence, drawn as a single gray line: the day it belongs to, the
// slot it occupied, how long it was planned for, and the overtake — how far
// before (or after) its planned end the last block was actually closed. The
// task breakdown is collapsed by default and slides open on click.
function ChainCard({ chain, onOpenChain }: { chain: Chain; onOpenChain: (c: Chain) => void }) {
  const [expanded, setExpanded] = useState(false);

  const plannedSec = (chain.endMs - chain.startMs) / 1000;
  const lastDoneMs = chain.tasks.reduce(
    (max, t) => (t.finishedAt !== null && t.finishedAt > max ? t.finishedAt : max),
    0
  );
  const allDone = chain.tasks.every(isDone);
  const deltaSec = allDone && lastDoneMs > 0 ? Math.round((chain.endMs - lastDoneMs) / 1000) : null;

  const deltaText =
    deltaSec === null
      ? 'в работе'
      : Math.abs(deltaSec) < 30
        ? 'в график'
        : deltaSec > 0
          ? `обгон ${fmtDur(deltaSec)}`
          : `отставание ${fmtDur(-deltaSec)}`;

  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      className={`run-row has-tasks${expanded ? ' expanded' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      title="Показать задачи секвенции"
    >
      <div className="run-line">
        <span className="run-day">{fmtDate(dayKeyOf(chain.startMs))}</span>
        <span className="run-sep" aria-hidden="true">·</span>
        <span className="run-time">
          {fmtWall(chain.startMs)}–{fmtWall(chain.endMs)}
        </span>
        <span className="run-sep" aria-hidden="true">·</span>
        <span className="run-dur">{fmtDur(plannedSec)}</span>
        <span className="run-sep" aria-hidden="true">·</span>
        <span className="run-delta">{deltaText}</span>
        <span className="dc-sess-chevron" aria-hidden="true">▾</span>
      </div>
      <div className="dc-sess-details">
        <div className="dc-sess-details-inner">
          <ul className="day-card-tasks">
            {chain.tasks.map((t) => (
              <li key={t.id} className={isDone(t) ? 'done' : ''}>
                <span className="dc-emoji">{t.emoji}</span>
                <span className="dc-name">{t.name}</span>
                <span className="dc-time">{fmtDur(t.plannedTime)}</span>
                <span className="dc-status">{isDone(t) ? '✓' : '○'}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="dc-sess-open"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChain(chain);
            }}
          >
            ↗ Открыть секвенцию в трекере
          </button>
        </div>
      </div>
    </div>
  );
}

interface DaysPageProps {
  chains: Chain[];
  onOpenChain: (chain: Chain) => void;
}

// Every sequence that was actually worked, newest first — the history the
// saved-runs list used to show, now read straight off the calendar.
function DaysPage({ chains, onOpenChain }: DaysPageProps) {
  const sessions = useMemo(
    () =>
      chains
        .filter((c) => isSession(c) && c.tasks.some(isDone))
        .sort((a, b) => b.startMs - a.startMs),
    [chains]
  );

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

      {sessions.length === 0 && (
        <p className="days-empty">
          Пока нет проработанных секвенций. Закрой задачу в календаре — и она появится здесь.
        </p>
      )}

      <div className="days-timeline">
        {visibleSessions.map((chain) => (
          <ChainCard key={`${chain.startMs}-${chain.id}`} chain={chain} onOpenChain={onOpenChain} />
        ))}
        {hasMore && <div ref={sentinelRef} className="days-sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}

export default DaysPage;
