import { useCallback, useRef, useState } from 'react';
import type { SessionState } from './types';

export function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const stateRef = useRef<SessionState>('idle');
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const tick = useCallback(() => {
    const now = performance.now();
    const delta = now - startRef.current;
    setElapsed(elapsedRef.current + delta);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    stateRef.current = 'running';
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    setSessionState('running');
  }, [tick]);

  const pause = useCallback(() => {
    stateRef.current = 'paused';
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    elapsedRef.current += performance.now() - startRef.current;
    setElapsed(elapsedRef.current);
    setSessionState('paused');
  }, []);

  const resume = useCallback(() => {
    stateRef.current = 'running';
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    setSessionState('running');
  }, [tick]);

  const reset = useCallback(() => {
    stateRef.current = 'idle';
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    elapsedRef.current = 0;
    startRef.current = 0;
    setElapsed(0);
    setSessionState('idle');
  }, []);

  const finish = useCallback(() => {
    stateRef.current = 'finished';
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    elapsedRef.current += performance.now() - startRef.current;
    setElapsed(elapsedRef.current);
    setSessionState('finished');
  }, []);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, ms);
    if (stateRef.current === 'running') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      elapsedRef.current = clamped;
      startRef.current = performance.now();
      setElapsed(clamped);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      elapsedRef.current = clamped;
      setElapsed(clamped);
    }
  }, [tick]);

  return { elapsed, sessionState, start, pause, resume, reset, finish, seek };
}

export function formatTime(ms: number, showMs = true): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const msPart = Math.floor((ms % 1000) / 10);

  if (h > 0) {
    return showMs
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(2, '0')}`
      : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return showMs
    ? `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDelta(ms: number): string {
  if (!isFinite(ms) || ms === 0) return '—';
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const msPart = Math.floor((abs % 1000) / 10);
  if (h > 0) {
    return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(2, '0')}`;
  }
  if (m > 0) {
    return `${sign}${m}:${String(s).padStart(2, '0')}.${String(msPart).padStart(2, '0')}`;
  }
  return `${sign}${s}.${String(msPart).padStart(2, '0')}`;
}
