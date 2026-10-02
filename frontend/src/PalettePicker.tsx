import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DashPalette, GlassPages } from './dashPalette';
import { isUserPalette, newPaletteId, PALETTE_NAME_MAX } from './dashPalette';
import type { DashPaletteStore } from './useDashPalette';
import { IconCheck, IconClose, IconPalette, IconPencil, IconPlus } from './icons';

// A palette's two colours as one round swatch, split on the diagonal.
const swatchStyle = (p: DashPalette): CSSProperties => ({
  background: `conic-gradient(from 225deg, ${p.base} 0 50%, ${p.accent} 50% 100%)`,
});

// The pages that can take the look or leave it, as the switches name them.
const GLASS_PAGES: { page: keyof GlassPages; label: string; hint?: string }[] = [
  { page: 'calendar', label: 'Календарь' },
  { page: 'tracker', label: 'Секвенция', hint: 'кроме «Спирали»' },
];

// The header's palette button and its popover: which pages wear the
// dashboard's look, and in which colours — one of the palettes, or one the
// user makes, edits or deletes. While one is being edited the page is shown in
// it, so its colours are judged where they will actually be used.
export default function PalettePicker({ store, page, shown }: {
  store: DashPaletteStore;
  page: 'home' | 'calendar' | 'tracker';
  // Whether the page open under the popover wears the look right now.
  shown: boolean;
}) {
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
        title="Оформление"
        aria-label="Оформление"
        aria-expanded={open}
      >
        <IconPalette />
      </button>

      {open && (
        <div className="palette-pop" role="dialog" aria-label="Оформление">
          {draft ? (
            <PaletteEditor
              draft={draft}
              isNew={!own.some((p) => p.id === draft.id)}
              shown={shown}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={(p) => {
                store.save(p);
                setDraft(null);
              }}
            />
          ) : (
            <>
              <p className="palette-head">Оформление</p>
              <p className="palette-lead">Стекло и цвета «Главной» — ещё и на страницах:</p>
              <ul className="palette-pages">
                {GLASS_PAGES.map(({ page: p, label, hint }) => (
                  <li key={p} className={p === page ? 'current' : undefined}>
                    <label className="palette-page">
                      <span className="palette-page-text">
                        <b>{label}</b>
                        {hint && <small>{hint}</small>}
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="palette-switch"
                        checked={store.glass[p]}
                        onChange={(e) => store.setGlass(p, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>

              <p className="palette-sub">Цветовая гамма</p>
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

function PaletteEditor({ draft, isNew, shown, onChange, onCancel, onSave }: {
  draft: DashPalette;
  isNew: boolean;
  shown: boolean;
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
        label="Акцент"
        hint="часы сна, подписи и метки"
        value={draft.accent}
        onChange={(accent) => onChange({ ...draft, accent })}
      />

      <p className="palette-note">
        {shown
          ? 'Страница уже показана в этих цветах.'
          : 'Эти цвета видны на «Главной» и страницах со стеклом.'}
      </p>

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
