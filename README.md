# ⏱ SpeedRun Task Tracker

A calendar you can speedrun. Plan the day the way you would in Google Calendar — real slots, real times, parallel blocks — then close tasks as you go and watch the **overtake**: the time you have won back from the plan and can spend on everything that follows. Any run of back-to-back blocks can be opened in the LiveSplit-style views (thermometer, spiral route, list) and run against the clock.

![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript) ![Stack](https://img.shields.io/badge/Vite-8-646cff?logo=vite) ![Stack](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)

## Frontend + Backend

The app is split into two parts:

- `frontend/` — React + Vite SPA (calendar, dashboard, kanban board and the sequence visualisations: timeline, spiral, list).
- `backend/` — FastAPI + SQLite REST API (users, the per-day plan, daily totals, sleep log).

All user data lives in the backend's SQLite file, scoped per account (registration
& login are included). Deployment instructions for a bare server are in
[`DEPLOY.md`](./DEPLOY.md).

## Features

- **Calendar** — day / week / month views with an hour grid: drag on empty space to create a block, drag it to move (across days too), drag either edge to resize, click to edit. The backlog rail holds unplanned tasks; drop one on the grid to give it a time. Hover a day in the 3-day/week views to see reminder details and the first real break after the current or next uninterrupted work stretch.
- **Pinned tasks** — pin a calendar block or backlog item to lock its placement. It can still be completed and edited; uncheck the pin to move it again.
- **Parallel tasks** — overlapping blocks are laid out side by side, and count as a single group: the group is closed only when its last task is.
- **Overtake (обгон)** — the headline metric: how far ahead of the plan you are running right now. See [the rules](#the-overtake) below.
- **Sequences are explicit** — blocks never connect to each other on their own, however tightly they are laid out: two blocks that touch stay two separate blocks until you say otherwise. A sequence is marked by a spine on the left of the day column; click the spine to open the session editor, drag it to move the whole run at once.
- **Sessions** — blocks that touch or nearly touch (a gap of 5 minutes or less) get a 🔗 handle in the gap: press it and they are pulled together into one named session. Selecting any batch of blocks and pressing *Собрать в отдельную сессию* does the same without them having to be neighbours. A session holds together however its blocks are later moved, can be renamed, dragged as a whole (gaps intact, across midnight too) and pulled apart again.
- **Blocks inside a session join it** — the one connection that needs no approval: drop a block entirely inside a session's span and it becomes a real member of it, so it is never left behind when the session is dragged.
- **Start a session early** — the session editor (and the tracker header) offers ▶ *Начать сейчас*: the whole run slides to the current moment and opens in the tracker views.
- **Thermometer timeline** — vertical fill bar that grows as the sequence's time passes, color-coded by task
- **Spiral route** — zooming spiral view where one full turn (360°) equals one hour of planned time; every task's planet is visible at once, far ones rendered smaller, and sub-pixel planets culled
- **List timeline** — a plain task list (emoji avatar, name, finish time and schedule delta per row); the task the sequence has reached expands into a thermometer that tapers back into the spine, with a motivational picture card beside it (pictures are served by the backend from `MOTIVATION_DIR`)
- **Kanban board** — plan tasks ahead across days in three columns (Open → In-Progress → Done); dragging an Open task into In-Progress puts it on that day's calendar, after everything already planned there
- **Recurring tasks** — a task can repeat on a fixed interval or walk a spaced-repetition series (1 → 3 → 7 → 16 → 35 days, scaled by a base); closing it schedules the next occurrence at the same time of day
- **Wall-clock only** — no session to start, pause or reset: the day runs on the real clock, and ✓ records the moment a task was actually closed
- **Statistics** — the heatmap and the sleep tracker are derived from the plan itself: work/rest seconds come from the blocks that were really closed
- **Dark & light themes** — every view, including the spiral, adapts to the active theme
- **Space background** — layered depth: far starfield and constellation clusters stay fixed, near stars endlessly stream outward from the spiral's center
- **Time scrubbing** — drag the thermometer or the spiral route to inspect another moment of a sequence; one click returns to now
- **Per-user accounts** — register / log in; the plan, the daily totals and the sleep log are stored server-side per user
- **Task customization** — emoji and color per task, including a user-built animated gradient with 2–5 colors, adjustable flow direction and speed; reflected across the calendar, backlog and Kanban views
- **Habits** — per-user habit tracker on the home page. Each habit is either *count* (a daily quota of units, e.g. 10 отжиманий) or *time* (a daily quota of minutes, e.g. 300 ≈ 5 часов). The habit cards live in a draggable grid you can reorder; each card shows today's progress vs its quota and a per-day history. Link a task to a habit in the block editor: closing that task adds the block's minutes to a *time* habit automatically, and count habits are advanced by hand with +/−.

## The overtake

Everything below is computed from the plan and the current time — nothing is stored,
so reloading mid-day never changes the number
([`credit.ts`](./frontend/src/credit.ts), with the worked examples in
[`credit.test.ts`](./frontend/src/credit.test.ts)).

| Situation | What happens to the lead |
| --- | --- |
| A block is closed before its slot ends | The lead becomes `planned end − now`: the rest of the plan may start that much earlier |
| The next block starts immediately | The lead keeps running against it — finish inside the shifted slot and it is kept, overrun and it melts away |
| The next block is hours off | The lead is frozen and waits. When you get there you may start that much earlier, so the lead is kept rather than spent |
| Blocks run in parallel | They are one group: the lead is measured from the latest planned end in the group to the moment its last task was closed |
| A block was already closed before its slot begins | Its whole duration is added to the lead when the plan reaches it |
| Midnight passes while the blocks keep coming | The lead carries over — a "day" is the working session, not the date |
| The session is put down for 10 minutes and picked up after midnight | That is a new working day: the lead starts from zero. Inside one date even a long gap keeps it |

The calendar shows the lead three ways: the HUD number (frozen or running), a
green band between the now-line and where the plan effectively stands, and a
per-block delta on every closed block.

## Local development

**Prerequisites:** Node.js 20+ and Python 3.12+.

```bash
# 1. Backend (http://localhost:8000)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn app.main:app --reload   # or: python run.py

# 2. Frontend (http://localhost:5173, proxies /api to the backend)
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). In dev the Vite server
proxies every `/api/*` request to the backend, so no CORS config is needed.

Use the **register** tab on the login screen to create an account (a token is
stored in `localStorage` and sent as `Authorization: Bearer ...`).

Motivational pictures for the List view are served by the backend from
`backend/data/motivation/` (override with the `MOTIVATION_DIR` env var). Drop
images there — they are picked up automatically and are not committed to git.

## Scripts

| Location   | Command              | Description                          |
| ---------- | -------------------- | ------------------------------------ |
| `frontend` | `npm run dev`        | Start Vite dev server (port 5173)    |
| `frontend` | `npm run build`      | Type-check & production build → `dist/` |
| `frontend` | `npm run preview`    | Preview the build locally            |
| `frontend` | `npm run lint`       | Run ESLint                           |
| `frontend` | `npm test`           | Run frontend unit tests (Vitest)     |
| `backend`  | `python -m pytest`   | Run backend API tests                |
| `backend`  | `python run.py`      | Start the API on port 8000           |

## How to Use

1. **Register / log in** — data is tied to your account.
2. **Plan the day** — on the calendar, drag on the grid to create a block, or drop one from the backlog. Set the emoji, colour, length and (optionally) a repeat rule in the dialog. Blocks may overlap: that is a parallel group.
3. **Work the plan** — press ✓ on a block the moment you really finish it. The HUD shows your lead, what closing the running block right now would bank, and when the rest of the plan will be done.
4. **Glue a sequence** — press the 🔗 handle between two blocks (or select a batch and *Собрать в отдельную сессию*) to make them one session, then click its spine to open it in the thermometer / spiral / list views and close splits from there.
5. **Look back** — the dashboard (🏠) holds the kanban board, every stretch you have worked, and the statistics page.

## CI / CD

GitHub Actions runs on push / PR (see `.github/workflows/deploy.yml`):

- **backend** — installs deps, runs `pytest`
- **frontend** — `npm ci`, lint, Vitest tests, production build (uploaded as an artefact)
- **deploy** — only on push to `master`: pulls the backend on the server, ships the
  pre-built `dist/` over SCP, restarts the systemd service and checks `/api/health`

## Tech Stack

- **Frontend:** React 19 + TypeScript 6 + Vite 8, CSS custom properties
- **Backend:** FastAPI + Uvicorn + SQLite (stdlib `sqlite3`), PBKDF2 password hashing, opaque bearer tokens
- **Tests:** pytest (backend), Vitest (frontend unit)
