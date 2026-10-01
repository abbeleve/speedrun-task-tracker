import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Themed dropdown. Replaces a native <select>: on several platforms the
// browser's own option popup is OS-chrome and ignores the app's dark/light
// theme, so this renders its own menu instead, styled like the rest of the UI
// everywhere.

export interface DropdownOption<T extends string> {
  value: T;
  label: ReactNode;
}

export default function Dropdown<T extends string>({ value, onChange, options, className, title }: {
  value: T;
  onChange: (v: T) => void;
  options: DropdownOption<T>[];
  className?: string;
  title?: string; // what the choice is about, shown on hover
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={`dd${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className="dd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
      >
        <span className="dd-btn-label">{current?.label}</span>
        <span className="dd-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dd-option${o.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
