import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Habit, HabitChart, HabitEntry, Task } from './types';
import type { HabitStore } from './habitStore';
import { shiftDayKey } from './history';
import {
  defaultStep,
  defaultUnit,
  habitTargetOn,
  habitTotal,
  isHabitComplete,
  isHabitDoneOn,
  parseHabitAmount,
} from './habits';
import { gaugeStatus, HABIT_CHARTS, habitChartOf, habitPercent } from './habitChart';
import { forgetCelebration, habitStreak, markCelebrated, wasCelebrated } from './streak';
import { StreakBadge, StreakBurst } from './StreakFlame';
import HabitDialog from './HabitDialog';
import HabitDial from './HabitDial';
import HabitGauge from './HabitGauge';
import ChartSwitch from './ChartSwitch';
import type { ChartSwitchOption } from './ChartSwitch';
import { IconChartDots, IconChartGauge, IconSnowflake } from './icons';

interface HabitGridProps {
  store: HabitStore;
  tasks: Task[]; // every task of the plan — the grid filters by date
  date: string; // 'YYYY-MM-DD' (local) — the day being tracked
  // Hours left in the day once 3 or fewer (see streakWarnStage), else null:
  // an unmet streak's fire starts to smoulder.
  warnHours: number | null;
}

const STRIP_DAYS = 7;
const DIAL_DOTS = 14; // the dial shows today's progress as a row of dots

const CHART_ICONS: Record<HabitChart, React.ReactNode> = {
  dots: <IconChartDots size={16} />,
  gauge: <IconChartGauge size={16} />,
};
const CHART_OPTIONS: ChartSwitchOption<HabitChart>[] = HABIT_CHARTS.map((c) => ({
  ...c,
  icon: CHART_ICONS[c.value],
}));

interface StripDay {
  date: string;
  weekdayShort: string;
}

function weekdayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
}

