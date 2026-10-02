// The living backdrop: with the switch on, each of the backdrop's four glows
// wanders off its place on a path of its own and morphs as it goes. A glow is
// three nested boxes (see DashBackdrop.tsx), and each box walks one motion on
// its own — sideways, up and down, the ellipse's shape — from one random
// point to the next. The motions turn at different moments, so a glow never
// comes to a standstill and never retraces a path: it meanders. Only
// `transform` is animated, which the browser runs off the main thread, so a
// busy calendar does not stutter the backdrop and vice versa. How fast they
// go is the user's to pick, and is kept with the rest of the look
// (dashPalette.ts).

export type FlowMotion = 'x' | 'y' | 'shape';

interface MotionSpec {
  // How far from its place a glow may go: vw sideways, vh up and down, and
  // for the shape the most each axis of the ellipse may grow or shrink by.
  reach: number;
  // The shortest step worth taking, so a leg never ends right where it began.
  minStep: number;
  // How long one leg takes at the normal speed, ms.
  minMs: number;
  maxMs: number;
}

export const FLOW_MOTIONS: Record<FlowMotion, MotionSpec> = {
  x: { reach: 18, minStep: 7, minMs: 9000, maxMs: 17000 },
  y: { reach: 16, minStep: 6, minMs: 10000, maxMs: 19000 },
  shape: { reach: 0.22, minStep: 0.08, minMs: 11000, maxMs: 21000 },
};

export interface FlowPoint {
  a: number; // x: vw; y: vh; shape: horizontal scale offset
  b: number; // shape only: vertical scale offset
}

export const FLOW_REST: FlowPoint = { a: 0, b: 0 };

export interface FlowLeg {
  to: FlowPoint;
  duration: number;
}

// The next point to head for from `from`, at least `minStep` away on some
// axis, and how long to take getting there.
export function nextFlowLeg(motion: FlowMotion, from: FlowPoint, random: () => number = Math.random): FlowLeg {
  const { reach, minStep, minMs, maxMs } = FLOW_MOTIONS[motion];
  const pick = (current: number) => {
    const value = (random() * 2 - 1) * reach;
    if (Math.abs(value - current) >= minStep) return value;
    // Too close: take the shortest step instead, towards the side with more
    // room, which stays inside the reach.
    return current > 0 ? current - minStep : current + minStep;
  };
  const to = { a: pick(from.a), b: motion === 'shape' ? pick(from.b) : 0 };
  return { to, duration: Math.round(minMs + random() * (maxMs - minMs)) };
}

// The transform that puts a box at a point of its motion.
export function flowTransform(motion: FlowMotion, p: FlowPoint): string {
  const n = (v: number) => +v.toFixed(3);
  if (motion === 'x') return `translateX(${n(p.a)}vw)`;
  if (motion === 'y') return `translateY(${n(p.a)}vh)`;
  return `scale(${n(1 + p.a)}, ${n(1 + p.b)})`;
}

// How long a glow takes to drift home when the switch goes off.
export const FLOW_SETTLE_MS = 1400;

export interface FlowWalk {
  // Speeds the walk up or slows it down, the leg under way included, from
  // where the box is now.
  setSpeed: (speed: number) => void;
  // Ends the walk and lets the box drift back to its place rather than jump.
  stop: () => void;
}

// Walks one box through random legs at `speed` times the normal pace.
export function wander(
  el: HTMLElement,
  motion: FlowMotion,
  speed = 1,
  random: () => number = Math.random
): FlowWalk {
  let at = FLOW_REST;
  let current: Animation | null = null;
  let stopped = false;
  let rate = speed;

  // A box still drifting home from the last walk sets off from where it is.
  const settling = el.getAnimations?.() ?? [];
  let from = settling.length > 0 ? getComputedStyle(el).transform : flowTransform(motion, at);
  settling.forEach((a) => a.cancel());

  const step = () => {
    if (stopped) return;
    const leg = nextFlowLeg(motion, at, random);
    const next = el.animate([{ transform: from }, { transform: flowTransform(motion, leg.to) }], {
      duration: leg.duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    next.playbackRate = rate;
    // The finished leg held its end point; the new one starts from it.
    current?.cancel();
    current = next;
    at = leg.to;
    from = flowTransform(motion, at);
    next.onfinish = step;
  };
  step();

  return {
    setSpeed(next) {
      if (next === rate) return;
      rate = next;
      current?.updatePlaybackRate(rate);
    },
    stop() {
      stopped = true;
      if (!current) return;
      const here = getComputedStyle(el).transform;
      current.onfinish = null;
      current.cancel();
      current = null;
      if (here && here !== 'none') {
        el.animate([{ transform: here }, { transform: flowTransform(motion, FLOW_REST) }], {
          duration: FLOW_SETTLE_MS,
          easing: 'ease-in-out',
        });
      }
    },
  };
}
