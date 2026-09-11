// API client for the FastAPI backend (frontend/backend split).
// Every request goes to the same origin under /api: in dev Vite proxies it to
// the backend, in production Nginx does the same. Auth is a bearer token stored
// in localStorage and attached to each request.

import { todayKey } from './history';
import type { DayState, DayStats, RunRecord, TaskTemplate, Template } from './types';

const TOKEN_KEY = 'speedrun_token';

export class AuthError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'AuthError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new Error('Network error — is the backend running?');
  }

  if (res.status === 401) {
    setToken(null);
    throw new AuthError();
  }

  if (!res.ok) {
    let detail = `API error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : detail;
    } catch {
      // non-JSON error body — keep default message
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return undefined as T;
}

// ── Shared types (server contract) ─────────────────────────────────

export interface SleepLogData {
  hours: number[];
  quality: number | null;
}

// Re-export the shared entities so callers can import them uniformly from ./api.
export type { DayState, DayStats, RunRecord, Template, TaskTemplate } from './types';

// ── Auth ───────────────────────────────────────────────────────────

export async function register(username: string, password: string): Promise<{ token: string; username: string }> {
  return apiFetch('/register', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export async function login(username: string, password: string): Promise<{ token: string; username: string }> {
  return apiFetch('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
}

export async function me(): Promise<{ id: number; username: string }> {
  return apiFetch('/me');
}

// ── History (daily sprints) ────────────────────────────────────────

export async function loadHistory(): Promise<Record<string, DayStats>> {
  return apiFetch('/history');
}

export async function saveDayStats(date: string, stats: DayStats): Promise<void> {
  await apiFetch(`/history/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(stats),
  });
}

// Mirrors the old localStorage behaviour: accumulate a run's work/rest and session
// count on the server (the backend upserts the whole day entry). A run is tied to
// the day it started (passed in), not the day it happens to end.
export async function addSessionToHistory(workSec: number, restSec: number, date: string = todayKey()): Promise<void> {
  const hist = await loadHistory();
  const cur = hist[date];
  const next: DayStats = {
    date,
    workSec: (cur?.workSec ?? 0) + workSec,
    restSec: (cur?.restSec ?? 0) + restSec,
    sessions: (cur?.sessions ?? 0) + 1,
  };
  await saveDayStats(date, next);
}

// Individual completed runs (one row per session), so a day can list them.
export async function loadRuns(): Promise<RunRecord[]> {
  return apiFetch('/runs');
}

export async function addRun(run: Omit<RunRecord, 'id'>): Promise<void> {
  await apiFetch('/runs', {
    method: 'POST',
    body: JSON.stringify(run),
  });
}

// ── Per-day tracker state (tasks + timeline progress) ──────────────

export async function loadDay(date: string): Promise<DayState> {
  return apiFetch(`/day/${encodeURIComponent(date)}`);
}

export async function saveDay(date: string, state: DayState): Promise<void> {
  await apiFetch(`/day/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(state),
  });
}

export async function loadDayDates(): Promise<string[]> {
  return apiFetch('/day-dates');
}

export async function loadDays(): Promise<Record<string, DayState>> {
  return apiFetch('/days');
}

// ── Sleep log ──────────────────────────────────────────────────────

export async function loadSleepLog(): Promise<Record<string, SleepLogData>> {
  return apiFetch('/sleep');
}

export async function saveSleepLog(date: string, entry: SleepLogData | null): Promise<void> {
  const hasData = entry !== null && (entry.hours.length > 0 || entry.quality !== null);
  await apiFetch(`/sleep/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(hasData ? entry : {}),
  });
}

// ── Saved run templates ────────────────────────────────────────────

export async function loadTemplates(): Promise<Template[]> {
  return apiFetch('/templates');
}

export async function saveTemplate(tpl: Template): Promise<void> {
  await apiFetch(`/templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PUT',
    body: JSON.stringify(tpl),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Task templates (sidebar) ───────────────────────────────────────

export async function loadTaskTemplates(): Promise<TaskTemplate[]> {
  return apiFetch('/task-templates');
}

export async function saveTaskTemplate(tpl: TaskTemplate): Promise<void> {
  await apiFetch(`/task-templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PUT',
    body: JSON.stringify(tpl),
  });
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  await apiFetch(`/task-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
