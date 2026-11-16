import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config.ts';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { normalizePkMobile } from '../lib/phone.ts';
import type { AuthUser } from './auth.ts';
import { lockBooking, moveTo } from './bookings.ts';
import { buildLine } from './pricing.ts';

async function audit(c: Db, actor: string, action: string, entityType: string, entityId: string, reason: string | null, after: object) {
  await c.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason, after_data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor, action, entityType, entityId, reason, JSON.stringify(after)]);
}

// ---------------- Zones ----------------

const Position = z.tuple([z.number().min(60.8).max(77.9), z.number().min(23).max(37.2)]);
const Ring = z.array(Position).min(4);
export const GeoJsonArea = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1)).min(1) }),
]);

export const ZoneInput = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,30}$/),
  name_en: z.string().trim().min(2).max(120),
  name_ur: z.string().trim().min(2).max(120),
  city_code: z.string().optional(),
  city_region_id: z.uuid().optional(),
  boundary: GeoJsonArea,
  precedence: z.number().int().min(-100).max(100).default(0),
  opens_at: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
  closes_at: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
  travel_charge_paisa: z.number().int().nonnegative().default(0),
}).strict();

export async function listZones(db: Db) {
  return many(db, `SELECT z.id, z.code, z.name_en, z.name_ur, z.status, z.is_demo, z.precedence, z.opens_at::text, z.closes_at::text,
                          z.travel_charge_paisa, z.verified_at, ST_AsGeoJSON(z.boundary)::json AS boundary,
                          round((ST_Area(z.boundary::geography) / 1e6)::numeric, 2)::float8 AS area_km2,
                          (SELECT count(*)::int FROM provider_zones pz WHERE pz.zone_id = z.id) AS providers,
                          (SELECT count(*)::int FROM job_zone_availability a WHERE a.zone_id = z.id AND a.status = 'enabled') AS jobs
                   FROM service_zones z ORDER BY z.code`);
}

/** New zones start as drafts that are not demo data; they must be verified before activation. */
export async function createZone(c: PoolClient, staff: AuthUser, input: z.infer<typeof ZoneInput>) {
  const geo = JSON.stringify(input.boundary);
  const valid = await one<{ ok: boolean; reason: string }>(c,
    `SELECT ST_IsValid(g) AS ok, ST_IsValidReason(g) AS reason FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) x`, [geo]);
  if (!valid?.ok) throw unprocessable('INVALID_BOUNDARY', `The boundary is not a valid shape: ${valid?.reason}`);
  if (await one(c, 'SELECT 1 FROM service_zones WHERE code = $1', [input.code])) throw conflict('ZONE_EXISTS', 'A zone with this code exists.');
  const city = input.city_code || input.city_region_id ? await one<{ id: string; parent_id: string; district: string | null }>(c,
    `SELECT r.id, r.parent_id, (WITH RECURSIVE up AS (SELECT id, parent_id, level FROM regions WHERE id = r.id
       UNION ALL SELECT p.id, p.parent_id, p.level FROM regions p JOIN up ON p.id = up.parent_id)
       SELECT id FROM up WHERE level = 'district' LIMIT 1) AS district
     FROM regions r WHERE (r.code = $1 OR r.id::text = $2) AND r.level = 'city'`, [input.city_code ?? null, input.city_region_id ?? null]) : undefined;
  if ((input.city_code || input.city_region_id) && !city) throw unprocessable('UNKNOWN_CITY', 'Unknown city.');
  const z_ = await one<{ id: string }>(c,
    `INSERT INTO service_zones (id, code, name_en, name_ur, city_region_id, district_region_id, boundary, precedence, opens_at, closes_at,
       travel_charge_paisa, status, is_demo)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), $7,$8,$9,$10,'draft',false) RETURNING id`,
    [input.code, input.name_en, input.name_ur, city?.id ?? null, city?.district ?? null, geo, input.precedence, input.opens_at,
      input.closes_at, input.travel_charge_paisa]);
  await audit(c, staff.id, 'zone.create', 'zone', z_!.id, null, { ...input, boundary: undefined });
  return { id: z_!.id, status: 'draft' };
}

export const ZonePatch = ZoneInput.omit({ code: true, city_code: true, city_region_id: true }).partial().strict();

