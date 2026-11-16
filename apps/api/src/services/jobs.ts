import { config } from '../config.ts';
import { many, tx } from '../db.ts';
import { autoCloseCompleted, lockBooking, moveTo } from './bookings.ts';
import { deleteFile } from './storage.ts';

/**
 * Housekeeping that must happen even when nobody clicks anything. Safe to run on several
 * servers at once: each step locks the rows it changes and skips rows locked elsewhere.
 */
export async function runJobsOnce(): Promise<Record<string, number>> {
  const expiredOffers = await tx(async (c) => (await c.query(
    `UPDATE assignments SET status = 'expired', responded_at = now() WHERE status = 'offered' AND expires_at <= now()`)).rowCount ?? 0);

  const noProvider = await tx(async (c) => {
    const rows = await many<{ id: string }>(c,
      `SELECT b.id FROM bookings b
       WHERE b.status = 'requested' AND b.timing = 'same_day' AND b.created_at < now() - make_interval(mins => $1)
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.booking_id = b.id AND a.status = 'offered')
       FOR UPDATE SKIP LOCKED`, [config.NO_PROVIDER_AFTER_MINUTES]);
    for (const r of rows) {
      const b = await lockBooking(c, r.id);
      await moveTo(c, b, 'no_provider', 'system', null, 'no_provider_timeout', { after_minutes: config.NO_PROVIDER_AFTER_MINUTES });
    }
    return rows.length;
  });

  const autoClosed = await tx((c) => autoCloseCompleted(c));

  const purged = await tx(async (c) => {
    const rows = await many<{ id: string; storage_key: string }>(c,
      `SELECT id, storage_key FROM attachments WHERE deleted_at IS NULL AND created_at < now() - make_interval(days => $1)
       FOR UPDATE SKIP LOCKED`, [config.MEDIA_RETENTION_DAYS]);
    for (const r of rows) {
      await deleteFile(r.storage_key);
      await c.query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [r.id]);
    }
    return rows.length;
  });

  const otpPurged = await tx(async (c) => (await c.query(`DELETE FROM otp_challenges WHERE created_at < now() - interval '24 hours'`)).rowCount ?? 0);

  return { expiredOffers, noProvider, autoClosed, purged, otpPurged };
}
