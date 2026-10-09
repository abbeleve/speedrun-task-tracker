import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './CalendarPage';
import type { Task } from './types';
import type { DayStore } from './dayStore';
import { buildChains, buildGroups } from './schedule';
import { computeCredit, creditGroups } from './credit';

const now = new Date(2026, 9, 6, 14, 32).getTime(); // Tuesday 6 Oct, 14:32

// 23:00 on the 6th for two hours: one hour drawn on each side of midnight.
const late: Task = {
  id: 'late', name: 'Ночная задача', day: '2026-10-06', start: 23 * 60, plannedTime: 2 * 3600,
  completedAt: null, finishedAt: null, status: 'in-progress', order: 0, emoji: '🌙', color: '#3498db', type: 'task',
};

function calendar(view: string, layout = 'vertical') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'speedrun_cal_view' ? view : key === 'speedrun_cal_layout' ? layout : null),
  });
  const tasks = [late];
  const store: DayStore = { tasks, days: {}, ready: true, loading: false, error: null, reload: async () => {}, mutateDay: () => {}, upsertTask: () => {}, patchTask: () => {}, patchTasks: () => {}, removeTask: () => {}, removeTasks: () => {}, flush: () => {} };
  const deadlineStore = { deadlines: [], ready: true, error: null, reload: async () => {}, upsert: async () => {}, remove: async () => {} };
  return renderToStaticMarkup(<CalendarPage store={store} deadlineStore={deadlineStore} now={now} credit={computeCredit(creditGroups(tasks), now)} chains={buildChains(buildGroups(tasks))} onOpenChain={() => {}} habits={[]} weekOvertakeSec={0} />);
}

const count = (html: string, text: string) => html.split(text).length - 1;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('a block over midnight', () => {
  it.each(['vertical', 'horizontal'])('reads its whole time and length on both days (%s)', (layout) => {
    const html = calendar('3day', layout);
    expect(count(html, 'data-task-id="late"')).toBe(2);
    expect(count(html, '23:00–01:00')).toBe(2);
    expect(count(html, '>2 ч<')).toBe(2);
    // Not each piece's own share of the day.
    expect(html).not.toContain('23:00–00:00');
    expect(html).not.toContain('00:00–01:00');
    expect(html).not.toContain('>1 ч<');
  });

  it('has its edges where it really starts and ends, not at the seam', () => {
    const html = calendar('3day');
    expect(count(html, 'cal-block-resize--top')).toBe(1);
    expect(count(html, 'cal-block-resize--bottom')).toBe(1);
    // Everything from the first piece up to the second, then the second on.
    const [first, second] = html.split('data-task-id="late"').slice(1);
    expect(first).toContain('cal-block-resize--top');
    expect(first).not.toContain('cal-block-resize--bottom');
    expect(second).toContain('cal-block-resize--bottom');
    expect(second).not.toContain('cal-block-resize--top');
  });
});
