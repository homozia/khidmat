-- 001_core: identity, audit, idempotency, locations, zones, catalogue.
-- All application objects live in schema "app". Extensions (postgis, pgcrypto) are
-- created once by a database superuser; see README "Database setup".

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+92[0-9]{10}$'),
  full_name          text,
  preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ur')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('customer', 'provider', 'dispatcher', 'finance',
                                           'config_admin', 'verification', 'super_admin')),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164  text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- Append-only record of sensitive actions and exports.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  reason        text,
  before_data   jsonb,
  after_data    jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  user_id         uuid NOT NULL,
  route           text NOT NULL,
  key             text NOT NULL,
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);

-- Rows are append-only: block UPDATE and DELETE for everyone, including the table owner.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Location directory: province/territory > district > tehsil > city > locality.
CREATE TABLE regions (
  id         uuid PRIMARY KEY,
  parent_id  uuid REFERENCES regions(id),
  level      text NOT NULL CHECK (level IN ('province', 'district', 'tehsil', 'city', 'locality')),
  code       text NOT NULL UNIQUE,
  name_en    text NOT NULL,
  name_ur    text NOT NULL,
  centroid   geometry(Point, 4326),
  boundary   geometry(MultiPolygon, 4326),
  is_demo    boolean NOT NULL DEFAULT true,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden'))
);
CREATE INDEX regions_parent_idx ON regions (parent_id);

CREATE TABLE place_aliases (
  id         bigserial PRIMARY KEY,
  region_id  uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  lang       text NOT NULL CHECK (lang IN ('en', 'ur', 'roman')),
  normalized text NOT NULL
);
CREATE INDEX place_aliases_norm_idx ON place_aliases (normalized);

-- Service zones are independent of administrative boundaries.
CREATE TABLE service_zones (
  id                  uuid PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name_en             text NOT NULL,
  name_ur             text NOT NULL,
  city_region_id      uuid REFERENCES regions(id),
  district_region_id  uuid REFERENCES regions(id),
  boundary            geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(boundary)),
  precedence          int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  is_demo             boolean NOT NULL DEFAULT true,
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  opens_at            time NOT NULL DEFAULT '08:00',
  closes_at           time NOT NULL DEFAULT '20:00',
  travel_charge_paisa bigint NOT NULL DEFAULT 0 CHECK (travel_charge_paisa >= 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_zones_boundary_idx ON service_zones USING gist (boundary);

-- Catalogue
CREATE TABLE skills (
  code       text PRIMARY KEY,
  name_en    text NOT NULL,
  name_ur    text NOT NULL,
  restricted boolean NOT NULL DEFAULT false   -- needs a recorded licence/qualification check
);

CREATE TABLE categories (
  id             uuid PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name_en        text NOT NULL,
  name_ur        text NOT NULL,
  display_order  int NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id               uuid PRIMARY KEY,
  category_id      uuid NOT NULL REFERENCES categories(id),
  code             text NOT NULL UNIQUE,
  name_en          text NOT NULL,
  name_ur          text NOT NULL,
  description_en   text NOT NULL DEFAULT '',
  description_ur   text NOT NULL DEFAULT '',
  display_order    int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  booking_modes    text[] NOT NULL CHECK (booking_modes <@ ARRAY['fixed', 'quote', 'inspection']
                                          AND cardinality(booking_modes) > 0),
  required_skill   text NOT NULL REFERENCES skills(code),
  duration_minutes int NOT NULL DEFAULT 90 CHECK (duration_minutes > 0),
  needs_destination boolean NOT NULL DEFAULT false,  -- driver hire
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_intake_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  field_type    text NOT NULL CHECK (field_type IN ('integer', 'text', 'select', 'boolean', 'hours')),
  label_en      text NOT NULL,
  label_ur      text NOT NULL,
  required      boolean NOT NULL DEFAULT false,
  options       jsonb,
  min_value     numeric,
  max_value     numeric,
  display_order int NOT NULL DEFAULT 0,
  UNIQUE (job_id, key)
);

CREATE TABLE job_zone_availability (
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  zone_id    uuid NOT NULL REFERENCES service_zones(id) ON DELETE CASCADE,
  same_day   boolean NOT NULL DEFAULT true,
  scheduled  boolean NOT NULL DEFAULT true,
  status     text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'paused')),
  PRIMARY KEY (job_id, zone_id)
);

-- Price terms. A zone-specific rule beats a general one for the same job.
CREATE TABLE pricing_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid NOT NULL REFERENCES jobs(id),
  zone_id              uuid REFERENCES service_zones(id),
  base_labour_paisa    bigint NOT NULL DEFAULT 0 CHECK (base_labour_paisa >= 0),
  unit_label           text,          -- e.g. 'tap', 'panel', 'hour'
  unit_field_key       text,          -- intake field holding the unit count
  unit_labour_paisa    bigint NOT NULL DEFAULT 0 CHECK (unit_labour_paisa >= 0),
  included_units       int NOT NULL DEFAULT 1 CHECK (included_units >= 0),
  inspection_fee_paisa bigint NOT NULL DEFAULT 0 CHECK (inspection_fee_paisa >= 0),
  effective_from       timestamptz NOT NULL DEFAULT now(),
  effective_to         timestamptz,
  is_demo              boolean NOT NULL DEFAULT true
);
CREATE INDEX pricing_rules_job_idx ON pricing_rules (job_id);

CREATE TABLE charge_types (
  code           text PRIMARY KEY,
  name_en        text NOT NULL,
  name_ur        text NOT NULL,
  commissionable boolean NOT NULL,
  receipt_group  text NOT NULL CHECK (receipt_group IN ('labour', 'materials', 'visit_travel', 'reimbursements'))
);

-- Commission: most specific rule wins (job+district > job > category+district > category > district > global).
CREATE TABLE commission_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_job_id       uuid REFERENCES jobs(id),
  scope_category_id  uuid REFERENCES categories(id),
  scope_district_id  uuid REFERENCES regions(id),
  rate_bps           int NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),
  effective_from     timestamptz NOT NULL DEFAULT now(),
  effective_to       timestamptz,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_job_id IS NULL OR scope_category_id IS NULL)
);
