# Khidmat — local services marketplace (Islamabad & Rawalpindi)

"Khidmat" is a working name (`APP_NAME`). This repository holds the whole pilot:

| App | Folder | Who uses it |
| --- | --- | --- |
| API (Node + PostgreSQL/PostGIS) | `apps/api` | everything below |
| Customer app (Expo, Android first) | `apps/mobile` | customers |
| Provider portal + operations dashboard (React web) | `apps/web` | providers on their phones; dispatch, finance, verification and setup staff |

Status: **Milestone 4 (audit corrections and field-test build)**. See `docs/milestones/m4-audit-closure.md`.
All places, zone boundaries, prices and people in the seed are **synthetic demo data**.

## Requirements

- Node.js 22.18 or newer (TypeScript runs natively; no build step)
- Docker, for the PostgreSQL 16 + PostGIS 3.4 container. Without Docker, use your own PostgreSQL 16 with PostGIS 3 and pgcrypto, and the same databases as `scripts/db-init.sql`.

## Quick start (laptop test server)

```bash
npm run setup        # .env from .env.example, database container, npm ci, migrate, seed
npm run dev          # API on http://0.0.0.0:3000 (reachable from phones on the same Wi-Fi)
npm run serve:web    # provider portal + operations at http://<laptop-ip>:5173 (proxies the API)
npm run lan:ip       # prints the laptop address and the exact URLs for phones
```

`npm run db:reset` drops, migrates and seeds again. It only works on databases named `*_dev`, `*_test` or `*_sandbox`.

**Customer app on a phone:** install the signed field-test APK (**Khidmat TEST**), tap **Test server** on the sign-in screen, and enter the laptop address. See `docs/testing/phone-test-guide.md`. The Android emulator's `10.0.2.2` and the phone's `localhost` do not reach the laptop from a real phone.

**Customer app in development:** `cd apps/mobile && npx expo start` (development build). Build variants and signing are covered in `docs/operations/android-builds.md`.

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
| `npm run setup` | One-time local stack setup (see Quick start) |
| `npm run verify` | Lint + type check (all apps) + API tests + web build (what CI runs, plus the Android bundle) |
| `npm run serve:web` | Build the web app and serve it on port 5173 to the LAN, proxying /v1 to the API |
| `npm run lan:ip` | Show the laptop's Wi-Fi address and the URLs testers use |
| `npm run apk:fieldtest` | Local Gradle build of the signed field-test APK (needs the Android SDK and signing variables) |
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
apps/mobile/app.config.ts   build variants (fieldtest / staging / production)
.github/workflows/    ci.yml (lint, types, PostGIS tests, builds) and android-apk.yml (signed field-test APK)
docs/testing/         Phone Test Guide
docs/operations/      Android builds and signing; live SMS, storage, maps and staging (owner inputs)
docs/                 API, data model, operator guide, milestone reports
```

## Verified, sandbox, and owner actions

- **Verified here (automated):** 131 API/database tests, lint, types, web build and Android bundle (`docs/milestones/m4-audit-closure.md`).
- **Sandbox only:** SMS (fixed code, refused when `APP_ENV=production`); demo zone boundaries
  (`is_demo`, ignored in production); demo prices (`pricing_rules.is_demo`).
- **Needs owner approval/action:** SMS aggregator contract and sender ID; private object storage;
  Google Maps keys; HTTPS staging host; real zone boundaries checked on the ground; real prices;
  Play Store account and upload key; any live payment. Details: `docs/operations/storage-and-sms.md`.
