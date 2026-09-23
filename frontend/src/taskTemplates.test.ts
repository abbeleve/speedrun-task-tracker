import { describe, expect, it } from 'vitest';
import type { TaskTemplate } from './types';
import { taskFromTemplate } from './taskTemplates';

describe('taskFromTemplate', () => {
  it('reuses an unscheduled rest task without turning it into a recurrence', () => {
    const template: TaskTemplate = {
      id: 'eating',
      name: 'Eating',
      plannedTime: 1800,
      emoji: '🍽️',
      color: '#2ecc71',
      type: 'rest',
    };

    const first = taskFromTemplate(template, '2026-09-23');
    const second = taskFromTemplate(template, '2026-09-24');

    expect(first).toMatchObject({
      name: 'Eating',
      type: 'rest',
      plannedTime: 1800,
      day: '2026-09-23',
      status: 'open',
      start: null,
      finishedAt: null,
      repeat: null,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.day).toBe('2026-09-24');
    expect(template).not.toHaveProperty('day');
  });
});
