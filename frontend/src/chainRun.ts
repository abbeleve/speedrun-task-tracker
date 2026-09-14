// Adapter: a calendar sequence → the elapsed-clock "run" the thermometer,
// spiral and list views were built for.
//
// Those views draw a plan as one continuous strip of planned seconds and a
// playhead at `elapsedSec`. A sequence is exactly that, except that it lives on
// the wall clock and may contain parallel blocks. So the chain is flattened —
// every block laid end to end — and real time is mapped onto that strip group
// by group: a group's real span covers the sum of its blocks' durations, which
// for an ordinary (one block per group) sequence is the identity.

import type { Task } from './types';
import type { Chain } from './schedule';

interface Mark {
  realFromMs: number;
  realToMs: number;
  runFromSec: number;
  runToSec: number;
}

export interface ChainRun {
  // The chain's tasks, flattened in order, with `completedAt` expressed in
  // seconds from the start of the run (what the views read).
  tasks: Task[];
  cumulativeTimes: number[];
  totalSec: number;
  startMs: number;
  // Wall-clock instant → position on the flattened strip, in seconds.
  toRunSec: (ms: number) => number;
  // Position on the strip → wall-clock instant.
  toWallMs: (sec: number) => number;
}

export function buildChainRun(chain: Chain): ChainRun {
  const flat: Task[] = [];
  const cumulativeTimes: number[] = [];
  const marks: Mark[] = [];
  let cursor = 0;

  for (const group of chain.groups) {
    const runFromSec = cursor;
    for (const task of group.tasks) {
      cumulativeTimes.push(cursor);
      flat.push(task);
      cursor += Math.max(0, task.plannedTime);
    }
    marks.push({
      realFromMs: group.startMs,
      realToMs: group.endMs,
      runFromSec,
      runToSec: cursor,
    });
  }

  const totalSec = cursor;
  const startMs = chain.startMs;

  const toRunSec = (ms: number): number => {
    if (marks.length === 0) return 0;
    if (ms <= marks[0].realFromMs) return 0;
    for (const mark of marks) {
      if (ms < mark.realFromMs) return mark.runFromSec; // inside a seam
      if (ms <= mark.realToMs) {
        const realSpan = mark.realToMs - mark.realFromMs;
        const runSpan = mark.runToSec - mark.runFromSec;
        if (realSpan <= 0) return mark.runToSec;
        return mark.runFromSec + ((ms - mark.realFromMs) / realSpan) * runSpan;
      }
    }
    // Past the plan: the clock keeps running, one second per second.
    const last = marks[marks.length - 1];
    return last.runToSec + (ms - last.realToMs) / 1000;
  };

  const toWallMs = (sec: number): number => {
    if (marks.length === 0) return startMs;
    for (const mark of marks) {
      if (sec <= mark.runToSec) {
        const realSpan = mark.realToMs - mark.realFromMs;
        const runSpan = mark.runToSec - mark.runFromSec;
        if (runSpan <= 0) return mark.realFromMs;
        return (
          mark.realFromMs + ((Math.max(sec, mark.runFromSec) - mark.runFromSec) / runSpan) * realSpan
        );
      }
    }
    const last = marks[marks.length - 1];
    return last.realToMs + (sec - last.runToSec) * 1000;
  };

  const tasks = flat.map((task) => ({
    ...task,
    completedAt: task.finishedAt !== null ? toRunSec(task.finishedAt) : null,
  }));

  return { tasks, cumulativeTimes, totalSec, startMs, toRunSec, toWallMs };
}
