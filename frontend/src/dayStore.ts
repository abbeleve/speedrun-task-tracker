// The whole plan, in one place.
//
// The calendar shows weeks and months at a time, so a single open day is not
// enough any more: every day the account has is held here as date → tasks, and
// writes go back to the backend per day, debounced. Legacy days are migrated to
// wall-clock slots as they are read and saved back in the new shape.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from './types';
import * as api from './api';
import { normalizeTasks, preservePinnedPlacement } from './tasks';
import { migrateDayTasks, absorbIntoSessions } from './schedule';
import { dayStatsFromTasks } from './dayStats';

export type DaysByDate = Record<string, Task[]>;

const SAVE_DEBOUNCE_MS = 600;

export interface DayStore {
  days: DaysByDate;
  tasks: Task[]; // every task of every day, flattened
  ready: boolean;
  // A (re)load from the backend is in flight: the plan held here may be stale.
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Replace the tasks of one day.
  mutateDay: (date: string, updater: (tasks: Task[]) => Task[]) => void;
  // Add or replace a task, moving it between days when `task.day` changed.
  upsertTask: (task: Task) => void;
  // Patch a task by id; a patch that changes `day` moves it between days.
  patchTask: (id: string, patch: Partial<Task>) => void;
  // Patch several tasks in one write — how a whole session is moved.
  patchTasks: (patches: { id: string; patch: Partial<Task> }[]) => void;
  removeTask: (id: string) => void;
  // Remove several tasks in one write — how a selected batch is deleted.
  removeTasks: (ids: string[]) => void;
  flush: () => void;
}

export function useDayStore(): DayStore {
  const [days, setDays] = useState<DaysByDate>({});
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadsInFlightRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const daysRef = useRef<DaysByDate>(days);
  daysRef.current = days;
  const dirtyRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const dates = [...dirtyRef.current];
    dirtyRef.current.clear();
    for (const date of dates) {
      const tasks = daysRef.current[date] ?? [];
      void api
        .saveDay(date, { date, tasks })
        .catch((e) => console.error('Failed to save day', date, e));
      // The day's totals are derived from the plan, so they are refreshed
      // alongside it — that is what feeds the heatmap and the statistics page.
      void api
        .saveDayStats(date, dayStatsFromTasks(date, tasks))
        .catch((e) => console.error('Failed to save day stats', date, e));
    }
  }, []);

  const markDirty = useCallback(
    (dates: string[]) => {
      for (const date of dates) dirtyRef.current.add(date);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  const reload = useCallback(async () => {
    loadsInFlightRef.current++;
    setLoading(true);
    try {
      const raw = await api.loadDays();
      const next: DaysByDate = {};
      const migrated: string[] = [];
      for (const [date, state] of Object.entries(raw)) {
        const normalized = normalizeTasks(state.tasks, date);
        const withSlots = migrateDayTasks(normalized, date, state.startedAt);
        next[date] = withSlots;
        if (withSlots !== normalized) migrated.push(date);
      }
      setDays(next);
      setReady(true);
      setError(null);
      // Persist the migration once, so the legacy shape is read only one time.
      if (migrated.length > 0) {
        daysRef.current = next;
        markDirty(migrated);
      }
    } catch (e) {
      console.error('Failed to load days', e);
      setError('Не удалось загрузить план');
      setReady(true);
    } finally {
      loadsInFlightRef.current--;
      setLoading(loadsInFlightRef.current > 0);
    }
  }, [markDirty]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Nothing in flight should be lost when the tab goes away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  // Every mutation works off `daysRef`, which is kept in step with the state,
  // and writes the new map straight back: several edits in the same tick then
  // compose instead of racing, and the dirty bookkeeping stays out of React's
  // state updater (which may run twice).
  const commit = useCallback(
    (next: DaysByDate, touched: string[]) => {
      // Keep the invariant that a block standing entirely inside a session is
      // really a member of it, and not just visually in the middle of one: a
      // mutation that drops a block into a session's span joins it on the spot.
      // Touched dates are the only ones whose session layout could have changed.
      const joined: DaysByDate = {};
      for (const [date, list] of Object.entries(next)) {
        joined[date] = touched.includes(date) ? absorbIntoSessions(list) : list;
      }
      daysRef.current = joined;
      setDays(joined);
      markDirty(touched);
    },
    [markDirty]
  );

  const mutateDay = useCallback(
    (date: string, updater: (tasks: Task[]) => Task[]) => {
      const prev = daysRef.current;
      commit({ ...prev, [date]: updater(prev[date] ?? []) }, [date]);
    },
    [commit]
  );

  const upsertTask = useCallback(
    (task: Task) => {
      const prev = daysRef.current;
      const previousTask = Object.values(prev).flat().find((candidate) => candidate.id === task.id);
      const safeTask = preservePinnedPlacement(previousTask, task);
      const next: DaysByDate = {};
      const touched = new Set<string>([safeTask.day]);
      for (const [date, list] of Object.entries(prev)) {
        const without = list.filter((t) => t.id !== safeTask.id);
        if (without.length !== list.length && date !== safeTask.day) touched.add(date);
        next[date] = without;
      }
      next[safeTask.day] = [...(next[safeTask.day] ?? []), safeTask];
      commit(next, [...touched]);
    },
    [commit]
  );

  // One pass over the plan applying a patch per task id, so a whole session
  // moves in a single commit instead of a burst of them.
  const patchTasks = useCallback(
    (patches: { id: string; patch: Partial<Task> }[]) => {
      if (patches.length === 0) return;
      const byId = new Map(patches.map((p) => [p.id, p.patch]));
      const prev = daysRef.current;
      const next: DaysByDate = {};
      const touched: string[] = [];
      const moved: Task[] = [];
      for (const [date, list] of Object.entries(prev)) {
        let changed = false;
        const updated: Task[] = [];
        for (const task of list) {
          const patch = byId.get(task.id);
          if (!patch) {
            updated.push(task);
            continue;
          }
          changed = true;
          const patched = preservePinnedPlacement(task, { ...task, ...patch });
          // A patch that moves the task to another date re-buckets it.
          if (patched.day !== date) moved.push(patched);
          else updated.push(patched);
        }
        next[date] = changed ? updated : list;
        if (changed) touched.push(date);
      }
      for (const task of moved) {
        next[task.day] = [...(next[task.day] ?? []), task];
        touched.push(task.day);
      }
      commit(next, touched);
    },
    [commit]
  );

  const patchTask = useCallback(
    (id: string, patch: Partial<Task>) => patchTasks([{ id, patch }]),
    [patchTasks]
  );

  const removeTask = useCallback(
    (id: string) => {
      const prev = daysRef.current;
      const next: DaysByDate = {};
      const touched: string[] = [];
      for (const [date, list] of Object.entries(prev)) {
        const without = list.filter((t) => t.id !== id);
        next[date] = without;
        if (without.length !== list.length) touched.push(date);
      }
      commit(next, touched);
    },
    [commit]
  );

  const removeTasks = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const prev = daysRef.current;
      const next: DaysByDate = {};
      const touched: string[] = [];
      for (const [date, list] of Object.entries(prev)) {
        const without = list.filter((t) => !idSet.has(t.id));
        next[date] = without;
        if (without.length !== list.length) touched.push(date);
      }
      commit(next, touched);
    },
    [commit]
  );

  const tasks = useMemo(() => Object.values(days).flat(), [days]);

  return {
    days,
    tasks,
    ready,
    loading,
    error,
    reload,
    mutateDay,
    upsertTask,
    patchTask,
    patchTasks,
    removeTask,
    removeTasks,
    flush,
  };
}
