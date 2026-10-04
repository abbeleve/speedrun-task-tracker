import { memo, useEffect, useMemo, useState } from 'react';
import type { Habit, HabitEntry, Task } from './types';
import { closeWarning, closedWarnings, habitStreak, streakWarningText, warningKey } from './streak';
import { pushActive } from './push';
import { StreakFlame } from './StreakFlame';

interface StreakAlertsProps {
  habits: Habit[];
  entries: HabitEntry[];
  tasks: Task[];
  date: string; // today, 'YYYY-MM-DD' (local)
  stage: number | null; // hours left in the day once 3 or fewer — see streakWarnStage
  onOpen: (habitId: string) => void;
}

// Three, two and one hour before midnight, a card in the corner for every
// streak habit whose quota is still not met. Each stage shows until it is
// closed or the quota is met. A browser with pushes on gets the same warning
// from the server (backend/app/streak.py), so the page keeps quiet there.
function StreakAlerts({ habits, entries, tasks, date, stage, onOpen }: StreakAlertsProps) {
  const [closed, setClosed] = useState(() => ({ date, keys: closedWarnings(date) }));
  const [pushOn, setPushOn] = useState<boolean | null>(null);

  // Read again at every stage: pushes may have been switched since.
  useEffect(() => {
    if (stage === null) return;
    let live = true;
    pushActive()
      .then((on) => live && setPushOn(on))
      .catch(() => live && setPushOn(false));
    return () => {
      live = false;
    };
  }, [stage]);

  const due = useMemo(
    () =>
      stage === null
        ? []
        : habits
            .filter((habit) => habit.streak)
            .map((habit) => ({ habit, streak: habitStreak(habit, date, tasks, entries) }))
            .filter(({ streak }) => !streak.todayDone),
    [habits, entries, tasks, date, stage]
  );

  if (stage === null || pushOn !== false) return null;
  const closedKeys = closed.date === date ? closed.keys : [];
  const shown = due.filter(({ habit }) => !closedKeys.includes(warningKey(habit.id, stage)));
  if (shown.length === 0) return null;

  const close = (habitId: string) => {
    const key = warningKey(habitId, stage);
    closeWarning(date, key);
    setClosed({ date, keys: [...closedKeys, key] });
  };

  return (
    <div className="streak-alerts" role="status" aria-live="polite">
      {shown.map(({ habit, streak }) => (
        <div
          key={`${habit.id}:${stage}`}
          className="streak-alert"
          style={{ '--habit-color': habit.color } as React.CSSProperties}
        >
          <StreakFlame lit={false}>
            <span className="streak-flame-num">{streak.days}</span>
          </StreakFlame>
          <div className="streak-alert-text">
            <strong>
              {habit.emoji} {habit.name}
            </strong>
            <span>{streakWarningText(habit, streak.days, streak.left, stage)}</span>
          </div>
          <div className="streak-alert-actions">
            <button
              type="button"
              className="streak-alert-close"
              onClick={() => close(habit.id)}
              title="Скрыть"
              aria-label="Скрыть напоминание"
            >
              ✕
            </button>
            <button type="button" className="streak-alert-open" onClick={() => onOpen(habit.id)}>
              К привычке
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Memoized: App re-renders on every clock tick.
export default memo(StreakAlerts);
