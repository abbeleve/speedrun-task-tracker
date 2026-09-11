import type { RunRecord, Task } from './types';
import KanbanPage from './KanbanPage';
import DaysPage from './DaysPage';
import StatsPage from './StatsPage';

interface HomePageProps {
  activeDay: string;
  liveActiveTasks: Task[] | null;
  mutateActive: (updater: (tasks: Task[]) => Task[]) => void;
  onOpenTimeline: () => void;
  onOpenRun: (run: RunRecord) => void;
}

// The dashboard that gathers the three previously separate pages on one screen:
// the kanban board (left), the saved-days timeline (right) and the statistics
// page (below). The tracker itself lives on its own tab.
function HomePage({ activeDay, liveActiveTasks, mutateActive, onOpenTimeline, onOpenRun }: HomePageProps) {
  return (
    <div className="home-page">
      <div className="home-top">
        <section className="home-panel home-panel--kanban">
          <KanbanPage
            activeDay={activeDay}
            liveActiveTasks={liveActiveTasks}
            mutateActive={mutateActive}
            onOpenTimeline={onOpenTimeline}
          />
        </section>
        <section className="home-panel home-panel--days">
          <DaysPage onOpenRun={onOpenRun} />
        </section>
      </div>
      <section className="home-panel home-panel--stats">
        <StatsPage />
      </section>
    </div>
  );
}

export default HomePage;
