import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { buildChains, buildGroups, dayStartMs } from './schedule';
import { buildChainRun } from './chainRun';

const DAY = '2026-03-10';
const at = (min: number) => dayStartMs(DAY) + min * 60_000;
const hm = (h: number, m = 0) => h * 60 + m;

let seq = 0;
function task(start: number, minutes: number, done?: number): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `task ${seq}`,
    plannedTime: minutes * 60,
    completedAt: null,
    start,
    finishedAt: done ?? null,
    order: seq,
    emoji: '📋',
    color: '#3498db',
    type: 'task',
    day: DAY,
    status: done ? 'done' : 'in-progress',
  };
}

// The tracker is only ever opened on a real sequence, and blocks are one
// sequence only once they have been glued by hand — so the fixture glues them
// (see schedule.ts's buildChains).
const chainOf = (tasks: Task[]) =>
  buildChains(buildGroups(tasks.map((t) => ({ ...t, sessionId: 's1' }))))[0];

describe('buildChainRun', () => {
  it('flattens a back-to-back sequence one second per second', () => {
    const run = buildChainRun(chainOf([task(hm(10), 60), task(hm(11), 30)]));
    expect(run.cumulativeTimes).toEqual([0, 3600]);
    expect(run.totalSec).toBe(5400);
    expect(run.toRunSec(at(hm(10, 30)))).toBe(1800);
    expect(run.toWallMs(1800)).toBe(at(hm(10, 30)));
  });

  it('turns a real finish timestamp into a run offset', () => {
    const run = buildChainRun(
      chainOf([task(hm(10), 60, at(hm(10, 45))), task(hm(11), 30)])
    );
    expect(run.tasks[0].completedAt).toBe(45 * 60);
    expect(run.tasks[1].completedAt).toBeNull();
  });

  it('pins the clock to the start before the sequence begins', () => {
    const run = buildChainRun(chainOf([task(hm(10), 60)]));
    expect(run.toRunSec(at(hm(9)))).toBe(0);
  });

  it('keeps counting past the end of the plan', () => {
    const run = buildChainRun(chainOf([task(hm(10), 60)]));
    expect(run.toRunSec(at(hm(11, 30)))).toBe(3600 + 1800);
  });

  it('stretches a parallel group over the strip both blocks need', () => {
    // 10:00–11:00 alongside 10:00–10:30: one real hour covers 90 planned
    // minutes, so the playhead runs 1.5× through it.
    const run = buildChainRun(chainOf([task(hm(10), 60), task(hm(10), 30)]));
    expect(run.totalSec).toBe(5400);
    expect(run.toRunSec(at(hm(10, 30)))).toBe(2700);
    expect(run.toRunSec(at(hm(11)))).toBe(5400);
  });
});
