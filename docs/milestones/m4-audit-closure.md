# M4 audit closure report

**Scope:** corrections to `khidmat-m3.zip` requested in the M4 audit brief.
**Source:** `khidmat-m4-source.zip`. The git history has three commits: the baseline, the backend fixes, and the apps, build and CI changes.
**Date:** 16 November 2026

## 1. Baseline (before any change)

The archive was extracted to its own directory and committed unchanged as "Baseline: khidmat-m3.zip as delivered". The checks below ran against a local PostgreSQL 16 + PostGIS 3.4 using isolated `*_test` and `*_dev` databases.

| Check | Command | Baseline result |
|---|---|---|
| Install | `npm ci` | OK |
| Lint | `npm run lint` | OK |
| Types (api, web, mobile) | `npm run typecheck` | OK |
| API + database suite | `npm test` | **98 / 98 passed** (8 files). The 76 tests the earlier audit could not run ran here because PostGIS was available. |
| Web build | `npm run build:web` | OK |
| Android JS export | `npm run build:android-bundle` | OK. This is a bundle, not an APK. |

All 98 tests passed, so none of the M3 audit findings below were caught by the existing suite. Each finding was confirmed by reading the code and then reproduced with a new failing test before the fix.

## 2. Findings

Severity: **High** means a customer can be charged wrongly or twice, or a security or safety gap. **Medium** means a wrong result in a normal workflow. **Low** means friction or a missing operational capability.

