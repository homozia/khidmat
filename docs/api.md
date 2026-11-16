# API reference (v1)

JSON over HTTPS. Authenticate with `Authorization: Bearer <token>` from `/v1/auth/otp/verify`.
Money is always integer **paisa** (`_paisa` fields; PKR 1 = 100 paisa). Times are ISO 8601 UTC;
show them in Asia/Karachi. Errors: `{ "error": { "code", "message", "details"? } }`.

Writes marked **[idem]** take an `Idempotency-Key` header (8–100 of `A-Z a-z 0-9 _ - : .`).
A retry with the same key and body returns the first response; a different body is refused (409).
`POST /v1/bookings` requires the header.

## Public / any signed-in user

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | DB reachable, environment, whether SMS is sandbox |
| POST | `/v1/auth/otp/request` | `{phone}` any Pakistani mobile format. 3 per 15 min per phone |
| POST | `/v1/auth/otp/verify` | `{phone, code}` → `{token, userId, roles}`. Lock after 5 wrong codes |
| POST | `/v1/auth/logout` | Revokes the session |
| GET | `/v1/me` | Roles and provider id |
| GET | `/v1/places?q=` | Locality search in English, Urdu or Roman Urdu |
| POST | `/v1/coverage/resolve` | `{lat,lng}` or `{locality_id}` (+ optional `job_id`) → `covered` · `needs_confirmation` · `outside` (+ `nearby`) |
| GET | `/v1/catalogue?lat&lng` or `?locality_id` | Categories and jobs enabled in the resolved zone, ordered, with intake fields |

## Customer

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/bookings` **[idem, required]** | `job_id, timing (same_day/scheduled), scheduled_start?, location{lat,lng,source}` **or** `locality_id`, `address_line, landmark?, destination{lat,lng,text}?` (driver jobs), `intake{}` |
| GET | `/v1/bookings` | My bookings |
| GET | `/v1/bookings/:id` | Visible to the customer, the assigned provider and staff only |
| GET | `/v1/bookings/:id/receipt` | After completion. Providers/staff also see fee and net |
| POST | `/v1/bookings/:id/cancel` | `{reason}`. Allowed before the provider arrives |
| POST | `/v1/bookings/:id/confirm-payment` | Customer confirms cash paid → booking closed |
| POST | `/v1/quotes/:id/approve` **[idem]** | Only the booking's customer |
| POST | `/v1/quotes/:id/decline` | Booking returns to where it was |

## Provider

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/provider/offers` | Open offers: area, job, time, price lines. No address |
| POST | `/v1/provider/offers/:id/accept` · `/decline` | First acceptance wins |
| POST | `/v1/provider/bookings/:id/status` | `{to: en_route · on_site · in_progress}`. `in_progress` needs an approved work price |
| POST | `/v1/provider/bookings/:id/quotes` **[idem]** | `{kind: quote · change_order, lines[{charge_type, description, quantity, unit_price_paisa}]}`; charge types: labour, driver_hours, overtime, materials, reimbursement |
| POST | `/v1/provider/bookings/:id/complete` **[idem]** | `{cash_collected_paisa}` must equal the approved total; posts the commission once |
| GET | `/v1/provider/ledger` | Balance owed and entries |
| GET | `/v1/provider/statements` | Closed weekly statements |

## Staff

| Method | Path | Role |
| --- | --- | --- |
| GET | `/v1/admin/dispatch/queue` | dispatcher |
| GET | `/v1/admin/bookings/:id/eligible-providers` | dispatcher — ranked by distance, jobs today, rating |
| POST | `/v1/admin/bookings/:id/offers` | dispatcher — `{provider_id}`; offer expires in `OFFER_TTL_MINUTES` |
| POST | `/v1/admin/bookings/:id/confirm-location` | dispatcher — `{lat,lng}` for ambiguous manual addresses |
| POST | `/v1/admin/bookings/:id/refunds` **[idem]** | finance — `{charge_type, amount_paisa, reason}`; recomputes commission |
| POST | `/v1/admin/settlements` | finance — `{provider_id, amount_paisa, method, reference, received_at}`; duplicate reference refused |
| POST | `/v1/admin/statements/close` | finance — `{week_start}` (a Monday, Asia/Karachi); idempotent |
| GET | `/v1/admin/providers/:id/ledger` | finance |
| POST | `/v1/admin/jobs` | config_admin — new job starts as draft, no zones |
| POST | `/v1/admin/jobs/:id/status` | config_admin — `active · paused · draft` |
| PUT | `/v1/admin/jobs/:id/zones/:zoneId` | config_admin — `{status: enabled · paused, same_day?, scheduled?}` |

`super_admin` passes every staff check. All staff writes are recorded in `audit_log`.