export async function updateZone(c: PoolClient, staff: AuthUser, zoneId: string, input: z.infer<typeof ZonePatch>) {
  const zone = await one<{ status: string }>(c, 'SELECT status FROM service_zones WHERE id = $1 FOR UPDATE', [zoneId]);
  if (!zone) throw notFound('Zone');
  if (input.boundary) {
    const v = await one<{ ok: boolean }>(c, `SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS ok`, [JSON.stringify(input.boundary)]);
    if (!v?.ok) throw unprocessable('INVALID_BOUNDARY', 'The boundary is not a valid shape.');
    // A changed boundary must be re-verified on the ground before the zone serves customers again.
    await c.query(`UPDATE service_zones SET boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), verified_at = NULL, verified_by = NULL,
                     status = CASE WHEN status = 'active' THEN 'paused' ELSE status END WHERE id = $1`, [zoneId, JSON.stringify(input.boundary)]);
  }
  const sets: string[] = [];
  const params: unknown[] = [zoneId];
  for (const col of ['name_en', 'name_ur', 'precedence', 'opens_at', 'closes_at', 'travel_charge_paisa'] as const) {
    if (input[col] !== undefined) { params.push(input[col]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length) await c.query(`UPDATE service_zones SET ${sets.join(', ')} WHERE id = $1`, params);
  await audit(c, staff.id, 'zone.update', 'zone', zoneId, null, { ...input, boundary: input.boundary ? 'changed' : undefined });
}

export async function verifyZone(c: PoolClient, staff: AuthUser, zoneId: string, note: string) {
  const r = await c.query(`UPDATE service_zones SET verified_at = now(), verified_by = $2 WHERE id = $1`, [zoneId, staff.id]);
  if (!r.rowCount) throw notFound('Zone');
  await audit(c, staff.id, 'zone.verify', 'zone', zoneId, note, {});
}

export async function setZoneStatus(c: PoolClient, staff: AuthUser, zoneId: string, status: 'active' | 'paused' | 'draft') {
  const z_ = await one<{ is_demo: boolean; verified_at: Date | null }>(c, 'SELECT is_demo, verified_at FROM service_zones WHERE id = $1', [zoneId]);
  if (!z_) throw notFound('Zone');
  if (status === 'active') {
    if (z_.is_demo && config.APP_ENV === 'production') throw conflict('DEMO_ZONE', 'Demo boundaries cannot serve live customers.');
    if (!z_.is_demo && !z_.verified_at) throw conflict('ZONE_NOT_VERIFIED', 'Verify the boundary on the ground before activating.');
  }
  await c.query('UPDATE service_zones SET status = $2 WHERE id = $1', [zoneId, status]);
  await audit(c, staff.id, 'zone.status', 'zone', zoneId, null, { status });
}

// ---------------- Catalogue ----------------

export async function adminCatalogue(db: Db) {
  return many(db,
    `SELECT c.id, c.code, c.name_en, c.name_ur, c.status, c.display_order,
            coalesce(json_agg(json_build_object('id', j.id, 'code', j.code, 'name_en', j.name_en, 'name_ur', j.name_ur, 'status', j.status,
              'display_order', j.display_order, 'booking_modes', j.booking_modes, 'required_skill', j.required_skill,
              'zones', (SELECT coalesce(json_agg(z.code ORDER BY z.code), '[]') FROM job_zone_availability a JOIN service_zones z ON z.id = a.zone_id
                        WHERE a.job_id = j.id AND a.status = 'enabled'),
              'price', (SELECT row_to_json(p) FROM (SELECT id, base_labour_paisa, unit_label, unit_labour_paisa, included_units, inspection_fee_paisa, is_demo
                        FROM pricing_rules pr WHERE pr.job_id = j.id AND pr.zone_id IS NULL AND (pr.effective_to IS NULL OR pr.effective_to > now())
                        ORDER BY effective_from DESC LIMIT 1) p))
              ORDER BY j.display_order, j.id) FILTER (WHERE j.id IS NOT NULL), '[]') AS jobs
     FROM categories c LEFT JOIN jobs j ON j.category_id = c.id
     GROUP BY c.id ORDER BY c.display_order, c.id`);
}

export const CategoryPatch = z.object({
  name_en: z.string().trim().min(2).max(120).optional(), name_ur: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
}).strict();

export async function updateCategory(c: PoolClient, staff: AuthUser, id: string, input: z.infer<typeof CategoryPatch>) {
  const r = await c.query(`UPDATE categories SET name_en = coalesce($2, name_en), name_ur = coalesce($3, name_ur),
                             status = coalesce($4, status), updated_at = now() WHERE id = $1`,
    [id, input.name_en ?? null, input.name_ur ?? null, input.status ?? null]);
  if (!r.rowCount) throw notFound('Category');
  await audit(c, staff.id, 'category.update', 'category', id, null, input);
}

/** New order for categories, or for the jobs of one category. Ids not listed keep their place after the listed ones. */
export async function reorder(c: PoolClient, staff: AuthUser, table: 'categories' | 'jobs', ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await c.query(`UPDATE ${table} SET display_order = $2 WHERE id = $1`, [id, (i + 1) * 10]);
  }
  await audit(c, staff.id, `${table}.reorder`, table, ids[0] ?? '-', null, { ids });
}

export const JobPatch = z.object({
  name_en: z.string().trim().min(2).max(120).optional(), name_ur: z.string().trim().min(2).max(120).optional(),
  duration_minutes: z.number().int().positive().max(1440).optional(),
  booking_modes: z.array(z.enum(['fixed', 'quote', 'inspection'])).min(1).optional(),
}).strict();

export async function updateJob(c: PoolClient, staff: AuthUser, id: string, input: z.infer<typeof JobPatch>) {
  const r = await c.query(`UPDATE jobs SET name_en = coalesce($2, name_en), name_ur = coalesce($3, name_ur),
                             duration_minutes = coalesce($4, duration_minutes), booking_modes = coalesce($5, booking_modes), updated_at = now()
                           WHERE id = $1`, [id, input.name_en ?? null, input.name_ur ?? null, input.duration_minutes ?? null, input.booking_modes ?? null]);
  if (!r.rowCount) throw notFound('Job');
  await audit(c, staff.id, 'job.update', 'job', id, null, input);
}

// ---------------- Prices and commission ----------------

export const PricingInput = z.object({
  job_id: z.uuid(), zone_id: z.uuid().optional(),
  base_labour_paisa: z.number().int().nonnegative(), unit_label: z.string().max(30).optional(), unit_field_key: z.string().max(40).optional(),
  unit_labour_paisa: z.number().int().nonnegative().default(0), included_units: z.number().int().nonnegative().default(1),
  inspection_fee_paisa: z.number().int().nonnegative().default(0),
}).strict();

/** A new price takes effect now and ends the previous rule for the same job and zone. Bookings already made keep their snapshot. */
export async function setPrice(c: PoolClient, staff: AuthUser, input: z.infer<typeof PricingInput>) {
  await c.query(`UPDATE pricing_rules SET effective_to = now() WHERE job_id = $1 AND zone_id IS NOT DISTINCT FROM $2::uuid
                   AND (effective_to IS NULL OR effective_to > now())`, [input.job_id, input.zone_id ?? null]);
  const r = await one<{ id: string }>(c,
    `INSERT INTO pricing_rules (job_id, zone_id, base_labour_paisa, unit_label, unit_field_key, unit_labour_paisa, included_units,
       inspection_fee_paisa, effective_from, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), false) RETURNING id`,
    [input.job_id, input.zone_id ?? null, input.base_labour_paisa, input.unit_label ?? null, input.unit_field_key ?? null,
      input.unit_labour_paisa, input.included_units, input.inspection_fee_paisa]);
  await audit(c, staff.id, 'price.set', 'job', input.job_id, null, input);
  return { id: r!.id };
}

export const CommissionInput = z.object({
  scope_job_id: z.uuid().optional(), scope_category_id: z.uuid().optional(), scope_district_id: z.uuid().optional(),
  rate_bps: z.number().int().min(0).max(5000), effective_from: z.iso.datetime({ offset: true }).optional(), reason: z.string().trim().min(3),
}).strict().refine((v) => !(v.scope_job_id && v.scope_category_id), 'Choose a job or a category, not both');

export async function addCommissionRule(c: PoolClient, staff: AuthUser, input: z.infer<typeof CommissionInput>) {
  const r = await one<{ id: string }>(c,
    `INSERT INTO commission_rules (scope_job_id, scope_category_id, scope_district_id, rate_bps, effective_from, created_by)
     VALUES ($1,$2,$3,$4, coalesce($5::timestamptz, now()), $6) RETURNING id`,
    [input.scope_job_id ?? null, input.scope_category_id ?? null, input.scope_district_id ?? null, input.rate_bps, input.effective_from ?? null, staff.id]);
  await audit(c, staff.id, 'commission.rule', 'commission_rule', r!.id, input.reason, input);
  return { id: r!.id };
}

export async function listCommissionRules(db: Db) {
  return many(db, `SELECT cr.*, j.code AS job_code, c.code AS category_code, d.name_en AS district
                   FROM commission_rules cr LEFT JOIN jobs j ON j.id = cr.scope_job_id LEFT JOIN categories c ON c.id = cr.scope_category_id
                   LEFT JOIN regions d ON d.id = cr.scope_district_id ORDER BY cr.created_at DESC`);
}

// ---------------- Providers ----------------

export const ProviderOnboardInput = z.object({
  phone: z.string(), full_name: z.string().trim().min(3).max(120), display_name: z.string().trim().min(2).max(40),
  skills: z.array(z.string()).min(1), zone_ids: z.array(z.uuid()).min(1),
  base: z.object({ lat: z.number(), lng: z.number() }).optional(),
}).strict();

/** Verification officers register applicants (walk-in or phone). The applicant then uploads documents. */
export async function onboardProvider(c: PoolClient, staff: AuthUser, input: z.infer<typeof ProviderOnboardInput>) {
  const phone = normalizePkMobile(input.phone);
  if (!phone) throw unprocessable('INVALID_PHONE', 'Enter a Pakistani mobile number.');
  let user = await one<{ id: string }>(c, 'SELECT id FROM users WHERE phone_e164 = $1', [phone]);
  if (!user) user = await one<{ id: string }>(c, 'INSERT INTO users (phone_e164, full_name) VALUES ($1,$2) RETURNING id', [phone, input.full_name]);
  if (await one(c, 'SELECT 1 FROM providers WHERE user_id = $1', [user!.id])) throw conflict('ALREADY_PROVIDER', 'This phone already has a provider profile.');
  await c.query(`INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1,'provider',$2) ON CONFLICT DO NOTHING`, [user!.id, staff.id]);
  const p = await one<{ id: string }>(c,
    `INSERT INTO providers (user_id, display_name, status, base_location)
     VALUES ($1,$2,'applicant', CASE WHEN $3::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$3),4326) END) RETURNING id`,
    [user!.id, input.display_name, input.base?.lat ?? null, input.base?.lng ?? null]);
  for (const s of input.skills) await c.query(`INSERT INTO provider_skills (provider_id, skill_code) VALUES ($1,$2)`, [p!.id, s]);
  for (const z_ of input.zone_ids) await c.query(`INSERT INTO provider_zones (provider_id, zone_id) VALUES ($1,$2)`, [p!.id, z_]);
  await audit(c, staff.id, 'provider.onboard', 'provider', p!.id, null, { skills: input.skills, zones: input.zone_ids });
  return { id: p!.id, status: 'applicant' };
}

export async function listProviders(db: Db, status?: string) {
  return many(db,
    `SELECT p.id, p.display_name, p.status, p.rating_avg, p.review_count, u.full_name, u.phone_e164 AS phone,
            (SELECT json_agg(json_build_object('skill', s.skill_code, 'status', s.status, 'expires_at', s.expires_at)) FROM provider_skills s WHERE s.provider_id = p.id) AS skills,
            (SELECT json_agg(z.code ORDER BY z.code) FROM provider_zones pz JOIN service_zones z ON z.id = pz.zone_id WHERE pz.provider_id = p.id) AS zones,
            (SELECT count(*)::int FROM provider_documents d WHERE d.provider_id = p.id AND d.status = 'pending' AND d.deleted_at IS NULL) AS pending_documents,
            coalesce((SELECT sum(amount_paisa) FROM ledger_entries l WHERE l.provider_id = p.id), 0)::bigint AS balance_paisa
     FROM providers p JOIN users u ON u.id = p.user_id
     WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at`, [status ?? null]);
}

export async function providerDocuments(db: Db, providerId: string) {
  return many(db, `SELECT id, doc_type, content_type, size_bytes, status, note, created_at, reviewed_at
                   FROM provider_documents WHERE provider_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [providerId]);
}

export async function reviewDocument(c: PoolClient, staff: AuthUser, docId: string, status: 'accepted' | 'rejected', note: string) {
  const r = await c.query(`UPDATE provider_documents SET status = $2, note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
    [docId, status, note, staff.id]);
  if (!r.rowCount) throw notFound('Document');
  await audit(c, staff.id, 'document.review', 'provider_document', docId, note, { status });
}

/** Approving a skill records what was checked (licence number, certificate) and when it expires. */
export async function decideSkill(c: PoolClient, staff: AuthUser, providerId: string, skill: string,
  input: { decision: 'approved' | 'rejected'; check_note: string; expires_at?: string; evidence_document_id?: string }) {
  const restricted = await one<{ restricted: boolean }>(c, 'SELECT restricted FROM skills WHERE code = $1', [skill]);
  if (!restricted) throw notFound('Skill');
  if (input.decision === 'approved' && restricted.restricted) {
    if (!input.expires_at) throw unprocessable('EXPIRY_REQUIRED', 'Restricted skills need the licence or certificate expiry date.');
    if (new Date(input.expires_at).getTime() <= Date.now()) throw unprocessable('EXPIRED_EVIDENCE', 'That licence or certificate has already expired.');
    // The approval must point at a document from this provider that a verification officer accepted.
    if (!input.evidence_document_id) throw unprocessable('EVIDENCE_REQUIRED', 'Choose the accepted document that proves this skill.');
    const doc = await one<{ ok: boolean }>(c, `SELECT (provider_id = $2 AND status = 'accepted' AND deleted_at IS NULL) AS ok FROM provider_documents WHERE id = $1`,
      [input.evidence_document_id, providerId]);
    if (!doc?.ok) throw unprocessable('EVIDENCE_NOT_ACCEPTED', 'The evidence must be an accepted document uploaded by this provider.');
  }
  const r = await c.query(`UPDATE provider_skills SET status = $3, check_note = $4, expires_at = $5, evidence_document_id = $7,
                             approved_by = CASE WHEN $3 = 'approved' THEN $6::uuid END, approved_at = CASE WHEN $3 = 'approved' THEN now() END
                           WHERE provider_id = $1 AND skill_code = $2`,
    [providerId, skill, input.decision, input.check_note, input.expires_at ?? null, staff.id, input.evidence_document_id ?? null]);
  if (!r.rowCount) throw notFound('Provider skill');
  await audit(c, staff.id, 'skill.decide', 'provider', providerId, input.check_note, { skill, ...input });
}

export async function setProviderStatus(c: PoolClient, staff: AuthUser, providerId: string, status: 'approved' | 'suspended' | 'rejected', reason: string) {
  const r = await c.query(`UPDATE providers SET status = $2, approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
                             approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END WHERE id = $1`, [providerId, status, staff.id]);
  if (!r.rowCount) throw notFound('Provider');
  if (status === 'suspended') {
    await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE provider_id = $1 AND status = 'offered'`, [providerId]);
  }
  await audit(c, staff.id, 'provider.status', 'provider', providerId, reason, { status });
}

export async function setProviderZones(c: PoolClient, staff: AuthUser, providerId: string, zoneIds: string[]) {
  await c.query('DELETE FROM provider_zones WHERE provider_id = $1', [providerId]);
  for (const z_ of zoneIds) await c.query('INSERT INTO provider_zones (provider_id, zone_id) VALUES ($1,$2)', [providerId, z_]);
  await audit(c, staff.id, 'provider.zones', 'provider', providerId, null, { zoneIds });
}

// ---------------- Booking operations ----------------

export async function adminBookings(db: Db, f: { status?: string; q?: string }) {
  return many(db,
    `SELECT b.id, b.ref, b.status, b.booking_mode, b.scheduled_start, b.created_at, j.name_en AS job, z.code AS zone,
            p.display_name AS provider, u.full_name AS customer,
            (SELECT count(*)::int FROM complaints c WHERE c.booking_id = b.id AND c.status IN ('open', 'under_review')) AS open_complaints
     FROM bookings b JOIN jobs j ON j.id = b.job_id JOIN service_zones z ON z.id = b.zone_id JOIN users u ON u.id = b.customer_id
     LEFT JOIN providers p ON p.id = b.assigned_provider_id
     WHERE ($1::text IS NULL OR b.status = $1) AND ($2::text IS NULL OR b.ref ILIKE '%' || $2 || '%')
     ORDER BY b.created_at DESC LIMIT 200`, [f.status ?? null, f.q ?? null]);
}

export async function bookingTimeline(db: Db, bookingId: string) {
  return many(db, `SELECT e.event_type, e.from_status, e.to_status, e.data, e.created_at, u.full_name AS actor
                   FROM booking_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.booking_id = $1 ORDER BY e.id`, [bookingId]);
}

export async function markNoProvider(c: PoolClient, staff: AuthUser, bookingId: string, reason: string) {
  const b = await lockBooking(c, bookingId);
  await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE booking_id = $1 AND status = 'offered'`, [bookingId]);
  await moveTo(c, b, 'no_provider', 'dispatcher', staff.id, 'no_provider', { reason });
}

/** Takes the booking back from its provider (before work starts) so it can be offered again. */
export async function reassign(c: PoolClient, staff: AuthUser, bookingId: string, reason: string) {
  const b = await lockBooking(c, bookingId);
  if (!['assigned', 'en_route', 'no_provider'].includes(b.status)) throw conflict('NOT_REASSIGNABLE', `A booking that is ${b.status} cannot be reassigned.`);
  await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE booking_id = $1 AND status IN ('offered', 'accepted')`, [bookingId]);
  await moveTo(c, b, 'requested', 'dispatcher', staff.id, 'reassigned', { reason, from_provider: b.assigned_provider_id }, { assigned_provider_id: null });
  await audit(c, staff.id, 'booking.reassign', 'booking', bookingId, reason, {});
}

/**
 * Visit charge when no work can be done (e.g. a lockout the locksmith could not verify, or the
 * customer was absent). Added by a dispatcher, with a reason, after speaking to the customer.
 */
export const VISIT_REASONS = ['authorization_not_verified', 'customer_absent', 'access_refused'] as const;

export async function addVisitCharge(c: PoolClient, staff: AuthUser, bookingId: string, visitReason: (typeof VISIT_REASONS)[number], note: string) {
  const b = await lockBooking(c, bookingId);
  if (b.status !== 'on_site') throw conflict('NOT_ON_SITE', 'A visit charge can only be added while the provider is on site.');
  // Only the visit charge disclosed to the customer at booking may be billed.
  const amountPaisa = Number((b.terms_snapshot as { visit_charge_paisa?: number }).visit_charge_paisa ?? 0);
  if (amountPaisa <= 0) throw conflict('NO_VISIT_CHARGE_TERMS', 'This booking was not made with a visit charge, so none can be billed.');
  if (visitReason === 'authorization_not_verified') {
    const chk = await one<{ verified: boolean }>(c, 'SELECT verified FROM authorization_checks WHERE booking_id = $1', [bookingId]);
    if (!chk || chk.verified) throw conflict('CHECK_NOT_FAILED', 'The provider has not recorded a failed authorisation check.');
  }
  const reason = `${visitReason.replace(/_/g, ' ')}: ${note}`;
  // No work was done, so the work price agreed at booking is set aside (superseded, never edited) and only the visit is billed.
  const setAside = await c.query(`UPDATE quotes SET status = 'superseded' WHERE booking_id = $1 AND status IN ('approved', 'sent')`, [bookingId]);
  const rev = await one<{ n: number }>(c, 'SELECT coalesce(max(revision), 0) + 1 AS n FROM quotes WHERE booking_id = $1', [bookingId]);
  const q = await one<{ id: string }>(c,
    `INSERT INTO quotes (booking_id, revision, kind, status, created_by, decided_by, decided_at, note)
     VALUES ($1,$2,'change_order','approved',$3,$3,now(),$4) RETURNING id`, [bookingId, rev!.n, staff.id, `Visit charge only: ${reason}`]);
  await c.query('UPDATE quotes SET visit_reason = $2 WHERE id = $1', [q!.id, visitReason]);
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, data) VALUES ($1,$2,'visit_charge_only',$3)`,
    [bookingId, staff.id, JSON.stringify({ reason, amountPaisa, superseded_quotes: setAside.rowCount })]);
  const line = buildLine({ charge_type: 'visit_charge', description: 'Visit charge', quantity: 1, unit_price_paisa: amountPaisa });
  await c.query(`INSERT INTO quote_lines (quote_id, charge_type, description, quantity, unit_price_paisa, amount_paisa) VALUES ($1,$2,$3,$4,$5,$6)`,
    [q!.id, line.charge_type, line.description, line.quantity, line.unit_price_paisa, line.amount_paisa]);
  await audit(c, staff.id, 'booking.visit_charge', 'booking', bookingId, reason, { amountPaisa });
}

