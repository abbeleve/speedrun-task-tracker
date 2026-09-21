import { useEffect, useRef } from 'react';
import type { Chain } from './schedule';
import { todayKey } from './history';
import type { Task } from './types';
import type { HabitStore } from './habitStore';
import { signedDur } from './format';
import { overtakeSegments } from './weekOvertake';
import HabitGrid from './HabitGrid';
import KanbanPage from './KanbanPage';
import DaysPage from './DaysPage';
import { ActivityHeatmap, ActivityStatsSummary, SleepTracker, useStatsData } from './StatsPage';

interface HomePageProps {
  // The stretches the day was worked in — see schedule.ts's buildRunChains.
  runChains: Chain[];
  onOpenCalendar: () => void;
  onOpenChain: (chain: Chain) => void;
  habits: HabitStore;
  tasks: Task[];
  // Overtake summed across the current calendar week (Mon–Sun), today's
  // contribution live — see weekOvertake.ts.
  weekOvertakeSec: number;
}

// The track always shows at least this many gray hour-blocks on each side of
// zero, even with nothing filled yet; it grows past that once the overtake
// (or lag) exceeds it, staying symmetric so the zero mark stays centered.
const MIN_SIDE_SEGMENTS = 18;

// A strip of angled hour-blocks centered on zero: filled blocks grow to the
// right (green) when ahead of plan for the week, to the left (red) when
// behind, one solid block per full hour and a partly-filled block for the
// remainder. The current lead/lag sits in the middle in place of a zero mark.
function WeekOvertakeBar({ sec }: { sec: number }) {
  const ahead = sec >= 0;
  const segments = overtakeSegments(sec);
  const sideCount = Math.max(MIN_SIDE_SEGMENTS, segments.length);
  const fill = (i: number) => segments[i] ?? 0;
  const barRef = useRef<HTMLDivElement>(null);

  // Keep the zero point (and the value sitting on it) scrolled into the
  // middle of the strip's viewport rather than off to whichever side the
  // browser opens a fresh scroll container on.
  useEffect(() => {
    const el = barRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [sideCount]);

  return (
    <div className={`home-week-overtake ${ahead ? 'ahead' : 'behind'}`}>
      <span className="home-week-overtake-label">Обгон за неделю</span>
      <div
        ref={barRef}
        className="home-week-overtake-bar"
        role="img"
        aria-label={`Обгон за неделю: ${signedDur(sec)}`}
      >
        <div className="ot-side ot-side-left">
          {Array.from({ length: sideCount }, (_, i) => sideCount - 1 - i).map((i) => (
            <span key={i} className="ot-block">
              <span
                className="ot-block-fill ot-block-fill--neg"
                style={{ width: `${(ahead ? 0 : fill(i)) * 100}%` }}
              />
            </span>
          ))}
        </div>
        <span className="ot-center-value">{signedDur(sec)}</span>
        <div className="ot-side ot-side-right">
          {Array.from({ length: sideCount }, (_, i) => i).map((i) => (
            <span key={i} className="ot-block">
              <span
                className="ot-block-fill ot-block-fill--pos"
                style={{ width: `${(ahead ? fill(i) : 0) * 100}%` }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// The dashboard, top to bottom: this week's overtake, the activity heatmap,
// the habit tracker, the yearly stats summary, the sleep tracker, the kanban
// board and the worked-sequences timeline. The plan itself lives on the
// calendar.
//
// The board still reads and writes the backend directly, so the calendar's
// store is flushed before this page is shown and re-read when it is left.
function HomePage({
  runChains,
  onOpenCalendar,
  onOpenChain,
  habits,
  tasks,
  weekOvertakeSec,
}: HomePageProps) {
  const stats = useStatsData();
  return (
    <div className="home-page">
      <WeekOvertakeBar sec={weekOvertakeSec} />
      <section className="home-panel home-panel--activity">
        <ActivityHeatmap stats={stats} habits={habits.habits} entries={habits.entries} tasks={tasks} />
      </section>
      <HabitGrid store={habits} tasks={tasks} date={todayKey()} />
      <section className="home-panel home-panel--stats-summary">
        <ActivityStatsSummary stats={stats} />
      </section>
      <section className="home-panel home-panel--sleep">
        <SleepTracker stats={stats} />
      </section>
      <section className="home-panel home-panel--kanban">
        <KanbanPage activeDay={todayKey()} onOpenCalendar={onOpenCalendar} />
      </section>
      <section className="home-panel home-panel--days">
        <DaysPage runChains={runChains} onOpenChain={onOpenChain} />
      </section>
    </div>
  );
}

export default HomePage;
