# ⏱ SpeedRun Task Tracker

A LiveSplit-inspired task tracking app with a vertical thermometer timeline, an infinite zooming spiral route, and a snake-hunting grid. Plan your tasks, time your run, and see exactly how far ahead (or behind) you are — in style.

![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript) ![Stack](https://img.shields.io/badge/Vite-8-646cff?logo=vite) ![Stack](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)

## Frontend + Backend

The app is split into two parts:

- `frontend/` — React + Vite SPA (all the visualisation: timeline, spiral, snake).
- `backend/` — FastAPI + SQLite REST API (users, daily sprints, sleep log, templates).

All user data lives in the backend's SQLite file, scoped per account (registration
& login are included). Deployment instructions for a bare server are in
[`DEPLOY.md`](./DEPLOY.md).

## Features (test)

- **Thermometer timeline** — vertical fill bar that grows as time passes, color-coded by task
- **Spiral route** — zooming spiral view where one full turn (360°) equals one hour of planned time; every task's planet is visible at once, far ones rendered smaller, and sub-pixel planets culled
- **Snake grid** — tasks are scattered across a square grid like meals; a snake crawls from meal to meal and eats each one exactly when its planned time arrives
- **Dark & light themes** — both the spiral and the snake view adapt to the active theme
- **Space background** — layered depth: far starfield and constellation clusters stay fixed, near stars endlessly stream outward from the spiral's center
- **Task splits** — each task has a planned time, actual segment time, and live delta (ahead/behind)
- **Time scrubbing** — click & drag on the timeline, spiral or snake route to manually set the timer
- **Per-user accounts** — register / log in; daily sprints, sleep log and templates are stored server-side per user
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
2. **Add tasks** — pick an emoji & color, enter a name and planned minutes, click **+ Add**
3. *(Optional)* — drag tasks to reorder, or save/load templates
4. **Start Run** — the timer begins; the playhead moves down the thermometer, the star sweeps along the spiral, or the snake crawls the grid (toggle between Timeline, Spiral and Snake views)
5. **Complete splits** — click **✓** (or the planet / meal); see your delta (green = ahead, red = behind)
6. **Scrub time** — click & drag the timeline, spiral or snake route to manually adjust the timer
7. **Pause / Resume / Reset** as needed; finished sprints are saved to your daily history and shown in the statistics page (heatmap + sleep tracker)

## CI / CD

GitHub Actions runs on push / PR (see `.github/workflows/ci.yml`):

- **backend** — installs deps, runs `pytest`
- **frontend** — `npm ci`, lint, Vitest tests, production build

## Tech Stack

- **Frontend:** React 19 + TypeScript 6 + Vite 8, CSS custom properties
- **Backend:** FastAPI + Uvicorn + SQLite (stdlib `sqlite3`), PBKDF2 password hashing, opaque bearer tokens
- **Tests:** pytest (backend), Vitest (frontend unit)
