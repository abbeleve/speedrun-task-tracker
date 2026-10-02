import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import DashBackdrop from './DashBackdrop';
import { FLOW_MOTIONS, FLOW_REST, FLOW_SETTLE_MS, flowTransform, nextFlowLeg, wander } from './backdropFlow';
import type { FlowMotion, FlowPoint } from './backdropFlow';

// A repeatable stand-in for Math.random.
function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

const MOTIONS: FlowMotion[] = ['x', 'y', 'shape'];

describe('nextFlowLeg', () => {
  it('keeps every leg inside the reach, a real step away, and within its time', () => {
    for (const motion of MOTIONS) {
      const { reach, minStep, minMs, maxMs } = FLOW_MOTIONS[motion];
      const random = seeded(7);
      let at: FlowPoint = FLOW_REST;
      for (let i = 0; i < 500; i++) {
        const leg = nextFlowLeg(motion, at, random);
        expect(Math.abs(leg.to.a)).toBeLessThanOrEqual(reach);
        expect(Math.abs(leg.to.a - at.a)).toBeGreaterThanOrEqual(minStep - 1e-9);
        if (motion === 'shape') {
          expect(Math.abs(leg.to.b)).toBeLessThanOrEqual(reach);
          expect(Math.abs(leg.to.b - at.b)).toBeGreaterThanOrEqual(minStep - 1e-9);
        } else {
          expect(leg.to.b).toBe(0);
        }
        expect(leg.duration).toBeGreaterThanOrEqual(minMs);
        expect(leg.duration).toBeLessThanOrEqual(maxMs);
        at = leg.to;
      }
    }
  });

  it('steps away even when the random point lands where the glow already is', () => {
    const { reach, minStep } = FLOW_MOTIONS.x;
    // random() = 0.5 is the middle of the reach, 0.
    expect(nextFlowLeg('x', FLOW_REST, () => 0.5).to.a).toBe(minStep);
    // At the far edge the step goes back in, never out of the reach.
    const edge = nextFlowLeg('x', { a: reach, b: 0 }, () => 1).to.a;
    expect(edge).toBe(reach - minStep);
    expect(nextFlowLeg('x', { a: -reach, b: 0 }, () => 0).to.a).toBe(-reach + minStep);
  });

  it('wanders: the same start gives different paths', () => {
    const path = (seed: number) => {
      const random = seeded(seed);
      let at = FLOW_REST;
      return Array.from({ length: 5 }, () => (at = nextFlowLeg('x', at, random).to).a);
    };
    expect(path(1)).not.toEqual(path(2));
  });
});

describe('flowTransform', () => {
  it('moves the sideways and the up-and-down boxes in viewport units, and scales the shape', () => {
    expect(flowTransform('x', { a: 12.3456, b: 0 })).toBe('translateX(12.346vw)');
    expect(flowTransform('y', { a: -4, b: 0 })).toBe('translateY(-4vh)');
    expect(flowTransform('shape', { a: 0.1, b: -0.15 })).toBe('scale(1.1, 0.85)');
    expect(flowTransform('shape', FLOW_REST)).toBe('scale(1, 1)');
  });
});

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  playbackRate: number;
  cancel: ReturnType<typeof vi.fn>;
  updatePlaybackRate: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
}

function fakeElement() {
  const animations: FakeAnimation[] = [];
  const el = {
    animate: vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: FakeAnimation = {
        keyframes,
        options,
        playbackRate: 1,
        cancel: vi.fn(),
        updatePlaybackRate: vi.fn(),
        onfinish: null,
      };
      animations.push(animation);
      return animation;
    }),
  };
  return { el: el as unknown as HTMLElement, animations };
}

describe('wander', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets off from the glow’s place and chains each leg from where the last one ended', () => {
    const { el, animations } = fakeElement();
    wander(el, 'x', 1, seeded(3));

    expect(animations).toHaveLength(1);
    const [first] = animations;
    expect(first.keyframes[0]).toEqual({ transform: 'translateX(0vw)' });
    expect(first.options).toMatchObject({ easing: 'ease-in-out', fill: 'forwards' });

    first.onfinish?.();
    expect(animations).toHaveLength(2);
    expect(animations[1].keyframes[0]).toEqual(first.keyframes[1]);
    // The finished leg is dropped once the next one holds the glow.
    expect(first.cancel).toHaveBeenCalledOnce();

    animations[1].onfinish?.();
    expect(animations[2].keyframes[0]).toEqual(animations[1].keyframes[1]);
  });

  it('sets off from where it is when switched back on while still drifting home', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 0, -40)' }));
    const { el, animations } = fakeElement();
    const homeward = { cancel: vi.fn() };
    Object.assign(el, { getAnimations: () => [homeward] });

    wander(el, 'y', 1, seeded(9));
    expect(homeward.cancel).toHaveBeenCalledOnce();
    expect(animations[0].keyframes[0]).toEqual({ transform: 'matrix(1, 0, 0, 1, 0, -40)' });
    animations[0].onfinish?.();
    expect(animations[1].keyframes[0]).toEqual(animations[0].keyframes[1]);
  });

  it('drifts back to its place when stopped, and walks no further', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 120, 0)' }));
    const { el, animations } = fakeElement();
    const walk = wander(el, 'x', 2, seeded(5));
    const leg = animations[0];

    walk.stop();
    expect(leg.cancel).toHaveBeenCalledOnce();
    expect(leg.onfinish).toBeNull();
    expect(animations).toHaveLength(2);
    expect(animations[1].keyframes).toEqual([
      { transform: 'matrix(1, 0, 0, 1, 120, 0)' },
      { transform: 'translateX(0vw)' },
    ]);
    // Home is always the same short drift, whatever the speed.
    expect(animations[1].options).toMatchObject({ duration: FLOW_SETTLE_MS });
    expect(animations[1].playbackRate).toBe(1);
    expect(animations[1].options.fill).toBeUndefined();
  });

  it('walks at the speed it was given, and a new speed reaches the leg under way and the ones after', () => {
    const { el, animations } = fakeElement();
    const walk = wander(el, 'shape', 0.5, seeded(11));
    const [first] = animations;
    // The leg keeps its normal length; the speed is the rate it plays at.
    expect(first.options.duration).toBeGreaterThanOrEqual(FLOW_MOTIONS.shape.minMs);
    expect(first.playbackRate).toBe(0.5);

    walk.setSpeed(2.5);
    expect(first.updatePlaybackRate).toHaveBeenCalledWith(2.5);
    walk.setSpeed(2.5);
    expect(first.updatePlaybackRate).toHaveBeenCalledOnce();

    first.onfinish?.();
    expect(animations[1].playbackRate).toBe(2.5);
  });
});

describe('DashBackdrop', () => {
  it('draws four glows, each a box per motion, hidden from assistive tech', () => {
    const html = renderToStaticMarkup(createElement(DashBackdrop, { flowing: true, speed: 1 }));
    expect(html).toMatch(/^<div class="dash-backdrop" aria-hidden="true">/);
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`class="dash-glow dash-glow--${n}"`);
    expect(html.match(/class="dash-glow-drift"/g)).toHaveLength(4);
    expect(html.match(/class="dash-glow-shape"/g)).toHaveLength(4);
  });
});
