from typing import List, Optional, Union

from pydantic import BaseModel, Field


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    token: str
    username: str


class UserOut(BaseModel):
    id: int
    username: str


class DayStatsIn(BaseModel):
    # Optional/partial: a field left out keeps the day's existing value rather
    # than being zeroed, so a caller that only knows about one of them (the
    # overtake engine saving its per-day result, say) can PUT just that field.
    workSec: Optional[int] = None
    restSec: Optional[int] = None
    sessions: Optional[int] = None
    overtakeSec: Optional[float] = None


class DayStatsOut(BaseModel):
    date: str
    workSec: int
    restSec: int
    sessions: int
    overtakeSec: float


class RepeatConfig(BaseModel):
    # Recurrence rule. 'fixed' repeats every `baseDays` days; 'increasing' walks
    # a ready forgetting-curve series, each step scaled by `baseDays`.
    mode: str = 'fixed'
    baseDays: float = 1


class TaskColorAnimation(BaseModel):
    type: str = 'flow'
    colors: List[str] = Field(default_factory=list)
    # Degrees in new clients; cardinal strings remain accepted so tasks saved
    # before the 360° direction control continue to load and migrate.
    direction: Union[float, str] = 0
    durationSec: float = 6


class DayTask(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    plannedTime: float
    # Session-relative completion in seconds — kept for run snapshots saved
    # before the calendar rework (and for the sequence views, which still run
    # on an elapsed clock).
    completedAt: Optional[float] = None
    # Wall-clock slot: minutes from midnight of `day`. None = unplaced backlog.
    start: Optional[float] = None
    # Epoch ms the task was actually finished at; drives the overtake engine.
    finishedAt: Optional[float] = None
    order: int = 0
    emoji: str = ''
    color: str = ''
    colorAnimation: Optional[TaskColorAnimation] = None
    type: str = 'task'
    # Kanban planning: the day the task is scheduled for ('YYYY-MM-DD') and its
    # column — 'open' (backlog), 'in-progress' (on a timeline) or 'done'. Tasks
    # kept in a per-day JSON blob, so legacy rows simply lack these keys and the
    # defaults below fill them in.
    day: str = ''
    status: str = 'open'
    # A pinned task cannot change its calendar/backlog placement until unpinned.
    pinned: bool = False
    # Optional recurrence; absent for one-off tasks. `repeatIndex` is the step in
    # the series and `repeatOf` links an auto-scheduled occurrence to its source.
    repeat: Optional[RepeatConfig] = None
    repeatIndex: int = 0
    repeatOf: Optional[str] = None
    # Explicit session: tasks glued together by hand share a `sessionId` and its
    # name, so the sequence survives a reload and can be moved as one block.
    sessionId: Optional[str] = None
    sessionName: Optional[str] = None
    # User-selected gradient for the calendar sequence/session spine. Stored on
    # every member so a session keeps its appearance across reloads and moves.
    sequenceGradient: Optional[str] = None
    # Optional link to a habit: completing this task grows that habit's daily
    # progress (time habits add the block's duration; count habits add 1).
    habitId: Optional[str] = None


class RunIn(BaseModel):
    date: str
    # Epoch milliseconds. Modelled as float so a fractional timestamp from the
    # client is coerced instead of failing validation with a 422.
    startedAt: float
    endedAt: float
    workSec: int = 0
    restSec: int = 0
    # Snapshot of the session's plan, so a day can show several sessions and
    # each one keeps its own tasks/percent after the tracker is cleared.
    plannedSec: float = 0
    tasks: List[DayTask] = []


class DayStateIn(BaseModel):
    tasks: List[DayTask] = []
    # Legacy session fields: written by clients from before the calendar
    # rework, still accepted so their days round-trip unchanged.
    elapsedMs: float = 0
    timeCredit: float = 0
    sessionState: str = 'idle'
    startedAt: Optional[float] = None


class SleepIn(BaseModel):
    hours: Optional[List[int]] = None
    quality: Optional[int] = None
    # Minutes from midnight. ``bed`` may sit past ``wake``, meaning the night
    # ran through midnight. Absent on entries from clients that only track
    # whole hours, which still round-trip through ``hours`` alone.
    bed: Optional[int] = None
    wake: Optional[int] = None


class TemplateTask(BaseModel):
    name: str
    plannedTime: float
    emoji: str = ''
    color: str = ''
    type: str = 'task'


class TemplateIn(BaseModel):
    id: str
    name: str
    tasks: List[TemplateTask] = []


class TaskTemplateIn(BaseModel):
    id: str
    name: str
    plannedTime: float
    emoji: str = ''
    color: str = ''
    type: str = 'task'


# A habit definition. `format` is 'count' (quota of units/day, e.g. 10 отжиманий)
# or 'time' (quota of minutes/day, e.g. 300 ≈ 5 часов). `target` is in those
# same units; `unit` is the human-readable label ('раз', 'мин', ...). `order`
# is the habit's position in the home-page grid.
class HabitIn(BaseModel):
    id: str
    name: str
    emoji: str = ''
    color: str = ''
    format: str = 'count'
    target: float = 1
    unit: str = ''
    order: int = 0


# The hand-entered portion of a habit's progress for one day. The task-linked
# auto portion is derived live from the day's plan on the frontend.
class HabitEntryIn(BaseModel):
    manual: float = 0
