-- Audit F2: media uploads are separate from booking creation and safe to retry.
-- The phone gives each file a client reference; a retried upload with the same reference returns the stored row.
ALTER TABLE attachments ADD COLUMN client_ref text CHECK (client_ref IS NULL OR client_ref ~ '^[A-Za-z0-9_-]{8,80}$');
CREATE UNIQUE INDEX attachments_client_ref ON attachments (booking_id, client_ref) WHERE client_ref IS NOT NULL;
