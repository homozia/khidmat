import type { PoolClient } from 'pg';
import { config } from '../config.ts';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { AuthUser } from './auth.ts';
import { lockBooking, moveTo } from './bookings.ts';

export interface EligibleProvider {
  provider_id: string;
  display_name: string;
  distance_m: number;
  jobs_today: number;
  rating_avg: number | null;
}

/**
 * Providers who may receive an offer for this booking:
 * approved and active; approved, unexpired skill for the job; covers the pickup zone (and the
 * destination zone for driver trips); no overlapping active job; under the daily cap;
 * not overdue on commission. Ranked by distance, then fewest jobs today, then rating.
 */
export async function eligibleProviders(db: Db, bookingId: string): Promise<EligibleProvider[]> {
  const rows = await many<EligibleProvider & { daily_job_cap: number }>(db,
    `WITH b AS (
       SELECT bk.id, bk.zone_id, bk.location, bk.scheduled_start, j.required_skill, bk.duration_minutes,
              (bk.terms_snapshot->>'destination_zone_id')::uuid AS dest_zone_id
       FROM bookings bk JOIN jobs j ON j.id = bk.job_id WHERE bk.id = $1
     ), bal AS (
       SELECT provider_id,
              sum(amount_paisa) AS balance,
              sum(amount_paisa) FILTER (WHERE amount_paisa < 0 OR created_at < now() - make_interval(days => $3)) AS overdue
       FROM ledger_entries GROUP BY provider_id
     )
     SELECT p.id AS provider_id, p.display_name,
            round(ST_Distance(p.base_location::geography, b.location::geography))::int AS distance_m,
            (SELECT count(*)::int FROM bookings x WHERE x.assigned_provider_id = p.id
               AND (x.scheduled_start AT TIME ZONE 'Asia/Karachi')::date = (b.scheduled_start AT TIME ZONE 'Asia/Karachi')::date
               AND x.status NOT IN ('cancelled')) AS jobs_today,
            p.rating_avg, p.daily_job_cap
     FROM providers p
     JOIN users u ON u.id = p.user_id AND u.status = 'active'
     CROSS JOIN b
     LEFT JOIN bal ON bal.provider_id = p.id
     WHERE p.status = 'approved' AND p.accepting_offers
       AND EXISTS (SELECT 1 FROM provider_skills s WHERE s.provider_id = p.id AND s.skill_code = b.required_skill
                   AND s.status = 'approved' AND (s.expires_at IS NULL OR s.expires_at > b.scheduled_start))
       AND EXISTS (SELECT 1 FROM provider_zones pz WHERE pz.provider_id = p.id AND pz.zone_id = b.zone_id)
       AND (b.dest_zone_id IS NULL OR EXISTS (SELECT 1 FROM provider_zones pz WHERE pz.provider_id = p.id AND pz.zone_id = b.dest_zone_id))
       AND NOT EXISTS (
         SELECT 1 FROM bookings x
         WHERE x.assigned_provider_id = p.id AND x.id <> b.id
           AND x.status IN ('assigned', 'en_route', 'on_site', 'awaiting_approval', 'in_progress')
           AND tstzrange(x.scheduled_start, x.scheduled_start + make_interval(mins => x.duration_minutes))
               && tstzrange(b.scheduled_start, b.scheduled_start + make_interval(mins => b.duration_minutes)))
       AND coalesce(bal.balance, 0) <= $2
       AND coalesce(bal.overdue, 0) <= 0
     ORDER BY distance_m ASC NULLS LAST, jobs_today ASC, p.rating_avg DESC NULLS LAST, p.id
    `, [bookingId, config.OVERDUE_BALANCE_LIMIT_PAISA, config.OVERDUE_DAYS]);
  return rows.filter((r) => r.jobs_today < r.daily_job_cap).map(({ daily_job_cap: _cap, ...r }) => r);
}

