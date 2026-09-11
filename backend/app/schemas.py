from typing import List, Optional

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
    workSec: int = 0
    restSec: int = 0
    sessions: int = 0


class DayStatsOut(BaseModel):
    date: str
    workSec: int
    restSec: int
    sessions: int


class DayTask(BaseModel):
    id: str
    name: str
    plannedTime: float
    completedAt: Optional[float] = None
    order: int = 0
    emoji: str = ''
    color: str = ''
    type: str = 'task'
    # Kanban planning: the day the task is scheduled for ('YYYY-MM-DD') and its
    # column — 'open' (backlog), 'in-progress' (on a timeline) or 'done'. Tasks
    # kept in a per-day JSON blob, so legacy rows simply lack these keys and the
    # defaults below fill them in.
    day: str = ''
    status: str = 'open'


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
    elapsedMs: float = 0
    timeCredit: float = 0
    sessionState: str = 'idle'
    startedAt: Optional[float] = None


class SleepIn(BaseModel):
    hours: Optional[List[int]] = None
    quality: Optional[int] = None


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
