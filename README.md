<p align="center">
  <img src="assets/brand/ego-icon-dark-rounded.svg" width="112" alt="Ego logo">
</p>

<h1 align="center">Ego</h1>

<p align="center">
  My personal app for money, workouts, health, tasks, the calendar, food, and a diary, with an AI
  chat that reads and writes all of it. It runs on my Android phone, on my Windows desktop, and in
  the browser at <a href="https://ego.kharitonovegor.com">ego.kharitonovegor.com</a>.
</p>

<p align="center">
  <img src="docs/media/tour.gif" alt="Clicking through Ego's apps on the desktop" width="900">
</p>

It's built for one user, me. Every screenshot here uses made-up demo data.

## Apps

| App | What it does |
| --- | --- |
| AI | A chat that reads and writes the other apps. "Publix $42 and gas $30", "bench 3x8 at 185", and "move my 3pm to 4" all work. Every write waits three seconds on a card you can undo. |
| Finance | Manual accounts, transactions, categories, a monthly budget, and receipt photos read by a model. |
| Gym | A workout log modeled on FitNotes, with personal records, a rest timer, and 116 exercises. |
| Health | Fitbit data from Google Health: steps, sleep stages, heart rate, HRV, weight, and a readiness score. |
| Calendar | Google Calendar with day, 3 day, week, month, and schedule views. Events drag to a new time, and Google's keyboard shortcuts work. |
| Tasks | Trello-style boards with labels, checklists, due-date reminders, and goals. |
| Habits | Daily and weekly habits with streaks, plus a running clock for each habit I'm quitting. |
| Food | Meals logged from a photo, a barcode, or a sentence, with macros against daily targets, and a fridge list. |
| Sheets | Small typed spreadsheets, like a list of people and companies. |
| Diary | A chat with myself, laid out like Telegram's Saved Messages. |
| Mood | One mood and a note per day. |
| Study | Canvas assignments grouped by due date. |

The desktop adds a global Trello quick add on `Alt+N`, and Quick tools on `Alt+S` that read text
from a screenshot or download a video with yt-dlp. [docs/apps.md](docs/apps.md) describes every
app in detail.

## In motion

<p align="center">
  <img src="docs/media/tasks-drag.gif" alt="Dragging cards between lists on a Tasks board" width="900"><br>
  Dragging cards between lists on a board.
</p>

<p align="center">
  <img src="docs/media/calendar-views.gif" alt="Switching Calendar views and opening an event" width="900"><br>
  Calendar views: 3 days, day, month, schedule, then back to the week to open an event.
</p>

<p align="center">
  <img src="docs/media/habits-checkoff.gif" alt="Checking off habits for today" width="900"><br>
  Checking off today's habits. Drink water counts up to eight a day.
</p>

## Screenshots

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/media/finance.png" alt="Finance home: balance, spending, and upcoming bills"><br>Finance</td>
    <td width="50%" align="center"><img src="docs/media/budget.png" alt="October budget with one category over"><br>Budget</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/calendar.png" alt="Calendar week view with three calendars"><br>Calendar</td>
    <td width="50%" align="center"><img src="docs/media/ai.png" alt="AI chat answering from the ledger, with what it read listed under the reply"><br>AI</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/tasks.png" alt="A Tasks board with To Do, Doing, and Done"><br>Tasks</td>
    <td width="50%" align="center"><img src="docs/media/goals.png" alt="Goals with checkpoints and linked boards"><br>Goals</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/health.png" alt="Health overview with the readiness score"><br>Health</td>
    <td width="50%" align="center"><img src="docs/media/sleep.png" alt="A week of sleep and one night by stage"><br>Sleep</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/gym.png" alt="Today's workout, with records marked by a trophy"><br>Gym</td>
    <td width="50%" align="center"><img src="docs/media/food.png" alt="Food log against daily calorie and macro targets"><br>Food</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/habits.png" alt="Today's habits and the week's progress rings"><br>Habits</td>
    <td width="50%" align="center"><img src="docs/media/quit.png" alt="Clocks for habits being quit"><br>Quitting</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/sheets.png" alt="A Sheets grid of people and companies"><br>Sheets</td>
    <td width="50%" align="center"><img src="docs/media/study.png" alt="Canvas assignments by due date"><br>Study</td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/media/diary.png" alt="Diary messages with hashtags, a reply, and a pin"><br>Diary</td>
    <td width="50%" align="center"><img src="docs/media/mood.png" alt="Mood for today and past days"><br>Mood</td>
  </tr>
</table>

## How it fits together

- `apps/mobile` is the Android app, in Expo and React Native.
- `apps/desktop` is the Windows app, in Electron, React, and Tailwind. Its screens live in
  `packages/ui`.
- `apps/web` runs the same screens in a browser, on Vercel.
- `apps/api` is a Cloudflare Worker with D1 and R2. It holds the data and every API key, so the
  phone, desktop, and browser keep none.
- Each device keeps its own SQLite copy and syncs through the Worker with an outbox and a change
  log, so every screen opens offline.

`docs/ledger-setup.md` covers deploying the Worker, enrolling devices, and the imports from
FitNotes and Telegram.

## Running it

```
npm install
npm run dev
```

`npm run dev` starts the desktop app with hot reload. Electron 44 needs Node 22.12 or newer.
`npm run typecheck` checks every package, and `npm test` runs every package's tests. The package
icon in the title bar builds and opens a Windows installer, and `npm run dist` does the same from a
terminal.

Secrets stay out of the repo. Each app has a `.env.example`; copy it to `.env.local` next to it
and fill it in. electron-vite bakes the desktop's values into the packaged installer, so don't share
the installer.

## Layout

```
apps/mobile/             Android app (Expo, React Native)
apps/desktop/            Windows app (Electron main process, preload, and overlay windows)
apps/web/                the browser host: SQLite in a worker, sign-in, the media service worker
apps/api/                Cloudflare Worker: D1 migrations, sync, AI, Google, Trello, Canvas
packages/ui/             the desktop and web screens, one folder per app
packages/local/          the phone's data layer: SQLite schema, repositories, outbox, sync
packages/core/           rules every app shares: money, gym, habits, tasks, calendar, AI tools
packages/api-contracts/  the Worker's request and response types
assets/brand/            the logo in every size
```
