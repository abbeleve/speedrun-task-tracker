import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Deadline } from './types';
import * as api from './api';

export interface DeadlineStore {
  deadlines: Deadline[];
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
  upsert: (deadline: Deadline) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useDeadlines(): DeadlineStore {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setDeadlines(await api.loadDeadlines());
      setReady(true);
      setError(null);
    } catch {
      setError('Не удалось загрузить дедлайны');
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // Confirm writes before announcing completion. The editor prevents a second
  // mutation while a save is in flight, so closing/reopening cannot race.
  const upsert = useCallback(async (deadline: Deadline) => {
    await api.saveDeadline(deadline);
    setDeadlines((previous) => [...previous.filter((item) => item.id !== deadline.id), deadline]);
  }, []);
  const remove = useCallback(async (id: string) => {
    await api.deleteDeadline(id);
    setDeadlines((previous) => previous.filter((item) => item.id !== id));
  }, []);
  return useMemo(() => ({ deadlines, ready, error, reload, upsert, remove }),
    [deadlines, ready, error, reload, upsert, remove]);
}
