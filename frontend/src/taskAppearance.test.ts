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
  direction: 'right',
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
      direction: 'right',
      durationSec: 2,
    });
  });

  it('rejects a flow without at least two color stops', () => {
    expect(
      normalizeTaskColorAnimation({ ...flow, colors: ['#ff0000'] }, '#3498db')
    ).toBeNull();
  });

  it('builds a gradient and animation variables for task surfaces', () => {
    expect(taskColorStyle('#3498DB', { ...flow, direction: 'down', durationSec: 8 })).toEqual({
      '--task-color': '#3498db',
      '--task-gradient':
        'linear-gradient(180deg, #ff0000 0%, #00ff00 16.667%, #0000ff 33.333%, #ff0000 50%, #00ff00 66.667%, #0000ff 83.333%, #ff0000 100%)',
      '--task-flow-duration': '8s',
    });
  });

  it('keeps solid tasks free of gradient variables', () => {
    expect(taskColorStyle('#ABCDEF', null)).toEqual({ '--task-color': '#abcdef' });
  });

  it('uses a safe direction class for malformed stored data', () => {
    const malformed = { ...flow, direction: 'sideways' } as unknown as TaskColorAnimation;
    expect(taskColorAnimationClass(malformed)).toBe(
      'task-color-flow task-color-flow--right'
    );
  });
});
