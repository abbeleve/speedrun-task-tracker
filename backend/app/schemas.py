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
