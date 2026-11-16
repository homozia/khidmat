# Data model

Generated from the migrated schema (`app` schema, PostgreSQL 16 + PostGIS). Money columns are integer paisa; geometry is SRID 4326 (WGS 84).

Key guarantees enforced by the database itself:

- `assignments_one_accepted`: at most one accepted provider per booking (partial unique index).
- `quotes_one_open`: at most one quote waiting for the customer per booking.
- `ledger_entries.source_key` unique: a completion, refund or settlement can post its money entry only once.
- `ledger_entries`, `booking_events`, `audit_log`: UPDATE and DELETE raise an error (append-only triggers).
- `settlements (provider_id, method, reference)` unique: a payment reference is recorded once.
- `bookings.terms_snapshot`: job name, price lines, pricing rule, commission rate and zone as agreed at booking time.

## Identity and audit

| Table | Columns |
| --- | --- |
| `users` | id uuid, phone_e164 text, full_name text, preferred_language text, status text, created_at timestamp with time zone |
| `user_roles` | user_id uuid, role text, granted_by uuid, granted_at timestamp with time zone |
| `otp_challenges` | id uuid, phone_e164 text, code_hash text, expires_at timestamp with time zone, attempts integer, consumed_at timestamp with time zone, created_at timestamp with time zone |
| `sessions` | id uuid, user_id uuid, token_hash text, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone |
| `audit_log` | id bigint, actor_user_id uuid, action text, entity_type text, entity_id text, reason text, before_data jsonb, after_data jsonb, created_at timestamp with time zone |
| `idempotency_keys` | user_id uuid, route text, key text, request_hash text, response_status integer, response_body jsonb, created_at timestamp with time zone |

## Location and coverage

| Table | Columns |
| --- | --- |
| `regions` | id uuid, parent_id uuid, level text, code text, name_en text, name_ur text, centroid geometry, boundary geometry, is_demo boolean, status text |
| `place_aliases` | id bigint, region_id uuid, alias text, lang text, normalized text |
| `service_zones` | id uuid, code text, name_en text, name_ur text, city_region_id uuid, district_region_id uuid, boundary geometry, precedence integer, status text, is_demo boolean, verified_by uuid, verified_at timestamp with time zone, opens_at time without time zone, closes_at time without time zone, travel_charge_paisa bigint, created_at timestamp with time zone |

## Catalogue and pricing

| Table | Columns |
| --- | --- |
| `skills` | code text, name_en text, name_ur text, restricted boolean |
| `categories` | id uuid, code text, name_en text, name_ur text, display_order integer, status text, updated_at timestamp with time zone |
| `jobs` | id uuid, category_id uuid, code text, name_en text, name_ur text, description_en text, description_ur text, display_order integer, status text, booking_modes ARRAY, required_skill text, duration_minutes integer, needs_destination boolean, updated_at timestamp with time zone |
| `job_intake_fields` | id uuid, job_id uuid, key text, field_type text, label_en text, label_ur text, required boolean, options jsonb, min_value numeric, max_value numeric, display_order integer |
| `job_zone_availability` | job_id uuid, zone_id uuid, same_day boolean, scheduled boolean, status text |
| `pricing_rules` | id uuid, job_id uuid, zone_id uuid, base_labour_paisa bigint, unit_label text, unit_field_key text, unit_labour_paisa bigint, included_units integer, inspection_fee_paisa bigint, effective_from timestamp with time zone, effective_to timestamp with time zone, is_demo boolean |
| `charge_types` | code text, name_en text, name_ur text, commissionable boolean, receipt_group text |
| `commission_rules` | id uuid, scope_job_id uuid, scope_category_id uuid, scope_district_id uuid, rate_bps integer, effective_from timestamp with time zone, effective_to timestamp with time zone, created_by uuid, created_at timestamp with time zone |

## Providers

| Table | Columns |
| --- | --- |
| `providers` | id uuid, user_id uuid, display_name text, status text, base_location geometry, daily_job_cap integer, rating_avg numeric, approved_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone |
| `provider_skills` | provider_id uuid, skill_code text, status text, check_note text, expires_at timestamp with time zone, approved_by uuid, approved_at timestamp with time zone |
| `provider_zones` | provider_id uuid, zone_id uuid |

## Bookings

| Table | Columns |
| --- | --- |
| `bookings` | id uuid, ref text, customer_id uuid, job_id uuid, zone_id uuid, booking_mode text, status text, resume_status text, timing text, scheduled_start timestamp with time zone, address_line text, landmark text, locality_region_id uuid, location geometry, location_source text, needs_location_confirmation boolean, destination_text text, destination geometry, intake jsonb, terms_snapshot jsonb, commission_rate_bps integer, commission_rule_id uuid, assigned_provider_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, completed_at timestamp with time zone, closed_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text |
| `booking_events` | id bigint, booking_id uuid, actor_user_id uuid, event_type text, from_status text, to_status text, data jsonb, created_at timestamp with time zone |
| `quotes` | id uuid, booking_id uuid, revision integer, kind text, status text, created_by uuid, created_at timestamp with time zone, decided_by uuid, decided_at timestamp with time zone, note text |
| `quote_lines` | id uuid, quote_id uuid, charge_type text, description text, quantity numeric, unit_price_paisa bigint, amount_paisa bigint |
| `assignments` | id uuid, booking_id uuid, provider_id uuid, status text, offered_by uuid, offered_at timestamp with time zone, expires_at timestamp with time zone, responded_at timestamp with time zone |

## Money

| Table | Columns |
| --- | --- |
| `payments` | id uuid, booking_id uuid, method text, amount_due_paisa bigint, amount_collected_paisa bigint, status text, collected_at timestamp with time zone, confirmed_at timestamp with time zone, confirmed_by text |
| `refunds` | id uuid, booking_id uuid, charge_type text, amount_paisa bigint, reason text, created_by uuid, created_at timestamp with time zone |
| `ledger_entries` | id bigint, provider_id uuid, booking_id uuid, entry_type text, amount_paisa bigint, source_key text, memo text, created_by uuid, created_at timestamp with time zone |
| `settlements` | id uuid, provider_id uuid, amount_paisa bigint, method text, reference text, received_at timestamp with time zone, recorded_by uuid, created_at timestamp with time zone |
| `statement_periods` | id uuid, provider_id uuid, period_start date, period_end date, opening_balance_paisa bigint, charges_paisa bigint, reversals_paisa bigint, settlements_paisa bigint, adjustments_paisa bigint, closing_balance_paisa bigint, booking_count integer, closed_by uuid, closed_at timestamp with time zone |
