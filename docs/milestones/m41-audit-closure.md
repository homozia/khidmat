# M4.1 audit closure report

**Input:** `khidmat-m4-source.zip` (SHA-256 `d54a2216…2593`; identical to the M4 delivery, kept unchanged).
**Output:** `khidmat-m4.1-source.zip`. The git history starts from the M4 package (tag `m4`).
**Date:** 16 November 2026. All checks below ran in Claude's Linux workspace with PostgreSQL 16 + PostGIS 3.4.

## Findings

| # | Finding | Confirmed by | Fix | Evidence (observed) |
|---|---|---|---|---|
| D1 | **Lockout authorisation bypass.** `on_site → completed` was allowed (needed for visit-only charges), but completion never checked the occupancy check, so a lockout could be completed and billed unverified. Bookings whose saved terms lacked the flag skipped the check entirely. | Reading the code; the new tests fail on M4 (2 of 5) | One rule, `assertAuthorizedForWork`, applies at `in_progress` and at completion. The flag falls back to the service setting for older bookings. The only exception is a visit-only charge (all approved lines are a disclosed visit charge billed by staff for a defined reason). The provider portal blocks completion and says why. | `m41-audit.test.ts` D1: unverified completion refused (no ledger entry); verified job completes from `on_site` and from `in_progress`; older booking blocked; visit-only charge after a failed check completes at PKR 500; customer-absent visit-only charge completes. **5/5 pass** |
| D2 | **Test-server switching.** The session, drafts and files were scoped by account only. Two seeded servers share user IDs, so a draft could follow the tester to the wrong server. Requests read the server address at call time. | Reading the code; first test run showed the switch revoking the token of an in-flight send | The session records its server, and a server change requires a fresh sign-in. Drafts and files are stored under server + account. Every request a draft makes is bound to its server and token. Switching lets the request already on its way finish, stops before the next one, ends the old session on the old server, then switches. A 401 from an old server never signs out the current session. | `apps/mobile/test/outbox.test.ts` against **two real API servers** on separately seeded databases: same user ID, separate drafts; old session revoked (401), fresh sign-in required after restart; uncertain booking stays with server A and "Check again" finds that one booking; switch during an upload: nothing reaches B, the remaining file resumes on A, 2 files in total. **4/4 pass** |
| D3 | **Setup erased test data.** `npm run setup` called `db:seed`, which was an alias for reset. | Reading the code | `db:init` migrates and loads demo data only into an empty database. `db:seed` now means the same thing. `db:reset` / `reset-test-data.ps1` asks for the database name to be typed (or `--yes`) and still refuses non-disposable names. The start scripts use init only. | `m41-audit.test.ts` D3: init run twice after creating a booking, photo, completion, refund and ledger entries leaves every count and the ledger total identical; a fresh database is seeded. Live: start re-run on a populated database printed "Existing data kept" with counts unchanged; reset with a wrong answer printed "Cancelled. Nothing was changed." |
| D4 | **Failed uploads disappeared.** Permanent upload errors silently marked a file as done; there was no state or recovery. | Reading the code | Each file is *Waiting to send*, *Sending*, *Sent* or *Not sent*, with a plain reason. Permanent errors offer **Replace** or **Remove**; connection problems keep the file waiting for **Send files**. The booking reference stays visible. After a restart, "uploading" becomes "waiting" again without re-sending the booking. | `outbox.test.ts` D4: unsupported file → *Not sent* (permanent), kept, replaced with a JPEG and uploaded; removal; lost upload reply → *Waiting*, the server already has it, the retry stores it once; interrupted send + restart → uncertain booking resolved to one booking, file uploaded once. **4/4 pass** |
| D5 | **Docs and code disagreed.** | Checking each doc against the code | `docs/api.md` was rebuilt from the route list (it still described M1–M2: no preview or price token, uploads, lockout check, refunds marked paid, places, skills, service settings; wrong OTP limit). `operator-guide.md` was rewritten (it still said "until the admin web app ships"). The old phone guide was replaced by START_HERE / PHONE_TEST_CHECKLIST. The M4 closure report gained a corrections note. The README commands match the scripts. The APK workflow, eas.json and app.config agree on 0.4.1 / versionCode 5. | Manual check; fresh-clone verification below. Upgrade from M4: see below |

### Found during the usability walkthroughs (also fixed)

| Problem | Where | Fix | Evidence |
|---|---|---|---|
| Area search for `g10` or `G10` returned nothing, with no message (a dead end) | App, API | Space-insensitive alias match; a "no area matches" message and a search error message | API test (5 spellings); walkthrough at 360 px |
| Sandbox OTP limit of 3 per 15 minutes locked testers out after three account switches | API | Sandbox numbers (no SMS sent) allow 30; live SMS keeps 3 | `platform.test.ts` both limits |
| Signed-out start opened the Report screen | App | `Stack.Protected redirectTo` | Walkthrough lands on sign-in |
| Phone numbers, amounts and references displayed reversed in Urdu | App | Unicode LTR isolation for numbers, PKR amounts, references and addresses | Urdu walkthrough screenshots |
| Service list showed no prices | App, API | `from_price_paisa` in the catalogue (same rule as the preview); "from Rs …" in the list | API test; screenshot |
| New users saw only a small "Choose my area" row; Cancel was open under the timeline; complaints were labelled "Report a problem", like the tester's report | App | First-step prompt; collapsible cancel; "Make a complaint" | Walkthrough |
| Staff tab row stretched to about 200 px on phones; the provider tab bar could cover the last action | Website | Grid rows and padding reserved for the tab bar | Measured 55 px nav and 64 px reserve at 390 px |
| Only locksmith seeded was pending, which blocked the lockout test | Seed | Added Rashid, a licensed locksmith (Zahid stays pending for the verification test) | Role card; suite green |
| Request ids shown inline on normal screens | App, website | Moved to **Diagnostics** (app home and website footer) | Screenshots |

