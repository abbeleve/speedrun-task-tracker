import type { Task, TaskTemplate } from './types';
import { newTaskId } from './tasks';

// A template describes the task, not an occurrence or a place on the calendar.
// Every use starts a fresh, unscheduled backlog item on the chosen day.
export function taskFromTemplate(template: TaskTemplate, day: string): Task {
  return {
    id: newTaskId(),
    name: template.name,
    plannedTime: template.plannedTime,
    emoji: template.emoji,
    color: template.color,
    type: template.type,
    day,
    status: 'open',
    start: null,
    completedAt: null,
    finishedAt: null,
    order: 0,
    pinned: false,
    repeat: null,
  };
}
