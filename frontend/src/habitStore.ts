// The habit tracker, in one place.
//
// Unlike the day plan (which is edited constantly and debounced per day),
// habits and their manual entries are small, so every mutation just fires its
// own PUT and updates local state on the spot. The task-linked part of the
// progress is never stored here — it is derived live from the day plan.

import { useCallback, useEffect, useState } from 'react';
import type { Habit, HabitEntry } from './types';
import * as api from './api';

export interface HabitStore {
  habits: Habit[];
  entries: HabitEntry[];
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Add or replace a habit (persisted by its id).
  upsert: (habit: Habit) => void;
  remove: (id: string) => void;
  // The hand-entered portion of a habit's progress for one day; 0 clears it.
  setManual: (habitId: string, date: string, manual: number) => void;
  // Persist a new grid order (list of habit ids, front to back).
  reorder: (ids: string[]) => void;
}

export function useHabits(): HabitStore {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [h, e] = await Promise.all([api.loadHabits(), api.loadHabitEntries()]);
      setHabits(h);
      setEntries(e);
      setReady(true);
      setError(null);
    } catch (e) {
      console.error('Failed to load habits', e);
      setError('Не удалось загрузить привычки');
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback((habit: Habit) => {
    setHabits((prev) => {
      const without = prev.filter((h) => h.id !== habit.id);
      const next = [...without, habit].sort((a, b) => a.order - b.order);
      return next;
    });
    void api.saveHabit(habit).catch((e) => console.error('Failed to save habit', habit.id, e));
  }, []);

  const remove = useCallback((id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    setEntries((prev) => prev.filter((e) => e.habitId !== id));
    void api.deleteHabit(id).catch((e) => console.error('Failed to delete habit', id, e));
  }, []);

  const setManual = useCallback((habitId: string, date: string, manual: number) => {
    setEntries((prev) => {
      const rest = prev.filter((e) => !(e.habitId === habitId && e.date === date));
      // A cleared manual value leaves the entry out of the history entirely,
      // so an untouched day reads as "nothing by hand".
      if (manual === 0) return rest;
      return [...rest, { habitId, date, manual }];
    });
    void api
      .saveHabitEntry(habitId, date, manual)
      .catch((e) => console.error('Failed to save habit entry', habitId, date, e));
  }, []);

  const reorder = useCallback((ids: string[]) => {
    setHabits((prev) => {
      const byId = new Map(prev.map((h) => [h.id, h]));
      const next = ids
        .map((id, i) => (byId.get(id) ? { ...byId.get(id)!, order: i } : null))
        .filter((h): h is Habit => h !== null);
      for (const h of next) {
        void api.saveHabit(h).catch((e) => console.error('Failed to save habit order', h.id, e));
      }
      return next;
    });
  }, []);

  return { habits, entries, ready, error, reload, upsert, remove, setManual, reorder };
}