## New in this package

- **Windows:** `start-test-env.ps1`, `stop-test-env.ps1`, `reset-test-data.ps1` over `scripts/test-env.mjs`. These give progress steps, plain errors (Docker missing or not running, port in use, database not ready), and print the phone URLs. They list adapters with Wi-Fi first and virtual adapters (WSL, VirtualBox and so on) marked, and explain same-Wi-Fi, client isolation, the firewall rule and a changed IP.
- **App:**
  - **Test server** screen: address in use, connection check with plain-language diagnosis, version.
  - Test accounts on sign-in (TEST app with a sandbox server only).
  - **Diagnostics** with request ids.
  - **Report** (TEST app only): a draft of safe fields; free text is scrubbed of phone and ID numbers; nothing is sent automatically.
  - Next-step text for every booking status.
- **Website:** role card on the sign-in page (sandbox server only), **Diagnostics**, **Report a problem** (sandbox server only).
- **Lost-reply control:** `TEST_FAULTS=1`, refused on staging and production. The app's Diagnostics switch makes the server save a booking or file and then drop the reply.
- **APK workflow:**
  - produces `khidmat-m4.1-field-test.apk`;
  - checks the package ID, versionName 0.4.1, the versionCode input, minSdk 24, the embedded bundle, the v2 signature, a non-debug key and (with `KHIDMAT_CERT_SHA256`) the expected key;
  - writes SHA-256 and a run summary.

## Verification (commands run, observed results)

| Check | Command | Result | Environment |
|---|---|---|---|
| Install | `npm ci` (fresh clone) | 836 packages | Workspace |
| Lint | `npm run lint` | OK | Workspace |
| Types (api, web, mobile) | `npm run typecheck` | OK | Workspace |
| API + PostGIS suite | `npm test -w apps/api` | **143 / 143** (10 files; 11 new in `m41-audit.test.ts`, 1 added in `platform.test.ts`) | PostgreSQL 16 + PostGIS 3.4 |
| App logic vs two real servers | `npm test -w apps/mobile` | **8 / 8** | Two API processes, two seeded databases |
| Start script | `node --test scripts/test-env.test.mjs`, plus live start, re-run, stop and reset | 3/3; live behaviour as described in D3 | Workspace without Docker (`KHIDMAT_NO_DOCKER=1`); the Docker-missing message was also checked |
| Web build | `npm run build:web` | OK | Workspace |
| Android bundle | `npm run build:android-bundle` | OK | Workspace |
| Native config | `expo prebuild` fieldtest / production | fieldtest: `pk.khidmat.customer.fieldtest`, 0.4.1 (5), release signing hook, cleartext true. Production: `pk.khidmat.customer`, cleartext **false** | Workspace |
| Upgrade from M4 | M4 code built a database with a completed booking, photo, change order, refund, ledger and a pending booking; then M4.1 `db:init` and the M4.1 API | Counts identical (2 bookings, 1 file, 1 refund, 2 ledger entries, PKR 80 net fee). The receipt reads gross PKR 1,450, fee PKR 80, refund owed PKR 200; `g10` finds G-10 | Workspace |
| Customer walkthrough (English) | Web build of the TEST app at 360 × 760 | Sign-in → area with GPS denied → plumbing → review → confirm with the lost-reply control → **one booking** (count 2→3 at the drop, still 3 after "Check again") → booking detail → report → My bookings. No horizontal overflow, no page errors | Chrome (desktop) emulating a narrow screen, **not** a phone |
| Customer walkthrough (Urdu) | Same, Urdu | Right-to-left layout correct; prices and numbers read correctly after the fix; no overflow | Chrome, narrow |
| Provider and staff portals | Website at 390 × 844 | Accept offer, job, quote, change order, cash completion (fee PKR 96 on 1,200 + 450), lockout check form, complaint review, report. No overflow after the fixes | Chrome, narrow |
| Signed APK | GitHub Actions | **Not run:** no repository exists yet (see below) | — |
| Physical phone / emulator | PHONE_TEST_CHECKLIST.md | **Not run:** no Android device or SDK here | — |
| Windows PowerShell scripts | — | **Not run:** no Windows or PowerShell here. The scripts only check Node and Docker and call the tested Node script | — |
| Large system font | — | **Needs a phone** (checklist C5) | — |

## Needs your account or your phone

1. **GitHub:** create the empty private repository `khidmat` and reply "repo created". Claude then pushes and sets the four signing secrets and the certificate variable. Alternatively follow `docs/operations/android-builds.md`, steps 2–3. Then click **Actions → Field-test APK → Run workflow** (versionCode 5) and download the **khidmat-m4.1-field-test** artifact.
2. **Phone:** install the APK and run PHONE_TEST_CHECKLIST.md (smoke test A, then B–I).
3. **Windows laptop:** run `start-test-env.ps1` once and report anything unclear.

The package is **not yet "ready for phone testing"**: that needs the signed APK installed and connected to the test backend. Public launch is still **not ready** (live SMS, private storage, staging host, maps keys, Play signing and a physical-phone pass are outstanding; see `docs/operations/storage-and-sms.md`).