export async function manualAdjustment(c: PoolClient, staff: AuthUser, providerId: string, amountPaisa: number, reason: string) {
  if (amountPaisa === 0) throw unprocessable('ZERO_AMOUNT', 'The adjustment cannot be zero.');
  const row = await one<{ id: number }>(c,
    `INSERT INTO ledger_entries (provider_id, entry_type, amount_paisa, source_key, memo, created_by)
     VALUES ($1,'manual_adjustment',$2,'adjustment:' || gen_random_uuid(),$3,$4) RETURNING id`, [providerId, amountPaisa, reason, staff.id]);
  await audit(c, staff.id, 'ledger.adjust', 'provider', providerId, reason, { amountPaisa });
  return { entry_id: row!.id };
}

// ---------------- Reports ----------------

export async function summaryReport(db: Db, from: string, to: string) {
  const range = [from, to];
  const totals = await one(db,
    `SELECT count(*)::int AS bookings,
            count(*) FILTER (WHERE status IN ('completed', 'closed'))::int AS completed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE status = 'no_provider')::int AS no_provider,
            coalesce(round(avg(extract(epoch FROM (SELECT min(e.created_at) FROM booking_events e WHERE e.booking_id = b.id AND e.event_type = 'accepted') - b.created_at) / 60)), 0)::int AS avg_minutes_to_assign
     FROM bookings b WHERE (b.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date`, range);
  const money = await one(db,
    `SELECT coalesce(sum(p.amount_collected_paisa), 0)::bigint AS cash_collected_paisa,
            coalesce((SELECT sum(amount_paisa) FROM ledger_entries l WHERE l.entry_type IN ('commission_charge', 'commission_increase', 'commission_reversal')
                      AND (l.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date), 0)::bigint AS commission_paisa,
            coalesce((SELECT sum(-amount_paisa) FROM ledger_entries l WHERE l.entry_type = 'settlement_received'
                      AND (l.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date), 0)::bigint AS settled_paisa,
            coalesce((SELECT sum(amount_paisa) FROM ledger_entries), 0)::bigint AS outstanding_paisa
     FROM payments p WHERE (p.collected_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date`, range);
  const byCategory = await many(db,
    `SELECT c.code, c.name_en, count(*)::int AS bookings, count(*) FILTER (WHERE b.status IN ('completed', 'closed'))::int AS completed
     FROM bookings b JOIN jobs j ON j.id = b.job_id JOIN categories c ON c.id = j.category_id
     WHERE (b.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date
     GROUP BY c.code, c.name_en, c.display_order ORDER BY c.display_order`, range);
  const byZone = await many(db,
    `SELECT z.code, count(*)::int AS bookings FROM bookings b JOIN service_zones z ON z.id = b.zone_id
     WHERE (b.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date GROUP BY z.code ORDER BY z.code`, range);
  const complaints = await one(db,
    `SELECT count(*)::int AS opened, count(*) FILTER (WHERE status IN ('open', 'under_review'))::int AS still_open
     FROM complaints WHERE (created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $1::date AND $2::date`, range);
  return { from, to, ...totals, ...money, complaints, by_category: byCategory, by_zone: byZone };
}