| # | Finding | Sev. | Workflow | Root cause | Correction | Main files | Regression evidence |
|---|---|---|---|---|---|---|---|
| F1 | Duplicate bookings on retry | High | Customer booking | The app created a new Idempotency-Key on every tap, and the home-screen retry used a separate copy. Nothing stopped two sends running at once. | One saved submission per account: the key and full body (including the price token) are fixed at confirmation. All retries share one in-flight send. An uncertain result (network loss, timeout, 5xx, request still in progress) is kept as "uncertain" and retried with the same request. | `apps/mobile/src/lib/outbox.ts`, `book/[jobId].tsx`, `components/OutboxCard.tsx`; API `idempotent()` unchanged | `m4-audit.test.ts` › F1: never sent, lost reply, double tap (parallel), restart replay, and keys scoped per account. **5/5 pass; each ends with exactly one booking.** |
| F2a | Drafts readable across accounts | High | Shared phone | The pending booking was stored in plain AsyncStorage under one global key. | The outbox is stored in the encrypted SecureStore under `khidmat_outbox_<userId>` and only loaded for that account. Media copies live in a per-account folder. The server also refuses another account's key or price token. | `outbox.ts`, `api.ts` | F1 test "keys are scoped to the account" (409, no booking data returned). Phone scenario 7. |
| F2b | Media upload tied to booking creation | Medium | Booking with photos | Uploads ran inside the submit call, could not resume, and a retried upload stored a second copy. | Uploads run after the booking exists, one by one with a client reference. Migration 005 adds `attachments.client_ref` with a unique index and an advisory lock, so a retry returns the stored file (200). Pending files survive restarts. | `migrations/005_resumable_media.sql`, `services/attachments.ts`, `routes-m3.ts`, `outbox.ts` | F2 test: sequential retry (201 then 200, same id) and parallel retry (one row). **Pass.** |
| F2c | Sign-out left the server session alive | High | Sign-out | The app deleted its local token only. | `signOutEverywhere()` calls `/v1/auth/logout` when online and always clears the token and user id. A 401 also signs out locally. The web app already revoked its session. | `api.ts`, `_layout.tsx` | F2 test "sign-out revokes the session" (`/v1/me` 200 → logout 204 → 401). **Pass.** |
| F3 | Price consent not bound to terms | High | Booking confirmation | Create re-priced the booking silently, with no link to what the customer saw. Demo prices could be picked in production. | Preview returns a 30-minute HMAC price token over the canonical terms: job, zone, mode, timing, intake, destination, duration, price lines, total, visit charge and cancellation. Create needs the token. If it is missing, the server returns `PRICE_CONFIRMATION_REQUIRED`; if the terms changed, `PRICE_CHANGED`. Both carry the new terms and token, and the app shows them for fresh approval. The accepted hash is stored on the booking. Pricing skips `is_demo` rules when `APP_ENV=production`. | `services/bookings.ts`, `services/pricing.ts`, migration 004, `book/[jobId].tsx` | F3 tests: no token, price change, travel-charge change, detail change, accepted hash stored, demo excluded in production. **5/5 pass.** |
| F4 | Commission clarity | Medium | Provider earnings | The provider saw only total and fee. | The receipt and job page show gross, chargeable (labour), excluded (materials, travel, tolls), fee and net. The 8% default, rule overrides and rate snapshot are unchanged. | `services/finance.ts`, `web/pages/provider.tsx` | F4/F5: PKR 1,200 labour + 450 materials → **fee PKR 96, posted once** (same key twice → one ledger row); net PKR 1,554. Settlement reference reuse → 409 (`flow-plumbing.test.ts`). Weekly statement reconciles and is idempotent (`money-inspection.test.ts`). |
| F5 | Cash and refund states | Medium | Completion, finance | Payment status was a free label, refunds had no "paid" state, and outstanding actions were not shown. | Payment status is `provider_reported`, `customer_confirmed` or `auto_confirmed` (old rows mapped by migration 004). Refunds are `recorded` or `paid`. "Paid" requires a method and reference, enforced by a DB check and the API. Receipts list outstanding actions and the refund still owed. Every refund action is written to the audit log. | migration 004, `services/finance.ts`, `web/pages/admin.tsx`, `bookings/[id].tsx` | F5 tests: state transition, labour vs materials refund (−PKR 16 vs 0), empty reference 400, paid once, audit trail `refund.create, refund.create, refund.paid`. **Pass.** |
| F6 | Service window ignored requested hours | High | Driver dispatch | Overlap checks used the job's default 90 minutes. | `bookings.duration_minutes` is snapshotted at booking (hours field × 60 for hourly jobs) and backfilled by migration 004. Eligibility and overlap use the full window. | migration 004, `services/bookings.ts`, `services/dispatch.ts` | F6 test: an 8-hour booking blocks a 13:00 offer, with a plain-language reason. **Pass.** |
| F7 | No re-check at acceptance; competing acceptances | High | Offer acceptance | Acceptance only checked that the offer was open. | Acceptance locks the provider row (`FOR UPDATE`), re-runs full eligibility (status, availability, skill and licence expiry, pickup and destination coverage, overlap, daily cap, overdue balance), and withdraws the offer with a reason when it no longer qualifies. The portal shows that reason. | `services/dispatch.ts`, `web/pages/provider.tsx` | F7 tests: overlapping offers accepted in parallel → one assigned; licence expired, availability off, suspended → withdrawn with reason; stale offer → expired. Two providers on one booking: `authz-dispatch.test.ts`. **Pass.** |
| F8a | Restricted skills approved without evidence | High | Verification | Approval needed only a note. | Restricted skills need an accepted document from the same provider and a future expiry date. The portal selects the evidence document. | `services/admin.ts`, `web/pages/admin.tsx` | F8 "expired licence" test; `m3-backend.test.ts` updated to require an accepted document. **Pass.** |
| F8b | Lockouts could start without an occupancy check; visit charge unbounded | High | Locksmith lockout | No check step, and the visit charge amount was typed freely by staff. | The `authorization_checks` table is recorded once and on site. `in_progress` is blocked until a verified check exists (`AUTHORIZATION_CHECK_REQUIRED` / `AUTHORIZATION_NOT_VERIFIED`). Visit charges are only the amount disclosed in the accepted terms, only for a defined reason (`authorization_not_verified` needs a failed check), and are audited. The app shows the check rule and the visit charge before booking. | migration 004, `services/bookings.ts`, `services/admin.ts`, provider and admin web, `book/[jobId].tsx` | F8 tests: visit charge disclosed; verified lockout; unverifiable lockout (blocked, bad reason 400, PKR 500 billed, audit entry); job without terms → `NO_VISIT_CHARGE_TERMS`. **Pass.** |
| F8c | Operational paths | Low | Dispatch, support | Already working in M3. | The reassignment, no-provider, cancellation, complaint and suspension paths were re-verified. Customer messages now use plain error text with a support reference. | `errors.ts`, web `useAction` | Existing `m3-backend.test.ts` and `authz-dispatch.test.ts`. **Pass.** |
| F9 | Hard-coded cities; boundary edge cases | Medium | Location setup | The zone form had an ISB/RWP select. Points on a shared edge resolved to nothing (`ST_Contains`). | Places admin covers province, district, tehsil, city and locality, with English, Urdu and Roman Urdu aliases and hide/show. The zone form picks its city from data. Coverage and dispatch use `ST_Covers`. Aliases are unique per region (migration 004). | `services/admin.ts`, `routes-m3.ts`, `services/coverage.ts`, `web/pages/setup.tsx` | F9 tests: shared edge → covered, same zone every time; a **third synthetic district** (Demo Taxila: district, city, locality, aliases, zone, service) is bookable through the API with no app change. Paused zones and destinations outside coverage: `coverage-catalogue.test.ts`, `driver.test.ts`. **Pass.** |
| F10 | Service configuration partly hard-coded | Medium | Catalogue | The app decided "needs destination" by category code and ignored select options. | Staff can add categories, edit service settings (names, descriptions, modes, skill, duration and duration field, destination, lockout check, visit charge), add intake fields including choice fields, and manage skills. The mobile form renders all of it from `/v1/catalogue`. | `services/admin.ts`, `services/catalogue.ts`, `web/pages/setup.tsx`, `book/[jobId].tsx` | F10 tests: a **solar/UPS service with a choice field in one zone** is visible only there; an invalid option is rejected and a valid one booked; settings reach the catalogue. **Pass.** |
| F11 | Urdu gaps in error and recovery paths | Medium | All customer screens | Server English messages were shown raw. | About 40 error codes have plain-language English and Urdu text, as do all recovery, outbox, lockout and price-change messages. Choice buttons and list rows are at least 44 px high. | `mobile/src/lib/errors.ts`, `i18n.tsx` | Typecheck. **Needs a physical phone:** RTL, largest font and small screen (guide, scenario 8). |
| F12 | Setup not reproducible; reset could hit any DB | Medium | Developers, testers | No Compose file or setup script. The reset guard checked only `APP_ENV`. | `docker-compose.yml` (PostGIS 16-3.4 with dev and test databases), `npm run setup`, `npm run lan:ip`, `npm run serve:web` (LAN preview with an API proxy). The reset also refuses databases not named `*_dev`, `*_test` or `*_sandbox`. A CI workflow uses a PostGIS service. | `docker-compose.yml`, `scripts/*`, `migrate.ts`, `.github/workflows/ci.yml` | F12 test: reset on `khidmat_prod` throws. |
| F13 | Test and production settings mixed; adapters untested | High | Environments | The sandbox code was accepted anywhere outside production. The S3 and SMS adapters were stubs. | Staging accepts the sandbox code only for `SANDBOX_OTP_ALLOWLIST` numbers. Production refuses the sandbox, an allowlist, dev secrets and local storage. The SMS aggregator adapter has timeout, auth and unavailable errors. The S3 driver uses private objects and 5-minute signed URLs, with errors mapped. Every response has an `x-request-id`, also returned in error bodies. Cleartext HTTP is allowed only in the field-test build. | `config.ts`, `services/sms.ts`, `services/storage.ts`, `services/auth.ts`, `app.ts`, `app.config.ts` | F12–F14 tests: allowlist rules; SMS success, 401, unreachable, unconfigured; S3 (s3rver) put, get, signed link, delete, bad credentials, outage; request id. **Pass.** |
| F14 | No installable APK or reproducible build | High | Field testing | Only an Expo JS export existed. | `app.config.ts` variants (fieldtest, staging, production) with separate package ids. The release signing config reads the keystore from the environment. EAS profiles. A local Gradle path (`npm run apk:fieldtest`). A GitHub Actions workflow builds the signed release APK with the bundle embedded and runs `apksigner verify`, the bundle presence check, `aapt2` badging and SHA-256. An in-app **Test server** setting replaces the build-time IP. | `apps/mobile/app.config.ts`, `plugins/with-release-signing.js`, `eas.json`, `.github/workflows/android-apk.yml`, `docs/operations/android-builds.md` | Prebuild verified locally: release `signingConfig`, `usesCleartextTraffic=true` only for fieldtest, `minSdk 24`, package `pk.khidmat.customer.fieldtest`, version 0.4.0 (4). **APK: see section 4.** |

