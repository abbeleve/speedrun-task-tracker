import { useMemo, useRef, useState } from 'react';
import type { Deadline, Habit, Task } from './types';
import type { BacklogSlot } from './backlog';
import {
  BACKLOG_WIDTH_DEFAULT,
  BACKLOG_WIDTH_MAX,
  BACKLOG_WIDTH_MIN,
  backlogDayLabel,
  backlogSlot,
  backlogTargetDay,
  clampBacklogWidth,
  groupBacklog,
  matchesBacklogQuery,
  pluralTasks,
} from './backlog';
import { deadlineLabel, deadlineShortLabel, deadlineState } from './deadlines';
import { compactDur } from './format';
import { shiftDayKey } from './history';
import { isReminder, isScheduled } from './schedule';
import { describeRepeat } from './tasks';
import { taskColorAnimationClass, taskColorStyle } from './taskAppearance';
import { IconCalendarCheck, IconClock, IconFlag, IconSearch } from './icons';

interface BacklogTasksProps {
  tasks: Task[]; // the open tasks
  plan: Task[]; // every task there is — where the free slots are found
  now: number;
  today: string;
  habits: Habit[];
  deadlineById: Map<string, Deadline>;
  // Deadlines whose linked blocks are planned past the due moment.
  latePlans: Set<string>;
  onOpen: (task: Task, event: React.MouseEvent) => void;
  onSaveTemplate: (task: Task) => void;
  onPlace: (task: Task, slot: BacklogSlot) => void;
  onMoveToToday: (tasks: Task[]) => void;
  onShowDay: (day: string) => void;
  onOpenDeadline: (deadline: Deadline) => void;
}

function hhmm(min: number): string {
  const m = Math.round(min) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
}