// The home-page habit tracker. Every habit gets its own dial-card: a
// semicircular row of dots in the habit's own colour framing today's
// progress as an oversized number. Each card is independent — history, target
// and unit all belong to one habit, nothing is aggregated across habits.
function HabitGrid({ store, tasks, date, warnHours }: HabitGridProps) {
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

  // `amount` is already in the habit's own units and carries its sign — the
  // card decides whether that is one default step or a number typed by hand.
  const adjust = (habit: Habit, amount: number) => {
    const cur = manualFor(entries, habit, date);
    store.setManual(habit.id, date, Math.max(0, cur + amount));
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
              warnHours={warnHours}
              isDragging={dragId === habit.id}
              isHistoryOpen={historyOpenId === habit.id}
              onToggleHistory={() =>
                setHistoryOpenId((cur) => (cur === habit.id ? null : habit.id))
              }
              onEdit={() => setDialog(habit)}
              onDragStart={() => setDragId(habit.id)}
              onDragEnd={() => setDragId(null)}
              onDrop={() => dropOn(habit.id)}
              onAdjust={(amount) => adjust(habit, amount)}
              onChartChange={(chart) => store.upsert({ ...habit, chart })}
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
  warnHours: number | null;
  isDragging: boolean;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  onEdit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onAdjust: (amount: number) => void;
  // Saved with the habit, so the choice follows the account between sessions.
  onChartChange: (chart: HabitChart) => void;
}

// One habit as a self-contained dial-card:
//   • name (large, centred) — clicking it opens the edit dialog
//   • a tiny arrow-toggle in the top-right corner that opens/closes history
//   • the chart — TODAY only — in the habit's own colour, drawn one of two
//     ways, picked with the little switch on its right:
//       dots  — a dotted arc with the percentage and "value / target unit" in
//               the gap it leaves, and yesterday's percentage under it;
//       gauge — a fan of capsules around today's value and a pill saying how
//               much is left, over two bars: yesterday and the last 7 days
//   • for a streak habit, a little fire in the chart's top-left corner with
//     the days in a row in it and the savers in hand under it; meeting
//     today's quota sets the card ablaze (StreakBurst) and flies the fire
//     into it
//   • a 7-day strip of "did I hit it" cells, only when the toggle is open —
//     a missed day a saver covered is iced over
//   • − / + steppers at the bottom, with the step itself shown between them
//     Click anywhere on the card and the number keys retype that step, so
//     "+25" is four keystrokes away without the card growing a single control.
// The dial is the visual identity of the card; the number is the practical
// read-out ("how much have I done today"). Past days live behind the toggle.
function HabitCard({
  habit,
  tasks,
  entries,
  date,
  days,
  warnHours,
  isDragging,
  isHistoryOpen,
  onToggleHistory,
  onEdit,
  onDragStart,
  onDragEnd,
  onDrop,
  onAdjust,
  onChartChange,
}: HabitCardProps) {
  // Digits typed on the focused card, building up the step the − / + buttons
  // apply. Empty means "no custom step yet", so the habit's own default stands
  // in — the buttons therefore always do something, even mid-typing.
  const [stepDraft, setStepDraft] = useState('');
  // Set once the chart has been switched on this card: only then does the new
  // chart ease in, so loading the page does not animate every card at once.
  const [chartSwitched, setChartSwitched] = useState(false);

  const today = habitTotal(habit, date, tasks, entries);
  const target = habitTargetOn(habit, date);
  const complete = isHabitComplete(today, target);
  const unit = habit.unit || defaultUnit(habit.format);
  const typedStep = parseHabitAmount(stepDraft);
  const step = typedStep ?? defaultStep(habit.format);
  const stepLabel = stepDraft !== '' ? stepDraft : formatNumber(step);

  // Number keys retype the step; backspace walks it back; Escape drops it and
  // returns the card to the habit's default. Everything else (tab, arrows, the
  // buttons' own space/enter) is left alone, so the card stays a normal
  // keyboard citizen.
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      setStepDraft((d) => (d.replace(/[^0-9]/g, '').length >= 5 ? d : d + e.key));
    } else if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      setStepDraft((d) => (d === '' || d.includes(',') ? d : d + ','));
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      setStepDraft((d) => d.slice(0, -1));
    } else if (e.key === 'Escape' && stepDraft !== '') {
      e.stopPropagation();
      setStepDraft('');
    }
  };
  const streak = useMemo(
    () => (habit.streak ? habitStreak(habit, date, tasks, entries) : null),
    [habit, date, tasks, entries]
  );
  const frozenDays = useMemo(() => new Set(streak?.frozen), [streak]);
  const dayStatuses = days.map((d) => ({
    ...d,
    ok: isHabitDoneOn(habit, d.date, tasks, entries),
    frozen: frozenDays.has(d.date),
  }));
  const doneCount = dayStatuses.filter((d) => d.ok).length;
  const progress = target > 0
    ? Math.max(0, Math.min(1, today / target))
    : 0;
  const pct = habitPercent(today, target);
  const chart = habitChartOf(habit);

  // Yesterday is measured against yesterday's own quota, so the day a quota is
  // raised does not retroactively shrink the day before it.
  const yesterday = shiftDayKey(date, -1);
  const yesterdayTotal = habitTotal(habit, yesterday, tasks, entries);
  const yesterdayTarget = habitTargetOn(habit, yesterday);
  const yesterdayPct = habitPercent(yesterdayTotal, yesterdayTarget);
  const status = gaugeStatus(today, target, unit);

  // The streak being celebrated (today's count) while the fire plays.
  const [burst, setBurst] = useState<number | null>(null);
  // Bumped as the celebration lands in the badge, to pop it.
  const [pop, setPop] = useState(0);
  const badgeFireRef = useRef<HTMLSpanElement>(null);
  const prevLit = useRef<boolean | null>(null);
  const lit = streak?.todayDone ?? false;
  const streakDays = streak?.days ?? 0;

  // Today's quota met → the fire, once a day per habit, whether it was met
  // right here or on the calendar while the page was away. Dropping back
  // below the quota here re-arms it, so meeting it again earns the fire again.
  useEffect(() => {
    const was = prevLit.current;
    prevLit.current = lit;
    if (!habit.streak) return;
    if (!lit) {
      if (was) forgetCelebration(habit.id, date);
      return;
    }
    if (wasCelebrated(habit.id, date)) return;
    markCelebrated(habit.id, date);
    setBurst(streakDays);
  }, [habit.id, habit.streak, date, lit, streakDays]);

  const endBurst = useCallback(() => {
    setBurst(null);
    setPop((n) => n + 1);
  }, []);

  return (
    <li
      className={`habit-card${complete ? ' done' : ''}${isDragging ? ' dragging' : ''}${isHistoryOpen ? ' history-open' : ''}`}
      data-habit-id={habit.id}
      draggable
      tabIndex={0}
      onKeyDown={onCardKeyDown}
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
      aria-label={`${habit.name}: ${formatNumber(today)} из ${formatNumber(target)}${unit ? ' ' + unit : ''} сегодня`}
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

      <div className="habit-card-stage">
        {streak && (
          <StreakBadge
            streak={streak}
            days={burst !== null ? Math.max(0, burst - 1) : streak.days}
            lit={burst === null && streak.todayDone}
            warnHours={warnHours}
            unit={unit}
            savedYesterday={frozenDays.has(yesterday)}
            pop={pop}
            flameRef={badgeFireRef}
          />
        )}
        {chart === 'gauge' ? (
          <div key="gauge" className={`habit-card-dial${chartSwitched ? ' habit-card-chart-in' : ''}`}>
            <div className="habit-card-dial-label" aria-hidden>
              Сегодня
            </div>
            <div className="habit-card-dial-arc">
              <HabitGauge
                color={habit.color}
                progress={progress}
                size={260}
                className="habit-gauge-svg"
                ariaLabel={`Сегодня: ${pct}% от цели`}
              />
              <div className="habit-gauge-readout" aria-hidden>
                {status && (
                  <span className={`habit-gauge-pill${status.done ? ' done' : ''}`}>{status.text}</span>
                )}
                <div className="habit-gauge-number">
                  {formatNumber(today)}
                  {unit && <span className="habit-gauge-unit">{unit}</span>}
                </div>
              </div>
            </div>
            <div className="habit-gauge-bars">
              <GaugeBar
                label="Вчера"
                value={`${yesterdayPct}%`}
                fill={yesterdayPct / 100}
                title={`Вчера: ${formatNumber(yesterdayTotal)} / ${formatNumber(yesterdayTarget)}${unit ? ' ' + unit : ''}`}
              />
              <GaugeBar
                label={`${dayStatuses.length} дней`}
                value={`${doneCount} / ${dayStatuses.length}`}
                fill={dayStatuses.length > 0 ? doneCount / dayStatuses.length : 0}
                muted
                title={`Норма выполнена ${doneCount} из ${dayStatuses.length} последних дней`}
              />
            </div>
          </div>
        ) : (
          <div key="dots" className={`habit-card-dial${chartSwitched ? ' habit-card-chart-in' : ''}`}>
            <div className="habit-card-dial-label" aria-hidden>
              Сегодня
            </div>
            <div className="habit-card-dial-arc">
              <HabitDial
                color={habit.color}
                progress={progress}
                total={DIAL_DOTS}
                size={260}
                dot={14}
                className="habit-card-dial-svg"
                ariaLabel={`Сегодня: ${pct}% от цели`}
              />
              <div className="habit-card-dial-readout" aria-hidden>
                <div className="habit-card-dial-number">
                  {pct}
                  <span className="habit-card-dial-percent-sign">%</span>
                </div>
                <div className="habit-card-dial-unit">
                  {formatNumber(today)} / {formatNumber(target)}
                  {unit && <span className="habit-card-dial-unit-label"> {unit}</span>}
                </div>
              </div>
            </div>
            <div className="habit-card-dial-compare" aria-hidden>
              <span className="habit-card-dial-compare-value">{yesterdayPct}%</span> вчера
            </div>
          </div>
        )}
        <ChartSwitch
          className="habit-card-chart-switch"
          label="Вид графика"
          value={chart}
          options={CHART_OPTIONS}
          onChange={(next) => {
            setChartSwitched(true);
            onChartChange(next);
          }}
        />
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
                  className={`habit-card-history-cell${d.ok ? ' ok' : ''}${d.frozen ? ' frozen' : ''}${isToday ? ' today' : ''}`}
                  title={`${d.date}: ${
                    d.ok ? 'выполнено' : d.frozen ? 'не выполнено — серию спасла заморозка' : 'не выполнено'
                  }`}
                >
                  {d.frozen && <IconSnowflake className="habit-card-history-frost" size={9} strokeWidth={2.5} />}
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
          onClick={() => onAdjust(-step)}
          title={`Минус ${stepLabel}`}
          aria-label={`Минус ${stepLabel}`}
        >
          −
        </button>
        <button
          type="button"
          className={`habit-step${typedStep !== null ? ' custom' : ''}`}
          onClick={(e) => {
            e.currentTarget.focus();
            setStepDraft('');
          }}
          title="Набери своё число с клавиатуры"
          aria-label={`Шаг: ${stepLabel}${unit ? ' ' + unit : ''}. Набери своё число с клавиатуры`}
        >
          {stepLabel}
          {unit && <span className="habit-step-unit"> {unit}</span>}
        </button>
        <button
          type="button"
          className="habit-btn"
          onClick={() => onAdjust(step)}
          title={`Плюс ${stepLabel}`}
          aria-label={`Плюс ${stepLabel}`}
        >
          +
        </button>
      </div>

      {burst !== null && <StreakBurst days={burst} target={badgeFireRef} onDone={endBurst} />}
    </li>
  );
}

// One labelled row under the gauge: name on the left, figure on the right,
// a thin bar beneath. The first row is in the habit's colour, the second a
// quiet grey, so the two never read as the same measure.
function GaugeBar({ label, value, fill, muted = false, title }: {
  label: string;
  value: string;
  fill: number;
  muted?: boolean;
  title: string;
}) {
  return (
    <div className={`habit-gauge-bar${muted ? ' muted' : ''}`} title={title}>
      <div className="habit-gauge-bar-head">
        <span>{label}</span>
        <span className="habit-gauge-bar-value">{value}</span>
      </div>
      <div className="habit-gauge-bar-track">
        <div
          className="habit-gauge-bar-fill"
          style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
        />
      </div>
    </div>
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

// Memoized: the dashboard re-renders on every clock tick.
export default memo(HabitGrid);
