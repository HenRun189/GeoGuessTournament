# GeoGuessr Tournament — Alpha/Beta

A self-hosted tournament management system for GeoGuessr tournaments with 4–12 participants: a moderator panel, a public live page and an OBS stream overlay, all synchronized in real time.

## Stack

| Layer      | Tech                                              |
| ---------- | ------------------------------------------------- |
| Engine     | Pure TypeScript package (no I/O, fully testable)  |
| Backend    | Node.js + TypeScript, Express, SSE live updates   |
| Database   | SQLite via Prisma (PostgreSQL-swappable)          |
| Frontend   | React 18 + TypeScript, Vite, Tailwind CSS         |
| Tests      | Vitest (engine + end-to-end service tests)        |

## Project layout

```
shared/    Domain types shared by all packages (@gt/shared)
engine/    Tournament engine: schedules, standings, knockout logic (@gt/engine)
server/    Express API, Prisma models, SSE broadcasting, demo mode (@gt/server)
web/       React UI: home, setup wizard, admin, public page, overlay (@gt/web)
```

## 1. Install

Requires Node.js 18+.

```bash
npm install
```

## 2. Initialize the database

```bash
npm run db:push -w server
```

This creates `server/prisma/dev.db` (SQLite). The schema lives in `server/prisma/schema.prisma`; to swap to PostgreSQL later, change the `datasource db` provider and `DATABASE_URL` — no application code changes.

## 3. Start development

```bash
npm run dev
```

- API:  http://localhost:8787
- Web:  http://localhost:5173 (proxies `/api` to :8787)

## 4. Create a tournament

Open http://localhost:5173 and click **+ New tournament** (or use a demo button on the home page).

Setup wizard:

1. **Name**
2. **Participants** 4–12
3. **Participants** — name, optional country (2-letter code → flag), optional abbreviation
4. **Teams** (only sizes 8/10/12) — pair the players into n/2 two-player teams; no auto-pairing
5. **Confirm** — shows the generated structure, then **CREATE TOURNAMENT**

You land in the admin panel. Click **▶ Start tournament** to begin.

## 5. Open the public page

```
http://localhost:5173/tournament/<id>
```

Spectators see the current match, upcoming matches, live ranking/group tables, bracket, results and champion. No admin controls. Updates live over SSE.

## 6. Open the OBS overlay

Add a **Browser Source** in OBS:

- URL: `http://localhost:5173/overlay/<id>`
- Width/Height: 1920×1080 or 1280×720
- ✓ Shutdown source when not visible: off
- ✓ Refresh browser when scene becomes active: off (updates are live)

The overlay background is transparent by default (toggle in admin → Overlay control). Views:

- **Preliminary stage:** auto-rotates NEXT MATCHES → RANKING / GROUP TABLES every 30 s (configurable)
- **Knockout stage:** auto-rotates BRACKET → CURRENT MATCH
- Moderator override buttons: AUTO / NEXT MATCHES / TABLE / BRACKET / CURRENT MATCH — a manual choice sticks until AUTO is pressed again
- Settings persist per tournament: rotation on/off + interval, logo, tournament name, flags, compact layout, transparency, dark/light theme

## Admin panel essentials

- **Current match** — winner click + two damage fields + SAVE (Enter also submits). Damages auto-derive: A taken = B dealt, B taken = A dealt.
- **Set live** on any match — the real GeoGuessr order may differ from the generated order
- **Undo last result** — removes the newest result, restores standings/match status, asks for confirmation
- **Force next stage** — manual override; auto-advance also happens when a stage completes
- **Reset tournament** — wipes results and regenerates the schedule (same teams/groups, new random matchups for 7/9/11)
- **Overlay control** — view override + settings, mirrored onto the overlay instantly

## 7. Build for production

```bash
npm run build
npm run start -w server        # serves the API on :8787
# serve web/dist with any static host; proxy /api and /api/events (SSE) to :8787
```

`npm run typecheck` typechecks all packages; `npm test` runs engine + server tests.

## Tests

```bash
npm test
```

- **Engine tests (22):** round-robin completeness, 7/9/11 random schedules (unique opponents, match counts, seed reproducibility), per-size match counts, group plans, standings tiebreak order, team validation.
- **Service tests (15):** full lifecycle for every size 4–12 (create → preliminary → semifinals → final → finished), no duplicate opponents for 7/9/11, semifinal pairings 1v4/2v3 and group cross 1A v 2B, eliminations, invalid-result rejection, double-save protection, undo, reset, delete.

## Rules implemented (spec source of truth)

- **Ranking:** wins DESC → damage dealt DESC → damage taken ASC. No hidden tiebreakers; exact ties are marked "T".
- **4/5:** single round robin → SF 1v4, 2v3 → Final (rank 5 eliminated for size 5).
- **6:** two groups of 3, RR inside group → 1A v 2B, 1B v 2A → Final; both 3rds eliminated.
- **7/9/11:** random unique-opponent matchups, generated once, stored permanently (seed persisted), never regenerated automatically → SF 1v4, 2v3 → Final.
- **8/10/12:** 2-player teams; 8/10 single RR; 12 two groups of 3 teams.
- **States:** SETUP → PRELIMINARY → SEMIFINALS → FINAL → FINISHED (auto-advance + manual override).

## Assumptions & documented decisions

1. **7/9/11 "exactly 3 matches each" is mathematically impossible** (n×3 is odd for n=7/9/11, but every match involves 2 players). The generator therefore gives **one random player a bye (2 matches)** and everyone else exactly 3, keeping the harder constraint (no duplicate opponents). Total matches: 10/13/16.
2. **Groups for 6/12 are seeded by entry order** (alternating A, B, A, B…) in the wizard; the moderator controls seeding by ordering participants accordingly. (A shuffle option can be added later.)
3. **Damage taken is derived**, not entered: A taken = B dealt and vice versa (per spec §5).
4. **Undo targets the most recently saved result** (by save time), not the highest bracket position.
5. **No authentication in Alpha/Beta** — anyone with the tournament id can open the admin URL. IDs are random 8-char strings (unguessable in practice); add auth before public hosting.
6. **Demo tournaments** are flagged `isDemo` and can all be removed with one button; they are filled automatically with random results through the normal save pipeline (including knockouts).

## Exact commands to run locally

```bash
# from the repository root
npm install                      # 1. install
npm run db:push -w server        # 2. initialize SQLite database
npm run dev                      # 3. start API (:8787) + web (:5173)

# then open:
#   home:    http://localhost:5173
#   public:  http://localhost:5173/tournament/<id>
#   admin:   http://localhost:5173/admin/<id>
#   overlay: http://localhost:5173/overlay/<id>   (OBS browser source)

npm test                         # run all automated tests
npm run typecheck                # typecheck all packages
npm run build                    # production build (all packages + web bundle)
npm run start -w server          # run built server in production
```
