import { useEffect, useMemo, useState } from 'react';
import type { DayState, RunRecord, Task } from './types';
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

function fmtWall(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function DayCard({
  info,
  sessions,
  onOpen,
  onOpenRun,
}: {
  info: DayInfo;
  sessions: RunRecord[];
  onOpen: (date: string) => void;
  onOpenRun: (run: RunRecord) => void;
}) {
  const { state } = info;
  const open = () => onOpen(state.date);

  // A day can hold several sessions. Each saved run carries its own task
  // snapshot, so the card is built from those; the raw day state is only a
  // fallback for a plan that has not produced a run yet (still in progress).
  const hasSessions = sessions.length > 0;
  const sessionSec = sessions.reduce((s, r) => s + (r.endedAt - r.startedAt) / 1000, 0);
  const elapsedSec = hasSessions ? sessionSec : info.elapsedSec;
  const allTasks = hasSessions ? sessions.flatMap((s) => s.tasks ?? []) : info.tasks;
  const totalPlannedSec = allTasks.reduce((s, t) => s + t.plannedTime, 0);
  const doneCount = allTasks.filter((t) => t.completedAt !== null).length;
  const pct =
    totalPlannedSec > 0 ? Math.min(100, Math.round((elapsedSec / totalPlannedSec) * 100)) : 0;

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
        <span>✅ {doneCount}/{allTasks.length} задач</span>
        <span>⏱ {fmtDur(elapsedSec)}</span>
        {totalPlannedSec > 0 && <span>План: {fmtDur(totalPlannedSec)}</span>}
      </div>
      <div className="day-progress">
        <div className="day-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {hasSessions ? (
        <div className="day-card-sessions" onClick={(e) => e.stopPropagation()}>
          <div className="day-card-sessions-title">🔄 Сессии ({sessions.length})</div>
          <ul className="day-card-sessions-list">
            {sessions.map((s) => {
              const dur = (s.endedAt - s.startedAt) / 1000;
              const planned = (s.tasks ?? []).reduce((a, t) => a + t.plannedTime, 0);
              const sPct =
                planned > 0 ? Math.min(100, Math.round((dur / planned) * 100)) : 0;
              const hasTasks = (s.tasks?.length ?? 0) > 0;
              return (
                <li
                  key={s.id}
                  className={`day-card-session${hasTasks ? ' clickable' : ''}`}
                  role={hasTasks ? 'button' : undefined}
                  tabIndex={hasTasks ? 0 : undefined}
                  title={hasTasks ? 'Открыть эту сессию в трекере' : 'Нет сохранённых задач'}
                  onClick={
                    hasTasks
                      ? (e) => {
                          e.stopPropagation();
                          onOpenRun(s);
                        }
                      : undefined
                  }
                  onKeyDown={
                    hasTasks
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpenRun(s);
                          }
                        }
                      : undefined
                  }
                >
                  <div className="dc-sess-head">
                    <span className="dc-sess-range">
                      {fmtWall(s.startedAt)}–{fmtWall(s.endedAt)}
                    </span>
                    <span className="dc-sess-dur">⏱ {fmtDur(dur)}</span>
                    <span className="dc-sess-work">💪 {fmtDur(s.workSec)}</span>
                    <span className="dc-sess-pct">{sPct}%</span>
                  </div>
                  {(s.tasks?.length ?? 0) > 0 && (
                    <ul className="day-card-tasks">
                      {s.tasks.map((t) => (
                        <li key={t.id} className={t.completedAt !== null ? 'done' : ''}>
                          <span className="dc-emoji">{t.emoji}</span>
                          <span className="dc-name">{t.name}</span>
                          <span className="dc-time">{fmtDur(t.plannedTime)}</span>
                          <span className="dc-status">{t.completedAt !== null ? '✓' : '○'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        info.tasks.length > 0 && (
          <ul className="day-card-tasks">
            {info.tasks.map((t) => (
              <li key={t.id} className={t.completedAt !== null ? 'done' : ''}>
                <span className="dc-emoji">{t.emoji}</span>
                <span className="dc-name">{t.name}</span>
                <span className="dc-time">{fmtDur(t.plannedTime)}</span>
                <span className="dc-status">{t.completedAt !== null ? '✓' : '○'}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function DaysPage({
  onOpenDay,
  onOpenRun,
}: {
  onOpenDay: (date: string) => void;
  onOpenRun: (run: RunRecord) => void;
}) {
  const [days, setDays] = useState<Record<string, DayState> | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.loadDays(), api.loadRuns()])
      .then(([d, r]) => {
        if (!active) return;
        setDays(d);
        setRuns(r);
      })
      .catch((e) => {
        console.error('Failed to load days', e);
        if (active) setError('Не удалось загрузить дни');
      });
    return () => {
      active = false;
    };
  }, []);

  // Runs grouped by the day they started, in chronological order per day.
  const runsByDate = useMemo(() => {
    const map: Record<string, RunRecord[]> = {};
    for (const r of runs) (map[r.date] ??= []).push(r);
    for (const list of Object.values(map)) list.sort((a, b) => a.startedAt - b.startedAt);
    return map;
  }, [runs]);

  const infos = useMemo(() => {
    const all: Record<string, DayState> = { ...(days ?? {}) };
    // A day that only has completed sessions (e.g. its task list was cleared
    // after finishing) must still show its sessions in the timeline.
    for (const date of Object.keys(runsByDate)) {
      if (!all[date]) {
        all[date] = {
          date,
          tasks: [],
          elapsedMs: 0,
          timeCredit: 0,
          sessionState: 'idle',
          startedAt: null,
        };
      }
    }
    return Object.values(all)
      .map(buildInfo)
      .filter(
        (i) =>
          i.tasks.length > 0 || i.elapsedSec > 0 || (runsByDate[i.state.date]?.length ?? 0) > 0
      )
      .sort((a, b) => (a.state.date < b.state.date ? 1 : -1));
  }, [days, runsByDate]);

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
          <DayCard
            key={info.state.date}
            info={info}
            sessions={runsByDate[info.state.date] ?? []}
            onOpen={onOpenDay}
            onOpenRun={onOpenRun}
          />
        ))}
      </div>
    </div>
  );
}

export default DaysPage;
