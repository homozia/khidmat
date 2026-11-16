# Live services: SMS, file storage, maps (owner inputs)

The test stack runs with none of these. Each service is behind an adapter selected by `.env` and refused in production when misconfigured.

## SMS sign-in codes

| Setting | Test | Staging | Production |
|---|---|---|---|
| `SMS_PROVIDER` | `sandbox` (code `SANDBOX_OTP_CODE`, nothing sent) | `sandbox` with `SANDBOX_OTP_ALLOWLIST`, or `aggregator` | `aggregator` (sandbox refused) |
| `SANDBOX_OTP_ALLOWLIST` | not needed | **required** with sandbox: comma-separated synthetic numbers; any other number gets `TEST_NUMBERS_ONLY` | must be empty |

Aggregator adapter (`apps/api/src/services/sms.ts`): it sends an HTTPS JSON POST `{to, from, text}` with a bearer API key, times out after `SMS_TIMEOUT_MS`, and maps the response to `SMS_AUTH_FAILED` (401/403), `SMS_UNAVAILABLE` (network, timeout, 5xx) or `SMS_FAILED`. If the chosen provider's API differs, change only `sendViaAggregator`.

**Owner inputs:** the aggregator contract, API URL, API key, and a PTA-approved sender ID. See `docs/owner/sms-quote-request.md`.

## Files (photos, voice notes, provider documents)

| Setting | Test | Staging/production |
|---|---|---|
| `STORAGE_DRIVER` | `local` (laptop disk, HMAC-signed links) | `s3` (local refused in production) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | required |

The S3 driver (`services/storage.ts`) stores objects privately and hands out 5-minute signed download links. It maps errors to `NOT_FOUND`, `STORAGE_AUTH_FAILED` and `STORAGE_UNAVAILABLE`. Tested against the s3rver emulator: upload, download, signed link, delete, bad credentials, outage.

**Owner inputs:** a bucket, for example Cloudflare R2, with **no public access** and lifecycle deletion after `MEDIA_RETENTION_DAYS`, plus an access key limited to that bucket. Bucket privacy is a provider setting that the emulator cannot check: after setup, confirm that opening an object URL without a signature returns 403.

## Maps

Without a key, customers choose their area from the place list or use GPS. A dispatcher confirms the pin before dispatch whenever an area spans more than one zone.

**Owner inputs:** a Google Maps Platform Android key, restricted to the package id and SHA-1 shown in `apksigner.txt`, and a server key restricted by IP (`MAPS_SERVER_KEY`). These enable draggable pickup pins.

## Staging

**Owner inputs:**
- An HTTPS hostname, for example `staging-api.<domain>`.
- A managed PostgreSQL 16 with PostGIS.
- `APP_ENV=staging`, with random `FILE_SIGNING_SECRET` and `QUOTE_SIGNING_SECRET` (`openssl rand -hex 32`).
- An allowlist of synthetic numbers.

Build the staging app with `APP_VARIANT=staging EXPO_PUBLIC_API_URL=https://… `.
