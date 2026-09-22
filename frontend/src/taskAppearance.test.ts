import { describe, expect, it } from 'vitest';
import type { TaskColorAnimation } from './types';
import {
  normalizeTaskColorAnimation,
  taskColorAnimationClass,
  taskColorStyle,
} from './taskAppearance';

const flow: TaskColorAnimation = {
  type: 'flow',
  colors: ['#ff0000', '#00ff00', '#0000ff'],
  direction: 0,
  durationSec: 6,
};

describe('task color animation', () => {
  it('normalizes colors, direction and speed from stored data', () => {
    const stored = {
      type: 'flow',
      colors: ['#ABCDEF', 'bad', '#123456', '#234567', '#345678', '#456789'],
      direction: 'diagonal',
      durationSec: 0.5,
    } as unknown as TaskColorAnimation;

    expect(normalizeTaskColorAnimation(stored, '#FEDCBA')).toEqual({
      type: 'flow',
      colors: ['#abcdef', '#fedcba', '#123456', '#234567', '#345678'],
      direction: 0,
      durationSec: 2,
    });
  });

  it('migrates cardinal directions and wraps arbitrary angles', () => {
    const legacy = { ...flow, direction: 'left' } as unknown as TaskColorAnimation;
    expect(normalizeTaskColorAnimation(legacy, '#3498db')!.direction).toBe(180);
    expect(
      normalizeTaskColorAnimation({ ...flow, direction: -45 }, '#3498db')!.direction
    ).toBe(315);
    expect(
      normalizeTaskColorAnimation({ ...flow, direction: 721 }, '#3498db')!.direction
    ).toBe(1);
  });

  it('rejects a flow without at least two color stops', () => {
    expect(
      normalizeTaskColorAnimation({ ...flow, colors: ['#ff0000'] }, '#3498db')
    ).toBeNull();
  });

  it('builds a gradient and animation variables for task surfaces', () => {
    expect(taskColorStyle('#3498DB', { ...flow, direction: 135, durationSec: 8 })).toEqual({
      '--task-color': '#3498db',
      '--task-gradient':
        'repeating-linear-gradient(225deg, #ff0000 calc(var(--task-flow-phase) + 0%), #00ff00 calc(var(--task-flow-phase) + 33.333%), #0000ff calc(var(--task-flow-phase) + 66.667%), #ff0000 calc(var(--task-flow-phase) + 100%))',
      '--task-flow-duration': '8s',
    });
  });

  it('keeps solid tasks free of gradient variables', () => {
    expect(taskColorStyle('#ABCDEF', null)).toEqual({ '--task-color': '#abcdef' });
  });

  it('uses one animation class for every angle', () => {
    const malformed = { ...flow, direction: 'sideways' } as unknown as TaskColorAnimation;
    expect(taskColorAnimationClass(malformed)).toBe('task-color-flow');
  });
});
