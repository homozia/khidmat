-- 004_audit_fixes: corrections from the M3 audit. Applies on top of existing data.

-- Service duration is snapshotted per booking (hourly driver jobs use the requested hours).
ALTER TABLE jobs ADD COLUMN duration_field_key text;            -- intake field holding hours, e.g. 'hours'
ALTER TABLE jobs ADD COLUMN visit_charge_paisa bigint NOT NULL DEFAULT 0 CHECK (visit_charge_paisa >= 0);
ALTER TABLE jobs ADD COLUMN requires_authorization_check boolean NOT NULL DEFAULT false;  -- lockouts
UPDATE jobs SET duration_field_key = 'hours' WHERE EXISTS (
  SELECT 1 FROM job_intake_fields f WHERE f.job_id = jobs.id AND f.key = 'hours' AND f.field_type = 'hours');
UPDATE jobs SET requires_authorization_check = true, visit_charge_paisa = 50000 WHERE code = 'locksmith.lockout';

ALTER TABLE bookings ADD COLUMN duration_minutes int;
UPDATE bookings b SET duration_minutes = coalesce(
  CASE WHEN j.duration_field_key IS NOT NULL AND (b.intake ->> j.duration_field_key) IS NOT NULL
       THEN round((b.intake ->> j.duration_field_key)::numeric * 60)::int END,
  j.duration_minutes)
FROM jobs j WHERE j.id = b.job_id;
ALTER TABLE bookings ALTER COLUMN duration_minutes SET NOT NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_duration_positive CHECK (duration_minutes > 0);

-- Locksmith authorisation check recorded by the provider on site.
CREATE TABLE authorization_checks (
  booking_id  uuid PRIMARY KEY REFERENCES bookings(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  verified    boolean NOT NULL,
  method      text NOT NULL CHECK (method IN ('photo_id_matches_address', 'utility_bill', 'tenancy_document', 'guard_or_neighbour', 'not_verifiable')),
  note        text NOT NULL CHECK (length(note) BETWEEN 3 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Visit charges carry a defined reason.
ALTER TABLE quotes ADD COLUMN visit_reason text CHECK (visit_reason IN ('authorization_not_verified', 'customer_absent', 'access_refused'));

-- Restricted skills are approved against a reviewed document.
ALTER TABLE provider_skills ADD COLUMN evidence_document_id uuid REFERENCES provider_documents(id);

-- Cash: who said it was paid.
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
UPDATE payments SET status = CASE WHEN status = 'cash_collected' THEN 'provider_reported'
                                  WHEN confirmed_by = 'auto' THEN 'auto_confirmed' ELSE 'customer_confirmed' END;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('provider_reported', 'customer_confirmed', 'auto_confirmed'));

-- Refunds: recorded by finance, then paid out with evidence.
ALTER TABLE refunds ADD COLUMN status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'paid'));
ALTER TABLE refunds ADD COLUMN paid_at timestamptz;
ALTER TABLE refunds ADD COLUMN paid_method text CHECK (paid_method IN ('provider_cash', 'jazzcash', 'easypaisa', 'bank_transfer', 'office_cash'));
ALTER TABLE refunds ADD COLUMN paid_reference text;
ALTER TABLE refunds ADD COLUMN paid_by uuid REFERENCES users(id);
ALTER TABLE refunds ADD CONSTRAINT refunds_paid_has_evidence
  CHECK (status = 'recorded' OR (paid_at IS NOT NULL AND paid_method IS NOT NULL AND length(paid_reference) >= 3));

-- The price the customer agreed to is recorded with the booking.
ALTER TABLE bookings ADD COLUMN accepted_price_hash text;

-- Region aliases are managed by staff; keep them unique per region.
DELETE FROM place_aliases a USING place_aliases b WHERE a.region_id = b.region_id AND a.normalized = b.normalized AND a.id > b.id;
CREATE UNIQUE INDEX place_aliases_unique ON place_aliases (region_id, normalized);