// The backlog's «Задачи» tab: a search over the open tasks, the tasks grouped
// by the day they are planned for, and a card per task that says all there is
// to know about it — the whole name, the start of its notes, its length,
// repeat, habit and deadline — with «В план» to put it in the first free slot
// of its day without dragging.
function BacklogTasks({
  tasks,
  plan,
  now,
  today,
  habits,
  deadlineById,
  latePlans,
  onOpen,
  onSaveTemplate,
  onPlace,
  onMoveToToday,
  onShowDay,
  onOpenDeadline,
}: BacklogTasksProps) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => tasks.filter((task) => matchesBacklogQuery(task, query)), [tasks, query]);
  const groups = useMemo(() => groupBacklog(shown, today), [shown, today]);
  const habitById = useMemo(() => new Map(habits.map((habit) => [habit.id, habit])), [habits]);
  // The blocks on the calendar, by day: a card only has to look at its own
  // day and the one before it to find a free slot, not at the whole history.
  const blocksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of plan) {
      if (!isScheduled(task) || isReminder(task)) continue;
      map.set(task.day, [...(map.get(task.day) ?? []), task]);
    }
    return map;
  }, [plan]);

  const slotFor = (task: Task): BacklogSlot | null => {
    const day = backlogTargetDay(task, today);
    const nearby = [...(blocksByDay.get(day) ?? []), ...(blocksByDay.get(shiftDayKey(day, -1)) ?? [])];
    return backlogSlot(task, nearby, now);
  };

  const card = (task: Task, showDay: boolean) => {
    const habit = task.habitId ? habitById.get(task.habitId) : undefined;
    const deadline = task.deadlineId ? deadlineById.get(task.deadlineId) : undefined;
    const slot = task.pinned ? null : slotFor(task);
    const repeat = task.repeat ? describeRepeat(task.repeat) : null;
    let deadlineChip = null;
    if (deadline) {
      const state =
        latePlans.has(deadline.id) && deadline.completedAt === null
          ? 'plan-late'
          : deadlineState(deadline, now);
      const when = deadlineShortLabel(deadline, task.day);
      const status =
        state === 'done'
          ? 'закрыт'
          : state === 'overdue'
            ? 'просрочен'
            : state === 'plan-late'
              ? 'план выходит за срок'
              : 'открыт';
      const label = `Дедлайн «${deadline.name}» · ${deadlineLabel(deadline)} · ${status}`;
      deadlineChip = (
        <button
          type="button"
          className={`cal-backlog-chip cal-backlog-deadline ${state}`}
          title={label}
          aria-label={label}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onOpenDeadline(deadline); }}
        >
          <IconFlag size={12} />
          <span className="cal-backlog-chip-text">{deadline.name}{when && ` · ${when}`}</span>
        </button>
      );
    }
    const placeTitle = slot
      ? `В план: ${backlogDayLabel(slot.day, today)}, ${hhmm(slot.start)}–${hhmm(slot.start + task.plannedTime / 60)}`
      : 'До полуночи этого дня свободного окна нет';

    return (
      <div
        key={task.id}
        className={`cal-backlog-card cal-backlog-card--${task.type}${task.pinned ? ' pinned' : ''}`}
        style={taskColorStyle(task.color, task.colorAnimation) as React.CSSProperties}
        draggable={!task.pinned}
        onDragStart={(e) => {
          if (task.pinned) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', task.id);
        }}
        onClick={(e) => onOpen(task, e)}
      >
        <span className={`cal-backlog-card-emoji ${taskColorAnimationClass(task.colorAnimation)}`}>
          {task.emoji}
        </span>
        <div className="cal-backlog-card-body">
          <span className="cal-backlog-card-name">{task.name || 'Без названия'}</span>
          {task.description && (
            <p className="cal-backlog-card-desc" title={task.description}>{task.description}</p>
          )}
          <div className="cal-backlog-card-meta">
            <span className="cal-backlog-chip" title="Длительность">
              <IconClock size={12} />{compactDur(task.plannedTime)}
            </span>
            {showDay && (
              <span className={`cal-backlog-chip cal-backlog-chip--day${task.day < today ? ' overdue' : ''}`} title={`Запланировано на ${task.day}`}>
                {backlogDayLabel(task.day, today)}
              </span>
            )}
            {task.type === 'rest' && <span className="cal-backlog-chip">☕ отдых</span>}
            {task.type === 'reminder' && <span className="cal-backlog-chip">🔔 напоминание</span>}
            {repeat && (
              <span className="cal-backlog-chip" title={`Повтор: ${repeat}`}>
                🔁 <span className="cal-backlog-chip-text">{repeat}</span>
              </span>
            )}
            {habit && (
              <span className="cal-backlog-chip" title={`Привычка «${habit.name}»`}>
                {habit.emoji} <span className="cal-backlog-chip-text">{habit.name}</span>
              </span>
            )}
            {deadlineChip}
            {task.pinned && (
              <span className="cal-backlog-chip" title="Закреплено: сними флажок в редакторе, чтобы перенести">
                📌 закреплено
              </span>
            )}
          </div>
        </div>
        <div className="cal-backlog-card-actions">
          {!task.pinned && (
            <button
              type="button"
              className="cal-backlog-act cal-backlog-act--place"
              disabled={!slot}
              title={placeTitle}
              aria-label={`«${task.name}» — ${placeTitle}`}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => {
                e.stopPropagation();
                if (slot) onPlace(task, slot);
              }}
            >
              <IconCalendarCheck size={16} />
            </button>
          )}
          <button
            type="button"
            className="cal-backlog-act cal-backlog-save-template"
            title="Сохранить как шаблон"
            aria-label={`Сохранить «${task.name}» как шаблон`}
            onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onSaveTemplate(task); }}
          >
            ☆
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {tasks.length > 0 && (
        <label className="cal-backlog-search">
          <IconSearch size={15} />
          <input
            type="search"
            value={query}
            placeholder="Найти в бэклоге"
            aria-label="Найти в бэклоге"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </label>
      )}
      <div className="cal-backlog-list" role="tabpanel">
        {groups.map((group) => {
          const movable = group.tasks.filter((task) => !task.pinned);
          const label =
            group.kind === 'overdue'
              ? 'Просрочено'
              : group.kind === 'later'
                ? 'Позже'
                : capitalized(backlogDayLabel(group.day!, today));
          return (
            <section key={group.key} className={`cal-backlog-group cal-backlog-group--${group.kind}`} aria-label={label}>
              <header className="cal-backlog-group-head">
                {group.day ? (
                  <button
                    type="button"
                    className="cal-backlog-group-label"
                    title="Показать этот день в календаре"
                    onClick={() => onShowDay(group.day!)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="cal-backlog-group-label">{label}</span>
                )}
                <span className="cal-backlog-group-sum">
                  {group.tasks.length} {pluralTasks(group.tasks.length)}
                  {group.totalSec > 0 && ` · ${compactDur(group.totalSec)}`}
                </span>
                {group.kind === 'overdue' && movable.length > 0 && (
                  <button
                    type="button"
                    className="cal-backlog-group-action"
                    title="Перенести эти задачи на сегодня — в бэклоге, без времени"
                    onClick={() => onMoveToToday(movable)}
                  >
                    На сегодня
                  </button>
                )}
              </header>
              {group.tasks.map((task) => card(task, group.kind !== 'day'))}
            </section>
          );
        })}
        {tasks.length === 0 && (
          <p className="cal-backlog-empty">
            Бэклог пуст. Нажми ＋, чтобы добавить задачу, или перетащи сюда блок с сетки.
          </p>
        )}
        {tasks.length > 0 && shown.length === 0 && (
          <p className="cal-backlog-empty">Ничего не нашлось по «{query.trim()}»</p>
        )}
      </div>
      <details className="cal-backlog-help">
        <summary>Как планировать</summary>
        <ul className="cal-backlog-hint cal-backlog-hint--mouse">
          <li>Перетащи карточку на сетку, чтобы поставить время, или нажми на ней <IconCalendarCheck size={12} /> — задача встанет в первое свободное окно своего дня.</li>
          <li>Перетащи блок с сетки сюда — вернуть в бэклог.</li>
          <li>Зажми ЛКМ на пустом месте сетки на секунду и веди — выделишь пачку блоков. С Ctrl веди сразу, без ожидания — хоть с пустого места, хоть с блока. Рамка выделяет только задетые блоки внутри одного дня — параллельные можно выбрать по отдельности.</li>
          <li>Ctrl + клик по блоку — добавить его в пачку или убрать.</li>
          <li>Зажми C и кликни по блоку — разрежешь его на две части в этом месте; у красной линии «сейчас» разрез прилипает к текущему времени.</li>
        </ul>
        <ul className="cal-backlog-hint cal-backlog-hint--touch">
          <li>Нажми <IconCalendarCheck size={12} /> на карточке — задача встанет в первое свободное окно своего дня. Или открой карточку и выбери «В календарь», чтобы задать время самому.</li>
          <li>Удерживай блок на сетке, чтобы перетащить его — в том числе сюда, обратно в бэклог.</li>
        </ul>
      </details>
    </>
  );
}

// The rail's left edge: drag it (or focus it and press ← / →) to make the
// backlog wider or narrower; a double click puts it back.
export function BacklogResizer({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="cal-backlog-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина бэклога"
      aria-valuemin={BACKLOG_WIDTH_MIN}
      aria-valuemax={BACKLOG_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Потяни, чтобы изменить ширину бэклога. Двойной клик — как было"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        // The rail sits on the right, so pulling its edge left widens it.
        if (drag.current) onWidth(clampBacklogWidth(drag.current.width + drag.current.x - e.clientX));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => onWidth(BACKLOG_WIDTH_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onWidth(clampBacklogWidth(width + step));
        else if (e.key === 'ArrowRight') onWidth(clampBacklogWidth(width - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}

export default BacklogTasks;
