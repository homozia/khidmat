# API reference (v1)

JSON over HTTPS (plain HTTP only on the local test stack). Authenticate with `Authorization: Bearer <token>` from `/v1/auth/otp/verify`.
Money is always integer **paisa** (`_paisa` fields; PKR 1 = 100 paisa). Times are ISO 8601; show them in Asia/Karachi.

**Errors:** `{ "error": { "code", "message", "details"?, "request_id" } }`. Every response carries an `x-request-id` header. Quote it in defect reports.

**Idempotent writes:** routes marked **[idem]** take an `Idempotency-Key` header (8–100 of `A-Z a-z 0-9 _ - : .`).
- The key is scoped to the signed-in account.
- A retry with the same key and body returns the first response. A different body is refused (`IDEMPOTENCY_KEY_REUSED`).
- A retry while the first request is still running gets `REQUEST_IN_PROGRESS`.

**Test stack only:** with `TEST_FAULTS=1`, which is refused on staging and production, the header `x-khidmat-test-fault: drop-reply` on `POST /v1/bookings` or a file upload makes the server save normally and then drop the connection. This reproduces a reply lost after the database commit.

## Public / any signed-in user

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ok, app, env, sandbox_sms, test_faults}` |
| POST | `/v1/auth/otp/request` | `{phone}`, any Pakistani mobile format. Live SMS: 3 codes per 15 min per phone. Sandbox codes (test stack): 30. Staging accepts the sandbox code only for `SANDBOX_OTP_ALLOWLIST` numbers (`TEST_NUMBERS_ONLY`) |
| POST | `/v1/auth/otp/verify` | `{phone, code}` → `{token, userId, roles}`. Locks after 5 wrong codes |
| POST | `/v1/auth/logout` | Revokes the session on the server |
| GET | `/v1/me` | Roles and provider id |
| GET | `/v1/places?q=` | Locality search in English, Urdu or Roman Urdu. Ignores spaces and punctuation (`g10`, `G-10` and `g 10` all match) |
| POST | `/v1/coverage/resolve` | `{lat,lng}` or `{locality_id}` (+ optional `job_id`) → `covered`, `needs_confirmation` or `outside` (+ `nearby`). Points on a shared zone edge count as covered |
| GET | `/v1/catalogue?lat&lng` or `?locality_id` | Categories and services enabled in the resolved zone, with everything the app form needs: `booking_modes`, `from_price_paisa`, `needs_destination`, `requires_authorization_check`, `visit_charge_paisa`, `duration_field_key`, `description_*`, `fields[{key,type,label_*,required,min,max,options[{value,label_en,label_ur}]}]` |
| GET | `/v1/files?…` | Signed download link target (local storage only; 404 with S3) |

## Customer

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/bookings/preview` | Same body as create. → `{terms, price_token, needs_location_confirmation, location_precision}`. `terms` holds the price lines, total, visit charge, cancellation rule and duration. The 30-minute `price_token` is bound to the account and to those exact terms |
| POST | `/v1/bookings` **[idem, required]** | `job_id, timing (same_day/scheduled), scheduled_start?, location{lat,lng,source}` **or** `locality_id`, `address_line, landmark?, destination{lat,lng,text}?`, `intake{}`, `price_token`. Without a token: `PRICE_CONFIRMATION_REQUIRED`. If anything changed: `PRICE_CHANGED`. Both return `details.terms` and a fresh `details.price_token` to show and approve again |
| GET | `/v1/bookings` | My bookings |
| GET | `/v1/bookings/:id` | Customer, assigned provider and staff only. Includes `requires_authorization_check`, `authorization_check` and `visit_charge_paisa` |
| GET | `/v1/bookings/:id/receipt` | After completion. Lines by group, `payment_status` (`provider_reported`, `customer_confirmed` or `auto_confirmed`), `refunds[]`, `refund_owed_paisa`, `outstanding[]`. The provider and staff also see `provider{gross, commissionable, excluded, fee, net}` |
| POST | `/v1/bookings/:id/attachments?kind=photo\|voice&client_ref=` | Raw file body (photo: JPEG, PNG or WebP up to 5 MB; voice: M4A, AAC or MP3 up to 2 MB). Max 3 photos and 1 voice note. The same `client_ref` (8–80 safe characters) returns the stored file with 200 instead of storing it twice |
| GET | `/v1/bookings/:id/attachments` · GET `/v1/attachments/:id/url` · DELETE `/v1/attachments/:id` | List; 5-minute signed link; delete own file |
| POST | `/v1/bookings/:id/cancel` | `{reason}`. Allowed before the provider arrives |
| POST | `/v1/bookings/:id/confirm-payment` | Customer confirms cash paid → closed |
| POST | `/v1/bookings/:id/review` · `/complaints` | `{rating}` (14 days) · `{category, description}` (7 days, one open at a time) |
| POST | `/v1/quotes/:id/approve` **[idem]** · `/decline` | Only the booking's customer |