// ---------------- Location directory (data-driven cities, districts, localities, aliases) ----------------

export const normalizeAlias = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function listRegions(db: Db) {
  return many(db,
    `SELECT r.id, r.parent_id, r.level, r.code, r.name_en, r.name_ur, r.status, r.is_demo,
            ST_Y(r.centroid) AS lat, ST_X(r.centroid) AS lng, r.boundary IS NOT NULL AS has_boundary,
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'alias', a.alias, 'lang', a.lang) ORDER BY a.id)
                      FROM place_aliases a WHERE a.region_id = r.id), '[]') AS aliases
     FROM regions r ORDER BY array_position(ARRAY['province','district','tehsil','city','locality'], r.level), r.name_en`);
}

const PARENT_LEVEL: Record<string, string[]> = {
  province: [], district: ['province'], tehsil: ['district'], city: ['district', 'tehsil'], locality: ['city'],
};

export const RegionInput = z.object({
  parent_id: z.uuid().nullable(),
  level: z.enum(['province', 'district', 'tehsil', 'city', 'locality']),
  code: z.string().regex(/^[A-Z0-9-]{2,40}$/),
  name_en: z.string().trim().min(2).max(120),
  name_ur: z.string().trim().min(2).max(120),
  centre: z.object({ lat: z.number().min(23).max(37.2), lng: z.number().min(60.8).max(77.9) }).optional(),
  boundary: GeoJsonArea.optional(),
  aliases: z.array(z.object({ alias: z.string().trim().min(1).max(80), lang: z.enum(['en', 'ur', 'roman']) })).default([]),
  is_demo: z.boolean().default(false),
}).strict();

