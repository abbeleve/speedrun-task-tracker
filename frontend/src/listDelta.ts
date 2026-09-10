import type { Task } from './types';

// Signed milliseconds of schedule delta for a task: negative = finished ahead of
// the planned finish, positive = behind it. Only completed tasks have an actual
// delta; anything still to be run returns null.
export function taskDeltaMs(task: Task, plannedEndSec: number): number | null {
  if (task.completedAt === null) return null;
  return (task.completedAt - plannedEndSec) * 1000;
}
