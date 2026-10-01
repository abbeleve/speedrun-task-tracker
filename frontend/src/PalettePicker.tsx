import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DashPalette } from './dashPalette';
import { isUserPalette, newPaletteId, PALETTE_NAME_MAX } from './dashPalette';
import type { DashPaletteStore } from './useDashPalette';
import { IconCheck, IconClose, IconPalette, IconPencil, IconPlus } from './icons';

// A palette's two colours as one round swatch, split on the diagonal.
const swatchStyle = (p: DashPalette): CSSProperties => ({
  background: `conic-gradient(from 225deg, ${p.base} 0 50%, ${p.accent} 50% 100%)`,
});

// The header's palette button and its popover: choose one of the palettes, or
// make, edit and delete your own. While one is being edited the page is shown
// in it, so its colours are judged where they will actually be used.
export default function PalettePicker({ store }: { store: DashPaletteStore }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashPalette | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { setPreview } = store;

  const close = useCallback(() => {
    setOpen(false);
    setDraft(null);
  }, []);

  // The draft is painted on the page as it changes, and dropped with it.
  useEffect(() => {
    setPreview(draft);
  }, [draft, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  // A click anywhere else closes it; Escape backs out of the editor first.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (draft) setDraft(null);
      else close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, draft, close]);

  const builtIn = store.palettes.filter((p) => !isUserPalette(p.id));
  const own = store.palettes.filter((p) => isUserPalette(p.id));

  const item = (p: DashPalette) => {
    const active = p.id === store.activeId;
    const mine = isUserPalette(p.id);
    return (
      <li key={p.id} className={`palette-item${active ? ' active' : ''}`}>
        <button type="button" className="palette-pick" aria-pressed={active} onClick={() => store.select(p.id)}>
          <span className="palette-swatch" style={swatchStyle(p)} aria-hidden />
          <span className="palette-name">{p.name}</span>
          {active && <IconCheck size={15} className="palette-check" />}
        </button>
        {mine && (
          <span className="palette-tools">
            <button
              type="button"
              className="palette-tool"
              title="Изменить"
              aria-label={`Изменить «${p.name}»`}
              onClick={() => setDraft(p)}
            >
              <IconPencil size={13} />
            </button>
            <button
              type="button"
              className="palette-tool palette-tool--remove"
              title="Удалить"
              aria-label={`Удалить «${p.name}»`}
              onClick={() => store.remove(p.id)}
            >
              <IconClose size={12} />
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="palette" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn${open ? ' is-open' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        title="Цветовая гамма"
        aria-label="Цветовая гамма"
        aria-expanded={open}
      >
        <IconPalette />
      </button>

      {open && (
        <div className="palette-pop" role="dialog" aria-label="Цветовая гамма">
          {draft ? (
            <PaletteEditor
              draft={draft}
              isNew={!own.some((p) => p.id === draft.id)}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={(p) => {
                store.save(p);
                setDraft(null);
              }}
            />
          ) : (
            <>
              <p className="palette-head">Цветовая гамма</p>
              <ul className="palette-list">{builtIn.map(item)}</ul>

              <p className="palette-sub">Мои палитры</p>
              {own.length > 0 ? (
                <ul className="palette-list">{own.map(item)}</ul>
              ) : (
                <p className="palette-empty">Своих пока нет — соберите первую из двух цветов.</p>
              )}

              <button
                type="button"
                className="pill-btn palette-new"
                disabled={!store.canAdd}
                title={store.canAdd ? undefined : 'Палитр уже максимум'}
                onClick={() =>
                  setDraft({ id: newPaletteId(), name: '', base: store.current.base, accent: store.current.accent })
                }
              >
                <IconPlus size={15} />
                Новая палитра
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PaletteEditor({ draft, isNew, onChange, onCancel, onSave }: {
  draft: DashPalette;
  isNew: boolean;
  onChange: (p: DashPalette) => void;
  onCancel: () => void;
  onSave: (p: DashPalette) => void;
}) {
  const name = draft.name.trim();
  return (
    <form
      className="palette-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (name) onSave({ ...draft, name });
      }}
    >
      <p className="palette-head">{isNew ? 'Новая палитра' : 'Изменить палитру'}</p>

      <label className="palette-field">
        <span>Название</span>
        <input
          className="palette-input"
          value={draft.name}
          maxLength={PALETTE_NAME_MAX}
          placeholder="Например, «Весна»"
          autoFocus
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <ColorField
        label="Основной цвет"
        hint="фон, карточки, графики, кнопки"
        value={draft.base}
        onChange={(base) => onChange({ ...draft, base })}
      />
      <ColorField
        label="Трекер сна"
        hint="закрашенные часы сна"
        value={draft.accent}
        onChange={(accent) => onChange({ ...draft, accent })}
      />

      <p className="palette-note">Страница уже показана в этих цветах.</p>

      <div className="palette-actions">
        <button type="button" className="pill-btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="pill-btn pill-btn--primary" disabled={!name}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

function ColorField({ label, hint, value, onChange }: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="palette-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      <span className="palette-color-text">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <code>{value}</code>
    </label>
  );
}