/** Plain-language reason a provider cannot take a booking, checked in the same order as eligibility. */
export async function whyIneligible(db: Db, providerId: string, bookingId: string): Promise<string> {
  const r = await one<Record<string, boolean>>(db,
    `WITH b AS (SELECT bk.*, j.required_skill, (bk.terms_snapshot->>'destination_zone_id')::uuid AS dest FROM bookings bk JOIN jobs j ON j.id = bk.job_id WHERE bk.id = $2)
     SELECT p.status = 'approved' AND u.status = 'active' AS approved,
            p.accepting_offers AS available,
            EXISTS (SELECT 1 FROM provider_skills s WHERE s.provider_id = p.id AND s.skill_code = b.required_skill AND s.status = 'approved') AS skill,
            EXISTS (SELECT 1 FROM provider_skills s WHERE s.provider_id = p.id AND s.skill_code = b.required_skill AND s.status = 'approved'
                    AND (s.expires_at IS NULL OR s.expires_at > b.scheduled_start)) AS licence_valid,
            EXISTS (SELECT 1 FROM provider_zones z WHERE z.provider_id = p.id AND z.zone_id = b.zone_id) AS covers_pickup,
            (b.dest IS NULL OR EXISTS (SELECT 1 FROM provider_zones z WHERE z.provider_id = p.id AND z.zone_id = b.dest)) AS covers_destination,
            NOT EXISTS (SELECT 1 FROM bookings x WHERE x.assigned_provider_id = p.id AND x.id <> b.id
              AND x.status IN ('assigned', 'en_route', 'on_site', 'awaiting_approval', 'in_progress')
              AND tstzrange(x.scheduled_start, x.scheduled_start + make_interval(mins => x.duration_minutes))
                  && tstzrange(b.scheduled_start, b.scheduled_start + make_interval(mins => b.duration_minutes))) AS free
     FROM providers p JOIN users u ON u.id = p.user_id, b WHERE p.id = $1`, [providerId, bookingId]);
  if (!r) return 'Provider not found.';
  if (!r.approved) return 'The provider is not approved or is suspended.';
  if (!r.available) return 'The provider has switched off "Accepting jobs".';
  if (!r.skill) return 'The provider does not have an approved skill for this job.';
  if (!r.licence_valid) return 'The provider\'s licence or certificate expires before this booking.';
  if (!r.covers_pickup) return 'The provider does not cover this area.';
  if (!r.covers_destination) return 'The provider does not cover the trip destination.';
  if (!r.free) return 'The provider already has a job at this time.';
  return 'The provider is at the daily job limit or has overdue fees to pay.';
}

