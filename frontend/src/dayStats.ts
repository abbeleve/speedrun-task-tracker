// Daily totals, derived from the plan itself.
//
// There are no runs to log any more: the calendar *is* the record of the day.
// So the heatmap's work/rest seconds are read straight off the blocks that were
// actually closed, and "sessions" counts the sequences a day was worked in.

import type { DayStats, Task } from './types';
import { buildGroups, buildRuns, isDone, taskEndMs, taskStartMs } from './schedule';

// Time a closed block really occupied: from its planned start to the moment it
// was closed, never beyond its planned end (finishing late does not invent
// extra work, finishing early honestly counts less).
function spentSec(task: Task): number {
  const start = taskStartMs(task);
  const end = taskEndMs(task);
  const closed = task.finishedAt ?? end;
  return Math.max(0, Math.min(closed, end) - start) / 1000;
}

export function dayStatsFromTasks(date: string, tasks: Task[]): Omit<DayStats, 'overtakeSec'> {
  let workSec = 0;
  let restSec = 0;
  for (const task of tasks) {
    // Reminders never count towards productivity, whatever their status ends
    // up being — they are a service overlay, not work (see types.ts).
    if (task.status === 'open' || task.type === 'reminder' || !isDone(task)) continue;
    const spent = spentSec(task);
    if (task.type === 'rest') restSec += spent;
    else workSec += spent;
  }
  // A day's "sessions" are the stretches it was actually worked in: the clock
  // running without a break counts once, however many blocks that was split
  // into. Reading runs rather than sequences keeps the count honest now that
  // sequences are explicit — blocks worked back to back are still one stretch
  // whether or not they were ever glued (see schedule.ts's buildRuns).
  const sessions = buildRuns(buildGroups(tasks)).filter((run) =>
    run.some((group) => group.tasks.some(isDone))
  ).length;
  return {
    date,
    workSec: Math.round(workSec),
    restSec: Math.round(restSec),
    sessions,
  };
}
