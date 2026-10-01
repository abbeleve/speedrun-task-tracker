import type { InputHTMLAttributes } from 'react';

type TimeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'pattern' | 'maxLength' | 'size' | 'step'
> & { seconds?: boolean };

// Native time inputs follow the browser/OS clock preference and can show AM/PM.
// A text field keeps the editor in 24-hour time on every locale and device.
export default function TimeInput({ seconds = false, className = '', ...props }: TimeInputProps) {
  return (
    <input
      {...props}
      className={`cal-time-input ${className}`.trim()}
      type="text"
      pattern={seconds ? '([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]' : '([01][0-9]|2[0-3]):[0-5][0-9]'}
      placeholder={seconds ? 'ЧЧ:ММ:СС' : 'ЧЧ:ММ'}
      title={`Время в 24-часовом формате (${seconds ? 'ЧЧ:ММ:СС' : 'ЧЧ:ММ'})`}
      maxLength={seconds ? 8 : 5}
      size={seconds ? 8 : 5}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
