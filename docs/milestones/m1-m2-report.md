# Milestones 1 and 2 — evidence report (16 Nov 2026)

**Result:** the backend for the first end-to-end booking works locally against PostgreSQL 16 + PostGIS 3:
a GPS-denied customer books a fixed-price plumbing job in G-10, a dispatcher offers it to the only
eligible plumber, he accepts, adds materials that the customer approves, completes with PKR 1,250
cash, and exactly one PKR 64 commission entry is posted, even after a duplicate completion request.
Weekly statements and settlements reconcile. 75 automated tests pass on a fresh clone.

## Commands run and results

| Command | Result |
| --- | --- |
| `npm run db:reset` (fresh clone) | 2 migrations applied; seeded 11 categories, 51 jobs, 4 zones, 12 users |
| `npm run db:migrate` (twice) | "Database is up to date." both times |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors (TypeScript 5.9.3, strict) |
| `npm test` | 7 files, 75 tests passed (~7 s) |
| `git clone` → `npm ci` → `npm run db:reset` → `npm run verify` | all passed (acceptance check 8, API scope) |
| Live server + curl | `/health` ok; catalogue at G-10 → zone ISB-G, 11 categories, 51 jobs; signed-in `/v1/me` → 200 |

## Acceptance checks

| Check | Status | Evidence |
| --- | --- | --- |
| AC1 job added in one Rawalpindi zone, history keeps terms | **Verified (API)**; admin screen is M3 | `coverage-catalogue.test.ts` › AC1 (6 tests) |
| AC2 GPS denied, outside coverage, overlaps | **Verified (API)**; app screens are M3 | `coverage-catalogue.test.ts` › AC2 (5 tests); `flow-plumbing` first test |
| AC3 fixed-price cash job, one PKR 64 entry after duplicate | **Verified** | `flow-plumbing.test.ts` (10 tests) |
| AC4 inspection, change order, partial refund, settlement | **Verified (API core)**; dispute screens are M3 | `money-inspection.test.ts` (10 tests) |
| AC5 cross-city driver, overtime approval | **Verified (API)** | `driver.test.ts` (4 tests) |
| AC6 restricted jobs, no cross-user reads | **Verified (API)**; attachments arrive in M3 | `authz-dispatch.test.ts` (9 tests) |
| AC7 Android app in English/Urdu, no duplicate on interrupted request | **Partly**: no-duplicate verified at API (`platform.test.ts` › idempotency); the app does not exist yet | — |
| AC8 fresh checkout runs the demo | **Verified** for the API | clone run above |

## Remaining gaps (carried into Milestone 3/4)

- No customer app, provider portal or admin web UI yet; all flows are API-only.
- No photo/voice uploads (private bucket + signed URLs), complaints, reviews or dispute records.
- Same-day bookings are accepted at any hour (dispatcher handles); only scheduled times check zone hours.
- Offer expiry is checked when a provider responds; there is no background job yet to expire offers,
  move stale bookings to No provider, or auto-close completed bookings (function exists: `autoCloseCompleted`).
- Rate limiting covers OTP only; per-IP limits on booking creation, uploads and exports are still to add.
- Zone drawing/import, pricing and commission-rule editing have database support but no admin endpoints yet
  (only job create/status/zone enable).
- Provider self-onboarding and document upload are not built; demo providers are seeded.
- Staff second factor, OpenAPI generation, CI pipeline config, deployment, backups: Milestone 4.
- `npm audit` reports a moderate advisory in a dev-only dependency of `typescript-eslint` (minimatch); it does not ship to production.
