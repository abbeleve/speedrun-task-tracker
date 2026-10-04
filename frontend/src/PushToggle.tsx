import { useEffect, useState } from 'react';
import { IconBell, IconBellOff } from './icons';
import { disablePush, enablePush, pushSupported, syncPush, type PushState } from './push';

const TITLES: Record<Exclude<PushState, 'unsupported'>, string> = {
  on: 'Уведомления о блоках и сериях включены — выключить',
  off: 'Уведомлять о начале и конце блоков и о сериях привычек',
  denied: 'Уведомления запрещены в настройках браузера',
};

// The header's bell: pushes about the calendar's blocks, on or off for this
// browser (see push.ts). Not shown where the browser cannot take pushes.
export default function PushToggle() {
  const [state, setState] = useState<PushState>(() => (pushSupported() ? 'off' : 'unsupported'));
  // Held until the browser's standing is read, so a click cannot race it.
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    syncPush()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((e) => console.error('Failed to sync push', e))
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'unsupported') return null;

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
      } else {
        setState(await enablePush());
      }
    } catch (e) {
      console.error('Failed to switch push', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const title = failed ? 'Не удалось переключить уведомления — попробуйте ещё раз' : TITLES[state];
  return (
    <button
      type="button"
      className={`icon-btn${state === 'on' ? ' is-open' : ''}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={state === 'on'}
      title={title}
      aria-label={title}
    >
      {state === 'on' ? <IconBell /> : <IconBellOff />}
    </button>
  );
}
