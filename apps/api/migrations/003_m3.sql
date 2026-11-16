-- 003_m3: uploads, provider documents, reviews, complaints, provider availability.

CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL CHECK (kind IN ('photo', 'voice', 'completion_photo', 'lockout_proof')),
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL,
  size_bytes    int NOT NULL CHECK (size_bytes > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX attachments_booking_idx ON attachments (booking_id);

CREATE TABLE provider_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES providers(id),
  doc_type     text NOT NULL CHECK (doc_type IN ('cnic_front', 'cnic_back', 'selfie', 'police_certificate',
                                                  'driving_licence', 'trade_certificate', 'other')),
  storage_key  text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes   int NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE reviews (
  booking_id  uuid PRIMARY KEY REFERENCES bookings(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text CHECK (length(comment) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE complaints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  customer_id     uuid NOT NULL REFERENCES users(id),
  category        text NOT NULL CHECK (category IN ('quality', 'price', 'conduct', 'damage', 'no_show', 'other')),
  description     text NOT NULL CHECK (length(description) BETWEEN 5 AND 2000),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'closed')),
  resolution      text CHECK (resolution IN ('no_action', 'adjustment', 'refund')),
  resolution_note text,
  handled_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX complaints_status_idx ON complaints (status, created_at);
-- One open complaint per booking at a time.
CREATE UNIQUE INDEX complaints_one_open ON complaints (booking_id) WHERE status IN ('open', 'under_review');

ALTER TABLE providers ADD COLUMN review_count int NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN accepting_offers boolean NOT NULL DEFAULT true;
