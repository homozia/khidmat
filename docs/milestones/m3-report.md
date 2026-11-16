# Milestone 3 — evidence report (16 Nov 2026)

**Result:** all three apps exist and work against the same backend. A customer can sign in on the
Android app (English or Urdu) and pick their area without GPS. They can then book a plumbing job, see
the price before confirming, survive a dropped connection without creating a duplicate, approve a
change order, and get a receipt. Providers work from the mobile web portal. Operations staff dispatch,
verify providers, edit services, prices and areas, handle complaints and refunds, and close weeks
from the web dashboard.

## What was added

| Area | Added |
| --- | --- |
| Backend | Private uploads (photos, voice notes, completion/lockout photos, provider documents) checked by file signature, served only through 5-minute signed links; reviews and provider rating; complaints with review → resolution, including refund with commission recalculation; admin editing of zones (GeoJSON draw/import, verify, activate, boundary change pauses the zone), categories (reorder, pause), jobs, prices (new price for new bookings only) and commission rules; provider registration, document review (every view logged with a reason), skill approval with licence expiry, suspend; reassign, no-provider, visit-charge-only for unverifiable lockouts, manual ledger adjustment; summary report; background jobs (offer expiry, same-day no-provider after 30 min, auto-close after 72 h, media retention); booking price preview; CORS and safety headers |
| Web (`apps/web`) | Provider portal: offers, my jobs, job screen with journey rail, price/change-order builder, complete with cash, completion photo, earnings and statements, profile with availability and documents. Operations: dispatch, bookings with timeline and actions, complaints, providers, money (close week, record payments, commission rules), reports, services and prices, service areas. English/Urdu with right-to-left layout |
| Customer app (`apps/mobile`) | Expo SDK 58, Expo Router. Sign-in, location by GPS or area search (English/Urdu/Roman Urdu), categories, job form with intake fields, address and landmark, driver destination, same-day or scheduled time, up to 3 photos and a 60-second voice note, price review, offline-safe confirm, my bookings, tracking journey, approve/decline prices, receipt, "I paid in cash", rating, complaint, cancel. English/Urdu with right-to-left layout |
| Owner documents | `docs/owner/sms-quote-request.md`, `docs/owner/zone-field-checklist.md` |

## Commands run and results

| Command | Result |
| --- | --- |
| `npm run verify` (lint, type check of all 3 apps, 98 API tests, web build) | all passed |
| `npm run build:android-bundle` (`expo export --platform android`) | Android Hermes bundle produced (2.6 MB) |
| `expo export --platform web` + scripted Chrome run at 390×844 | full booking journey completed through the real UI |
| Interrupted request check (browser set offline at "Confirm booking", then "Send again" tapped twice) | bookings before 0, after 1: no duplicate |
| Commission for that booking (labour 800 + 400, materials 450 approved by change order) | one entry of PKR 96 (8% of 1,200) |

Screenshots: `docs/milestones/m3-screens/`.

## Acceptance checks now

| Check | Status |
| --- | --- |
| AC1 job added in one Rawalpindi zone, no app release | Verified (API + admin screen exists) |
| AC2 GPS denied, outside coverage, overlaps | Verified (API); manual area path used by the customer app in the scripted run |
| AC3, AC4, AC5, AC6 | Verified (API tests); screens exist for every step |
| AC7 English and Urdu on Android; interrupted request | **Partly.** Urdu/RTL and the no-duplicate retry verified in the app's web build in Chrome. **Not yet run on a real Android device or emulator** (none available here). Needs one `eas build --profile development` (owner approval for an Expo account) or a local Android Studio emulator |
| AC8 fresh checkout | Verified for API, web, and Android bundle |

## Known gaps (Milestone 4)

- Real-device QA on low-end Android, accessibility pass with TalkBack, weak-network testing on 3G.
- The customer app has no map yet: the provider sees an area-centre pin unless GPS was shared or a dispatcher confirmed it. Adding a map with a draggable pin needs a Google Maps Android key (owner approval) and a development build.
- On the web preview the session is not kept across reloads (by design: tokens are kept only in the phone's secure storage).
- Production file storage (S3/R2 adapter), live SMS adapter, staff two-factor sign-in, push notifications, CI pipeline, deployment, backups and the restore drill.
- Booking references can skip numbers (price previews use a number and roll back); harmless, noted for operators.
