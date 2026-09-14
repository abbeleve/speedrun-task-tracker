# ⏱ SpeedRun Task Tracker

A LiveSplit-inspired task tracking app: plan tasks on a kanban board, drop them onto a day's timeline, and run the day against the clock on a vertical thermometer or an infinite zooming spiral route — seeing exactly how far ahead (or behind) schedule you are.

![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript) ![Stack](https://img.shields.io/badge/Vite-8-646cff?logo=vite) ![Stack](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)

## Frontend + Backend

The app is split into two parts:

- `frontend/` — React + Vite SPA (dashboard, kanban board and all the run visualisation: timeline, spiral, list).
- `backend/` — FastAPI + SQLite REST API (users, tasks, daily sprints, sleep log, templates).

All user data lives in the backend's SQLite file, scoped per account (registration
& login are included). Deployment instructions for a bare server are in
[`DEPLOY.md`](./DEPLOY.md).

## Features

- **Dashboard** — one home screen with the kanban board, the timeline of saved sessions and the statistics page; the run itself lives on its own tab
- **Kanban board** — plan tasks ahead across days in three columns (Open → In-Progress → Done); dragging an Open task planned for the active day onto In-Progress drops it straight onto that day's timeline, and a task created on the timeline starts as In-Progress
- **Recurring tasks** — a task can repeat on a fixed interval or walk a spaced-repetition series (1 → 3 → 7 → 16 → 35 days, scaled by a base); completing it schedules the next occurrence back into Open
- **Thermometer timeline** — vertical fill bar that grows as time passes, color-coded by task
- **Spiral route** — zooming spiral view where one full turn (360°) equals one hour of planned time; every task's planet is visible at once, far ones rendered smaller, and sub-pixel planets culled
- **List timeline** — a plain task list (emoji avatar, name, finish time and schedule delta per row); the task the run has reached expands into a thermometer that tapers back into the spine, with a motivational picture card beside it (pictures are served by the backend from `MOTIVATION_DIR`)
- **Dark & light themes** — every view, including the spiral, adapts to the active theme
- **Space background** — layered depth: far starfield and constellation clusters stay fixed, near stars endlessly stream outward from the spiral's center
- **Task splits** — each task has a planned time, actual segment time, and live delta (ahead/behind)
- **Time scrubbing** — click & drag on the timeline or the spiral route to manually set the timer
- **Per-user accounts** — register / log in; tasks, daily sprints, sleep log and templates are stored server-side per user
- **Early completion credit** — completing a future task early boosts the current task's delta
- **Task customization** — emoji and color per task; reflected in the thermometer dots
- **Templates** — save, load, export & import task lists as JSON (kept on the backend)
- **Drag & drop** — reorder tasks in idle mode

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
2. **Plan tasks** — on the kanban board pick an emoji & color, enter a name, planned minutes and the day the task is for (optionally a repeat rule); it lands in **Open**
3. **Fill the day** — drag today's Open tasks into **In-Progress** to put them on the timeline, or add a task straight on the tracker tab
4. *(Optional)* — drag tasks to reorder, or save/load templates
5. **Start Run** — the timer begins; the playhead moves down the thermometer or the star sweeps along the spiral (toggle between Timeline, Spiral and List views)
6. **Complete splits** — click **✓** (or the planet); see your delta (green = ahead, red = behind) — the task moves to **Done**
7. **Scrub time** — click & drag the timeline or the spiral route to manually adjust the timer
8. **Pause / Resume / Reset** as needed; finished sprints are saved to your daily history and shown in the statistics page (heatmap + sleep tracker)

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
