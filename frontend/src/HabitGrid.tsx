import { useMemo, useState } from 'react';
import type { Habit, HabitEntry, Task } from './types';
import type { HabitStore } from './habitStore';
import { shiftDayKey } from './history';
import {
  defaultUnit,
  habitTotal,
  isHabitComplete,
  isHabitDoneOn,
} from './habits';
import HabitDialog from './HabitDialog';
import HabitDial from './HabitDial';

interface HabitGridProps {
  store: HabitStore;
  tasks: Task[]; // every task of the plan — the grid filters by date
  date: string; // 'YYYY-MM-DD' (local) — the day being tracked
}

const STRIP_DAYS = 7;
const DIAL_DOTS = 14; // the dial shows today's progress as a row of dots

interface StripDay {
  date: string;
  weekdayShort: string;
}

function weekdayName(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const dt = new Date(2000, m - 1, d);
  return dt.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
}

// The home-page habit tracker. Every habit gets its own dial-card: a
// semicircular row of dots in the habit's own colour framing today's
// progress as an oversized number. Each card is independent — history, target
// and unit all belong to one habit, nothing is aggregated across habits.
function HabitGrid({ store, tasks, date }: HabitGridProps) {
  const [dialog, setDialog] = useState<Habit | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Which habit's history is currently expanded. Only one at a time — opening
  // a second one closes the first, so the page doesn't grow without bound.
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);

  const habits = store.habits;
  const entries = store.entries;

  const stripDays = useMemo<StripDay[]>(
    () =>
      Array.from({ length: STRIP_DAYS }, (_, i) => ({
        date: shiftDayKey(date, -(STRIP_DAYS - 1 - i)),
        weekdayShort: weekdayName(shiftDayKey(date, -(STRIP_DAYS - 1 - i))),
      })),
    [date]
  );

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
    const cur = manualFor(entries, habit, date);
    store.setManual(habit.id, date, Math.max(0, cur + delta * step));
  };

  return (
    <section className="home-panel home-panel--habits">
      <header className="habits-head">
        <h2 className="habits-title">
          Привычки
          <em>
            {habits.length === 0
              ? 'нет ни одной'
              : `${habits.length} активн${
                  habits.length === 1
                    ? 'ая'
                    : habits.length < 5
                      ? 'ые'
                      : 'ых'
                }`}
          </em>
        </h2>
        <button
          type="button"
          className="cal-btn"
          onClick={() => setDialog('new')}
        >
          + Привычка
        </button>
      </header>

      {habits.length === 0 ? (
        <p className="habits-empty">
          Пока нет привычек. Добавь первую — например
          <strong> «10 отжиманий»</strong> или <strong>«5 часов занятий»</strong>.
        </p>
      ) : (
        <ul className="habits-grid">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              tasks={tasks}
              entries={entries}
              date={date}
              days={stripDays}
              isDragging={dragId === habit.id}
              isHistoryOpen={historyOpenId === habit.id}
              onToggleHistory={() =>
                setHistoryOpenId((cur) => (cur === habit.id ? null : habit.id))
              }
              onEdit={() => setDialog(habit)}
              onDragStart={() => setDragId(habit.id)}
              onDragEnd={() => setDragId(null)}
              onDrop={() => dropOn(habit.id)}
              onAdjust={(delta) => adjust(habit, delta)}
            />
          ))}
        </ul>
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

interface HabitCardProps {
  habit: Habit;
  tasks: Task[];
  entries: HabitEntry[];
  date: string;
  days: StripDay[];
  isDragging: boolean;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  onEdit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onAdjust: (delta: number) => void;
}

