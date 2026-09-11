import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DayState, Task, TaskStatus, TaskType } from './types';
import {
  DEFAULT_COLOR,
  DEFAULT_EMOJI,
  TASK_COLORS,
  TASK_EMOJIS,
  resolveTaskEmoji,
} from './types';
import * as api from './api';
import { formatTime } from './useTimer';
import { newTaskId, normalizeTasks, reindexTasks, STATUS_LABELS } from './tasks';
import { todayKey } from './history';

interface KanbanPageProps {
  // Day the tracker is currently on (normally today). Tasks of this day are
  // held live by the parent so board edits and the timeline stay in sync.
  activeDay: string;
  // Live tasks of the active day, or null while a historical run is open (then
  // the board edits that day through the backend instead).
  liveActiveTasks: Task[] | null;
  mutateActive: (updater: (tasks: Task[]) => Task[]) => void;
  onOpenTimeline: () => void;
}

const COLUMNS: TaskStatus[] = ['open', 'in-progress', 'done'];

function fmtDay(key: string): string {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', opts);
}

// Kanban board over every day's tasks: Open (planned backlog), In-Progress
// (placed on a timeline) and Done. Dragging an Open task that is planned for
// the active day onto In-Progress drops it on the timeline there; a task created
// straight on the timeline already starts as In-Progress.
function KanbanPage({ activeDay, liveActiveTasks, mutateActive, onOpenTimeline }: KanbanPageProps) {
  const today = todayKey();
  const hasLive = liveActiveTasks !== null;

  const [days, setDays] = useState<Record<string, DayState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState('');

  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('25');
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [type, setType] = useState<TaskType>('task');
  const [planDay, setPlanDay] = useState(activeDay);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null);

  useEffect(() => {
    setPlanDay(activeDay);
  }, [activeDay]);

  const reload = useCallback(async () => {
    try {
      const all = await api.loadDays();
      // When the parent holds the active day live, drop its (possibly stale)
      // persisted copy so the merged list never shows it twice.
      if (hasLive) delete all[activeDay];
      setDays(all);
      setError(null);
    } catch (e) {
      console.error('Failed to load days', e);
      setError('Не удалось загрузить задачи');
    }
  }, [activeDay, hasLive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeTasks = useMemo(
    () => liveActiveTasks ?? normalizeTasks(days?.[activeDay]?.tasks, activeDay),
    [liveActiveTasks, days, activeDay]
  );

  const allTasks = useMemo(() => {
    const list: Task[] = [...activeTasks];
    for (const [day, state] of Object.entries(days ?? {})) {
      if (day === activeDay) continue;
      list.push(...normalizeTasks(state.tasks, day));
    }
    return list;
  }, [activeTasks, days, activeDay]);

  const dayOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) if (t.day) set.add(t.day);
    return [...set].sort();
  }, [allTasks]);

  const visible = useMemo(
    () => (dayFilter ? allTasks.filter((t) => t.day === dayFilter) : allTasks),
    [allTasks, dayFilter]
  );

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { open: [], 'in-progress': [], done: [] };
    for (const t of visible) g[t.status].push(t);
    for (const s of COLUMNS) {
      g[s].sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order);
    }
    return g;
  }, [visible]);

  // A task can only change columns while it belongs to the active day — the
  // day whose timeline is on screen. Tasks of other days stay read-only.
  const canMove = useCallback((task: Task) => task.day === activeDay, [activeDay]);
  const isLive = useCallback(
    (task: Task) => hasLive && task.day === activeDay,
    [hasLive, activeDay]
  );

  // Persist a change to any day the parent is not holding live.
  const applyToDay = useCallback(
    async (day: string, updater: (tasks: Task[]) => Task[]) => {
      try {
        const state = days?.[day] ?? (await api.loadDay(day));
        const next: DayState = {
          ...state,
          date: day,
          tasks: updater(normalizeTasks(state.tasks, day)),
        };
        await api.saveDay(day, next);
        setDays((prev) => ({ ...(prev ?? {}), [day]: next }));
      } catch (e) {
        console.error('Failed to save tasks', e);
        setError('Не удалось сохранить задачу');
      }
    },
    [days]
  );

  const moveTaskTo = useCallback(
    (task: Task, status: TaskStatus) => {
      const patch = (t: Task): Task => {
        if (t.id !== task.id) return t;
        if (status === 'done') return { ...t, status, completedAt: t.completedAt ?? 0 };
        return { ...t, status, completedAt: null };
      };
      if (isLive(task)) mutateActive((prev) => reindexTasks(prev.map(patch)));
      else void applyToDay(activeDay, (ts) => reindexTasks(ts.map(patch)));
    },
    [isLive, mutateActive, applyToDay, activeDay]
  );

  const removeTask = useCallback(
    (task: Task) => {
      if (isLive(task)) mutateActive((prev) => reindexTasks(prev.filter((t) => t.id !== task.id)));
      else void applyToDay(task.day, (ts) => reindexTasks(ts.filter((t) => t.id !== task.id)));
    },
    [isLive, mutateActive, applyToDay]
  );

  const addPlannedTask = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      const plannedTime = Math.max(1, Math.round(parseFloat(minutes) * 60));
      if (!trimmed || !planDay || !isFinite(plannedTime)) return;
      const task: Task = {
        id: newTaskId(),
        name: trimmed,
        plannedTime,
        completedAt: null,
        order: 0,
        emoji: resolveTaskEmoji(emoji),
        color: color || DEFAULT_COLOR,
        type,
        day: planDay,
        status: 'open',
      };
      if (isLive(task)) mutateActive((prev) => reindexTasks([...prev, task]));
      else void applyToDay(planDay, (ts) => reindexTasks([...ts, task]));
      setName('');
    },
    [name, minutes, emoji, color, type, planDay, isLive, mutateActive, applyToDay]
  );

  const onDropColumn = (col: TaskStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    setDragId(null);
    setDropCol(null);
    if (!id) return;
    const task = allTasks.find((t) => t.id === id);
    if (!task || !canMove(task) || task.status === col) return;
    moveTaskTo(task, col);
  };

  if (days === null && liveActiveTasks === null) {
    return (
      <div className="kanban-page">
        <h2 className="kanban-title">🗂 Kanban</h2>
        <p className="kanban-empty">{error ?? 'Загрузка…'}</p>
      </div>
    );
  }

  return (
    <div className="kanban-page">
      <div className="kanban-top">
        <h2 className="kanban-title">🗂 Kanban</h2>
        <div className="kanban-filters">
          <label className="kanban-filter">
            День:
            <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
              <option value="">все</option>
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d === today ? `сегодня (${fmtDay(d)})` : fmtDay(d)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-stats-nav" onClick={onOpenTimeline}>
            ▶ К таймлайну
          </button>
        </div>
      </div>

      {error && <p className="kanban-err">{error}</p>}

      <form className="kanban-add" onSubmit={addPlannedTask}>
        <span className="kanban-add-emoji">{emoji}</span>
        <div className="kanban-emoji-row">
          {TASK_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className={`emoji-opt ${emoji === em ? 'active' : ''}`}
              onClick={() => setEmoji(em)}
            >
              {em}
            </button>
          ))}
        </div>
        <div className="kanban-color-row">
          {TASK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-opt ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <input
          className="kanban-input"
          type="text"
          placeholder="Название задачи…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="kanban-input kanban-input-sm"
          type="text"
          inputMode="decimal"
          placeholder="мин"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <label className="kanban-filter">
          на день:
          <input
            type="date"
            value={planDay}
            onChange={(e) => setPlanDay(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`type-toggle type-toggle-sm ${type === 'rest' ? 'active' : ''}`}
          onClick={() => setType(type === 'rest' ? 'task' : 'rest')}
          title={type === 'rest' ? 'Обычная задача' : 'Отдых / перерыв'}
        >
          ☕
        </button>
        <button type="submit" className="btn btn-add btn-add-sm">
          + Запланировать
        </button>
      </form>

      <div className="kanban-board">
        {COLUMNS.map((status) => (
          <div
            key={status}
            className={`kanban-col kanban-col--${status} ${dropCol === status ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropCol((prev) => (prev === status ? prev : status));
            }}
            onDrop={onDropColumn(status)}
          >
            <div className="kanban-col-head">
              <span className={`kanban-dot kanban-dot--${status}`} />
              <span className="kanban-col-name">{STATUS_LABELS[status]}</span>
              <span className="kanban-count">{grouped[status].length}</span>
            </div>
            <div className="kanban-cards">
              {grouped[status].map((task) => {
                const offered = status === 'open' && task.day === activeDay;
                const movable = canMove(task);
                return (
                  <div
                    key={task.id}
                    className={`kanban-card ${offered ? 'offered' : ''} ${
                      movable ? 'movable' : 'locked'
                    } ${dragId === task.id ? 'dragging' : ''}`}
                    draggable={movable}
                    onDragStart={(e) => {
                      if (!movable) return;
                      setDragId(task.id);
                      e.dataTransfer.setData('text/plain', task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropCol(null);
                    }}
                  >
                    <span className="kanban-card-emoji" style={{ '--task-color': task.color } as React.CSSProperties}>
                      {task.emoji}
                    </span>
                    <div className="kanban-card-body">
                      <span className="kanban-card-name">{task.name}</span>
                      <span className="kanban-card-meta">
                        <span className="kanban-card-time">{formatTime(task.plannedTime * 1000, false)}</span>
                        <span
                          className={`kanban-day-badge ${task.day === today ? 'is-today' : ''}`}
                          title={`Запланировано на ${task.day || '—'}`}
                        >
                          {task.day === today ? 'сегодня' : fmtDay(task.day)}
                        </span>
                        {task.type === 'rest' && <span className="kanban-rest">☕</span>}
                      </span>
                    </div>
                    <div className="kanban-card-actions">
                      {status === 'open' && movable && (
                        <button
                          type="button"
                          className="btn btn-complete"
                          onClick={() => moveTaskTo(task, 'in-progress')}
                          title="Поставить на таймлайн"
                        >
                          ▶
                        </button>
                      )}
                      {status === 'open' && !movable && (
                        <span className="kanban-lock" title={`Ждёт ${task.day || 'своего дня'}`}>
                          🔒
                        </span>
                      )}
                      {status === 'in-progress' && movable && (
                        <button
                          type="button"
                          className="btn btn-complete"
                          onClick={() => moveTaskTo(task, 'done')}
                          title="Отметить выполненной"
                        >
                          ✓
                        </button>
                      )}
                      {status === 'done' && movable && (
                        <button
                          type="button"
                          className="btn btn-undo"
                          onClick={() => moveTaskTo(task, 'in-progress')}
                          title="Вернуть в работу"
                        >
                          ↩
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-remove"
                        onClick={() => removeTask(task)}
                        title="Удалить"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              {grouped[status].length === 0 && <p className="kanban-col-empty">Пусто</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default KanbanPage;
