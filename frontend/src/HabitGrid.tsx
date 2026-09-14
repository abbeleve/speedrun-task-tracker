import { useMemo, useState } from 'react';
import type { Habit, HabitEntry, Task } from './types';
import type { HabitStore } from './habitStore';
import { shiftDayKey } from './history';
import {
  dayCompletion,
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

interface StripDay {
  date: string; // 'YYYY-MM-DD'
}

// The home-page habit tracker. The hero dial is the visual centre; the
// individual habits sit underneath as compact rows — each row carries a tiny
// 7-dot version of the dial, so the page speaks one visual language top to
// bottom instead of mixing a circle and a list of cards.
function HabitGrid({ store, tasks, date }: HabitGridProps) {
  const [dialog, setDialog] = useState<Habit | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const habits = store.habits;
  const entries = store.entries;

  const today = todayCompletion(habits, tasks, entries, date);
  const yesterday = yesterdayCompletion(habits, tasks, entries, date);
  const dialTotal = Math.max(habits.length, 7);

  const stripDays = useMemo<StripDay[]>(
    () =>
      Array.from({ length: STRIP_DAYS }, (_, i) => ({
        date: shiftDayKey(date, -(STRIP_DAYS - 1 - i)),
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

  const trend = trendArrow(today.rate, yesterday.rate);

  return (
    <section className="home-panel home-panel--habits">
      <header className="habits-head">
        <h2 className="habits-title">
          Привычки
          <em>
            {habits.length === 0
              ? 'нет ни одной'
              : `${today.done} из ${today.total} сегодня`}
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

      <DialHero
        today={today}
        yesterday={yesterday}
        dialTotal={dialTotal}
        trend={trend}
        hasHabits={habits.length > 0}
      />

      {habits.length === 0 ? (
        <p className="habits-empty">
          Пока нет привычек. Добавь первую — например
          <strong> «10 отжиманий»</strong> или <strong>«5 часов занятий»</strong>.
        </p>
      ) : (
        <ul className="habits-list">
          {habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              tasks={tasks}
              entries={entries}
              date={date}
              days={stripDays}
              isDragging={dragId === habit.id}
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

interface DialHeroProps {
  today: { done: number; total: number; rate: number };
  yesterday: { done: number; total: number; rate: number };
  dialTotal: number;
  trend: 'up' | 'down' | 'flat';
  hasHabits: boolean;
}

// The hero: a semicircular rainbow dial framing a single oversized number.
// When there are no habits, the dial is a quiet dim arc and the number is a
// dash — the design has an empty state, it doesn't pretend progress exists.
function DialHero({ today, yesterday, dialTotal, trend, hasHabits }: DialHeroProps) {
  const pct = Math.round(today.rate * 100);
  const yPct = Math.round(yesterday.rate * 100);
  return (
    <div
      className={`habit-hero${hasHabits ? '' : ' is-empty'}`}
      aria-label={
        hasHabits
          ? `Сегодня выполнено ${today.done} из ${today.total} привычек`
          : 'Привычек пока нет'
      }
    >
      <HabitDial
        progress={today.rate}
        total={dialTotal}
        size={360}
        dot={18}
        className="habit-hero-dial"
        ariaLabel={`Прогресс сегодня: ${pct}%`}
      />
      <div className="habit-hero-copy">
        <span className="habit-hero-eyebrow">Goals reached today</span>
        <div className="habit-hero-number">
          <span className="habit-hero-number-value">
            {hasHabits ? pct : '—'}
          </span>
          <span className="habit-hero-number-unit">
            {hasHabits ? 'percent' : ''}
          </span>
        </div>
        <span className="habit-hero-yesterday">
          {yesterday.total === 0 ? (
            'вчера — без данных'
          ) : (
            <>
              <span className="habit-hero-yesterday-value">{yPct}%</span>
              <span className="habit-hero-yesterday-label">yesterday</span>
              <span
                className={`habit-hero-trend habit-hero-trend--${trend}`}
                aria-hidden
              >
                {trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→'}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

interface HabitRowProps {
  habit: Habit;
  tasks: Task[];
  entries: HabitEntry[];
  date: string;
  days: StripDay[];
  isDragging: boolean;
  onEdit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onAdjust: (delta: number) => void;
}

// One habit as a horizontal row: identity on the left, micro-dial (the past 7
// days) in the middle, the +/- steppers on the right. The micro-dial reuses
// the hero's rainbow so the row reads as "a smaller copy of the big thing".
function HabitRow({
  habit,
  tasks,
  entries,
  date,
  days,
  isDragging,
  onEdit,
  onDragStart,
  onDragEnd,
  onDrop,
  onAdjust,
}: HabitRowProps) {
  const total = habitTotal(habit, date, tasks, entries);
  const complete = isHabitComplete(total, habit.target);
  const unit = habit.unit || defaultUnit(habit.format);
  const stepLabel = habit.format === 'time' ? '5 мин' : '1';
  const dayStatuses = days.map((d) => isHabitDoneOn(habit, d.date, tasks, entries));
  const todayIdx = days.findIndex((d) => d.date === date);

  return (
    <li
      className={`habit-row${complete ? ' done' : ''}${isDragging ? ' dragging' : ''}`}
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
    >
      <div className="habit-row-identity">
        <span className="habit-emoji" aria-hidden>
          {habit.emoji}
        </span>
        <div className="habit-row-text">
          <button
            type="button"
            className="habit-row-name"
            onClick={onEdit}
            title="Изменить привычку"
          >
            {habit.name}
          </button>
          <span className="habit-row-target">
            <span className={complete ? 'habit-row-target-value ok' : 'habit-row-target-value'}>
              {formatNumber(total)}
              {unit && <span className="habit-row-target-unit">{unit}</span>}
            </span>
            <span className="habit-row-target-sep">/</span>
            <span className="habit-row-target-goal">{formatNumber(habit.target)}</span>
          </span>
        </div>
      </div>

      <div
        className="habit-row-strip"
        aria-label="История за 7 дней"
        title={`История за 7 дней: ${dayStatuses.filter(Boolean).length}/${dayStatuses.length} выполнено`}
      >
        <HabitDial
          statuses={dayStatuses}
          size={dayStatuses.length === 7 ? 112 : 140}
          dot={dayStatuses.length === 7 ? 10 : 12}
          className="habit-row-dial"
          ariaLabel={`История: ${dayStatuses.filter(Boolean).length} из ${dayStatuses.length} выполнено`}
        />
        <ul className="habit-row-strip-marks" aria-hidden>
          {dayStatuses.map((ok, i) => (
            <li
              key={i}
              className={`habit-row-mark${ok ? ' ok' : ''}${i === todayIdx ? ' today' : ''}`}
            />
          ))}
        </ul>
      </div>

      <div className="habit-row-actions">
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

function todayCompletion(
  habits: Habit[],
  tasks: Task[],
  entries: HabitEntry[],
  date: string
) {
  return dayCompletion(habits, date, tasks, entries);
}

function yesterdayCompletion(
  habits: Habit[],
  tasks: Task[],
  entries: HabitEntry[],
  date: string
) {
  return dayCompletion(habits, shiftDayKey(date, -1), tasks, entries);
}

function trendArrow(
  today: number,
  yesterday: number
): 'up' | 'down' | 'flat' {
  const diff = today - yesterday;
  if (Math.abs(diff) < 0.01) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

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