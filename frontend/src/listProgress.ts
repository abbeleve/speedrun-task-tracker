import type { Task } from './types';

// How far the run has progressed through a single task, as a percentage in
// [0, 100]. `startSec` is the task's planned start (cumulative time), so the
// value is driven by the timeline position, not wall-clock time.
export function progressPct(task: Task | undefined, startSec: number, elapsedSec: number): number {
  if (!task || task.plannedTime <= 0) return 0;
  const raw = ((elapsedSec - startSec) / task.plannedTime) * 100;
  return Math.max(0, Math.min(100, raw));
}
