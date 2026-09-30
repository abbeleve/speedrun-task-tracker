import type { ReactNode } from 'react';

export interface ChartSwitchOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

interface ChartSwitchProps<T extends string> {
  value: T;
  options: ChartSwitchOption<T>[];
  onChange: (value: T) => void;
  // Accessible name of the whole switch, e.g. "Вид графика".
  label: string;
  className?: string;
}

// A slim column of icon buttons standing on the right of a chart, picking how
// it is drawn. The chosen one is raised like the header's segmented
// navigation. Keeping the choice (and saving it) is up to the caller.
function ChartSwitch<T extends string>({ value, options, onChange, label, className }: ChartSwitchProps<T>) {
  return (
    <div className={`chart-switch${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`chart-switch-btn${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => {
              if (!active) onChange(o.value);
            }}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}

export default ChartSwitch;
