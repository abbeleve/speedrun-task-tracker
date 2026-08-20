# ⏱ SpeedRun Task Tracker

A LiveSplit-inspired task tracking app with a vertical thermometer timeline, an infinite zooming spiral route, and a snake-hunting grid. Plan your tasks, time your run, and see exactly how far ahead (or behind) you are — in style.

![Stack](https://img.shields.io/badge/React-19-61dafb?logo=react) ![Stack](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript) ![Stack](https://img.shields.io/badge/Vite-8-646cff?logo=vite)

## Features

- **Thermometer timeline** — vertical fill bar that grows as time passes, color-coded by task
- **Spiral route** — zooming spiral view where one full turn (360°) equals one hour of planned time; every task's planet is visible at once, far ones rendered smaller, and sub-pixel planets culled
- **Snake grid** — tasks are scattered across a square grid like meals; a snake crawls from meal to meal and eats each one exactly when its planned time arrives, its colored body growing with the tasks it has digested
- **Dark & light themes** — both the spiral and the snake view adapt to the active theme
- **Polar angle guides** — faint rays radiate from the spiral's center at trig-circle multiples (every 30°, brighter 90° axes), marking 5-minute intervals of the run
- **Space background** — layered depth: far starfield and constellation clusters stay fixed, some far stars slowly and gently twinkle, and near stars endlessly stream outward from the spiral's center — reborn at fresh spots as they pass, so the loop never stalls (the run can last forever)
- **Task splits** — each task has a planned time, actual segment time, and live delta (ahead/behind)
- **Time scrubbing** — click & drag on the timeline, spiral or snake route to manually set the timer
- **Early completion credit** — completing a future task early boosts the current task's delta
- **Task customization** — choose an emoji and color for each task; reflected in the thermometer dots
- **Templates** — save, load, export & import task lists as JSON
- **Drag & drop** — reorder tasks in idle mode
- **Dark theme** — Discord-inspired color palette

## Installation

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and npm (comes with Node).

```bash
# Clone the repo
git clone https://github.com/YOUR_USER/speedrun-task-tracker.git
cd speedrun-task-tracker

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Production Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the build locally
```

## Scripts

| Command           | Description              |
| ----------------- | ------------------------ |
| `npm run dev`     | Start dev server (Vite)  |
| `npm run build`   | Type-check & production build |
| `npm run preview` | Serve production build   |
| `npm run lint`    | Run ESLint               |

## How to Use

1. **Add tasks** — pick an emoji & color, enter a name and planned minutes, click **+ Add**
2. *(Optional)* — drag tasks to reorder, or save/load templates
3. **Start Run** — the timer begins; the playhead moves down the thermometer, the star sweeps along the spiral, or the snake crawls the grid (toggle between Timeline, Spiral and Snake views)
4. **Complete splits** — click **✓** on a task to mark it done, click its planet in the spiral view, or click its meal in the snake view; see your delta (green = ahead, red = behind)
5. **Scrub time** — click & drag the timeline, spiral or snake route to manually adjust the timer
6. **Pause / Resume / Reset** as needed

## Tech Stack

- **React 19** + **TypeScript 6**
- **Vite 8** (dev server & bundler)
- CSS custom properties (no UI framework)
- `localStorage` for template persistence
