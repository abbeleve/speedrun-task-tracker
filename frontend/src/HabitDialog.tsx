import { useEffect, useMemo, useRef, useState } from 'react';
import type { Habit, HabitFormat } from './types';
import {
  EMOJI_CATEGORY_ICONS,
  TASK_COLORS,
  groupedEmojis,
  resolveTaskEmoji,
} from './types';
import { defaultUnit, newHabitId } from './habits';

interface HabitDialogProps {
  // The habit being edited, or null to create a new one.
  habit?: Habit | null;
  // Highest `order` currently in the grid, so a new habit lands last.
  nextOrder?: number;
  onSave: (habit: Habit) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

// Editor for one habit: what it is, how it is counted and how much counts as a
// done day. Creating and editing share the same form.
function HabitDialog({ habit, nextOrder = 0, onSave, onDelete, onClose }: HabitDialogProps) {
  const [name, setName] = useState(habit?.name ?? '');
  const [emoji, setEmoji] = useState(habit?.emoji ?? '🎯');
  const [color, setColor] = useState(habit?.color ?? TASK_COLORS[0]);
  const [format, setFormat] = useState<HabitFormat>(habit?.format ?? 'count');
  const [target, setTarget] = useState(
    habit ? String(habit.target) : format === 'time' ? '300' : '10'
  );
  const [unit, setUnit] = useState(habit?.unit ?? defaultUnit(habit?.format ?? 'count'));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // When the format flips, nudge the unit label and the default target so the
  // two stay coherent (count : 'раз', time : 'мин').
  useEffect(() => {
    setUnit((u) => (u && u.length > 0 ? u : defaultUnit(format)));
  }, [format]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (emojiOpen) setEmojiOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emojiOpen, onClose]);

  const emojiGroups = useMemo(() => groupedEmojis(emojiSearch), [emojiSearch]);
  const emojiGridRef = useRef<HTMLDivElement>(null);
  const scrollToCategory = (category: string) => {
    const grid = emojiGridRef.current;
    const header = grid?.querySelector(`[data-category="${CSS.escape(category)}"]`);
    header?.scrollIntoView({ block: 'start' });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsedTarget = parseFloat(target.replace(',', '.'));
    onSave({
      id: habit?.id ?? newHabitId(),
      name: trimmed,
      emoji: resolveTaskEmoji(emoji),
      color,
      format,
      target: isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1,
      unit: unit.trim(),
      order: habit?.order ?? nextOrder,
    });
  };

  return (
    <div className="cal-modal-backdrop" onMouseDown={onClose}>
      <form
        className="cal-modal hab-modal"
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
            placeholder="Название привычки"
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
            {!emojiSearch.trim() && (
              <div className="cal-emoji-tabs">
                {emojiGroups.map((g) => (
                  <button
                    key={g.category}
                    type="button"
                    className="cal-emoji-tab"
                    title={g.category}
                    onClick={() => scrollToCategory(g.category)}
                  >
                    {EMOJI_CATEGORY_ICONS[g.category]}
                  </button>
                ))}
              </div>
            )}
            <div className="cal-emoji-grid" ref={emojiGridRef}>
              {emojiGroups.map((g) => (
                <div key={g.category} className="cal-emoji-group">
                  <div className="cal-emoji-cat" data-category={g.category}>
                    {g.category}
                  </div>
                  {g.emojis.map((e) => (
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
              ))}
            </div>
          </div>
        )}

        <div className="cal-modal-row">
          <label className="cal-field cal-field--grow">
            <span>Формат</span>
            <div className="cal-seg">
              <button
                type="button"
                className={format === 'count' ? 'active' : ''}
                onClick={() => setFormat('count')}
              >
                🔢 Числовой
              </button>
              <button
                type="button"
                className={format === 'time' ? 'active' : ''}
                onClick={() => setFormat('time')}
              >
                ⏱ Временной
              </button>
            </div>
          </label>
        </div>

        <div className="cal-modal-row">
          <label className="cal-field cal-field--sm cal-field--grow">
            <span>{format === 'time' ? 'Цель в день, мин' : 'Цель в день'}</span>
            <input
              type="number"
              min={1}
              step="any"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <label className="cal-field cal-field--sm">
            <span>Ед. изм.</span>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={format === 'time' ? 'мин' : 'раз'}
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
        </div>

        <footer className="cal-modal-foot">
          {onDelete && (
            <button
              type="button"
              className="cal-btn cal-btn--danger"
              onClick={() => onDelete(habit!.id)}
            >
              🗑 Удалить
            </button>
          )}
          <span className="cal-modal-spacer" />
          <button type="button" className="cal-btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="cal-btn cal-btn--primary" disabled={!name.trim()}>
            {habit ? 'Сохранить' : 'Создать'}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default HabitDialog;
