# Khidmat — local services marketplace (Islamabad & Rawalpindi)

"Khidmat" is a working name (`APP_NAME`). This repository holds the whole pilot:

| App | Folder | Who uses it |
| --- | --- | --- |
| API (Node + PostgreSQL/PostGIS) | `apps/api` | everything below |
| Customer app (Expo, Android first) | `apps/mobile` | customers |
| Provider portal + operations dashboard (React web) | `apps/web` | providers on their phones; dispatch, finance, verification and setup staff |

Status: **Milestone 4.1 (field-test package)**. See `docs/milestones/m41-audit-closure.md`.
All places, zone boundaries, prices and people in the seed are **synthetic demo data**.

**Testers: open [START_HERE.md](START_HERE.md)**, then [PHONE_TEST_CHECKLIST.md](PHONE_TEST_CHECKLIST.md).

## Requirements

- Node.js 22.18 or newer (TypeScript runs natively; no build step)
- Docker Desktop, for the PostgreSQL 16 + PostGIS 3.4 container. Without Docker, use your own PostgreSQL 16 with PostGIS 3 and pgcrypto, the databases in `scripts/db-init.sql`, and `KHIDMAT_NO_DOCKER=1`.

## Test environment (laptop)

| Windows (PowerShell, in this folder) | macOS / Linux | What it does |
|---|---|---|
| `powershell -ExecutionPolicy Bypass -File .\start-test-env.ps1` | `npm run test-env:start` | Database → migrations → test data **only if the database is empty** → API (port 3000) → website (port 5173) → prints the phone addresses. Safe to re-run |
| `powershell -ExecutionPolicy Bypass -File .\stop-test-env.ps1` | `npm run test-env:stop` | Stops the API, website and database container. Data is kept |
| `powershell -ExecutionPolicy Bypass -File .\reset-test-data.ps1` | `npm run test-env:reset` | **Erases** test data and loads it fresh, after you type the database name. Only for `*_dev`, `*_test` or `*_sandbox` databases |
| — | `npm run test-env:status` | Shows what is running and the addresses again |

Logs: `.khidmat/logs/api.log` and `web.log`. Build variants, signing and the GitHub Actions APK build: `docs/operations/android-builds.md`.

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
| `npm run db:init` | Apply new migrations; load test data only into an empty database (safe) |
| `npm run verify` | Lint + type check (all apps) + API tests + web build (what CI runs, plus the Android bundle) |
| `npm run serve:web` | Build the web app and serve it on port 5173 to the LAN, proxying /v1 to the API |
| `npm run apk:fieldtest` | Local Gradle build of the signed field-test APK (needs the Android SDK and signing variables) |
| `npm run build:android-bundle` | Compile the customer app's Android JavaScript bundle |
| `npm test` | API and database tests (`khidmat_test`), then the app's booking and upload logic against two real test servers (`*_a_test`, `*_b_test`) |
| `npm run db:migrate` | Apply new migrations to the dev database |
| `npm run db:reset` | Drop + migrate + seed after typed confirmation (dev/test only); `-- --yes` skips the question |
| `npm run dev` | API with auto-reload |

## Layout

```
apps/api/
  migrations/         versioned SQL (never edit an applied file; add a new one)
  src/app.ts          HTTP routes (Fastify)
  src/services/       business rules: auth, coverage, pricing, bookings, dispatch, finance, idempotency
  src/domain/states.ts  booking state machine
  src/seed/           deterministic demo data (11 categories, 51 jobs, 4 zones, 13 people)
  test/               API integration tests against real PostgreSQL + PostGIS
apps/mobile/app.config.ts   build variants (fieldtest / staging / production)
.github/workflows/    ci.yml (lint, types, PostGIS tests, builds) and android-apk.yml (signed field-test APK)
docs/testing/         Phone Test Guide
docs/operations/      Android builds and signing; live SMS, storage, maps and staging (owner inputs)
docs/                 API, data model, operator guide, milestone reports
```

## Verified, sandbox, and owner actions

- **Verified here (automated):** see `docs/milestones/m41-audit-closure.md` for the commands and results.
- **Sandbox only:** SMS (fixed code, refused when `APP_ENV=production`); demo zone boundaries
  (`is_demo`, ignored in production); demo prices (`pricing_rules.is_demo`).
- **Needs owner approval/action:** SMS aggregator contract and sender ID; private object storage;
  Google Maps keys; HTTPS staging host; real zone boundaries checked on the ground; real prices;
  Play Store account and upload key; any live payment. Details: `docs/operations/storage-and-sms.md`.
