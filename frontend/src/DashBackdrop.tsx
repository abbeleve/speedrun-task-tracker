import { memo, useEffect, useRef } from 'react';
import { wander } from './backdropFlow';
import type { FlowMotion } from './backdropFlow';

const GLOWS = [1, 2, 3, 4] as const;

// Which motion each of a glow's boxes walks, outermost first.
const BOXES: { selector: string; motion: FlowMotion }[] = [
  { selector: '.dash-glow', motion: 'x' },
  { selector: '.dash-glow-drift', motion: 'y' },
  { selector: '.dash-glow-shape', motion: 'shape' },
];

const STILL_QUERY = '(prefers-reduced-motion: reduce)';

// The glass pages' backdrop: four soft glows of the palette's colours over
// the ground `.app--glass` paints (App.css). Each glow sits where the
// backdrop's layout puts it; with `flowing` on they wander off from there
// (backdropFlow.ts) — unless the system asks for less motion.
function DashBackdrop({ flowing }: { flowing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!flowing || !root || typeof root.animate !== 'function') return;
    const still = typeof window.matchMedia === 'function' ? window.matchMedia(STILL_QUERY) : null;
    let stops: (() => void)[] = [];

    const stop = () => {
      stops.forEach((s) => s());
      stops = [];
    };
    const sync = () => {
      if (still?.matches) stop();
      else if (stops.length === 0) {
        stops = BOXES.flatMap(({ selector, motion }) =>
          Array.from(root.querySelectorAll<HTMLElement>(selector), (el) => wander(el, motion))
        );
      }
    };

    sync();
    still?.addEventListener?.('change', sync);
    return () => {
      still?.removeEventListener?.('change', sync);
      stop();
    };
  }, [flowing]);

  return (
    <div className="dash-backdrop" ref={ref} aria-hidden="true">
      {GLOWS.map((n) => (
        <div key={n} className={`dash-glow dash-glow--${n}`}>
          <div className="dash-glow-drift">
            <div className="dash-glow-shape" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(DashBackdrop);
