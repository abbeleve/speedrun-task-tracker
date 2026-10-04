import type { Deadline, Task } from './types';
import { dateKey, shiftDayKey } from './history';
import { dayStartMs, isDone, isScheduled, taskEndMs } from './schedule';
import { clockTime } from './format';

export type DeadlineState = 'open' | 'soon' | 'overdue' | 'done';

export function deadlineDueMs(deadline: Deadline): number {
  // Construct local wall time, including DST, rather than adding 24 hours.
  if (deadline.dueTime === null) return dayStartMs(shiftDayKey(deadline.dueDay, 1)) - 1;
  const date = new Date(dayStartMs(deadline.dueDay));
  date.setHours(Math.floor(deadline.dueTime / 60), deadline.dueTime % 60, 0, 0);
  return date.getTime();
}

export function deadlineState(deadline: Deadline, now: number): DeadlineState {
  if (deadline.completedAt !== null) return 'done';
  if (deadlineDueMs(deadline) < now) return 'overdue';
  return deadline.dueDay <= shiftDayKey(dateKey(new Date(now)), 1) ? 'soon' : 'open';
}

// Labels show only the absolute due date/time, never a countdown or buffer.
export function deadlineLabel(deadline: Deadline, includeDate = true): string {
  const date = new Date(dayStartMs(deadline.dueDay));
  const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = deadline.dueTime === null ? 'весь день' : clockTime(deadlineDueMs(deadline));
  return includeDate ? `${label} · ${time}` : time;
}

// The few characters a block has room for: the due time when the block is on
// the due day itself (nothing for a date-only one, the flag says it), else the
// day and month, with the year only when it differs from the block's.
export function deadlineShortLabel(deadline: Deadline, taskDay: string): string {
  if (deadline.dueDay === taskDay) return deadline.dueTime === null ? '' : clockTime(deadlineDueMs(deadline));
  const sameYear = deadline.dueDay.slice(0, 4) === taskDay.slice(0, 4);
  return new Date(dayStartMs(deadline.dueDay)).toLocaleDateString('ru-RU', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function openDeadlines(deadlines: Deadline[]): Deadline[] {
  return deadlines.filter((deadline) => deadline.completedAt === null)
    .sort((a, b) => deadlineDueMs(a) - deadlineDueMs(b) || a.id.localeCompare(b.id));
}

export function deadlinePlanLate(deadline: Deadline, tasks: Task[]): boolean {
  return deadline.completedAt === null && tasks.some((task) =>
    task.deadlineId === deadline.id && isScheduled(task) && !isDone(task)
    && taskEndMs(task) > deadlineDueMs(deadline));
}

export interface DeadlineCluster { minute: number; deadlines: Deadline[] }

// Nearby flags share a marker and open a picker; no deadline is hidden by an
// overlapping label, and distant deadlines keep their precise grid position.
export function deadlineClusters(deadlines: Deadline[], day: string, minGap: number): DeadlineCluster[] {
  const timed = deadlines.filter((deadline) => deadline.dueDay === day && deadline.dueTime !== null)
    .sort((a, b) => a.dueTime! - b.dueTime! || a.id.localeCompare(b.id));
  const clusters: DeadlineCluster[] = [];
  for (const deadline of timed) {
    const last = clusters.at(-1);
    if (last && deadline.dueTime! - last.minute < minGap) last.deadlines.push(deadline);
    else clusters.push({ minute: deadline.dueTime!, deadlines: [deadline] });
  }
  return clusters;
}
