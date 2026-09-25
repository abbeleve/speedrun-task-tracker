import { useEffect, useMemo, useRef, useState } from 'react';
import type { Habit, HabitFormat, HabitTarget } from './types';
import {
  EMOJI_CATEGORY_ICONS,
  TASK_COLORS,
  groupedEmojis,
  resolveTaskEmoji,
} from './types';
import { defaultUnit, habitTargets, newHabitId, setHabitTarget } from './habits';
import { todayKey } from './history';

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
// done day. Creating and editing share the same form. The quota is versioned:
// a changed quota starts from a chosen day (today unless told otherwise), and
// the days before it keep the quota they were done against.
function HabitDialog({ habit, nextOrder = 0, onSave, onDelete, onClose }: HabitDialogProps) {
  const today = todayKey();
  const history = habit ? habitTargets(habit) : [];
  const latest = history.at(-1);
  const [name, setName] = useState(habit?.name ?? '');
  const [emoji, setEmoji] = useState(habit?.emoji ?? '🎯');
  const [color, setColor] = useState(habit?.color ?? TASK_COLORS[0]);
  const [format, setFormat] = useState<HabitFormat>(habit?.format ?? 'count');
  const [target, setTarget] = useState(
    latest ? String(latest.target) : format === 'time' ? '300' : '10'
  );
  // The day a changed quota starts. An already planned future quota is edited
  // in place, so the default is that plan's own day rather than today.
  const [since, setSince] = useState(
    latest && latest.since > today ? latest.since : today
  );
  const [wholeHistory, setWholeHistory] = useState(false);
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

  const parsed = parseFloat(target.replace(',', '.'));
  const typedTarget = isFinite(parsed) && parsed > 0 ? parsed : null;
  const targetChanged = !!latest && typedTarget !== null && typedTarget !== latest.target;
  // The quota history this save would write — also shown as a preview, so the
  // user sees which days the change reaches before committing to it.
  const nextTargets: HabitTarget[] = !latest
    ? [{ since: '', target: typedTarget ?? 1 }]
    : targetChanged
      ? setHabitTarget(history, typedTarget, wholeHistory ? '' : since || today)
      : history;
  const unitLabel = unit.trim() || defaultUnit(format);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({
      id: habit?.id ?? newHabitId(),
      name: trimmed,
      emoji: resolveTaskEmoji(emoji),
      color,
      format,
      target: nextTargets[nextTargets.length - 1].target,
      targets: nextTargets,
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

        {targetChanged && (
          <div className="cal-modal-row">
            <div className="cal-field cal-field--grow">
              <span>Новая цель действует</span>
              <div className="hab-since">
                <div className="cal-seg">
                  <button
                    type="button"
                    className={wholeHistory ? '' : 'active'}
                    onClick={() => setWholeHistory(false)}
                  >
                    📅 С даты
                  </button>
                  <button
                    type="button"
                    className={wholeHistory ? 'active' : ''}
                    onClick={() => setWholeHistory(true)}
                  >
                    ♾ Всю историю
                  </button>
                </div>
                {wholeHistory ? (
                  <span className="cal-repeat-hint">Прошлые дни пересчитаются по новой цели</span>
                ) : (
                  <input
                    type="date"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    aria-label="Дата, с которой действует новая цель"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {nextTargets.length > 1 && (
          <div className="cal-field">
            <span>История цели</span>
            <ol className="hab-targets">
              {nextTargets.map((v, i) => {
                const next = nextTargets[i + 1];
                const planned = v.since > today;
                const current = !planned && (!next || next.since > today);
                return (
                  <li
                    key={v.since}
                    className={`hab-target${current ? ' current' : ''}${planned ? ' planned' : ''}`}
                  >
                    <span className="hab-target-since">
                      {i === 0 ? 'с начала' : `с ${formatSince(v.since, today)}`}
                    </span>
                    <span className="hab-target-value">
                      {v.target}
                      {unitLabel && ` ${unitLabel}`}
                    </span>
                    {current && <em>сейчас</em>}
                    {planned && <em>запланировано</em>}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

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

// '2026-09-25' → '25 сентября', with the year only when it is not this one.
function formatSince(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export default HabitDialog;
