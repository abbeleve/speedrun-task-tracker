import { describe, expect, it } from 'vitest';
import DaysPage from './DaysPage';
import HabitGrid from './HabitGrid';
import KanbanPage from './KanbanPage';
import { ActivityHeatmap, ActivityStatsSummary, SleepTracker } from './StatsPage';

// App re-renders on every clock tick (twice a second) and the home page with
// it. Only the weekly overtake strip reads the clock; every other panel has to
// skip those renders, or the sleep grid (thousands of cell buttons), the
// heatmap and the board are rebuilt twice a second and the page stutters on
// every scroll, hover and habit +.
const REACT_MEMO = Symbol.for('react.memo');

describe('dashboard panels', () => {
  it.each([
    ['HabitGrid', HabitGrid],
    ['ActivityHeatmap', ActivityHeatmap],
    ['ActivityStatsSummary', ActivityStatsSummary],
    ['SleepTracker', SleepTracker],
    ['KanbanPage', KanbanPage],
    ['DaysPage', DaysPage],
  ])('%s is memoized against the clock tick', (_, component) => {
    expect((component as unknown as { $$typeof?: symbol }).$$typeof).toBe(REACT_MEMO);
  });
});
