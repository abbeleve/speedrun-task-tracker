import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './CalendarPage';
import DeadlineDialog from './DeadlineDialog';
import TaskDialog from './TaskDialog';
import type { Deadline, Task } from './types';
import type { DayStore } from './dayStore';
import { buildChains, buildGroups } from './schedule';
import { computeCredit, creditGroups } from './credit';

const now = new Date(2026, 9, 1, 12, 30).getTime();
const deadline: Deadline = { id: 'launch', name: 'Launch website', description: null, dueDay: '2026-10-02', dueTime: 1080, completedAt: null };
const work = (day: string): Task => ({ id: day, name: 'Finished preparation', day, start: 540, plannedTime: 3600, completedAt: null, finishedAt: now - 60000, status: 'done', order: 0, emoji: '📋', color: '#3498db', type: 'task', deadlineId: 'launch' });
const tasks = [work('2026-09-30'), work('2026-10-01')];
const store: DayStore = { tasks, days: Object.fromEntries(tasks.map((task) => [task.day, [task]])), ready: true, loading: false, error: null, reload: async () => {}, mutateDay: () => {}, upsertTask: () => {}, patchTask: () => {}, patchTasks: () => {}, removeTask: () => {}, removeTasks: () => {}, flush: () => {} };

function calendar(view = '3day', layout = 'vertical', milestones = [deadline]) {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'speedrun_cal_view' ? view : key === 'speedrun_cal_layout' ? layout : null });
  const deadlineStore = { deadlines: milestones, ready: true, error: null, reload: async () => {}, upsert: async () => {}, remove: async () => {} };
  return renderToStaticMarkup(<CalendarPage store={store} deadlineStore={deadlineStore} now={now} credit={computeCredit(creditGroups(tasks), now)} chains={buildChains(buildGroups(tasks))} onOpenChain={() => {}} habits={[]} weekOvertakeSec={0} />);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: false }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('deadline calendar presentation', () => {
  it('keeps the deadline and due-day flag visible after all linked blocks close', () => {
    const html = calendar();
    expect(html).toContain('Блоки закрыты · дедлайн открыт');
    expect(html).toContain('cal-deadline-flag');
    expect(html).toContain('Launch website');
    expect(html).toContain('cal-task-deadline-badge');
    expect(html).not.toMatch(/Запас по плану|Время до дедлайна|Осталось до/);
  });
  it('keeps upcoming deadlines visible when the due date is outside the day view', () => {
    const html = calendar('day');
    expect(html).toContain('cal-upcoming-deadline');
    expect(html).toContain('Launch website');
    expect(html).not.toContain('class="cal-deadline-flag');
  });
  it('renders flags in timeline and month views without a task on the due date', () => {
    expect(calendar('3day', 'horizontal')).toContain('cal-deadline-flag across');
    expect(calendar('month')).toContain('cal-month-deadline');
  });
  it('keeps completed milestones in the calendar history but out of the open row', () => {
    const html = calendar('3day', 'vertical', [{ ...deadline, completedAt: now }]);
    expect(html).toContain('cal-deadline-flag');
    expect(html).not.toContain('class="cal-upcoming-deadlines"');
  });
  it('renders date-only deadlines above the hour grid', () => {
    const html = calendar('3day', 'vertical', [{ ...deadline, dueTime: null }]);
    expect(html).toContain('cal-date-deadlines');
    expect(html).toContain('date-only');
    expect(html).toContain('Весь день');
  });
  it('offers a separate completion action even when all work blocks are done', () => {
    const html = renderToStaticMarkup(<DeadlineDialog deadline={deadline} isNew={false} tasks={tasks} now={now} onSave={async () => {}} onDelete={async () => {}} onOpenTask={() => {}} onAddTask={() => {}} onClose={() => {}} />);
    expect(html).toContain('2 из 2 закрыто');
    expect(html).toContain('дедлайн ещё открыт');
    expect(html).toContain('Закрыть дедлайн');
    expect(html).toContain('Запланировать блок');
  });
});

describe('task deadline controls', () => {
  it('offers a deadline for a new task even before any deadlines exist', () => {
    const html = renderToStaticMarkup(<TaskDialog task={{ ...work('2026-10-01'), deadlineId: null, finishedAt: null, status: 'in-progress' }} isNew={true} deadlines={[]} onCreateDeadline={() => {}} onSave={() => {}} onClose={() => {}} />);
    expect(html).toContain('Дедлайн результата');
    expect(html).toContain('— без дедлайна —');
    expect(html).toContain('Новый дедлайн');
    expect(html.indexOf('Дедлайн результата')).toBeLessThan(html.indexOf('Цвет и аватар'));
  });
  it('shows the linked result and its due time in an existing task editor', () => {
    const html = renderToStaticMarkup(<TaskDialog task={work('2026-10-01')} isNew={false} deadlines={[deadline]} onCreateDeadline={() => {}} onSave={() => {}} onClose={() => {}} />);
    expect(html).toContain('value="launch" selected=""');
    expect(html).toContain('Launch website');
    expect(html).toContain('18:00');
    expect(html).toContain('Дедлайн результата');
  });
});
