import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Habit, RepeatMode, Task, TaskType } from './types';
import { ALL_EMOJIS, EMOJI_DATA, TASK_COLORS, resolveTaskEmoji } from './types';
import { INCREASING_SERIES } from './tasks';
import { DAY_MIN, isDone } from './schedule';

export interface DialogAnchor {
  x: number; // client coordinates of the block the popover belongs to
  y: number;
}

interface TaskDialogProps {
  task: Task;
  isNew: boolean;
  // Where the editor was opened from. Anchored → it floats next to the block on
  // the grid (Google-Calendar style) and the grid keeps showing the block
  // itself; absent → it is a plain centred modal.
  anchor?: DialogAnchor | null;
  // Name of the session the task is glued into, when it is in one.
  sessionName?: string | null;
  onLeaveSession?: () => void;
  // The habits a task can be linked to (see Habit). Completing a linked task
  // grows that habit's daily progress.
  habits?: Habit[];
  // Fires on every edit so the calendar can redraw the block being described.
  onPreview?: (task: Task) => void;
  onSave: (task: Task) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const POP_WIDTH = 380;
const POP_MARGIN = 12;

// Keep the popover inside the window: it opens to the right of the block when
// there is room, and flips to its left when there is not.
function popoverStyle(anchor: DialogAnchor, height: number): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left =
    anchor.x + POP_MARGIN + POP_WIDTH <= vw - POP_MARGIN
      ? anchor.x + POP_MARGIN
      : Math.max(POP_MARGIN, anchor.x - POP_MARGIN - POP_WIDTH);
  const top = Math.max(POP_MARGIN, Math.min(anchor.y - 40, vh - height - POP_MARGIN));
  return { position: 'fixed', left, top, width: POP_WIDTH, maxHeight: vh - 2 * POP_MARGIN };
}