export async function createRegion(c: PoolClient, staff: AuthUser, input: z.infer<typeof RegionInput>) {
  const allowed = PARENT_LEVEL[input.level]!;
  if (allowed.length === 0 && input.parent_id) throw unprocessable('BAD_PARENT', 'A province has no parent.');
  if (allowed.length > 0) {
    const parent = input.parent_id ? await one<{ level: string }>(c, 'SELECT level FROM regions WHERE id = $1', [input.parent_id]) : undefined;
    if (!parent || !allowed.includes(parent.level)) throw unprocessable('BAD_PARENT', `A ${input.level} must sit under a ${allowed.join(' or ')}.`);
  }
  if (input.level === 'locality' && !input.centre && !input.boundary) throw unprocessable('LOCATION_REQUIRED', 'A locality needs a centre point or a boundary.');
  if (await one(c, 'SELECT 1 FROM regions WHERE code = $1', [input.code])) throw conflict('REGION_EXISTS', 'That code is already used.');
  const r = await one<{ id: string }>(c,
    `INSERT INTO regions (id, parent_id, level, code, name_en, name_ur, centroid, boundary, is_demo)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,
       CASE WHEN $6::float8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($7,$6),4326)
            WHEN $8::text IS NOT NULL THEN ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($8),4326)) END,
       CASE WHEN $8::text IS NOT NULL THEN ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($8),4326)) END, $9)
     RETURNING id`,
    [input.parent_id, input.level, input.code, input.name_en, input.name_ur, input.centre?.lat ?? null, input.centre?.lng ?? null,
      input.boundary ? JSON.stringify(input.boundary) : null, input.is_demo]);
  const aliases = [{ alias: input.name_en, lang: 'en' }, { alias: input.name_ur, lang: 'ur' }, ...input.aliases];
  for (const a of aliases) {
    await c.query(`INSERT INTO place_aliases (region_id, alias, lang, normalized) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [r!.id, a.alias, a.lang, normalizeAlias(a.alias)]);
  }
  await audit(c, staff.id, 'region.create', 'region', r!.id, null, { ...input, boundary: input.boundary ? 'set' : undefined });
  return { id: r!.id };
}

export async function addAlias(c: PoolClient, staff: AuthUser, regionId: string, alias: string, lang: string) {
  const r = await c.query(`INSERT INTO place_aliases (region_id, alias, lang, normalized) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [regionId, alias, lang, normalizeAlias(alias)]);
  if (!r.rowCount) throw conflict('ALIAS_EXISTS', 'That name is already listed for this place.');
  await audit(c, staff.id, 'region.alias.add', 'region', regionId, null, { alias, lang });
}

export async function removeAlias(c: PoolClient, staff: AuthUser, aliasId: number) {
  const r = await one<{ region_id: string }>(c, 'DELETE FROM place_aliases WHERE id = $1 RETURNING region_id', [aliasId]);
  if (!r) throw notFound('Alias');
  await audit(c, staff.id, 'region.alias.remove', 'region', r.region_id, null, { aliasId });
}

export async function setRegionStatus(c: PoolClient, staff: AuthUser, id: string, status: 'active' | 'hidden') {
  const r = await c.query('UPDATE regions SET status = $2 WHERE id = $1', [id, status]);
  if (!r.rowCount) throw notFound('Region');
  await audit(c, staff.id, 'region.status', 'region', id, null, { status });
}

// ---------------- Skills, categories, services and their intake fields ----------------

export const SkillInput = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), name_en: z.string().trim().min(2).max(80), name_ur: z.string().trim().min(2).max(80),
  restricted: z.boolean(),
}).strict();