## Provider

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/provider/offers` · `/jobs` · `/profile` | Offers show area, job, time and price lines, but no address |
| POST | `/v1/provider/offers/:id/accept` · `/decline` | On accept the server re-checks status, availability, licence expiry, pickup and destination coverage, overlapping jobs, daily cap and overdue balance (serialised per provider). → `{status: accepted}`, `{status: withdrawn, reason}` or `{status: expired}` |
| POST | `/v1/provider/bookings/:id/status` | `{to: en_route · on_site · in_progress}`. `in_progress` needs an approved work price and, for lockouts, a verified occupancy check (`AUTHORIZATION_CHECK_REQUIRED` / `AUTHORIZATION_NOT_VERIFIED`) |
| POST | `/v1/provider/bookings/:id/authorization-check` | Lockouts, on site, once: `{verified, method: photo_id_matches_address · utility_bill · tenancy_document · guard_or_neighbour · not_verifiable, note}` |
| POST | `/v1/provider/bookings/:id/quotes` **[idem]** | `{kind: quote · change_order, lines[{charge_type, description, quantity, unit_price_paisa}]}`. Charge types: labour, driver_hours, overtime, materials, reimbursement |
| POST | `/v1/provider/bookings/:id/complete` **[idem]** | `{cash_collected_paisa}` must equal the approved total. Posts the commission once. Lockouts need a verified check unless the only approved charge is a visit-only charge |
| PUT | `/v1/provider/availability` | `{accepting_offers}` |
| POST | `/v1/provider/documents` | Upload a licence or certificate (raw file, `?doc_type=`) |
| GET | `/v1/provider/ledger` · `/statements` | Balance owed and entries · closed weekly statements |

## Staff

| Method | Path | Role |
| --- | --- | --- |
| GET | `/v1/admin/dispatch/queue` · `/bookings` · `/bookings/:id/timeline` | dispatcher, finance |
| GET | `/v1/admin/bookings/:id/eligible-providers` | dispatcher. Ranked by distance, jobs today, rating |
| POST | `/v1/admin/bookings/:id/offers` | dispatcher. `{provider_id}`. Ineligible providers are refused with a plain reason |
| POST | `/v1/admin/bookings/:id/confirm-location` | dispatcher. `{lat,lng}` for approximate manual addresses |
| POST | `/v1/admin/bookings/:id/reassign` · `/no-provider` | dispatcher. `{reason}` |
| POST | `/v1/admin/bookings/:id/visit-charge` | dispatcher. `{reason: authorization_not_verified · customer_absent · access_refused, note}`. Bills only the visit charge disclosed in the accepted terms. `authorization_not_verified` needs a failed check |
| POST | `/v1/admin/bookings/:id/refunds` **[idem]** | finance. `{charge_type, amount_paisa, reason}`. Recomputes the commission (labour lowers it; materials do not) |
| POST | `/v1/admin/refunds/:id/paid` | finance. `{method, reference}`. The reference is required; a refund can be marked paid only once |
| POST | `/v1/admin/settlements` · `/statements/close` | finance. Duplicate settlement reference refused · `{week_start}` Monday, idempotent |
| GET | `/v1/admin/providers/:id/ledger` · POST `/v1/admin/providers/:id/adjustments` | finance |
| GET | `/v1/admin/complaints` · POST `/v1/admin/complaints/:id/resolve` | dispatcher, finance |
| GET/POST | `/v1/admin/providers` · POST `/:id/status` · PUT `/:id/zones` | verification (create, approve, suspend) |
| GET | `/v1/admin/providers/:id/documents` · POST `/v1/admin/documents/:id/url` · `/review` | verification. Viewing a document is logged with a reason |
| POST | `/v1/admin/providers/:id/skills/:skill` | verification. Restricted skills need `expires_at` in the future and an accepted `evidence_document_id` |
| GET/POST | `/v1/admin/regions` · POST `/:id/aliases` · `/:id/status` · DELETE `/v1/admin/aliases/:id` | config_admin. Places (province to locality) and English/Urdu/Roman Urdu spellings |
| GET/POST/PATCH | `/v1/admin/zones` · POST `/:id/verify` · `/:id/status` | config_admin. A zone sells only when verified and active |
| GET/PUT | `/v1/admin/skills` | config_admin |
| GET | `/v1/admin/catalogue` · POST `/v1/admin/categories` · PATCH `/:id` · POST `/reorder` | config_admin |
| POST | `/v1/admin/jobs` · GET/PATCH `/:id` · PATCH `/:id/settings` · POST `/:id/status` · PUT `/:id/zones/:zoneId` | config_admin. Settings: names, descriptions, modes, skill, duration, duration field, destination, lockout check, visit charge |
| PUT | `/v1/admin/jobs/:id/fields` · DELETE `/:id/fields/:key` | config_admin. Intake questions, including choice fields (2 or more options) |
| POST | `/v1/admin/pricing-rules` · GET/POST `/v1/admin/commission-rules` | config_admin. New prices apply to new bookings only |
| GET | `/v1/admin/reports/summary` · POST `/v1/admin/jobs/run` | dispatcher, finance · super_admin (run background jobs now) |

`super_admin` passes every staff check. All staff writes are recorded in `audit_log`.
