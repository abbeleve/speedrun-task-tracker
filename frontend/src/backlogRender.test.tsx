import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarPage from './CalendarPage';
import type { Deadline, Habit, Task } from './types';
import type { DayStore } from './dayStore';
import { buildChains, buildGroups } from './schedule';
import { computeCredit, creditGroups } from './credit';

const now = new Date(2026, 9, 6, 14, 32).getTime(); // Tuesday 6 Oct, 14:32
const LONG_NAME = 'Разобрать входящие письма от клиентов и ответить на все вопросы по новому тарифу до конца недели';

const open = (patch: Partial<Task>): Task => ({
  id: patch.id ?? 'task', name: 'Task', day: '2026-10-06', start: null, plannedTime: 1800,
  completedAt: null, finishedAt: null, status: 'open', order: 0, emoji: '📋', color: '#3498db', type: 'task', ...patch,
});

const deadline: Deadline = { id: 'launch', name: 'Запуск сайта', description: null, dueDay: '2026-10-09', dueTime: 1080, completedAt: null };
const habit: Habit = { id: 'read', name: 'Чтение', emoji: '📚', color: '#2ecc71', format: 'time', target: 30, targets: [{ since: '', target: 30 }], unit: 'мин', order: 0 };

function calendar(tasks: Task[], storage: Record<string, string> = {}) {
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage[key] ?? (key === 'speedrun_cal_view' ? 'day' : null) });
  const store: DayStore = { tasks, days: {}, ready: true, loading: false, error: null, reload: async () => {}, mutateDay: () => {}, upsertTask: () => {}, patchTask: () => {}, patchTasks: () => {}, removeTask: () => {}, removeTasks: () => {}, flush: () => {} };
  const deadlineStore = { deadlines: [deadline], ready: true, error: null, reload: async () => {}, upsert: async () => {}, remove: async () => {} };
  const scheduled = tasks.filter((task) => task.start !== null);
  return renderToStaticMarkup(<CalendarPage store={store} deadlineStore={deadlineStore} now={now} credit={computeCredit(creditGroups(scheduled), now)} chains={buildChains(buildGroups(scheduled))} onOpenChain={() => {}} habits={[habit]} weekOvertakeSec={0} />);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('backlog rail', () => {
  it('shows a long name in full, with the notes and the facts about the task', () => {
    const html = calendar([
      open({ id: 'mail', name: LONG_NAME, description: 'Сначала VIP-клиенты', plannedTime: 5400, repeat: { mode: 'fixed', baseDays: 7 }, habitId: 'read', deadlineId: 'launch' }),
    ]);
    expect(html).toContain(LONG_NAME);
    expect(html).toContain('Сначала VIP-клиенты');
    expect(html).toContain('1 ч 30 м');
    expect(html).toContain('каждые 7 дн.');
    expect(html).toContain('Чтение');
    expect(html).toContain('Запуск сайта');
    // «В план» offers the first free slot from now, on its day.
    expect(html).toContain('В план: сегодня, 14:35–16:05');
  });

  it('groups the tasks by day, with what each group adds up to', () => {
    const html = calendar([
      open({ id: 'old', name: 'Старый хвост', day: '2026-10-01' }),
      open({ id: 'now', name: 'На сегодня', plannedTime: 3600 }),
      open({ id: 'tmr', name: 'На завтра', day: '2026-10-07' }),
      open({ id: 'far', name: 'Когда-нибудь', day: '2026-11-20' }),
    ]);
    const list = html.slice(html.indexOf('cal-backlog-list'));
    const order = ['Просрочено', 'Сегодня', 'Завтра', 'Позже'].map((label) => list.indexOf(`>${label}<`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('На сегодня</button>'); // the overdue group's move-all
    expect(html).toContain('чт, 1 окт'); // a mixed group names each card's day
    expect(html).toContain('4 задачи · 2 ч 30 м'); // the whole backlog in the header
  });

  it('keeps the instructions folded away and offers a search', () => {
    const html = calendar([open({ id: 'a' })]);
    expect(html).toMatch(/<details class="cal-backlog-help"><summary>Как планировать<\/summary>/);
    expect(html).toContain('placeholder="Найти в бэклоге"');
  });

  it('gives a pinned task no «В план» and no drag', () => {
    const html = calendar([open({ id: 'pin', name: 'Закреплённая', pinned: true })]);
    expect(html).toContain('📌 закреплено');
    expect(html).not.toContain('В план:');
    expect(html).toContain('draggable="false"');
  });

  it('opens at the width it was left at', () => {
    expect(calendar([], { speedrun_backlog_width: '420' })).toContain('--backlog-width:420px');
    expect(calendar([])).toContain('--backlog-width:300px');
    expect(calendar([])).toContain('Бэклог пуст');
  });
});
