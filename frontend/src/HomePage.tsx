import type { Chain } from './schedule';
import { todayKey } from './history';
import type { Task } from './types';
import type { HabitStore } from './habitStore';
import HabitGrid from './HabitGrid';
import KanbanPage from './KanbanPage';
import DaysPage from './DaysPage';
import StatsPage from './StatsPage';

interface HomePageProps {
  chains: Chain[];
  onOpenCalendar: () => void;
  onOpenChain: (chain: Chain) => void;
  habits: HabitStore;
  tasks: Task[];
}

// The dashboard: the kanban board (left), the worked sequences (right), the
// habit tracker (full width) and the statistics page (below). The plan itself
// lives on the calendar.
//
// The board still reads and writes the backend directly, so the calendar's
// store is flushed before this page is shown and re-read when it is left.
function HomePage({
  chains,
  onOpenCalendar,
  onOpenChain,
  habits,
  tasks,
}: HomePageProps) {
  return (
    <div className="home-page">
      <div className="home-top">
        <section className="home-panel home-panel--kanban">
          <KanbanPage activeDay={todayKey()} onOpenCalendar={onOpenCalendar} />
        </section>
        <section className="home-panel home-panel--days">
          <DaysPage chains={chains} onOpenChain={onOpenChain} />
        </section>
      </div>
      <HabitGrid store={habits} tasks={tasks} date={todayKey()} />
      <section className="home-panel home-panel--stats">
        <StatsPage />
      </section>
    </div>
  );
}

export default HomePage;
