// Duration formatting shared by every view.
//
// The app used to own a session timer here (useTimer); since the calendar
// rework time comes from the wall clock, so only the formatters remain.

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
