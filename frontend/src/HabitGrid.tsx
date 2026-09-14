import { useMemo, useState } from 'react';
import type { Habit, Task } from './types';
import type { HabitStore } from './habitStore';
import { shiftDayKey } from './history';
import {
  defaultUnit,
  formatHabit,
  habitAuto,
  habitHistory,
  habitManual,
  habitProgress,
  habitTotal,
  isHabitComplete,
} from './habits';
import HabitDialog from './HabitDialog';

interface HabitGridProps {
  store: HabitStore;
  tasks: Task[]; // every task of the plan — the grid filters by date
  date: string; // 'YYYY-MM-DD' (local) — the day being tracked
}

const HISTORY_DAYS = 7;

function lastDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDayKey(today, -i));
}

// The home-page habit tracker: one card per habit in a draggable grid, each
// showing today's progress against its quota plus a per-day history.
function HabitGrid({ store, tasks, date }: HabitGridProps) {
  const [dialog, setDialog] = useState<Habit | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());

  const habits = store.habits;
  const days = useMemo(() => lastDays(date, HISTORY_DAYS), [date]);

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = habits.map((h) => h.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    store.reorder(ids);
    setDragId(null);
  };

  const adjust = (habit: Habit, delta: number) => {
    const step = habit.format === 'time' ? 5 : 1;
    const cur = habitManual(store.entries, habit.id, date);
    store.setManual(habit.id, date, Math.max(0, cur + delta * step));
  };

  return (
    <section className="home-panel home-panel--habits">
      <header className="habits-head">
        <h2 className="habits-title">🎯 Привычки</h2>
        <button
          type="button"
          className="btn btn-resume"
          onClick={() => setDialog('new')}
          title="Добавить привычку"
        >
          + Привычка
        </button>
      </header>

      {habits.length === 0 ? (
        <p className="habits-empty">
          Пока нет привычек. Добавь первую — например «10 отжиманий» или «5 часов занятий».
        </p>
      ) : (
        <div className="habits-grid">
          {habits.map((habit) => {
            const total = habitTotal(habit, date, tasks, store.entries);
            const pct = habitProgress(total, habit.target);
            const complete = isHabitComplete(total, habit.target);
            const hist = openHistory.has(habit.id)
              ? habitHistory(habit, days, tasks, store.entries)
              : null;

            return (
              <div
                key={habit.id}
                className={`habit-card${complete ? ' done' : ''}${dragId === habit.id ? ' dragging' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragId(habit.id);
                  e.dataTransfer.setData('text/plain', habit.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(habit.id);
                }}
                onDragEnd={() => setDragId(null)}
                style={{ '--habit-color': habit.color } as React.CSSProperties}
              >
                <div className="habit-card-head">
                  <span className="habit-emoji">{habit.emoji}</span>
                  <span className="habit-name" title={habit.name}>
                    {habit.name}
                  </span>
                  <button
                    type="button"
                    className="habit-btn habit-btn--icon"
                    onClick={() => setDialog(habit)}
                    title="Изменить привычку"
                  >
                    ✎
                  </button>
                </div>

                <div className="habit-value">
                  <span className={`habit-num${complete ? ' ok' : ''}`}>
                    {formatHabit(total, habit.target, habit.unit || defaultUnit(habit.format))}
                  </span>
                  {habit.format === 'time' && (
                    <span className="habit-meta">подвязанные задачи: +{habitAutoLabel(habit, tasks, date)}</span>
                  )}
                </div>

                <div className="habit-bar">
                  <div className="habit-bar-fill" style={{ width: `${pct * 100}%` }} />
                </div>

                <div className="habit-actions">
                  <button
                    type="button"
                    className="habit-btn"
                    onClick={() => adjust(habit, -1)}
                    title={habit.format === 'time' ? '−5 минут' : '−1'}
                  >
                    −
                  </button>
                  <span className="habit-step">
                    {habit.format === 'time' ? '5 мин' : '1'}
                  </span>
                  <button
                    type="button"
                    className="habit-btn"
                    onClick={() => adjust(habit, 1)}
                    title={habit.format === 'time' ? '+5 минут' : '+1'}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={`habit-btn habit-toggle${hist ? ' active' : ''}`}
                    onClick={() =>
                      setOpenHistory((prev) => {
                        const next = new Set(prev);
                        if (next.has(habit.id)) next.delete(habit.id);
                        else next.add(habit.id);
                        return next;
                      })
                    }
                  >
                    📅 История
                  </button>
                </div>

                {hist && (
                  <ul className="habit-history">
                    {hist.map(({ date: d, value }) => {
                      const done = isHabitComplete(value, habit.target);
                      const isToday = d === date;
                      return (
                        <li key={d} className={`${done ? 'ok' : ''}${isToday ? ' today' : ''}`}>
                          <span className="habit-history-day">
                            {isToday ? 'Сегодня' : shortDay(d)}
                          </span>
                          <span className="habit-history-value">
                            {formatHabit(value, habit.target, habit.unit || defaultUnit(habit.format))}
                          </span>
                          <span className="habit-history-mark">{done ? '✓' : '·'}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <HabitDialog
          habit={typeof dialog === 'object' ? dialog : null}
          nextOrder={habits.length}
          onSave={(h) => {
            store.upsert(h);
            setDialog(null);
          }}
          onDelete={
            typeof dialog === 'object'
              ? (id) => {
                  store.remove(id);
                  setDialog(null);
                }
              : undefined
          }
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

// Minutes auto-contributed today by completed linked tasks — shown as a hint on
// time habits so the user can see how far the plan is pushing the habit.
function habitAutoLabel(habit: Habit, tasks: Task[], date: string): string {
  return String(habitAuto(habit, date, tasks));
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const date = new Date(2000, m - 1, d);
  return date.toLocaleDateString('ru-RU', { weekday: 'short' });
}

export default HabitGrid;
