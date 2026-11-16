-- 002_operations: providers, bookings, quotes, assignments, payments and the money ledger.

CREATE TABLE providers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id),
  display_name   text NOT NULL,
  status         text NOT NULL DEFAULT 'applicant'
                 CHECK (status IN ('applicant', 'approved', 'suspended', 'rejected')),
  base_location  geometry(Point, 4326),
  daily_job_cap  int NOT NULL DEFAULT 6 CHECK (daily_job_cap > 0),
  rating_avg     numeric(3, 2),
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_skills (
  provider_id  uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  skill_code   text NOT NULL REFERENCES skills(code),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  check_note   text,            -- e.g. licence number checked, certificate reference
  expires_at   timestamptz,
  approved_by  uuid REFERENCES users(id),
  approved_at  timestamptz,
  PRIMARY KEY (provider_id, skill_code)
);

CREATE TABLE provider_zones (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  zone_id     uuid NOT NULL REFERENCES service_zones(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, zone_id)
);

CREATE SEQUENCE booking_ref_seq START 1001;

CREATE TABLE bookings (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                          text NOT NULL UNIQUE DEFAULT ('KH-' || nextval('booking_ref_seq')),
  customer_id                  uuid NOT NULL REFERENCES users(id),
  job_id                       uuid NOT NULL REFERENCES jobs(id),
  zone_id                      uuid NOT NULL REFERENCES service_zones(id),
  booking_mode                 text NOT NULL CHECK (booking_mode IN ('fixed', 'quote', 'inspection')),
  status                       text NOT NULL DEFAULT 'requested' CHECK (status IN (
                                 'requested', 'assigned', 'en_route', 'on_site', 'awaiting_approval',
                                 'in_progress', 'completed', 'closed', 'cancelled', 'no_provider')),
  resume_status                text,  -- where awaiting_approval returns to
  timing                       text NOT NULL CHECK (timing IN ('same_day', 'scheduled')),
  scheduled_start              timestamptz NOT NULL,
  address_line                 text NOT NULL,
  landmark                     text,
  locality_region_id           uuid REFERENCES regions(id),
  location                     geometry(Point, 4326) NOT NULL,
  location_source              text NOT NULL CHECK (location_source IN ('gps', 'manual_pin', 'locality_centroid', 'dispatcher')),
  needs_location_confirmation  boolean NOT NULL DEFAULT false,
  destination_text             text,
  destination                  geometry(Point, 4326),
  intake                       jsonb NOT NULL DEFAULT '{}',
  terms_snapshot               jsonb NOT NULL,
  commission_rate_bps          int NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 5000),
  commission_rule_id           uuid REFERENCES commission_rules(id),
  assigned_provider_id         uuid REFERENCES providers(id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  completed_at                 timestamptz,
  closed_at                    timestamptz,
  cancelled_at                 timestamptz,
  cancel_reason                text
);
CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);
CREATE INDEX bookings_provider_idx ON bookings (assigned_provider_id, scheduled_start);
CREATE INDEX bookings_status_idx ON bookings (status);

CREATE TABLE booking_events (
  id            bigserial PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  actor_user_id uuid REFERENCES users(id),
  event_type    text NOT NULL,
  from_status   text,
  to_status     text,
  data          jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, id);
CREATE TRIGGER booking_events_append_only BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  revision    int NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('initial', 'quote', 'change_order')),
  status      text NOT NULL CHECK (status IN ('sent', 'approved', 'declined', 'superseded', 'expired')),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  uuid REFERENCES users(id),
  decided_at  timestamptz,
  note        text,
  UNIQUE (booking_id, revision)
);
-- At most one quote waiting for the customer at a time.
CREATE UNIQUE INDEX quotes_one_open ON quotes (booking_id) WHERE status = 'sent';

CREATE TABLE quote_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL REFERENCES quotes(id),
  charge_type      text NOT NULL REFERENCES charge_types(code),
  description      text NOT NULL,
  quantity         numeric(8, 2) NOT NULL CHECK (quantity > 0),
  unit_price_paisa bigint NOT NULL CHECK (unit_price_paisa >= 0),
  amount_paisa     bigint NOT NULL CHECK (amount_paisa >= 0)
);
CREATE INDEX quote_lines_quote_idx ON quote_lines (quote_id);

CREATE TABLE assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  provider_id  uuid NOT NULL REFERENCES providers(id),
  status       text NOT NULL CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  offered_by   uuid REFERENCES users(id),
  offered_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz
);
-- The database itself refuses a second accepted provider for one booking.
CREATE UNIQUE INDEX assignments_one_accepted ON assignments (booking_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX assignments_one_open_offer ON assignments (booking_id, provider_id) WHERE status = 'offered';

CREATE TABLE payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL UNIQUE REFERENCES bookings(id),
  method                 text NOT NULL CHECK (method IN ('cash', 'online_sandbox')),
  amount_due_paisa       bigint NOT NULL CHECK (amount_due_paisa >= 0),
  amount_collected_paisa bigint NOT NULL CHECK (amount_collected_paisa >= 0),
  status                 text NOT NULL CHECK (status IN ('cash_collected', 'confirmed')),
  collected_at           timestamptz NOT NULL DEFAULT now(),
  confirmed_at           timestamptz,
  confirmed_by           text CHECK (confirmed_by IN ('customer', 'auto'))
);

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  charge_type  text NOT NULL REFERENCES charge_types(code),
  amount_paisa bigint NOT NULL CHECK (amount_paisa > 0),
  reason       text NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Money ledger per provider. Positive amount = provider owes the platform more.
-- source_key makes every system-generated entry idempotent.
CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  provider_id  uuid NOT NULL REFERENCES providers(id),
  booking_id   uuid REFERENCES bookings(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('commission_charge', 'commission_reversal',
                 'commission_increase', 'settlement_received', 'manual_adjustment')),
  amount_paisa bigint NOT NULL CHECK (amount_paisa <> 0),
  source_key   text NOT NULL UNIQUE,
  memo         text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_provider_idx ON ledger_entries (provider_id, created_at);
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE settlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES providers(id),
  amount_paisa bigint NOT NULL CHECK (amount_paisa > 0),
  method       text NOT NULL CHECK (method IN ('bank_transfer', 'jazzcash', 'easypaisa', 'cash_office')),
  reference    text NOT NULL,
  received_at  timestamptz NOT NULL,
  recorded_by  uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, method, reference)
);

-- Weekly statements are snapshots computed from the ledger; the ledger stays the source of truth.
CREATE TABLE statement_periods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           uuid NOT NULL REFERENCES providers(id),
  period_start          date NOT NULL,  -- Monday, Asia/Karachi
  period_end            date NOT NULL,  -- the following Monday (exclusive)
  opening_balance_paisa bigint NOT NULL,
  charges_paisa         bigint NOT NULL,
  reversals_paisa       bigint NOT NULL,
  settlements_paisa     bigint NOT NULL,
  adjustments_paisa     bigint NOT NULL,
  closing_balance_paisa bigint NOT NULL,
  booking_count         int NOT NULL,
  closed_by             uuid NOT NULL REFERENCES users(id),
  closed_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, period_start)
);