## 3. Final verification (after all fixes)

| Check | Command | Result | Where |
|---|---|---|---|
| Lint | `npm run lint` | OK | Workspace |
| Types | `npm run typecheck` | OK (api, web, mobile) | Workspace |
| API + PostGIS suite | `npm test` | **131 / 131 passed** (9 files; 33 new audit tests) | Local PostgreSQL 16 + PostGIS 3.4 |
| Web build | `npm run build:web` | OK | Workspace |
| Android JS bundle | `npm run build:android-bundle` | OK | Workspace |
| Native project generation | `APP_VARIANT=fieldtest expo prebuild` | OK; signing, cleartext and minSdk checked in generated files | Workspace |
| Signed APK | `.github/workflows/android-apk.yml` | See section 4 | GitHub Actions |
| Physical phone | Phone Test Guide | **Not run.** No handset is available to this environment. | — |
| Emulator | — | **Not run.** There is no Android SDK or emulator in this environment. | — |
| Browser | — | Web build checked by typecheck and build only. The M3 Chrome walkthrough evidence still applies to unchanged screens. The new setup screens were **not** visually walked through. | — |

## 4. APK status

The workspace cannot download the Android SDK or Gradle (Google's Maven and Gradle hosts are blocked), so the APK is built in GitHub Actions, the route the owner chose. This session cannot create a GitHub repository. The build waits for the owner to create an empty private repository. After that: push, set the four signing secrets, then run **Field-test APK** with version code 4. The workflow output (`khidmat-m4-field-test.apk`, `.sha256`, `apksigner.txt`, `badging.txt`) is the release evidence.

## 5. Remaining blockers and owner inputs

| Item | Needed for | Status |
|---|---|---|
| Empty private GitHub repo | Signed APK | Waiting on the owner |
| Physical Android phone run | "Ready for phone testing" sign-off | Use the Phone Test Guide |
| Google Maps key (Android + server) | Editable map pins. Dispatcher pin confirmation and manual area search already work without it. | Owner input |
| SMS aggregator account, API URL, key, approved sender ID | Live OTP (staging and production) | Owner input; quote request in `docs/owner/sms-quote-request.md` |
| Private object storage (e.g. Cloudflare R2 bucket and keys); bucket policy set to private | Staging and production files | Owner input. The emulator test cannot prove the bucket policy. |
| Staging hostname with HTTPS, plus a staging allowlist of synthetic numbers | Remote testing | Owner input |
| Play Console upload key (production) | Public release | Owner input. The field-test key must not be reused for Play. |

## 6. Public-launch readiness (separate from field testing)

**Not ready for public launch.** Open items before launch:
- Live SMS, private storage, a staging environment and maps credentials, all needing owner approval.
- Results from the physical phone test.
- Real zone boundaries checked on the ground (`docs/owner/zone-field-checklist.md`).
- Production signing in Play Console.
- Privacy policy and terms.
- Backups and monitoring for the production database.
- A load test of dispatch at expected volumes.
