import type { PoolClient } from 'pg';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { isStaff, type AuthUser } from './auth.ts';
import { deleteFile, fileUrl, KINDS, putFile, validateUpload } from './storage.ts';

const MAX_CUSTOMER_PHOTOS = 3;
const MAX_CUSTOMER_VOICE = 1;

type AttachmentKind = 'photo' | 'voice' | 'completion_photo' | 'lockout_proof';

async function bookingAccess(db: Db, user: AuthUser, bookingId: string) {
  const b = await one<{ customer_id: string; assigned_provider_id: string | null; status: string; closed_at: Date | null }>(db,
    'SELECT customer_id, assigned_provider_id, status, closed_at FROM bookings WHERE id = $1', [bookingId]);
  if (!b) throw notFound('Booking');
  const isCustomer = b.customer_id === user.id;
  const isProvider = !!user.providerId && b.assigned_provider_id === user.providerId && b.status !== 'cancelled' &&
    (!b.closed_at || new Date(b.closed_at).getTime() > Date.now() - 24 * 3600_000);
  const staff = isStaff(user, 'dispatcher', 'finance');
  if (!isCustomer && !isProvider && !staff) throw notFound('Booking');
  return { ...b, isCustomer, isProvider, staff };
}

/** Customers add up to 3 photos and one voice note; the provider adds completion or lockout proof photos. */
export async function addAttachment(c: PoolClient, user: AuthUser, bookingId: string, kind: AttachmentKind, declaredType: string, buf: Buffer) {
  const b = await bookingAccess(c, user, bookingId);
  const type = validateUpload(kind === 'voice' ? KINDS.voice : KINDS.photo, declaredType, buf);
  if (kind === 'photo' || kind === 'voice') {
    if (!b.isCustomer) throw notFound('Booking');
    if (['completed', 'closed', 'cancelled'].includes(b.status)) throw conflict('BOOKING_FINISHED', 'Media can only be added to an open booking.');
    const n = await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM attachments WHERE booking_id = $1 AND kind = $2 AND deleted_at IS NULL`, [bookingId, kind]);
    const max = kind === 'photo' ? MAX_CUSTOMER_PHOTOS : MAX_CUSTOMER_VOICE;
    if ((n?.n ?? 0) >= max) throw unprocessable('TOO_MANY_FILES', `At most ${max} ${kind === 'photo' ? 'photos' : 'voice note'} per booking.`);
  } else if (!b.isProvider) {
    throw notFound('Booking');
  }
  const key = await putFile('booking', buf, type);
  const row = await one<{ id: string }>(c,
    `INSERT INTO attachments (booking_id, owner_user_id, kind, storage_key, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [bookingId, user.id, kind, key, type, buf.length]);
  return { id: row!.id, kind, content_type: type, size_bytes: buf.length };
}

export async function listAttachments(db: Db, user: AuthUser, bookingId: string) {
  await bookingAccess(db, user, bookingId);
  return many(db, `SELECT id, kind, content_type, size_bytes, created_at FROM attachments
                   WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [bookingId]);
}

export async function attachmentUrl(db: Db, user: AuthUser, attachmentId: string) {
  const a = await one<{ booking_id: string; storage_key: string; content_type: string }>(db,
    'SELECT booking_id, storage_key, content_type FROM attachments WHERE id = $1 AND deleted_at IS NULL', [attachmentId]);
  if (!a) throw notFound('File');
  await bookingAccess(db, user, a.booking_id);
  return fileUrl(a.storage_key, a.content_type);
}

export async function deleteAttachment(c: PoolClient, user: AuthUser, attachmentId: string) {
  const a = await one<{ owner_user_id: string; storage_key: string }>(c,
    'SELECT owner_user_id, storage_key FROM attachments WHERE id = $1 AND deleted_at IS NULL', [attachmentId]);
  if (!a || a.owner_user_id !== user.id) throw notFound('File');
  await c.query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [attachmentId]);
  await deleteFile(a.storage_key);
}

// ---- Provider verification documents: only verification officers can open them, and every view is audited.

export async function addProviderDocument(c: PoolClient, providerId: string, docType: string, declaredType: string, buf: Buffer) {
  const type = validateUpload(KINDS.document, declaredType, buf);
  const key = await putFile('provider', buf, type);
  const row = await one<{ id: string }>(c,
    `INSERT INTO provider_documents (provider_id, doc_type, storage_key, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [providerId, docType, key, type, buf.length]);
  return { id: row!.id, doc_type: docType, status: 'pending' };
}

export async function providerDocumentUrl(c: PoolClient, staff: AuthUser, docId: string, reason: string) {
  const d = await one<{ provider_id: string; storage_key: string; content_type: string }>(c,
    'SELECT provider_id, storage_key, content_type FROM provider_documents WHERE id = $1 AND deleted_at IS NULL', [docId]);
  if (!d) throw notFound('Document');
  await c.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason) VALUES ($1,'document.view','provider_document',$2,$3)`,
    [staff.id, docId, reason]);
  return fileUrl(d.storage_key, d.content_type);
}
