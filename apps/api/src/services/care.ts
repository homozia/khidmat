import type { PoolClient } from 'pg';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { AuthUser } from './auth.ts';
import { refund } from './finance.ts';

const REVIEW_WINDOW_DAYS = 7;
const COMPLAINT_WINDOW_DAYS = 30;

export async function addReview(c: PoolClient, user: AuthUser, bookingId: string, rating: number, comment?: string) {
  const b = await one<{ customer_id: string; assigned_provider_id: string | null; status: string; within: boolean }>(c,
    `SELECT customer_id, assigned_provider_id, status,
            completed_at > now() - make_interval(days => $2) AS within FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId, REVIEW_WINDOW_DAYS]);
  if (!b || b.customer_id !== user.id) throw notFound('Booking');
  if (!['completed', 'closed'].includes(b.status) || !b.assigned_provider_id) throw conflict('NOT_REVIEWABLE', 'You can review after the job is completed.');
  if (!b.within) throw conflict('REVIEW_WINDOW_CLOSED', `Reviews are accepted for ${REVIEW_WINDOW_DAYS} days after completion.`);
  const ins = await c.query(`INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [bookingId, user.id, b.assigned_provider_id, rating, comment ?? null]);
  if (!ins.rowCount) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this job.');
  await c.query(`UPDATE providers p SET rating_avg = s.avg, review_count = s.n
                 FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n FROM reviews WHERE provider_id = $1) s
                 WHERE p.id = $1`, [b.assigned_provider_id]);
}

export async function openComplaint(c: PoolClient, user: AuthUser, bookingId: string, input: { category: string; description: string }) {
  const b = await one<{ customer_id: string; status: string; within: boolean }>(c,
    `SELECT customer_id, status, coalesce(completed_at, cancelled_at, created_at) > now() - make_interval(days => $2) AS within
     FROM bookings WHERE id = $1`, [bookingId, COMPLAINT_WINDOW_DAYS]);
  if (!b || b.customer_id !== user.id) throw notFound('Booking');
  if (!b.within) throw conflict('COMPLAINT_WINDOW_CLOSED', `Complaints are accepted for ${COMPLAINT_WINDOW_DAYS} days.`);
  const row = await one<{ id: string }>(c,
    `INSERT INTO complaints (booking_id, customer_id, category, description) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
    [bookingId, user.id, input.category, input.description]);
  if (!row) throw conflict('COMPLAINT_OPEN', 'There is already an open complaint for this booking.');
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, data) VALUES ($1,$2,'complaint_opened',$3)`,
    [bookingId, user.id, JSON.stringify({ complaint_id: row.id, category: input.category })]);
  return { id: row.id, status: 'open' };
}

export async function listComplaints(db: Db, status?: string) {
  return many(db,
    `SELECT c.id, c.status, c.category, c.description, c.resolution, c.resolution_note, c.created_at, c.resolved_at,
            b.id AS booking_id, b.ref, b.status AS booking_status, j.name_en AS job, p.display_name AS provider
     FROM complaints c JOIN bookings b ON b.id = c.booking_id JOIN jobs j ON j.id = b.job_id
     LEFT JOIN providers p ON p.id = b.assigned_provider_id
     WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.created_at`, [status ?? null]);
}

export async function complaintsForBooking(db: Db, bookingId: string) {
  return many(db, `SELECT id, status, category, description, resolution, resolution_note, created_at, resolved_at
                   FROM complaints WHERE booking_id = $1 ORDER BY created_at`, [bookingId]);
}

/**
 * Resolve a complaint. A refund resolution needs the finance role and posts the refund
 * (with commission recalculation) in the same transaction.
 */
export async function resolveComplaint(c: PoolClient, staff: AuthUser, complaintId: string, input: {
  status: 'under_review' | 'resolved'; resolution?: 'no_action' | 'adjustment' | 'refund'; note?: string;
  refund?: { charge_type: string; amount_paisa: number };
}) {
  const comp = await one<{ booking_id: string; status: string }>(c, 'SELECT booking_id, status FROM complaints WHERE id = $1 FOR UPDATE', [complaintId]);
  if (!comp) throw notFound('Complaint');
  if (comp.status === 'resolved' || comp.status === 'closed') throw conflict('COMPLAINT_CLOSED', 'This complaint is already resolved.');
  if (input.status === 'under_review') {
    await c.query(`UPDATE complaints SET status = 'under_review', handled_by = $2 WHERE id = $1`, [complaintId, staff.id]);
    return { status: 'under_review' };
  }
  if (!input.resolution || !input.note) throw unprocessable('RESOLUTION_REQUIRED', 'Choose a resolution and write a note.');
  let refundResult: unknown = null;
  if (input.resolution === 'refund') {
    if (!staff.roles.has('finance') && !staff.roles.has('super_admin')) throw unprocessable('FINANCE_ROLE_REQUIRED', 'Only finance can issue refunds.');
    if (!input.refund) throw unprocessable('REFUND_REQUIRED', 'Enter the refund amount and charge type.');
    refundResult = await refund(c, staff, comp.booking_id, { ...input.refund, reason: `Complaint ${complaintId}: ${input.note}` });
  }
  await c.query(`UPDATE complaints SET status = 'resolved', resolution = $2, resolution_note = $3, handled_by = $4, resolved_at = now() WHERE id = $1`,
    [complaintId, input.resolution, input.note, staff.id]);
  await c.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason, after_data) VALUES ($1,'complaint.resolve','complaint',$2,$3,$4)`,
    [staff.id, complaintId, input.note, JSON.stringify(input)]);
  return { status: 'resolved', refund: refundResult };
}