export async function listSkills(db: Db) { return many(db, 'SELECT code, name_en, name_ur, restricted FROM skills ORDER BY code'); }

export async function upsertSkill(c: PoolClient, staff: AuthUser, input: z.infer<typeof SkillInput>) {
  await c.query(`INSERT INTO skills (code, name_en, name_ur, restricted) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_ur = EXCLUDED.name_ur, restricted = EXCLUDED.restricted`,
    [input.code, input.name_en, input.name_ur, input.restricted]);
  await audit(c, staff.id, 'skill.upsert', 'skill', input.code, null, input);
}

export const NewCategoryInput = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), name_en: z.string().trim().min(2).max(120), name_ur: z.string().trim().min(2).max(120),
}).strict();

export async function createCategory(c: PoolClient, staff: AuthUser, input: z.infer<typeof NewCategoryInput>) {
  if (await one(c, 'SELECT 1 FROM categories WHERE code = $1', [input.code])) throw conflict('CATEGORY_EXISTS', 'That code is already used.');
  const r = await one<{ id: string }>(c,
    `INSERT INTO categories (id, code, name_en, name_ur, status, display_order)
     VALUES (gen_random_uuid(), $1,$2,$3,'draft', (SELECT coalesce(max(display_order), 0) + 10 FROM categories)) RETURNING id`,
    [input.code, input.name_en, input.name_ur]);
  await audit(c, staff.id, 'category.create', 'category', r!.id, null, input);
  return { id: r!.id, status: 'draft' };
}