export async function offerBooking(c: PoolClient, staff: AuthUser, bookingId: string, providerId: string) {
  const b = await lockBooking(c, bookingId);
  if (b.status !== 'requested') throw conflict('NOT_DISPATCHABLE', `A booking that is ${b.status} cannot be offered.`);
  const needsPin = await one<{ v: boolean }>(c, 'SELECT needs_location_confirmation AS v FROM bookings WHERE id = $1', [bookingId]);
  if (needsPin?.v) throw conflict('LOCATION_UNCONFIRMED', 'Confirm the customer location before dispatching.');
  const eligible = await eligibleProviders(c, bookingId);
  if (!eligible.some((e) => e.provider_id === providerId)) {
    throw unprocessable('PROVIDER_NOT_ELIGIBLE', await whyIneligible(c, providerId, bookingId));
  }
  const a = await one<{ id: string; expires_at: Date }>(c,
    `INSERT INTO assignments (booking_id, provider_id, status, offered_by, expires_at)
     VALUES ($1,$2,'offered',$3, now() + make_interval(mins => $4))
     ON CONFLICT DO NOTHING RETURNING id, expires_at`, [bookingId, providerId, staff.id, config.OFFER_TTL_MINUTES]);
  if (!a) throw conflict('OFFER_EXISTS', 'This provider already has an open offer for this booking.');
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, data) VALUES ($1,$2,'offered',$3)`,
    [bookingId, staff.id, JSON.stringify({ provider_id: providerId })]);
  return { assignment_id: a.id, expires_at: a.expires_at };
}

/** Offers show the area, job and time only; the exact address appears after acceptance. */
export async function listOffers(db: Db, user: AuthUser) {
  if (!user.providerId) return [];
  return many(db,
    `SELECT a.id AS assignment_id, a.expires_at, b.id AS booking_id, b.ref, b.scheduled_start, b.booking_mode,
            j.name_en AS job_name_en, j.name_ur AS job_name_ur, z.name_en AS zone_en, z.name_ur AS zone_ur,
            loc.name_en AS locality_en, loc.name_ur AS locality_ur,
            (b.terms_snapshot->'price_lines') AS price_lines
     FROM assignments a JOIN bookings b ON b.id = a.booking_id JOIN jobs j ON j.id = b.job_id
     JOIN service_zones z ON z.id = b.zone_id LEFT JOIN regions loc ON loc.id = b.locality_region_id
     WHERE a.provider_id = $1 AND a.status = 'offered' AND a.expires_at > now()
     ORDER BY a.expires_at`, [user.providerId]);
}

export async function respondToOffer(c: PoolClient, user: AuthUser, assignmentId: string, accept: boolean) {
  const a = await one<{ id: string; booking_id: string; provider_id: string; status: string; expired: boolean }>(c,
    `SELECT id, booking_id, provider_id, status, expires_at <= now() AS expired FROM assignments WHERE id = $1`, [assignmentId]);
  if (!a || a.provider_id !== user.providerId) throw notFound('Offer');
  const b = await lockBooking(c, a.booking_id);
  const fresh = await one<{ status: string }>(c, 'SELECT status FROM assignments WHERE id = $1 FOR UPDATE', [assignmentId]);
  if (fresh!.status !== 'offered') throw conflict('OFFER_CLOSED', `This offer is ${fresh!.status}.`);
  if (a.expired) {
    await c.query(`UPDATE assignments SET status = 'expired', responded_at = now() WHERE id = $1`, [assignmentId]);
    return { status: 'expired' as const };
  }
  if (!accept) {
    await c.query(`UPDATE assignments SET status = 'declined', responded_at = now() WHERE id = $1`, [assignmentId]);
    return { status: 'declined' as const };
  }
  if (b.status !== 'requested') throw conflict('BOOKING_TAKEN', 'This booking is no longer available.');
  // Serialise this provider's acceptances so two overlapping jobs cannot both be taken,
  // then re-check everything that may have changed since the offer was sent.
  await c.query('SELECT 1 FROM providers WHERE id = $1 FOR UPDATE', [a.provider_id]);
  const stillEligible = (await eligibleProviders(c, b.id)).some((p) => p.provider_id === a.provider_id);
  if (!stillEligible) {
    const reason = await whyIneligible(c, a.provider_id, b.id);
    await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE id = $1`, [assignmentId]);
    await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, data) VALUES ($1,$2,'offer_withdrawn',$3)`,
      [b.id, user.id, JSON.stringify({ assignment_id: assignmentId, reason })]);
    return { status: 'withdrawn' as const, reason };
  }
  // The partial unique index assignments_one_accepted is the final guard against two acceptances.
  await c.query(`UPDATE assignments SET status = 'accepted', responded_at = now() WHERE id = $1`, [assignmentId]);
  await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE booking_id = $1 AND status = 'offered'`, [b.id]);
  await moveTo(c, b, 'assigned', 'system', user.id, 'accepted', { assignment_id: assignmentId }, { assigned_provider_id: a.provider_id });
  return { status: 'accepted' as const, booking_id: b.id };
}

export async function dispatchQueue(db: Db) {
  return many(db,
    `SELECT b.id, b.ref, b.status, b.scheduled_start, b.needs_location_confirmation, j.name_en AS job, z.code AS zone,
            round(extract(epoch FROM now() - b.created_at) / 60)::int AS age_minutes,
            (SELECT count(*)::int FROM assignments a WHERE a.booking_id = b.id AND a.status = 'offered' AND a.expires_at > now()) AS open_offers
     FROM bookings b JOIN jobs j ON j.id = b.job_id JOIN service_zones z ON z.id = b.zone_id
     WHERE b.status IN ('requested', 'no_provider') ORDER BY b.scheduled_start`);
}

export async function confirmLocation(c: PoolClient, staff: AuthUser, bookingId: string, lat: number, lng: number) {
  const b = await lockBooking(c, bookingId);
  if (b.status !== 'requested') throw conflict('NOT_DISPATCHABLE', 'Location can only be confirmed before dispatch.');
  const inZone = await one<{ ok: boolean }>(c,
    `SELECT ST_Covers(z.boundary, ST_SetSRID(ST_MakePoint($2,$3),4326)) AS ok FROM service_zones z WHERE z.id = $1`, [b.zone_id, lng, lat]);
  if (!inZone?.ok) throw unprocessable('PIN_OUTSIDE_ZONE', 'The confirmed pin is outside the booking zone; cancel and rebook.');
  await c.query(`UPDATE bookings SET location = ST_SetSRID(ST_MakePoint($2,$3),4326), location_source = 'dispatcher',
                   needs_location_confirmation = false, updated_at = now() WHERE id = $1`, [bookingId, lng, lat]);
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type) VALUES ($1,$2,'location_confirmed')`, [bookingId, staff.id]);
}
