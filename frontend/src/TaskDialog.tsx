import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  Habit,
  RepeatMode,
  Task,
  TaskColorAnimation,
  TaskType,
} from './types';
import {
  EMOJI_CATEGORY_ICONS,
  TASK_COLORS,
  groupedEmojis,
  resolveTaskEmoji,
} from './types';
import { INCREASING_SERIES } from './tasks';
import { DAY_MIN, isDone } from './schedule';
import { loadColorPresets as loadSavedColorPresets, saveColorPresets as saveSavedColorPresets } from './api';
import type { ColorPreset } from './colorPresets';
import {
  clearLegacyColorPresets,
  loadLegacyColorPresets,
  moveColorPreset,
  newColorPresetId,
  normalizeColorPresets,
} from './colorPresets';
import {
  DEFAULT_FLOW_COLORS,
  DEFAULT_FLOW_DURATION_SEC,
  taskColorAnimationClass,
  taskColorStyle,
} from './taskAppearance';

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
  onDuplicate?: () => void;
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
  onDuplicate,
  onClose,
}: TaskDialogProps) {
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? '');
  const [day, setDay] = useState(task.day);
  const [time, setTime] = useState(toTimeInput(task.start));
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(task.plannedTime / 60))));
  const [emoji, setEmoji] = useState(task.emoji);
  const [color, setColor] = useState(task.color);
  const [colorPresets, setColorPresets] = useState<ColorPreset[]>([]);
  const colorPresetsRef = useRef<ColorPreset[]>([]);
  const [colorPresetsReady, setColorPresetsReady] = useState(false);
  const [colorPresetsError, setColorPresetsError] = useState<'load' | 'save' | null>(null);
  const [colorPresetsLoadAttempt, setColorPresetsLoadAttempt] = useState(0);
  const [draftPresetNames, setDraftPresetNames] = useState<Record<string, string>>({});
  const colorPresetSaveRevision = useRef(0);
  const colorPresetMounted = useRef(true);
  const [colorEditorOpen, setColorEditorOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetColor, setNewPresetColor] = useState(task.color);
  const initialFlow = task.colorAnimation?.type === 'flow' ? task.colorAnimation : null;
  const [flowOn, setFlowOn] = useState(Boolean(initialFlow));
  const [flowColors, setFlowColors] = useState<string[]>(
    initialFlow?.colors ?? [task.color, ...DEFAULT_FLOW_COLORS.slice(1)]
  );
  const [flowDirection, setFlowDirection] = useState(initialFlow?.direction ?? 0);
  const [flowDurationSec, setFlowDurationSec] = useState(
    initialFlow?.durationSec ?? DEFAULT_FLOW_DURATION_SEC
  );
  const [type, setType] = useState<TaskType>(task.type);
  const [habitId, setHabitId] = useState(task.habitId ?? '');
  const [repeatOn, setRepeatOn] = useState(Boolean(task.repeat));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(task.repeat?.mode ?? 'fixed');
  const [repeatBase, setRepeatBase] = useState(String(task.repeat?.baseDays ?? 7));
  const [pinned, setPinned] = useState(task.pinned ?? false);
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
  const colorAnimation = useMemo<TaskColorAnimation | null>(
    () =>
      flowOn
        ? {
            type: 'flow',
            colors: flowColors,
            direction: flowDirection,
            durationSec: flowDurationSec,
          }
        : null,
    [flowOn, flowColors, flowDirection, flowDurationSec]
  );

  const nameRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    colorPresetMounted.current = true;
    return () => { colorPresetMounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await loadSavedColorPresets();
        if (!active) return;
        if (saved === null) {
          const legacy = loadLegacyColorPresets();
          await saveSavedColorPresets(legacy);
          if (!active) return;
          colorPresetsRef.current = legacy;
          setColorPresets(legacy);
        } else {
          const valid = normalizeColorPresets(saved);
          colorPresetsRef.current = valid;
          setColorPresets(valid);
        }
        clearLegacyColorPresets();
        setColorPresetsReady(true);
        setColorPresetsError(null);
      } catch {
        if (active) setColorPresetsError('load');
      }
    })();
    return () => { active = false; };
  }, [colorPresetsLoadAttempt]);

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
      description: description.trim() || null,
      day,
      start: fromTimeInput(time, taskRef.current.start ?? 0),
      plannedTime: minutesToSec(minutes),
      emoji,
      color,
      colorAnimation,
      type,
      habitId: habitId || null,
      pinned,
    });
  }, [name, description, day, time, minutes, emoji, color, colorAnimation, type, habitId, pinned]);

  const formRef = useRef<HTMLFormElement>(null);
  const [popHeight, setPopHeight] = useState(0);
  useLayoutEffect(() => {
    if (!anchor) return;
    setPopHeight(formRef.current?.offsetHeight ?? 0);
  }, [
    anchor,
    emojiOpen,
    repeatOn,
    colorEditorOpen,
    colorPresets.length,
    flowOn,
    flowColors.length,
  ]);

  const emojiGroups = useMemo(() => groupedEmojis(emojiSearch), [emojiSearch]);
  const commitColorPresets = (next: ColorPreset[]) => {
    const valid = normalizeColorPresets(next);
    colorPresetsRef.current = valid;
    setColorPresets(valid);
    setColorPresetsError(null);
    const revision = ++colorPresetSaveRevision.current;
    void saveSavedColorPresets(valid).then(
      () => {
        if (colorPresetMounted.current && revision === colorPresetSaveRevision.current) {
          setColorPresetsError(null);
        }
      },
      () => {
        if (colorPresetMounted.current && revision === colorPresetSaveRevision.current) {
          setColorPresetsError('save');
        }
      }
    );
  };
  const patchColorPreset = (id: string, patch: Partial<ColorPreset>) => {
    commitColorPresets(colorPresetsRef.current.map((preset) => (
      preset.id === id ? { ...preset, ...patch } : preset
    )));
  };
  const removeColorPreset = (id: string) => {
    commitColorPresets(colorPresetsRef.current.filter((preset) => preset.id !== id));
  };
  const reorderColorPreset = (index: number, offset: -1 | 1) => {
    commitColorPresets(moveColorPreset(colorPresetsRef.current, index, offset));
  };
  const retryColorPresets = () => {
    if (!colorPresetsReady) {
      setColorPresetsError(null);
      setColorPresetsLoadAttempt((attempt) => attempt + 1);
    } else {
      commitColorPresets(colorPresetsRef.current);
    }
  };
  const addColorPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: ColorPreset = {
      id: newColorPresetId(),
      name,
      color: newPresetColor.toLowerCase(),
    };
    commitColorPresets([...colorPresetsRef.current, preset]);
    setColor(preset.color);
    setNewPresetName('');
  };
  const emojiGridRef = useRef<HTMLDivElement>(null);
  const scrollToCategory = (category: string) => {
    const grid = emojiGridRef.current;
    const header = grid?.querySelector(`[data-category="${CSS.escape(category)}"]`);
    header?.scrollIntoView({ block: 'start' });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // A block dragged out on the grid may be saved without typing a name yet.
    const trimmed = name.trim() || 'Новая задача';
    const plannedTime = minutesToSec(minutes);
    const isReminder = type === 'reminder';
    // A reminder is never "performed" as a task — no matter what the checkbox
    // (hidden for this type) last held, it can never come out of this save done.
    const canTrackDone = task.status !== 'open' && !isReminder;
    onSave({
      ...task,
      name: trimmed,
      description: description.trim() || null,
      day,
      start: fromTimeInput(time, task.start ?? 0),
      plannedTime,
      emoji: resolveTaskEmoji(emoji),
      color,
      colorAnimation,
      type,
      pinned,
      habitId: isReminder ? null : habitId || null,
      repeat: repeatOn
        ? { mode: repeatMode, baseDays: Math.max(1, parseFloat(repeatBase) || 1) }
        : null,
      ...(isReminder
        ? { status: task.status === 'open' ? 'open' : 'in-progress', finishedAt: null, completedAt: null }
        : canTrackDone && done
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

        <label className="cal-field cal-field--grow">
          <span>Описание</span>
          <textarea
            className="cal-modal-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Подробности задачи…"
            rows={3}
          />
        </label>

        <div className="cal-modal-row">
          <label className="cal-field">
            <span>Дата</span>
            <input
              type="date"
              value={day}
              disabled={pinned}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label className="cal-field">
            <span>Начало</span>
            <input
              type="time"
              value={time}
              disabled={pinned}
              onChange={(e) => setTime(e.target.value)}
              step={300}
            />
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
          <label className="cal-check">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            <span>📌 Закрепить на месте</span>
          </label>
          <span className="cal-repeat-hint">
            Закреплённую задачу нельзя перенести, пока флажок не снят
          </span>
        </div>

        <div className="cal-modal-row">
          <div className="cal-field cal-field--grow">
            <span>Цвет</span>
            <div className="cal-color-preset-bar">
              <div className="cal-color-preset-chips">
                {!colorPresetsReady && !colorPresetsError && (
                  <span className="cal-color-preset-empty">Загрузка пресетов…</span>
                )}
                {colorPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`cal-color-preset-chip${preset.color === color ? ' active' : ''}`}
                    style={{ '--sw': preset.color } as React.CSSProperties}
                    onClick={() => setColor(preset.color)}
                    title={`${preset.name}: ${preset.color}`}
                  >
                    <span className="cal-color-preset-dot" />
                    <span>{preset.name}</span>
                  </button>
                ))}
                {colorPresetsReady && colorPresets.length === 0 && (
                  <span className="cal-color-preset-empty">Назовите цвета, чтобы быстро выбирать их по смыслу</span>
                )}
              </div>
              <button
                type="button"
                className={`cal-color-preset-edit${colorEditorOpen ? ' active' : ''}`}
                onClick={() => setColorEditorOpen((open) => !open)}
                disabled={!colorPresetsReady}
                title={colorEditorOpen ? 'Закрыть редактор пресетов' : 'Создать или изменить цветовые пресеты'}
                aria-pressed={colorEditorOpen}
              >
                ✎
              </button>
            </div>

            {colorPresetsError && (
              <div className="cal-color-preset-error" role="alert">
                {colorPresetsError === 'load'
                  ? 'Не удалось загрузить цветовые пресеты.'
                  : 'Цветовые пресеты не сохранены.'}
                <button type="button" onClick={retryColorPresets}>Повторить</button>
              </div>
            )}

            {colorEditorOpen && (
              <div className="cal-color-preset-editor">
                {colorPresets.map((preset, index) => (
                  <div className="cal-color-preset-row" key={preset.id}>
                    <input
                      type="color"
                      value={preset.color}
                      aria-label={`Цвет пресета ${preset.name}`}
                      onChange={(e) => {
                        const nextColor = e.target.value.toLowerCase();
                        const wasSelected = preset.color === color;
                        patchColorPreset(preset.id, { color: nextColor });
                        if (wasSelected) setColor(nextColor);
                      }}
                    />
                    <input
                      type="text"
                      value={draftPresetNames[preset.id] ?? preset.name}
                      maxLength={40}
                      aria-label="Название цветового пресета"
                      onChange={(e) => setDraftPresetNames((names) => ({
                        ...names, [preset.id]: e.target.value,
                      }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== preset.name) patchColorPreset(preset.id, { name });
                        setDraftPresetNames((names) => {
                          const next = { ...names };
                          delete next[preset.id];
                          return next;
                        });
                      }}
                    />
                    <div className="cal-color-preset-order">
                      <button
                        type="button"
                        onClick={() => reorderColorPreset(index, -1)}
                        disabled={index === 0}
                        title={`Поднять пресет «${preset.name}»`}
                        aria-label={`Поднять пресет «${preset.name}»`}
                      >↑</button>
                      <button
                        type="button"
                        onClick={() => reorderColorPreset(index, 1)}
                        disabled={index === colorPresets.length - 1}
                        title={`Опустить пресет «${preset.name}»`}
                        aria-label={`Опустить пресет «${preset.name}»`}
                      >↓</button>
                    </div>
                    <button
                      type="button"
                      className="cal-color-preset-remove"
                      onClick={() => removeColorPreset(preset.id)}
                      title={`Удалить пресет «${preset.name}»`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="cal-color-preset-row cal-color-preset-row--new">
                  <input
                    type="color"
                    value={newPresetColor}
                    aria-label="Цвет нового пресета"
                    onChange={(e) => setNewPresetColor(e.target.value)}
                  />
                  <input
                    type="text"
                    value={newPresetName}
                    maxLength={40}
                    placeholder="Название, например «Созвон»"
                    aria-label="Название нового цветового пресета"
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addColorPreset();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="cal-color-preset-add"
                    onClick={addColorPreset}
                    disabled={!newPresetName.trim()}
                    title="Добавить цветовой пресет"
                  >
                    ＋
                  </button>
                </div>
              </div>
            )}

            <div className="cal-colors">
              {TASK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`cal-color${c === color ? ' active' : ''}`}
                  style={{ background: c, '--sw': c } as React.CSSProperties}
                  onClick={() => setColor(c)}
                  title={colorPresets.find((preset) => preset.color === c)?.name ?? c}
                >
                  {c === color && <span className="cal-color-check">✓</span>}
                </button>
              ))}
              {!TASK_COLORS.includes(color) && (
                <button
                  type="button"
                  className="cal-color active"
                  style={{ background: color, '--sw': color } as React.CSSProperties}
                  onClick={() => colorInputRef.current?.click()}
                  title={colorPresets.find((preset) => preset.color === color)?.name ?? color}
                >
                  <span className="cal-color-check">✓</span>
                </button>
              )}
              <button
                type="button"
                className="cal-color cal-color--custom"
                onClick={() => colorInputRef.current?.click()}
                title="Свой цвет из палитры"
              >
                🎨
              </button>
              <input
                ref={colorInputRef}
                type="color"
                className="cal-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                tabIndex={-1}
                aria-label="Выбрать цвет из палитры"
              />
            </div>

            <div className="cal-color-animation">
              <span className="cal-color-animation-label">Анимация</span>
              <div className="cal-seg">
                <button
                  type="button"
                  className={!flowOn ? 'active' : ''}
                  onClick={() => setFlowOn(false)}
                >
                  Однотонный
                </button>
                <button
                  type="button"
                  className={flowOn ? 'active' : ''}
                  onClick={() => setFlowOn(true)}
                >
                  Поток градиента
                </button>
              </div>

              {flowOn && (
                <div className="cal-flow-editor">
                  <div
                    className={`cal-flow-preview ${taskColorAnimationClass(colorAnimation)}`}
                    style={taskColorStyle(color, colorAnimation) as React.CSSProperties}
                  >
                    Поток градиента
                  </div>

                  <div className="cal-flow-stops">
                    {flowColors.map((stop, index) => (
                      <label className="cal-flow-stop" key={`${index}-${stop}`}>
                        <input
                          type="color"
                          value={stop}
                          aria-label={`Цвет градиента ${index + 1}`}
                          onChange={(e) =>
                            setFlowColors((colors) =>
                              colors.map((value, colorIndex) =>
                                colorIndex === index ? e.target.value.toLowerCase() : value
                              )
                            )
                          }
                        />
                        <span>{index + 1}</span>
                        {flowColors.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setFlowColors((colors) =>
                                colors.filter((_, colorIndex) => colorIndex !== index)
                              )
                            }
                            title="Убрать цвет"
                          >
                            ✕
                          </button>
                        )}
                      </label>
                    ))}
                    {flowColors.length < 5 && (
                      <button
                        type="button"
                        className="cal-flow-add"
                        onClick={() =>
                          setFlowColors((colors) => [
                            ...colors,
                            colors[colors.length - 1] ?? color,
                          ])
                        }
                      >
                        ＋ цвет
                      </button>
                    )}
                  </div>

                  <div className="cal-flow-options">
                    <div className="cal-field cal-flow-direction-field">
                      <span>Направление · {flowDirection}°</span>
                      <div className="cal-flow-direction-control">
                        <span
                          className="cal-flow-direction-arrow"
                          style={{ transform: `rotate(${flowDirection}deg)` }}
                          aria-hidden="true"
                        >
                          →
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={359}
                          step={1}
                          value={flowDirection}
                          aria-label="Направление потока градиента"
                          onChange={(e) => setFlowDirection(Number(e.target.value))}
                        />
                        <input
                          type="number"
                          min={0}
                          max={359}
                          step={1}
                          value={flowDirection}
                          aria-label="Направление в градусах"
                          onChange={(e) =>
                            setFlowDirection(
                              Math.min(359, Math.max(0, Math.round(Number(e.target.value))))
                            )
                          }
                        />
                      </div>
                    </div>
                    <label className="cal-field cal-field--grow">
                      <span>Скорость · {flowDurationSec} сек.</span>
                      <input
                        type="range"
                        min={2}
                        max={20}
                        step={1}
                        value={flowDurationSec}
                        onChange={(e) => setFlowDurationSec(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </div>
              )}
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
              <button
                type="button"
                className={type === 'reminder' ? 'active' : ''}
                onClick={() => setType('reminder')}
              >
                🔔 Напоминание
              </button>
            </div>
          </div>
        </div>

        {type === 'reminder' && (
          <p className="cal-modal-hint">
            Служебное напоминание: не выполняется как задача и не считается —
            не входит в обгон, продуктивность и секвенции. На сетке рисуется
            тонкой полоской у правого края колонки и гаснет пунктиром, когда
            окно закрывается.
          </p>
        )}

        {habits && habits.length > 0 && type !== 'reminder' && (
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

        {task.status !== 'open' && type !== 'reminder' && (
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
          {onDuplicate && (
            <button type="button" className="cal-btn" onClick={onDuplicate} title="Создать копию этой задачи">
              📋 Копировать
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
