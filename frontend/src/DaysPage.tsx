import { useEffect, useMemo, useState } from 'react';
import type { DayState, Task } from './types';
import * as api from './api';

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(key: string): string {
  return parseKey(key).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function fmtDur(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h <= 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

interface DayInfo {
  state: DayState;
  tasks: Task[];
  totalPlannedSec: number;
  doneCount: number;
  elapsedSec: number;
  pct: number;
}

function buildInfo(state: DayState): DayInfo {
  const tasks = [...(state.tasks ?? [])].sort((a, b) => a.order - b.order);
  const totalPlannedSec = tasks.reduce((s, t) => s + t.plannedTime, 0);
  const doneCount = tasks.filter((t) => t.completedAt !== null).length;
  const elapsedSec = (state.elapsedMs ?? 0) / 1000;
  const pct =
    totalPlannedSec > 0
      ? Math.min(100, Math.round((elapsedSec / totalPlannedSec) * 100))
      : 0;
  return { state, tasks, totalPlannedSec, doneCount, elapsedSec, pct };
}

function DayCard({ info, onOpen }: { info: DayInfo; onOpen: (date: string) => void }) {
  const { state, tasks, totalPlannedSec, doneCount, elapsedSec, pct } = info;
  const open = () => onOpen(state.date);

  return (
    <div
      className="day-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      title="Открыть день в трекере"
    >
      <div className="day-card-head">
        <span className="day-card-date">{fmtDate(state.date)}</span>
        <span className="day-card-pct">{pct}%</span>
      </div>
      <div className="day-card-meta">
        <span>✅ {doneCount}/{tasks.length} задач</span>
        <span>⏱ {fmtDur(elapsedSec)}</span>
        {totalPlannedSec > 0 && <span>План: {fmtDur(totalPlannedSec)}</span>}
      </div>
      <div className="day-progress">
        <div className="day-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {tasks.length > 0 && (
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
      )}
    </div>
  );
}

function DaysPage({ onOpenDay }: { onOpenDay: (date: string) => void }) {
  const [days, setDays] = useState<Record<string, DayState> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .loadDays()
      .then((d) => {
        if (active) setDays(d);
      })
      .catch((e) => {
        console.error('Failed to load days', e);
        if (active) setError('Не удалось загрузить дни');
      });
    return () => {
      active = false;
    };
  }, []);

  const infos = useMemo(() => {
    if (!days) return [];
    return Object.values(days)
      .map(buildInfo)
      .filter((i) => i.tasks.length > 0 || i.elapsedSec > 0)
      .sort((a, b) => (a.state.date < b.state.date ? 1 : -1));
  }, [days]);

  return (
    <div className="days-page">
      <h2 className="days-title">🗓 Таймлайн дней</h2>

      {error && <p className="days-empty">{error}</p>}
      {days === null && !error && <p className="days-empty">Загрузка…</p>}
      {days !== null && infos.length === 0 && (
        <p className="days-empty">
          Пока нет сохранённых дней. Начни спринт — и он появится здесь.
        </p>
      )}

      <div className="days-timeline">
        {infos.map((info) => (
          <DayCard key={info.state.date} info={info} onOpen={onOpenDay} />
        ))}
      </div>
    </div>
  );
}

export default DaysPage;
