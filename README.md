# ⏱ SpeedRun Task Tracker

A calendar you can speedrun. Plan the day the way you would in Google Calendar — real slots, real times, parallel blocks — then close tasks as you go and watch the **overtake**: the time you have won back from the plan and can spend on everything that follows. Any run of back-to-back blocks can be opened in the LiveSplit-style views (thermometer, spiral route, list, story path) and run against the clock.

![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript) ![Stack](https://img.shields.io/badge/Vite-8-646cff?logo=vite) ![Stack](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)

## Frontend + Backend

The app is split into two parts:

- `frontend/` — React + Vite SPA (calendar, dashboard, kanban board and the sequence visualisations: timeline, spiral, list, story path).
- `backend/` — FastAPI + SQLite REST API (users, the per-day plan, daily totals, sleep log).

All user data lives in the backend's SQLite file, scoped per account (registration
& login are included). Deployment instructions for a bare server are in
[`DEPLOY.md`](./DEPLOY.md).

## Features

- **Calendar** — day / week / month views with an hour grid: drag on empty space to create a block, drag it to move (across days too), drag either edge to resize, click to edit. The backlog rail holds unplanned tasks; drop one on the grid to give it a time. Hover a day in the 3-day/week views to see reminder details and the first real break after the current or next uninterrupted work stretch.
- **Timeline layout** — the switch next to the views turns the day / 3-day / week grid on its side: a row per day with the hours running across, the hour ruler and the day labels pinned while it scrolls both ways. Blocks that run at the same time stack into lanes; a session hangs under a rail in its own gradient with connectors from step to step, weekends are hatched, and the now line stands across today's row. Hovering a day in the 3-day/week timeline opens its reminders and its first real break in a line of cards under the row (over it near the bottom of the screen), with the break marked out in the row. In any view, hovering a day also opens the hover card of each of its blocks on screen that are too short to show their own name — the same card the block shows when hovered itself — as many as fit side by side across the screen, in a line under the row's lanes (over the row near the bottom of the screen), each tied to its block by a guide. Drawing, moving, resizing by either end, the lasso, right-drag zoom and backlog drops all work as in the columns. The choice is saved to the account, so it follows you to another device.
- **Backlog templates** — hide the calendar backlog rail when you need more room. Its Templates tab stores reusable task details per account; each use makes a new unscheduled backlog task for the chosen day. This suits tasks such as a rest-type meal whose time is not known in advance.
- **Independent deadlines** — a deliverable has its own due date and completion, and can link to work blocks on different days. Flags mark its cutoff in calendar columns, timeline rows and month cells; linked blocks carry a flag badge, with a dotted guide on hover or selection. Open deadlines stay visible above the grid, including overdue ones and those whose work blocks are already done. Closing a block never closes its deadline, and moving it never moves the due date. The deadline editor can create more work blocks, close or reopen the deliverable, and accepts a date with optional time. Labels show absolute due dates and times without countdowns.
- **Pinned tasks** — pin a calendar block or backlog item to lock its placement. It can still be completed and edited; uncheck the pin to move it again.
- **Area selection** — hold Ctrl (⌘) and drag a rectangle within one day to select the blocks it touches, including individual parallel tasks. Drag any selected block to move the batch together. Ctrl (⌘) + click adds or removes a single block; holding on empty grid space for a second also starts a selection rectangle. Works in both calendar columns and timeline rows.
- **Cutting a block** — hold C and click a block to cut it in two at that point. A dashed line shows the time first. The cut snaps to the 5-minute grid and leaves at least 5 minutes on each side. Near the red now line it snaps to the current minute instead, and the line turns red, so you can cut a block exactly where you stopped working. The block keeps the first piece; a deep copy with the same name (no "копия") takes the rest. Both keep the block's done state, session, pin, habit and deadline links, so the slot, habit minutes and overtake still add up. Only the first piece keeps a repeat rule, so the next occurrence is scheduled once. It works in columns and the timeline, and across midnight. Reminders and blocks under 10 minutes are not cut.
- **Parallel tasks** — overlapping blocks are laid out side by side, and count as a single group: the group is closed only when its last task is.
- **Overtake (обгон)** — the headline metric: how far ahead of the plan you are running right now. See [the rules](#the-overtake) below.
- **Sequences are explicit** — blocks never connect to each other on their own, however tightly they are laid out: two blocks that touch stay two separate blocks until you say otherwise. A sequence is marked by a spine on the left of the day column; click the spine to open the session editor, drag it to move the whole run at once.
- **Sessions** — blocks that touch or nearly touch (a gap of 5 minutes or less) get a 🔗 handle in the gap: press it and they are pulled together into one named session. Selecting any batch of blocks and pressing *Собрать в отдельную сессию* does the same without them having to be neighbours. A session holds together however its blocks are later moved, can be renamed, dragged as a whole (gaps intact, across midnight too) and pulled apart again.
- **Blocks inside a session join it** — the one connection that needs no approval: drop a block entirely inside a session's span and it becomes a real member of it, so it is never left behind when the session is dragged.
- **Start a session early** — the session editor (and the tracker header) offers ▶ *Начать сейчас*: the whole run slides to the current moment and opens in the tracker views.
- **Thermometer timeline** — vertical fill bar that grows as the sequence's time passes, color-coded by task
- **Spiral route** — zooming spiral view where one full turn (360°) equals one hour of planned time; every task's planet is visible at once, far ones rendered smaller, and sub-pixel planets culled
- **List timeline** — a plain task list (emoji avatar, name, finish time and schedule delta per row); the task the sequence has reached expands into a thermometer that tapers back into the spine, with a motivational picture card beside it (pictures are served by the backend from `MOTIVATION_DIR`)
- **Story path** — a fourth sequence view inspired by a winding photo timeline: task images and text alternate along a continuous teal route. Each picture is square, so a step is as tall as its picture is wide, and the route bends around it in a true half-circle at any width. The route fills green as the active task progresses, keeps completed steps filled, and leaves upcoming steps pale; closing a step early fills its entire bend and starts the next one, while reopening or scrubbing updates the fill. It shares the List view's motivational pictures, shuffles their order on each page reload, uses every distinct image before looping, and keeps images stable while the clock ticks or views change. Shows progress, finish times and schedule deltas; tasks can be completed or reopened, and the active progress slider scrubs time. Supports light and dark themes and phone widths.
- **Kanban board** — plan tasks ahead across days in three columns (Open → In-Progress → Done); dragging an Open task into In-Progress puts it on that day's calendar, after everything already planned there
- **Recurring tasks** — a task can repeat on a fixed interval or walk a spaced-repetition series (1 → 3 → 7 → 16 → 35 days, scaled by a base); closing it schedules the next occurrence at the same time of day. A reminder has no ✓: it closes itself once its window has passed, and a recurring one schedules its next occurrence then (occurrences missed while the app was closed are caught up)
- **Wall-clock only** — no session to start, pause or reset: the day runs on the real clock, and ✓ records the moment a task was actually closed
- **Statistics** — the heatmap and the sleep tracker are derived from the plan itself: work/rest seconds come from the blocks that were really closed. The activity card's week and month views can be drawn three ways, picked with the switch on the right of the chart: bars; a *race* of running totals against the two periods before (green where you are ahead of the last one, red where behind, with the totals written out at the day you have reached); or a smooth *wave* of the daily values, with the days that met the habit's quota (or an average working day) dotted in and underlined. Both line charts have a date axis and a value axis in hours and minutes, or in the habit's own units for a count habit. The choice is saved to the account
- **Phones & tablets** — the layout adapts down to phone width (a phone opens on the day view with the backlog folded away). On a touch screen a finger scrolls the grid; a tap opens a block or drafts a new one where it landed, and a long press picks a block up to drag it (the grid scrolls on by itself near its edges) or draws a new one. A backlog card goes on the calendar with *📅 В календарь* in its editor, and kanban cards move between columns with their ▶ / ✓ / ↩ buttons
- **Push notifications** — the 🔔 in the header turns them on for this browser (PC or Android). The server pushes when a block starts, when a reminder's window opens, when a block's time runs out while it is still open, and when a streak habit's quota is still not met 3, 2 and 1 hours before midnight. Notifications arrive even with the tab closed, as long as the browser is running; on Android, even with the browser closed. They need the site on HTTPS (or `localhost`), and logging out turns them off for that browser
- **Intro** — every sign-in, registration and reload opens with a 3D shot (three.js), kept to white and the account's palette colour: the camera swings round a pale stopwatch in one unbroken move as it builds itself — a bead draws the bezel, the ticks pop up round the dial, the crown drops on — among a slow drift of task blocks; a click of the crown and the hand runs one lap, filling the dial behind it like a split; at the second click a ring pulses out and the dial's face opens into a window onto the app, which has been loading underneath all along, and the camera dives through it. It lasts about 3.5 s, and any click, tap or key skips it. The scene is built ahead of time (on the sign-in page, and while a saved session is checked), so it starts at once. Asking the system for less motion, or having no WebGL, turns it into a one-second fade of the title
- **Dark & light themes** — every view, including the spiral, adapts to the active theme
- **Space background** — layered depth: far starfield and constellation clusters stay fixed, near stars endlessly stream outward from the spiral's center
- **Time scrubbing** — drag the thermometer or the spiral route to inspect another moment of a sequence; one click returns to now
- **Per-user accounts** — register / log in; the plan, the daily totals and the sleep log are stored server-side per user
- **Task customization** — emoji and color per task, including a user-built animated gradient with 2–5 colors, a full 360° flow direction and adjustable speed; reflected across the calendar, backlog and Kanban views
- **Habits** — per-user habit tracker on the home page. Each habit is either *count* (a daily quota of units, e.g. 10 отжиманий) or *time* (a daily quota of minutes, e.g. 300 ≈ 5 часов). The habit cards live in a draggable grid you can reorder; each card shows today's progress vs its quota and a per-day history. Link a task to a habit in the block editor: closing that task adds the block's minutes to a *time* habit automatically, and count habits are advanced by hand with +/−. The quota is versioned, so you can progress (10 → 15 → 20 отжиманий) without rewriting the past: a new quota applies from a chosen day (today by default, or a future day to plan the next step), and every earlier day — in the 7-day strip, the heatmap and the week/month bars — is still judged against the quota it had then. *Всю историю* instead corrects the quota everywhere. Each card draws today's progress as a dotted arc or as a gauge of radial capsules (with a pill saying what is left, over bars for yesterday and the last 7 days); the switch on the right of the chart picks one per habit, and the choice is saved with the habit.
- **Streaks** — tick *🔥 Серия* in a habit's editor to count the days in a row its quota was met, each day against the quota it had then. The count lives in a little fire in the top-left corner of the card's chart, burning in the habit's own colour once today's quota is met. Until then it stays cold: a streak carried from yesterday keeps its number (an unfinished today does not break it before midnight), a broken one reads 0. Meeting the quota sets the card ablaze — the fire bursts up in the middle with a shockwave and embers, the count rolls over to today's, and the fire flies into the corner badge — once a day per habit, whether the quota was met on the card or by closing a linked block on the calendar; dropping back below it re-arms the fire. With 3, 2 and 1 hours left before midnight an unmet streak smoulders red with the hours left beside it, and a card in the corner of every page says what is left (*Серия 12 дней сгорит через 2 ч — осталось 4 раз*). A browser with push notifications on gets that as a push from the server instead, even with the tab closed.

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

The calendar shows the lead two ways: the HUD number (frozen or running) and a
green band between the now-line and where the plan effectively stands.

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

Motivational pictures for the List and Story path views are served by the backend from
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
   Open **Шаблоны** in the backlog to save a task for later use (or press ☆ on an existing backlog card), then choose a day and press **В бэклог** whenever you need a new copy. Use **Скрыть бэклог** to give the calendar more space; the same button shows it again.
3. **Work the plan** — press ✓ on a block the moment you really finish it. The HUD shows your lead, what closing the running block right now would bank, and when the rest of the plan will be done.
4. **Glue a sequence** — press the 🔗 handle between two blocks (or select a batch and *Собрать в отдельную сессию*) to make them one session, then click its spine to open it in the thermometer / spiral / list / story path views and close splits from there.
5. **Look back** — the dashboard (🏠) holds the kanban board, every stretch you have worked, and the statistics page.

## CI / CD

GitHub Actions runs on push / PR (see `.github/workflows/deploy.yml`):

- **backend** — installs deps, runs `pytest`
- **frontend** — `npm ci`, lint, Vitest tests, production build (uploaded as an artefact)
- **deploy** — only on push to `master`: pulls the backend on the server, ships the
  pre-built `dist/` over SCP, restarts the systemd service and checks `/api/health`

## Tech Stack

- **Frontend:** React 19 + TypeScript 6 + Vite 8, CSS custom properties; three.js for the intro (a chunk of its own, loaded on demand)
- **Backend:** FastAPI + Uvicorn + SQLite (stdlib `sqlite3`), PBKDF2 password hashing, opaque bearer tokens
- **Tests:** pytest (backend), Vitest (frontend unit)
