import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoryView } from './StoryView';
import type { Task } from './types';

vi.mock('./motivation', () => ({
  useMotivationImages: () => ['/first.jpg', '/second.jpg'],
}));

const tasks: Task[] = [0, 1, 2, 3].map((idx) => ({
  id: String(idx), name: 'Шаг ' + idx, description: 'Заметки к задаче',
  plannedTime: 600, completedAt: idx === 0 ? 300 : null,
  start: 600 + idx * 10, finishedAt: null, order: idx,
  emoji: '🌿', color: '#2ecc71', type: 'task', day: '2026-10-02',
  status: idx === 0 ? 'done' : 'in-progress', sessionName: 'Утренний фокус',
}));
const props = {
  tasks, cumulativeTimes: [0, 600, 1200, 1800], elapsedSec: 450,
  sessionState: 'running' as const, currentTaskIdx: 1, deltaMs: -300000,
  onCompleteTask: () => {}, onUncompleteTask: () => {}, onSeek: () => {},
  formatEnd: () => '10:30',
};

describe('StoryView tracking', () => {
  it('starts the next step progress at the real previous completion', () => {
    const html = renderToStaticMarkup(<StoryView {...props} />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('value="25"');
    expect(html).toContain('Завершить шаг');
    expect(html).toContain('Вернуть задачу');
    expect(html).toContain('Заметки к задаче');
    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    expect(sources).toHaveLength(4);
    expect(sources[0]).not.toBe(sources[1]);
    expect(sources.slice(2)).toEqual(sources.slice(0, 2));
  });

  it('lets overdue unfinished steps be completed after the planned finish', () => {
    const html = renderToStaticMarkup(<StoryView {...props} sessionState="finished" elapsedSec={3000} />);
    expect(html).toContain('Завершить шаг');
    expect(html).toContain('value="100"');
  });

  it('does not offer to complete a sequence that has not started', () => {
    const html = renderToStaticMarkup(<StoryView {...props} sessionState="idle" />);
    expect(html).not.toContain('Завершить шаг');
    expect(html).not.toContain('aria-current="step"');
  });

  it('shows a finished sequence without an active step', () => {
    const html = renderToStaticMarkup(<StoryView {...props}
      tasks={tasks.map((task) => ({ ...task, completedAt: 300 }))}
      sessionState="finished" currentTaskIdx={-1} />);
    expect(html).toContain('Секвенция пройдена. Отличная работа!');
    expect(html).not.toContain('Завершить шаг');
  });
});