export const JobSettingsInput = z.object({
  name_en: z.string().trim().min(2).max(120).optional(), name_ur: z.string().trim().min(2).max(120).optional(),
  description_en: z.string().max(1000).optional(), description_ur: z.string().max(1000).optional(),
  booking_modes: z.array(z.enum(['fixed', 'quote', 'inspection'])).min(1).optional(),
  required_skill: z.string().optional(),
  duration_minutes: z.number().int().positive().max(1440).optional(),
  duration_field_key: z.string().nullable().optional(),
  needs_destination: z.boolean().optional(),
  requires_authorization_check: z.boolean().optional(),
  visit_charge_paisa: z.number().int().nonnegative().max(10_000_00).optional(),
}).strict();

/** Every setting a customer sees comes from here, so services change without an app release. */
export async function updateJobSettings(c: PoolClient, staff: AuthUser, id: string, input: z.infer<typeof JobSettingsInput>) {
  if (input.required_skill && !(await one(c, 'SELECT 1 FROM skills WHERE code = $1', [input.required_skill]))) throw unprocessable('UNKNOWN_SKILL', 'Unknown skill.');
  if (input.duration_field_key) {
    const f = await one(c, `SELECT 1 FROM job_intake_fields WHERE job_id = $1 AND key = $2 AND field_type = 'hours'`, [id, input.duration_field_key]);
    if (!f) throw unprocessable('BAD_DURATION_FIELD', 'The duration field must be an "hours" field of this service.');
  }
  const cols = ['name_en', 'name_ur', 'description_en', 'description_ur', 'booking_modes', 'required_skill', 'duration_minutes',
    'duration_field_key', 'needs_destination', 'requires_authorization_check', 'visit_charge_paisa'] as const;
  const sets: string[] = []; const params: unknown[] = [id];
  for (const col of cols) if (input[col] !== undefined) { params.push(input[col]); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) return;
  const r = await c.query(`UPDATE jobs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  if (!r.rowCount) throw notFound('Service');
  await audit(c, staff.id, 'job.settings', 'job', id, null, input);
}

export const IntakeFieldInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  field_type: z.enum(['integer', 'text', 'select', 'boolean', 'hours']),
  label_en: z.string().trim().min(2).max(120), label_ur: z.string().trim().min(2).max(120),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().min(1).max(40), label_en: z.string().min(1).max(80), label_ur: z.string().min(1).max(80) })).optional(),
  min_value: z.number().optional(), max_value: z.number().optional(),
  display_order: z.number().int().optional(),
}).strict().refine((f) => f.field_type !== 'select' || (f.options?.length ?? 0) >= 2, 'A choice field needs at least two options');

export async function upsertIntakeField(c: PoolClient, staff: AuthUser, jobId: string, f: z.infer<typeof IntakeFieldInput>) {
  if (!(await one(c, 'SELECT 1 FROM jobs WHERE id = $1', [jobId]))) throw notFound('Service');
  await c.query(`INSERT INTO job_intake_fields (job_id, key, field_type, label_en, label_ur, required, options, min_value, max_value, display_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10, (SELECT coalesce(max(display_order), 0) + 10 FROM job_intake_fields WHERE job_id = $1)))
                 ON CONFLICT (job_id, key) DO UPDATE SET field_type = EXCLUDED.field_type, label_en = EXCLUDED.label_en, label_ur = EXCLUDED.label_ur,
                   required = EXCLUDED.required, options = EXCLUDED.options, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
                   display_order = EXCLUDED.display_order`,
    [jobId, f.key, f.field_type, f.label_en, f.label_ur, f.required, f.options ? JSON.stringify(f.options) : null, f.min_value ?? null, f.max_value ?? null, f.display_order ?? null]);
  await c.query('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);
  await audit(c, staff.id, 'job.field.upsert', 'job', jobId, null, f);
}

export async function removeIntakeField(c: PoolClient, staff: AuthUser, jobId: string, key: string) {
  const used = await one(c, 'SELECT 1 FROM jobs WHERE id = $1 AND duration_field_key = $2', [jobId, key]);
  if (used) throw conflict('FIELD_IN_USE', 'This field sets the booking duration; change the duration setting first.');
  const r = await c.query('DELETE FROM job_intake_fields WHERE job_id = $1 AND key = $2', [jobId, key]);
  if (!r.rowCount) throw notFound('Field');
  await audit(c, staff.id, 'job.field.remove', 'job', jobId, null, { key });
}