// One habit as a self-contained dial-card:
//   • name (large, centred) — clicking it opens the edit dialog
//   • a tiny arrow-toggle in the top-right corner that opens/closes history
//   • the dial — TODAY only — in the habit's own colour with the big number
//     and "value / target unit" in the gap the arc leaves
//   • a 7-day strip of "did I hit it" cells, only when the toggle is open
//   • − / + steppers at the bottom
// The dial is the visual identity of the card; the number is the practical
// read-out ("how much have I done today"). Past days live behind the toggle.
function HabitCard({
  habit,
  tasks,
  entries,
  date,
  days,
  isDragging,
  isHistoryOpen,
  onToggleHistory,
  onEdit,
  onDragStart,
  onDragEnd,
  onDrop,
  onAdjust,
}: HabitCardProps) {
  const today = habitTotal(habit, date, tasks, entries);
  const complete = isHabitComplete(today, habit.target);
  const unit = habit.unit || defaultUnit(habit.format);
  const stepLabel = habit.format === 'time' ? '5 мин' : '1';
  const dayStatuses = days.map((d) => ({
    ...d,
    ok: isHabitDoneOn(habit, d.date, tasks, entries),
  }));
  const doneCount = dayStatuses.filter((d) => d.ok).length;
  const progress = habit.target > 0
    ? Math.max(0, Math.min(1, today / habit.target))
    : 0;
  const pct = habit.target > 0 ? Math.round(Math.max(0, today / habit.target) * 100) : 0;

  const yesterday = shiftDayKey(date, -1);
  const yesterdayTotal = habitTotal(habit, yesterday, tasks, entries);
  const yesterdayPct = habit.target > 0 ? Math.round(Math.max(0, yesterdayTotal / habit.target) * 100) : 0;

  return (
    <li
      className={`habit-card${complete ? ' done' : ''}${isDragging ? ' dragging' : ''}${isHistoryOpen ? ' history-open' : ''}`}
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.setData('text/plain', habit.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      style={{ '--habit-color': habit.color } as React.CSSProperties}
      aria-label={`${habit.name}: ${formatNumber(today)} из ${formatNumber(habit.target)}${unit ? ' ' + unit : ''} сегодня`}
    >
      <button
        type="button"
        className="habit-card-history-toggle"
        onClick={onToggleHistory}
        aria-expanded={isHistoryOpen}
        aria-controls={`history-${habit.id}`}
        title={isHistoryOpen ? 'Скрыть историю' : 'Показать историю за 7 дней'}
        aria-label={isHistoryOpen ? 'Скрыть историю' : 'Показать историю'}
      >
        <span aria-hidden>{isHistoryOpen ? '✕' : '↗'}</span>
      </button>

      <button
        type="button"
        className="habit-card-name"
        onClick={onEdit}
        title="Изменить привычку"
      >
        <span className="habit-emoji" aria-hidden>
          {habit.emoji}
        </span>
        <span className="habit-card-name-text">{habit.name}</span>
      </button>

      <div className="habit-card-dial">
        <div className="habit-card-dial-label" aria-hidden>
          Сегодня
        </div>
        <div className="habit-card-dial-number" aria-hidden>
          {pct}
          <span className="habit-card-dial-percent-sign">%</span>
        </div>
        <div className="habit-card-dial-unit" aria-hidden>
          {formatNumber(today)} / {formatNumber(habit.target)}
          {unit && <span className="habit-card-dial-unit-label"> {unit}</span>}
        </div>
        <HabitDial
          color={habit.color}
          progress={progress}
          total={DIAL_DOTS}
          size={260}
          dot={14}
          className="habit-card-dial-svg"
          ariaLabel={`Сегодня: ${pct}% от цели`}
        />
        <div className="habit-card-dial-compare" aria-hidden>
          <span className="habit-card-dial-compare-value">{yesterdayPct}%</span> вчера
        </div>
      </div>

      {isHistoryOpen && (
        <div
          id={`history-${habit.id}`}
          className="habit-card-history"
          aria-label={`История за ${dayStatuses.length} дней: ${doneCount} выполнено`}
        >
          <ul className="habit-card-history-grid">
            {dayStatuses.map((d) => {
              const isToday = d.date === date;
              const dayNum = d.date.slice(-2);
              return (
                <li
                  key={d.date}
                  className={`habit-card-history-cell${d.ok ? ' ok' : ''}${isToday ? ' today' : ''}`}
                  title={`${d.date}: ${d.ok ? 'выполнено' : 'не выполнено'}`}
                >
                  <span className="habit-card-history-weekday">{d.weekdayShort}</span>
                  <span className="habit-card-history-day">{dayNum}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="habit-card-actions">
        <button
          type="button"
          className="habit-btn"
          onClick={() => onAdjust(-1)}
          title={habit.format === 'time' ? `−${stepLabel}` : '−1'}
          aria-label={habit.format === 'time' ? `Минус ${stepLabel}` : 'Минус 1'}
        >
          −
        </button>
        <span className="habit-step">{stepLabel}</span>
        <button
          type="button"
          className="habit-btn"
          onClick={() => onAdjust(1)}
          title={habit.format === 'time' ? `+${stepLabel}` : '+1'}
          aria-label={habit.format === 'time' ? `Плюс ${stepLabel}` : 'Плюс 1'}
        >
          +
        </button>
      </div>
    </li>
  );
}

// Helpers ─────────────────────────────────────────────────────────────

function manualFor(entries: HabitEntry[], habit: Habit, date: string): number {
  for (const e of entries) {
    if (e.habitId === habit.id && e.date === date) return e.manual;
  }
  return 0;
}

// 7 / 10 — never 7.0 / 10. Strips trailing zeros so the read-out stays clean.
function formatNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export default HabitGrid;
