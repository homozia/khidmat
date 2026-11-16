# Khidmat — local services marketplace (Islamabad & Rawalpindi)

"Khidmat" is a working name (`APP_NAME`). This repository holds the whole pilot:

| App | Folder | Who uses it |
| --- | --- | --- |
| API (Node + PostgreSQL/PostGIS) | `apps/api` | everything below |
| Customer app (Expo, Android first) | `apps/mobile` | customers |
| Provider portal + operations dashboard (React web) | `apps/web` | providers on their phones; dispatch, finance, verification and setup staff |

Status: **Milestones 1–3 complete in local/sandbox form** (see `docs/milestones/`).
All places, zone boundaries, prices and people in the seed are **synthetic demo data**.

## Requirements

- Node.js 22.18 or newer (TypeScript runs natively; no build step)
- PostgreSQL 16 with PostGIS 3 and pgcrypto

## Database setup (once, as a PostgreSQL superuser)

```sql
CREATE ROLE khidmat LOGIN PASSWORD 'khidmat_dev' CREATEDB;
CREATE DATABASE khidmat_dev OWNER khidmat;
CREATE DATABASE khidmat_test OWNER khidmat;
-- in EACH of the two databases:
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

On Debian/Ubuntu: `apt-get install postgresql-16 postgresql-16-postgis-3`, then run the SQL above with
`sudo -u postgres psql`.

## Run the seeded demo

```bash
cp .env.example .env      # local settings; never commit .env
npm ci
npm run db:reset          # drop, migrate and seed the dev database (refused unless APP_ENV is development/test)
npm run dev               # API on http://localhost:3000
```

In two more terminals:

```bash
npm run dev:web                 # provider portal + operations at http://localhost:5173
cd apps/mobile && EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 npx expo start   # customer app
```

The customer app uses native modules (location, camera, microphone, secure storage), so on a phone it
runs in a development build (`npx expo run:android` with Android Studio, or `eas build --profile development`),
not in Expo Go. The Android emulator reaches your computer at `http://10.0.2.2:3000`, which is the default.

Sign in with any demo phone below; the sandbox SMS accepts the code **123456** and sends nothing.

| Phone | Who | Roles |
| --- | --- | --- |
| +923000000001 | Ayesha | super admin (all staff roles) |
| +923000000002 | Bilal | dispatcher |
| +923000000003 | Fatima | finance |
| +923000000004 | Kamran | config admin |
| +923000000005 | Sana | verification |
| +923001110001 | Usman | customer (Islamabad) |
| +923001110002 | Hina | customer (Rawalpindi) |
| +923002220001 | Asif | provider, plumber, zones ISB-G and ISB-F |
| +923002220002 | Naveed | provider, electrician skill **pending** |
| +923002220003 | Tariq | provider, licensed driver, zones RWP-ST and ISB-G |
| +923002220004 | Zahid | provider, locksmith skill **pending** |
| +923002220005 | Imran | provider, plumber, zones RWP-ST and RWP-CS3 |

### A booking by hand (curl)

```bash
API=http://localhost:3000
tok() { curl -s -X POST $API/v1/auth/otp/request -H 'content-type: application/json' -d "{\"phone\":\"$1\"}" >/dev/null;
        curl -s -X POST $API/v1/auth/otp/verify  -H 'content-type: application/json' -d "{\"phone\":\"$1\",\"code\":\"123456\"}" | jq -r .token; }
CUST=$(tok 03001110001); DISP=$(tok 03000000002); PLUMB=$(tok 03002220001)

# What can be booked at this GPS point (G-10)?
curl -s "$API/v1/catalogue?lat=33.6762&lng=73.0128" | jq '.zone, [.categories[].name_en]'
# Look up the area by name instead of GPS (English, Urdu or Roman Urdu)
curl -s "$API/v1/places?q=g%2010" | jq
```

The full journey (book → dispatch → accept → change order → approve → complete → receipt → settle)
is scripted in `apps/api/test/flow-plumbing.test.ts`, which is the most readable reference.

## Commands

| Command | What it does |
| --- | --- |
| `npm run verify` | Lint + type check (all apps) + API tests + web build (what CI runs) |
| `npm run build:android-bundle` | Compile the customer app's Android JavaScript bundle |
| `npm test` | Tests only (uses `khidmat_test`, resets it per file) |
| `npm run db:migrate` | Apply new migrations to the dev database |
| `npm run db:reset` | Drop + migrate + seed (dev/test only) |
| `npm run dev` | API with auto-reload |

## Layout

```
apps/api/
  migrations/         versioned SQL (never edit an applied file; add a new one)
  src/app.ts          HTTP routes (Fastify)
  src/services/       business rules: auth, coverage, pricing, bookings, dispatch, finance, idempotency
  src/domain/states.ts  booking state machine
  src/seed/           deterministic demo data (11 categories, 51 jobs, 4 zones, 12 people)
  test/               API integration tests against real PostgreSQL + PostGIS
docs/                 API, data model, operator guide, milestone reports
```

## Verified, sandbox, and owner actions

- **Verified here (automated):** everything listed in `docs/milestones/m1-m2-report.md`.
- **Sandbox only:** SMS (fixed code, refused when `APP_ENV=production`); demo zone boundaries
  (`is_demo`, ignored in production); demo prices (`pricing_rules.is_demo`).
- **Needs owner approval/action:** SMS aggregator contract and sender ID; Google Maps billing key;
  hosting; real zone boundaries checked on the ground; real prices; Play Store account; any live payment.