function toTimeInput(startMin: number | null): string {
  const m = Math.max(0, Math.min(DAY_MIN - 1, Math.round(startMin ?? 0)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Minutes typed in the editor → planned seconds. Anything unreadable falls
// back to a minute, which is also the floor.
function minutesToSec(minutes: string): number {
  const parsed = parseFloat(minutes.replace(',', '.'));
  return Math.max(60, Math.round((isFinite(parsed) ? parsed : 1) * 60));
}

function fromTimeInput(value: string, fallback: number): number {
  const [h, m] = value.split(':').map(Number);
  if (!isFinite(h) || !isFinite(m)) return fallback;
  return Math.max(0, Math.min(DAY_MIN - 1, h * 60 + m));
}

// Local wall-clock timestamp ↔ <input type="datetime-local"> string. Seconds
// are kept (not just hh:mm) so re-saving the dialog without touching this
// field never quietly rounds a real finishedAt down to the minute — the
// overtake engine is sensitive to exactly that precision.
function toDatetimeInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fromDatetimeInput(value: string, fallback: number): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : fallback;
}

// Editor for one calendar block: when it runs, how long, what it looks like and
// whether it repeats. Used for both creating (a draft dropped on the grid) and
// editing an existing block.
function TaskDialog({
  task,
  isNew,
  anchor,
  sessionName,
  onLeaveSession,
  habits,
  onPreview,
  onSave,
  onDelete,
  onClose,
}: TaskDialogProps) {
  const [name, setName] = useState(task.name);
  const [day, setDay] = useState(task.day);
  const [time, setTime] = useState(toTimeInput(task.start));
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(task.plannedTime / 60))));
  const [emoji, setEmoji] = useState(task.emoji);
  const [color, setColor] = useState(task.color);
  const [type, setType] = useState<TaskType>(task.type);
  const [habitId, setHabitId] = useState(task.habitId ?? '');
  const [repeatOn, setRepeatOn] = useState(Boolean(task.repeat));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(task.repeat?.mode ?? 'fixed');
  const [repeatBase, setRepeatBase] = useState(String(task.repeat?.baseDays ?? 7));
  // Backdating a completion: a task placed on the calendar (backlog items have
  // no slot to credit against) can be marked done — or have its done moment
  // corrected — at any timestamp, not just "now". This is what lets a task
  // finished earlier but only ticked off later still credit the right day's
  // overtake instead of the moment it happened to be clicked.
  const [done, setDone] = useState(isDone(task));
  const [finishedInput, setFinishedInput] = useState(() =>
    toDatetimeInput(task.finishedAt ?? Date.now())
  );
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (emojiOpen) setEmojiOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emojiOpen, onClose]);

  // Live draft: the grid redraws the block from the fields as they are typed.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const taskRef = useRef(task);
  taskRef.current = task;
  useEffect(() => {
    previewRef.current?.({
      ...taskRef.current,
      name: name.trim(),
      day,
      start: fromTimeInput(time, taskRef.current.start ?? 0),
      plannedTime: minutesToSec(minutes),
      emoji,
      color,
      type,
      habitId: habitId || null,
    });
  }, [name, day, time, minutes, emoji, color, type, habitId]);

  const formRef = useRef<HTMLFormElement>(null);
  const [popHeight, setPopHeight] = useState(0);
  useLayoutEffect(() => {
    if (!anchor) return;
    setPopHeight(formRef.current?.offsetHeight ?? 0);
  }, [anchor, emojiOpen, repeatOn]);

  const emojis = useMemo(() => {
    const q = emojiSearch.trim().toLowerCase();
    if (!q) return ALL_EMOJIS;
    return EMOJI_DATA.filter((e) => e.keywords.some((k) => k.includes(q)) || e.emoji === q).map(
      (e) => e.emoji
    );
  }, [emojiSearch]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // A block dragged out on the grid may be saved without typing a name yet.
    const trimmed = name.trim() || 'Новая задача';
    const plannedTime = minutesToSec(minutes);
    const canTrackDone = task.status !== 'open';
    onSave({
      ...task,
      name: trimmed,
      day,
      start: fromTimeInput(time, task.start ?? 0),
      plannedTime,
      emoji: resolveTaskEmoji(emoji),
      color,
      type,
      habitId: habitId || null,
      repeat: repeatOn
        ? { mode: repeatMode, baseDays: Math.max(1, parseFloat(repeatBase) || 1) }
        : null,
      ...(canTrackDone && done
        ? { status: 'done', finishedAt: fromDatetimeInput(finishedInput, task.finishedAt ?? Date.now()) }
        : canTrackDone
          ? { status: task.status === 'done' ? 'in-progress' : task.status, finishedAt: null, completedAt: null }
          : null),
    });
  };

  const base = Math.max(1, parseFloat(repeatBase) || 1);

  return (
    <div
      className={`cal-modal-backdrop${anchor ? ' cal-modal-backdrop--pop' : ''}`}
      onMouseDown={onClose}
    >
      <form
        ref={formRef}
        className={`cal-modal${anchor ? ' cal-modal--pop' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={
          {
            '--task-color': color,
            ...(anchor ? popoverStyle(anchor, popHeight) : null),
          } as React.CSSProperties
        }
      >
        <header className="cal-modal-head">
          <button
            type="button"
            className="cal-modal-emoji"
            onClick={() => setEmojiOpen((v) => !v)}
            title="Сменить иконку"
          >
            {emoji}
          </button>
          <input
            ref={nameRef}
            className="cal-modal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название задачи"
          />
          <button type="button" className="cal-modal-close" onClick={onClose} title="Закрыть">
            ✕
          </button>
        </header>

        {emojiOpen && (
          <div className="cal-emoji-pop">
            <input
              className="cal-emoji-search"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Поиск иконки…"
              autoFocus
            />
            <div className="cal-emoji-grid">
              {emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`cal-emoji-cell${e === emoji ? ' active' : ''}`}
                  onClick={() => {
                    setEmoji(e);
                    setEmojiOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cal-modal-row">
          <label className="cal-field">
            <span>Дата</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="cal-field">
            <span>Начало</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} />
          </label>
          <label className="cal-field cal-field--sm">
            <span>Минут</span>
            <input
              type="number"
              min={1}
              // `step` here is only the arrow increment: a fixed step would make
              // the browser reject every duration that is not min + k·step
              // ("введите допустимое значение") — 60 among them.
              step="any"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
        </div>

        <div className="cal-modal-row">
          <div className="cal-field cal-field--grow">
            <span>Цвет</span>
            <div className="cal-colors">
              {TASK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`cal-color${c === color ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div className="cal-field">
            <span>Тип</span>
            <div className="cal-seg">
              <button
                type="button"
                className={type === 'task' ? 'active' : ''}
                onClick={() => setType('task')}
              >
                🎯 Задача
              </button>
              <button
                type="button"
                className={type === 'rest' ? 'active' : ''}
                onClick={() => setType('rest')}
              >
                ☕ Отдых
              </button>
            </div>
          </div>
        </div>

        {habits && habits.length > 0 && (
          <div className="cal-modal-row">
            <label className="cal-field cal-field--grow">
              <span>Привычка</span>
              <select value={habitId} onChange={(e) => setHabitId(e.target.value)}>
                <option value="">— без привычки —</option>
                {habits.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.emoji} {h.name} · {h.format === 'time' ? '⏱' : '🔢'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {task.status !== 'open' && (
          <div className="cal-modal-row cal-modal-row--done">
            <label className="cal-check">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
              <span>✓ Выполнено</span>
            </label>
            {done && (
              <label className="cal-field cal-field--grow">
                <span>Когда закрыта</span>
                <input
                  type="datetime-local"
                  step={1}
                  value={finishedInput}
                  onChange={(e) => setFinishedInput(e.target.value)}
                />
              </label>
            )}
          </div>
        )}

        <div className="cal-modal-row cal-modal-row--repeat">
          <label className="cal-check">
            <input
              type="checkbox"
              checked={repeatOn}
              onChange={(e) => setRepeatOn(e.target.checked)}
            />
            <span>Повторять</span>
          </label>
          {repeatOn && (
            <>
              <div className="cal-seg">
                <button
                  type="button"
                  className={repeatMode === 'fixed' ? 'active' : ''}
                  onClick={() => setRepeatMode('fixed')}
                >
                  Каждые N дней
                </button>
                <button
                  type="button"
                  className={repeatMode === 'increasing' ? 'active' : ''}
                  onClick={() => setRepeatMode('increasing')}
                >
                  Интервальное
                </button>
              </div>
              <label className="cal-field cal-field--sm">
                <span>База, дн.</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={repeatBase}
                  onChange={(e) => setRepeatBase(e.target.value)}
                />
              </label>
              <span className="cal-repeat-hint">
                {repeatMode === 'fixed'
                  ? `каждые ${base} дн.`
                  : INCREASING_SERIES.map((s) => s * base).join(' → ') + ' дн.'}
              </span>
            </>
          )}
        </div>

        {sessionName !== undefined && sessionName !== null && (
          <div className="cal-modal-session">
            <span>🔗 В сессии «{sessionName}»</span>
            {onLeaveSession && (
              <button type="button" className="cal-btn cal-btn--icon" onClick={onLeaveSession}>
                ✂ Выйти
              </button>
            )}
          </div>
        )}

        <footer className="cal-modal-foot">
          {onDelete && (
            <button type="button" className="cal-btn cal-btn--danger" onClick={onDelete}>
              🗑 Удалить
            </button>
          )}
          <span className="cal-modal-spacer" />
          <button type="button" className="cal-btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="cal-btn cal-btn--primary">
            {isNew ? 'Создать' : 'Сохранить'}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default TaskDialog;
