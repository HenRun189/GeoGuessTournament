# GeoGuessr Tournament — Alpha/Beta

Self-hosted tournament management for GeoGuessr events with **4–12 participants**: a moderator panel, a public live page, personal player pages and an OBS stream overlay — all synchronized in real time over Server-Sent Events.

> **Note:** the entire web UI is in **German**. This README is in English.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Routes & URLs](#routes--urls)
- [OBS overlay setup](#obs-overlay-setup)
- [Tournament formats](#tournament-formats)
- [Ranking & scoring](#ranking--scoring)
- [Project structure](#project-structure)
- [npm scripts](#npm-scripts)
- [Testing](#testing)
- [API reference](#api-reference)
- [Design notes & assumptions](#design-notes--assumptions)
- [Security notes](#security-notes)

---

## Features

### Global admin authentication

Use **Admin-Login** in the top navigation and the server-configured global password to sign in once. The server keeps a random session token only in an `HttpOnly`, `SameSite=Strict` cookie (12-hour expiry); logout revokes it. All tournament creation, demo management and moderator APIs require this session, irrespective of tournament id. Public tournament pages and player status/help actions remain available without signing in.

### Moderator panel (`/admin/:id`)

- **Fast result entry** — click the winner, type the two damage values, save (Enter also submits). Damage *taken* is derived automatically: A's damage taken = B's damage dealt, and vice versa.
- **Match scheduling** — the real match order often differs from the generated schedule. Any upcoming match can be pushed live immediately; saving a result auto-activates the next planned open match.
- **Edit results** — any finished result can be corrected in place; rankings and knockout slots are recalculated.
- **Stage control** — start the tournament, force the next stage, end it early, or undo the most recently saved result.
- **Presentation decks** — build and save slide decks, then run one full-screen on the overlay (`←` / `→` to navigate, `Esc` to exit).
- **Player management** — per-player readiness status, problem reports, profile image upload, personal player-page links (copy with one click), and a "Ping" button that triggers an alert on that player's page.
- **Overlay control** — view override plus every overlay setting, mirrored onto the overlay instantly.
- **Alert sound** — an opt-in chime when a new problem report arrives (browsers require a click first).

### Public page (`/tournament/:id`)

Live view for spectators: current match, upcoming matches, standings or group tables, bracket, results and champion. No moderator controls. Updates instantly via SSE.

### Player pages (`/player/:tournamentId/:unitId/:slug`)

One shareable page per player or team showing their status, next opponent, their own schedule, how many matches are still ahead of them, and their results. Players can set **BEREIT** (ready) / **IN GEOGUESSR** (in game) and send a problem report. Plays a tournament chime when it is their turn. Fully derived server-side — nothing editable via the URL.

### OBS overlay (`/overlay/:id`)

Transparent, auto-rotating broadcast graphics. See [OBS overlay setup](#obs-overlay-setup).

### Rules page (`/rules`)

Plain-language explanation of the format and flow, optionally scoped to a specific tournament (`/rules?turnier=<id>`).

### Demo mode

The home page can generate three ready-to-run tournaments that are filled with random results through the normal save pipeline:

| Button | Tournament |
| --- | --- |
| Demo erstellen (7 Spieler, fertig) | 7 individual players, random-3 format, played to the finish |
| Demo erstellen (8 → 4 Teams, fertig) | 8 players paired into 4 two-player teams |
| Demo erstellen (6 Spieler, Gruppen) | 6 players in two groups of three |

All demo tournaments are flagged `isDemo` and can be removed in one click.

---

## Tech stack

| Workspace  | Package       | Role                                                              |
| ---------- | ------------- | ----------------------------------------------------------------- |
| `shared`   | `@gt/shared`  | Domain types, DTOs and rules tables shared by every package       |
| `engine`   | `@gt/engine`  | Pure tournament logic — schedules, standings, knockout slots, RNG |
| `server`   | `@gt/server`  | Express API, Prisma/SQLite persistence, SSE broadcasting           |
| `web`      | `@gt/web`     | React UI — home, setup wizard, admin, public, player, overlay     |

| Concern    | Technology                                              |
| ---------- | ------------------------------------------------------- |
| Language   | TypeScript (strict) across all four workspaces           |
| Runtime    | Node.js 18+                                              |
| Backend    | Express 4, `cors`, `nanoid`                             |
| Database   | SQLite via Prisma 6 (swap to PostgreSQL with a one-line change) |
| Live sync  | Server-Sent Events, with automatic polling fallback      |
| Frontend   | React 18, React Router 6, Vite 6, Tailwind CSS 3        |
| Tests      | Vitest 2 (engine unit tests + end-to-end service tests)  |
| Tooling    | npm workspaces, `concurrently`, `tsx`                    |

The engine has **no I/O and no database dependency** — it is a pure function of its inputs plus an optional seed, which is what makes the schedule logic exhaustively testable.

---

## Quick start

**Prerequisite:** Node.js 18 or newer.

```bash
# 1. install all workspace dependencies
npm install

# 2. create the SQLite database (server/prisma/dev.db)
npm run db:push -w server

# 3. start the API (:8787) and the web app (:5173)
npm run dev
```

Set `ADMIN_PASSWORD` in `server/.env`, then open **http://localhost:5173**, choose **Admin-Login** in the top navigation, and sign in before creating or managing tournaments. `server/.env.example` documents the server-only settings.

<details>
<summary>Creating a tournament — the setup wizard</summary>

1. **Name** the tournament.
2. **Participants** — choose a count between 4 and 12.
3. **Participants** — name, optional 2-letter country code (rendered as a flag) and optional abbreviation.
4. **Teams** — *only for sizes 8, 10 and 12.* Pair the players into `n / 2` two-player teams. There is no auto-pairing; you control the pairing.
5. **Confirm** — review the generated structure, then **CREATE TOURNAMENT**.

You land in the moderator panel. Click **Turnier starten** to begin.

</details>

The Vite dev server proxies `/api` to `http://localhost:8787`, so both halves are reachable through the single port 5173.

---

## Configuration

Configuration lives in `server/.env` (git-ignored); use `server/.env.example` as the template. `ADMIN_PASSWORD` is required, is read only by the server and has no insecure fallback. The local development value is `189GgT`; rotate this value before public hosting. Never copy it into frontend settings.

| Variable       | Default                        | Purpose                                                   |
| -------------- | ------------------------------ | --------------------------------------------------------- |
| `DATABASE_URL` | `file:./prisma/dev.db`         | Prisma connection string (SQLite)                         |
| `PORT`         | `8787`                         | API port. Note: `PORT=0` is treated as "use the default".  |
| `ADMIN_PASSWORD` | required, no fallback       | Global admin password; only read by the API server. Login fails closed if missing. |

**Swapping to PostgreSQL:** change the `datasource db` provider in [server/prisma/schema.prisma](server/prisma/schema.prisma) and point `DATABASE_URL` at your database. No application code changes are required.

**Profile images** are written to `server/uploads/` as `profile_<id>.<png|jpg|webp>` and served from `/api/uploads/<filename>`, which validates the filename against a strict allow-list pattern. Uploads are capped at **4 MB** per image client-side.

---

## Routes & URLs

With `<id>` being the short 8-character tournament id:

| URL                            | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `/`                            | Tournament list, demo mode, delete entries |
| `/create`                      | Setup wizard                               |
| `/rules`                       | Rules & flow explanation                   |
| `/rules?turnier=<id>`          | Rules scoped to one tournament             |
| `/admin/<id>`                  | Moderator panel                            |
| `/tournament/<id>`             | Public live page                           |
| `/player/<id>/<unitId>/<slug>` | Personal player page                       |
| `/overlay/<id>`                | OBS browser source                        |

---

## OBS overlay setup

Add a **Browser Source** in OBS:

- **URL:** `http://localhost:5173/overlay/<id>`
- **Width / Height:** 1920×1080 or 1280×720
- **Shutdown source when not visible:** off
- **Refresh browser when scene becomes active:** off — the overlay updates live over SSE

The background is transparent by default (toggle in the moderator panel).

### Views

The overlay picks its view from a priority chain:

1. An **active presentation** always wins.
2. The **result screen** shows automatically for **12 seconds** after a result is saved.
3. An explicit **manual override** by the moderator, which sticks until `AUTO` is pressed again.
4. Otherwise **auto-rotation**, which alternates by stage:
   - Preliminary → `Nächste Spiele` ⇄ `Tabelle`
   - Semifinals / Final / Finished → `Turnierbaum` ⇄ `Aktuelles Spiel`

Available modes: `AUTO`, `Nächste Spiele`, `Tabelle`, `Turnierbaum`, `Aktuelles Spiel`, `Ergebnis`, `Präsentation`.

### Persistent settings

Stored per tournament and editable from the moderator panel: rotation on/off, rotation interval (seconds), logo, tournament name, flags, compact layout, transparency, and dark/light theme.

---

## Tournament formats

The format is derived automatically from the participant count.

| Size | Units          | Preliminary format                   | Matches / unit | Semifinals           |
| ---- | -------------- | ------------------------------------ | -------------- | -------------------- |
| 4    | players        | single round robin                   | 3              | 1st v 4th · 2nd v 3rd |
| 5    | players        | single round robin                   | 4              | 1st v 4th · 2nd v 3rd |
| 6    | players        | two groups of 3, round robin inside | 2              | 1A v 2B · 1B v 2A     |
| 7    | players        | random 3 unique opponents            | 3              | 1st v 4th · 2nd v 3rd |
| 8    | 2-player teams | single round robin                   | 3              | 1st v 4th · 2nd v 3rd |
| 9    | players        | random 3 unique opponents            | 3              | 1st v 4th · 2nd v 3rd |
| 10   | 2-player teams | single round robin                   | 4              | 1st v 4th · 2nd v 3rd |
| 11   | players        | random 3 unique opponents            | 3              | 1st v 4th · 2nd v 3rd |
| 12   | 2-player teams | two groups of 3, round robin inside  | 2              | 1A v 2B · 1B v 2A     |

- The four best units (or the top two of each group) reach the semifinals; winners reach the final, whose winner is the champion.
- In the groups formats, **both third-placed units are eliminated**. For size 5, fifth place is eliminated.
- **7 / 9 / 11** schedules are drawn **once, stored permanently** (the seed is persisted) and never regenerated automatically — only an explicit reset redraws them.
- In the two-groups formats the group rounds are interleaved, so Group A and Group B play in the same round rather than one group finishing before the other.

**Lifecycle:**

```
SETUP → PRELIMINARY → SEMIFINALS → FINAL → FINISHED
```

Stages auto-advance when completed; the moderator can also force the next stage manually.

---

## Ranking & scoring

1. More **wins** ranks higher.
2. On equal wins, more **damage dealt** ranks higher.
3. Still equal, **less damage taken** ranks higher.

There are no hidden tiebreakers — units that are identical on all three criteria are marked as tied (`T`). Damage taken is never entered by hand; it is derived from the damage the opponent dealt.

---

## Project structure

```
.
├── shared/    Domain types, DTOs and format tables (@gt/shared)
├── engine/    Pure tournament engine: formats, schedules, standings,
│              knockout slot resolution, seeded RNG (@gt/engine)
├── server/    Express API, Prisma schema, SSE hub, tournament
│              lifecycle mutations, demo generator (@gt/server)
│   ├── prisma/          schema.prisma + SQLite database
│   ├── src/routes/      HTTP + SSE routes
│   ├── src/services/    persistence, state projection, mutations
│   └── tests/           end-to-end service tests
├── web/       React UI (@gt/web)
│   ├── src/pages/       home, create, rules, admin, public, player, overlay
│   ├── src/components/  bracket, match list, standings, result entry, …
│   └── src/lib/api.ts   API client + SSE/polling state hook
└── package.json         npm workspaces root
```

---

## npm scripts

Run from the repository root:

| Command                | Effect                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | API + web concurrently (`:8787` and `:5173`)                    |
| `npm run dev:api`      | API only, with `tsx watch` reload                                |
| `npm run dev:web`      | Vite dev server only                                             |
| `npm run build`        | Build shared → engine → server → web in dependency order         |
| `npm test`             | Engine tests, then server end-to-end tests                       |
| `npm run typecheck`    | Typecheck all four workspaces                                    |
| `npm run db:push -w server` | Apply `schema.prisma` to the database                     |
| `npm run start -w server`    | Run the compiled server (`server/dist`)                    |

**Production build:**

```bash
npm run build
npm run start -w server      # API on :8787
```

Serve `web/dist` from any static host and proxy both `/api` and `/api/events` (the SSE stream) to port 8787.

---

## Testing

```bash
npm test
```

- **Engine — 26 tests:** round-robin completeness, random schedule generation, group plans, standings, and team validation.
- **Server — 35 tests:** tournament lifecycle across sizes, match/result flows, public-player access, global admin login/logout, session expiry, creation authorization, and protected-route checks.

Server tests set `DATABASE_URL=file:./test.db` and push the schema in `tests/setup.ts`, which Prisma resolves to `server/prisma/test.db` — a separate file, so the development database is never touched.

---

## API reference

All endpoints are mounted under `/api`. Responses are JSON; errors return `{ "error": "<message>" }` with an appropriate status code.

### Live updates

| Method | Path      | Description                                                       |
| ------ | --------- | ----------------------------------------------------------------- |
| `GET`  | `/events` | SSE stream. Requires `?tournamentId=<id>`. Emits `state`, `ping` and `deleted` events plus a `heartbeat` every 15 s. |

### Tournament lifecycle

| Method   | Path                                  | Description                              |
| -------- | ------------------------------------- | ---------------------------------------- |
| `GET`    | `/tournaments`                        | List all tournaments                     |
| `POST`   | `/tournaments`                        | Create a tournament (global admin session required), returns `{ id }`    |
| `GET`    | `/tournaments/:id`                    | Full aggregated state                   |
| `DELETE` | `/tournaments/:id`                    | Delete a tournament and all its data     |
| `POST`   | `/tournaments/:id/state`              | Set the stage explicitly                 |
| `POST`   | `/tournaments/:id/reset`              | Clear results and regenerate the schedule|
| `POST`   | `/tournaments/:id/pause`              | Pause or resume                          |
| `POST`   | `/tournaments/:id/current-match`      | Set or clear the current match           |
| `POST`   | `/tournaments/:id/undo`               | Undo the most recent result              |

### Matches

| Method | Path                                          | Description                     |
| ------ | --------------------------------------------- | ------------------------------- |
| `POST` | `/tournaments/:id/matches/:matchId/result`    | Save a result                   |
| `PUT`  | `/tournaments/:id/matches/:matchId/result`    | Edit an existing result         |

Both take `{ winnerUnitId, aDamageDealt, bDamageDealt }`.

### Players & units

| Method   | Path                                                     | Description                |
| -------- | -------------------------------------------------------- | -------------------------- |
| `GET`    | `/tournaments/:id/player/:unitId`                        | Aggregated player view     |
| `POST`   | `/tournaments/:id/units/:unitId/ping`                    | Trigger an alert on the player's page |
| `POST`   | `/tournaments/:id/units/:unitId/readiness`               | `ready` or `in_game`       |
| `POST`   | `/tournaments/:id/units/:unitId/problem`                 | Report a problem           |
| `POST`   | `/tournaments/:id/units/:unitId/problem/resolve`         | Mark a problem resolved    |
| `POST`   | `/tournaments/:id/participants/:participantId/image`     | Upload a profile image (base64) |
| `DELETE` | `/tournaments/:id/participants/:participantId/image`     | Remove a profile image     |

### Overlay & presentation

| Method   | Path                                          | Description                       |
| -------- | --------------------------------------------- | --------------------------------- |
| `PATCH`  | `/tournaments/:id/overlay-settings`           | Patch overlay settings            |
| `POST`   | `/tournaments/:id/overlay-mode`               | Override the current overlay view |
| `PUT`    | `/tournaments/:id/presentation/decks`         | Replace all decks                 |
| `POST`   | `/tournaments/:id/presentation/deck`          | Select the active deck            |
| `POST`   | `/tournaments/:id/presentation/active`        | Start or stop the presentation    |
| `POST`   | `/tournaments/:id/presentation/navigate`      | Move by `-1` or `1`               |

### Demo

| Method   | Path      | Description                                            |
| -------- | --------- | ------------------------------------------------------ |
| `POST`   | `/demo`   | Create a demo tournament (global admin session required). Body: `{ kind: "full" \| "team" \| "groups" }` |
| `DELETE` | `/demo`   | Delete every demo tournament (global admin session required), returns `{ removed }`    |

### Other

| Method | Path                     | Description                                    |
| ------ | ------------------------ | ---------------------------------------------- |
| `GET`  | `/health` (server root)  | Liveness probe, returns `{ "ok": true }`       |
| `GET`  | `/api/uploads/:filename` | Serve an uploaded profile image               |

---

## Design notes & assumptions

1. **"Exactly 3 matches each" is mathematically impossible for 7/9/11.** Three matches per player requires `n × 3` total appearances, which must be even — but 21, 27 and 33 are all odd. Since the harder constraint ("no player meets the same opponent twice") is preserved, the generator gives **exactly one player a bye (2 matches)** while everyone else plays exactly 3. Totals: 10, 13 and 16 matches respectively.
2. **Groups are seeded by entry order** (alternating A, B, A, B…) at creation time. The moderator therefore controls seeding by ordering the participants accordingly in the wizard.
3. **Damage taken is derived, never entered** — A's damage taken equals B's damage dealt.
4. **Undo targets the most recently saved result** (by save time), not the highest bracket position.
5. **Random schedules are permanent.** For 7/9/11 the generated seed is stored on the tournament, so the draw survives restarts and is only redrawn by an explicit reset.
6. **Demo tournaments are generated through the real pipeline** — they call the same `saveResult` path as the moderator UI rather than writing rows directly, which keeps them a genuine end-to-end exercise of the logic.

---

## Security notes

- Set a strong, unique `ADMIN_PASSWORD` for publicly hosted deployments. The local development password is kept in the ignored `.env`; rotate it before deployment.
- Admin sessions are global across tournaments, stored server-side by token hash, and expire after 12 hours. Ten failed logins from one client address within a 15-minute window trigger a 15-minute block. Public pages and player actions remain unauthenticated.
- **`npm run db:seed -w server` is broken.** The script points at `server/src/scripts/demo.ts`, which does not exist. Use the demo buttons on the home page instead, or `POST /api/demo`.
- **`server/uploads/` is not git-ignored.** Deleting a tournament or removing an image does clean the file from disk, but the directory itself is not excluded, so uploaded images will show up as untracked files. Add it to `.gitignore` before committing user uploads.
- **CORS is fully open** (`app.use(cors())`), which is appropriate for local use but should be restricted for a public deployment.
- SSE connections are held in memory, so the app is designed to run as a **single process**. Horizontal scaling would require an external pub/sub layer.