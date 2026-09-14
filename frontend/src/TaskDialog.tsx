import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepeatMode, Task, TaskType } from './types';
import { ALL_EMOJIS, EMOJI_DATA, TASK_COLORS, resolveTaskEmoji } from './types';
import { INCREASING_SERIES } from './tasks';
import { DAY_MIN } from './schedule';

interface TaskDialogProps {
  task: Task;
  isNew: boolean;
  onSave: (task: Task) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function toTimeInput(startMin: number | null): string {
  const m = Math.max(0, Math.min(DAY_MIN - 1, Math.round(startMin ?? 0)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fromTimeInput(value: string, fallback: number): number {
  const [h, m] = value.split(':').map(Number);
  if (!isFinite(h) || !isFinite(m)) return fallback;
  return Math.max(0, Math.min(DAY_MIN - 1, h * 60 + m));
}

// Editor for one calendar block: when it runs, how long, what it looks like and
// whether it repeats. Used for both creating (a draft dropped on the grid) and
// editing an existing block.
function TaskDialog({ task, isNew, onSave, onDelete, onClose }: TaskDialogProps) {
  const [name, setName] = useState(task.name);
  const [day, setDay] = useState(task.day);
  const [time, setTime] = useState(toTimeInput(task.start));
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(task.plannedTime / 60))));
  const [emoji, setEmoji] = useState(task.emoji);
  const [color, setColor] = useState(task.color);
  const [type, setType] = useState<TaskType>(task.type);
  const [repeatOn, setRepeatOn] = useState(Boolean(task.repeat));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(task.repeat?.mode ?? 'fixed');
  const [repeatBase, setRepeatBase] = useState(String(task.repeat?.baseDays ?? 7));
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
    const plannedTime = Math.max(60, Math.round(parseFloat(minutes) * 60) || 60);
    onSave({
      ...task,
      name: trimmed,
      day,
      start: fromTimeInput(time, task.start ?? 0),
      plannedTime,
      emoji: resolveTaskEmoji(emoji),
      color,
      type,
      repeat: repeatOn
        ? { mode: repeatMode, baseDays: Math.max(1, parseFloat(repeatBase) || 1) }
        : null,
    });
  };

  const base = Math.max(1, parseFloat(repeatBase) || 1);

  return (
    <div className="cal-modal-backdrop" onMouseDown={onClose}>
      <form
        className="cal-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ '--task-color': color } as React.CSSProperties}
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
              step={5}
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
