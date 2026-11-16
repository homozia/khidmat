import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, tx, one } from './db.ts';
import { AppError, forbidden, notFound } from './lib/errors.ts';
import { isStaff, type AuthUser, type Role } from './services/auth.ts';
import { addAttachment, addProviderDocument, attachmentUrl, deleteAttachment, listAttachments, providerDocumentUrl } from './services/attachments.ts';
import { addReview, listComplaints, openComplaint, resolveComplaint } from './services/care.ts';
import * as admin from './services/admin.ts';
import { readStored, storageDriver, verifySignedUrl } from './services/storage.ts';
import { markRefundPaid } from './services/finance.ts';
import { runJobsOnce } from './services/jobs.ts';

const BINARY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg'];
const Uuid = z.object({ id: z.uuid() });

export function registerM3Routes(app: FastifyInstance) {
  app.addContentTypeParser(BINARY_TYPES, { parseAs: 'buffer', bodyLimit: 6 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const need = (req: FastifyRequest, ...roles: Role[]): AuthUser => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
    if (roles.length && !isStaff(req.user, ...roles)) throw forbidden();
    return req.user;
  };
  const binary = (req: FastifyRequest) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'UNSUPPORTED_MEDIA', `Send the raw file with one of: ${BINARY_TYPES.join(', ')}`);
    return { buf: req.body, type: String(req.headers['content-type']).split(';')[0]!.trim() };
  };

  // ---- Files ----
  app.post('/v1/bookings/:id/attachments', async (req, reply) => {
    const u = need(req);
    const { kind, client_ref } = z.object({ kind: z.enum(['photo', 'voice', 'completion_photo', 'lockout_proof']),
      client_ref: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional() }).parse(req.query);
    const { buf, type } = binary(req);
    const r = await tx((c) => addAttachment(c, u, Uuid.parse(req.params).id, kind, type, buf, client_ref));
    return reply.status('replayed' in r ? 200 : 201).send(r);
  });
  app.get('/v1/bookings/:id/attachments', async (req) => listAttachments(pool, need(req), Uuid.parse(req.params).id));
  app.get('/v1/attachments/:id/url', async (req) => attachmentUrl(pool, need(req), Uuid.parse(req.params).id));
  app.delete('/v1/attachments/:id', async (req, reply) => {
    const u = need(req);
    await tx((c) => deleteAttachment(c, u, Uuid.parse(req.params).id));
    return reply.status(204).send();
  });
  /** Signed, expiring download link. No session needed: the signature is the permission. */
  app.get('/v1/files', async (req, reply: FastifyReply) => {
    if (storageDriver().name !== 'local') throw notFound('File');
    const { key, type } = verifySignedUrl(req.query as Record<string, string>);
    const buf = await readStored(key).catch(() => { throw notFound('File'); });
    return reply.header('content-type', type).header('cache-control', 'private, max-age=60').header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline').send(buf);
  });

  // ---- Reviews and complaints ----
  app.post('/v1/bookings/:id/review', async (req) => {
    const u = need(req);
    const b = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    await tx((c) => addReview(c, u, Uuid.parse(req.params).id, b.rating, b.comment));
    return { ok: true };
  });
  app.post('/v1/bookings/:id/complaints', async (req, reply) => {
    const u = need(req);
    const b = z.object({ category: z.enum(['quality', 'price', 'conduct', 'damage', 'no_show', 'other']),
      description: z.string().trim().min(5).max(2000) }).strict().parse(req.body);
    return reply.status(201).send(await tx((c) => openComplaint(c, u, Uuid.parse(req.params).id, b)));
  });
  app.get('/v1/admin/complaints', async (req) => {
    need(req, 'dispatcher', 'finance');
    return listComplaints(pool, z.object({ status: z.string().optional() }).parse(req.query).status);
  });
  app.post('/v1/admin/complaints/:id/resolve', async (req) => {
    const u = need(req, 'dispatcher', 'finance');
    const b = z.object({
      status: z.enum(['under_review', 'resolved']), resolution: z.enum(['no_action', 'adjustment', 'refund']).optional(),
      note: z.string().trim().min(3).max(1000).optional(),
      refund: z.object({ charge_type: z.string(), amount_paisa: z.number().int().positive() }).optional(),
    }).strict().parse(req.body);
    return tx((c) => resolveComplaint(c, u, Uuid.parse(req.params).id, b));
  });

  // ---- Provider self-service ----
  app.get('/v1/provider/profile', async (req) => {
    const u = need(req, 'provider');
    if (!u.providerId) throw forbidden();
    const p = await one(pool, `SELECT p.id, p.display_name, p.status, p.rating_avg, p.review_count, p.accepting_offers,
        (SELECT json_agg(json_build_object('skill', s.skill_code, 'status', s.status, 'expires_at', s.expires_at)) FROM provider_skills s WHERE s.provider_id = p.id) AS skills,
        (SELECT json_agg(json_build_object('code', z.code, 'name_en', z.name_en, 'name_ur', z.name_ur)) FROM provider_zones pz JOIN service_zones z ON z.id = pz.zone_id WHERE pz.provider_id = p.id) AS zones
      FROM providers p WHERE p.id = $1`, [u.providerId]);
    return { ...p, documents: await admin.providerDocuments(pool, u.providerId) };
  });
  app.put('/v1/provider/availability', async (req) => {
    const u = need(req, 'provider');
    const { accepting_offers } = z.object({ accepting_offers: z.boolean() }).parse(req.body);
    await pool.query('UPDATE providers SET accepting_offers = $2 WHERE id = $1', [u.providerId, accepting_offers]);
    return { accepting_offers };
  });
  app.get('/v1/provider/jobs', async (req) => {
    const u = need(req, 'provider');
    const { rows } = await pool.query(
      `SELECT b.id, b.ref, b.status, b.scheduled_start, j.name_en AS job_name_en, j.name_ur AS job_name_ur, z.name_en AS zone_en
       FROM bookings b JOIN jobs j ON j.id = b.job_id JOIN service_zones z ON z.id = b.zone_id
       WHERE b.assigned_provider_id = $1 ORDER BY (b.status IN ('completed', 'closed', 'cancelled')), b.scheduled_start DESC LIMIT 100`, [u.providerId]);
    return rows;
  });
  app.post('/v1/provider/documents', async (req, reply) => {
    const u = need(req, 'provider');
    if (!u.providerId) throw forbidden();
    const { doc_type } = z.object({ doc_type: z.enum(['cnic_front', 'cnic_back', 'selfie', 'police_certificate', 'driving_licence', 'trade_certificate', 'other']) }).parse(req.query);
    const { buf, type } = binary(req);
    return reply.status(201).send(await tx((c) => addProviderDocument(c, u.providerId!, doc_type, type, buf)));
  });

  // ---- Verification ----
  app.get('/v1/admin/providers', async (req) => {
    need(req, 'verification', 'dispatcher', 'finance');
    return admin.listProviders(pool, z.object({ status: z.string().optional() }).parse(req.query).status);
  });
  app.post('/v1/admin/providers', async (req, reply) => {
    const u = need(req, 'verification');
    return reply.status(201).send(await tx((c) => admin.onboardProvider(c, u, admin.ProviderOnboardInput.parse(req.body))));
  });
  app.get('/v1/admin/providers/:id/documents', async (req) => { need(req, 'verification'); return admin.providerDocuments(pool, Uuid.parse(req.params).id); });
  app.post('/v1/admin/documents/:id/url', async (req) => {
    const u = need(req, 'verification');
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    return tx((c) => providerDocumentUrl(c, u, Uuid.parse(req.params).id, reason));
  });
  app.post('/v1/admin/documents/:id/review', async (req) => {
    const u = need(req, 'verification');
    const b = z.object({ status: z.enum(['accepted', 'rejected']), note: z.string().trim().min(3).max(500) }).parse(req.body);
    await tx((c) => admin.reviewDocument(c, u, Uuid.parse(req.params).id, b.status, b.note));
    return { ok: true };
  });
  app.post('/v1/admin/providers/:id/skills/:skill', async (req) => {
    const u = need(req, 'verification');
    const p = z.object({ id: z.uuid(), skill: z.string() }).parse(req.params);
    const b = z.object({ decision: z.enum(['approved', 'rejected']), check_note: z.string().trim().min(3).max(300),
      expires_at: z.iso.date().optional(), evidence_document_id: z.uuid().optional() }).strict().parse(req.body);
    await tx((c) => admin.decideSkill(c, u, p.id, p.skill, b));
    return { ok: true };
  });
  app.post('/v1/admin/providers/:id/status', async (req) => {
    const u = need(req, 'verification');
    const b = z.object({ status: z.enum(['approved', 'suspended', 'rejected']), reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await tx((c) => admin.setProviderStatus(c, u, Uuid.parse(req.params).id, b.status, b.reason));
    return { ok: true };
  });
  app.put('/v1/admin/providers/:id/zones', async (req) => {
    const u = need(req, 'verification', 'dispatcher');
    const { zone_ids } = z.object({ zone_ids: z.array(z.uuid()) }).parse(req.body);
    await tx((c) => admin.setProviderZones(c, u, Uuid.parse(req.params).id, zone_ids));
    return { ok: true };
  });

  // ---- Zones ----
  app.get('/v1/admin/zones', async (req) => { need(req, 'config_admin', 'dispatcher'); return admin.listZones(pool); });
  app.post('/v1/admin/zones', async (req, reply) => {
    const u = need(req, 'config_admin');
    return reply.status(201).send(await tx((c) => admin.createZone(c, u, admin.ZoneInput.parse(req.body))));
  });
  app.patch('/v1/admin/zones/:id', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.updateZone(c, u, Uuid.parse(req.params).id, admin.ZonePatch.parse(req.body)));
    return { ok: true };
  });
  app.post('/v1/admin/zones/:id/verify', async (req) => {
    const u = need(req, 'config_admin');
    const { note } = z.object({ note: z.string().trim().min(5).max(500) }).parse(req.body);
    await tx((c) => admin.verifyZone(c, u, Uuid.parse(req.params).id, note));
    return { ok: true };
  });
  app.post('/v1/admin/zones/:id/status', async (req) => {
    const u = need(req, 'config_admin');
    const { status } = z.object({ status: z.enum(['active', 'paused', 'draft']) }).parse(req.body);
    await tx((c) => admin.setZoneStatus(c, u, Uuid.parse(req.params).id, status));
    return { ok: true };
  });

  // ---- Location directory ----
  app.get('/v1/admin/regions', async (req) => { need(req, 'config_admin', 'dispatcher'); return admin.listRegions(pool); });
  app.post('/v1/admin/regions', async (req, reply) => {
    const u = need(req, 'config_admin');
    return reply.status(201).send(await tx((c) => admin.createRegion(c, u, admin.RegionInput.parse(req.body))));
  });
  app.post('/v1/admin/regions/:id/aliases', async (req, reply) => {
    const u = need(req, 'config_admin');
    const b = z.object({ alias: z.string().trim().min(1).max(80), lang: z.enum(['en', 'ur', 'roman']) }).strict().parse(req.body);
    await tx((c) => admin.addAlias(c, u, Uuid.parse(req.params).id, b.alias, b.lang));
    return reply.status(201).send({ ok: true });
  });
  app.delete('/v1/admin/aliases/:aliasId', async (req, reply) => {
    const u = need(req, 'config_admin');
    const { aliasId } = z.object({ aliasId: z.coerce.number().int().positive() }).parse(req.params);
    await tx((c) => admin.removeAlias(c, u, aliasId));
    return reply.status(204).send();
  });
  app.post('/v1/admin/regions/:id/status', async (req) => {
    const u = need(req, 'config_admin');
    const { status } = z.object({ status: z.enum(['active', 'hidden']) }).parse(req.body);
    await tx((c) => admin.setRegionStatus(c, u, Uuid.parse(req.params).id, status));
    return { ok: true };
  });

  // ---- Skills, categories, service settings, intake fields ----
  app.get('/v1/admin/skills', async (req) => { need(req, 'config_admin', 'verification'); return admin.listSkills(pool); });
  app.put('/v1/admin/skills', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.upsertSkill(c, u, admin.SkillInput.parse(req.body)));
    return { ok: true };
  });
  app.post('/v1/admin/categories', async (req, reply) => {
    const u = need(req, 'config_admin');
    return reply.status(201).send(await tx((c) => admin.createCategory(c, u, admin.NewCategoryInput.parse(req.body))));
  });
  app.patch('/v1/admin/jobs/:id/settings', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.updateJobSettings(c, u, Uuid.parse(req.params).id, admin.JobSettingsInput.parse(req.body)));
    return { ok: true };
  });
  app.put('/v1/admin/jobs/:id/fields', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.upsertIntakeField(c, u, Uuid.parse(req.params).id, admin.IntakeFieldInput.parse(req.body)));
    return { ok: true };
  });
  app.delete('/v1/admin/jobs/:id/fields/:key', async (req, reply) => {
    const u = need(req, 'config_admin');
    const p = z.object({ id: z.uuid(), key: z.string() }).parse(req.params);
    await tx((c) => admin.removeIntakeField(c, u, p.id, p.key));
    return reply.status(204).send();
  });
  app.get('/v1/admin/jobs/:id', async (req) => {
    need(req, 'config_admin');
    const id = Uuid.parse(req.params).id;
    const job = await one(pool, `SELECT j.*, c.code AS category_code,
        coalesce((SELECT json_agg(f ORDER BY f.display_order) FROM job_intake_fields f WHERE f.job_id = j.id), '[]') AS fields
      FROM jobs j JOIN categories c ON c.id = j.category_id WHERE j.id = $1`, [id]);
    if (!job) throw notFound('Service');
    return job;
  });

  // ---- Catalogue, prices, commission ----
  app.get('/v1/admin/catalogue', async (req) => { need(req, 'config_admin'); return admin.adminCatalogue(pool); });
  app.patch('/v1/admin/categories/:id', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.updateCategory(c, u, Uuid.parse(req.params).id, admin.CategoryPatch.parse(req.body)));
    return { ok: true };
  });
  app.post('/v1/admin/categories/reorder', async (req) => {
    const u = need(req, 'config_admin');
    const { ids } = z.object({ ids: z.array(z.uuid()).min(1) }).parse(req.body);
    await tx((c) => admin.reorder(c, u, 'categories', ids));
    return { ok: true };
  });
  app.post('/v1/admin/jobs/reorder', async (req) => {
    const u = need(req, 'config_admin');
    const { ids } = z.object({ ids: z.array(z.uuid()).min(1) }).parse(req.body);
    await tx((c) => admin.reorder(c, u, 'jobs', ids));
    return { ok: true };
  });
  app.patch('/v1/admin/jobs/:id', async (req) => {
    const u = need(req, 'config_admin');
    await tx((c) => admin.updateJob(c, u, Uuid.parse(req.params).id, admin.JobPatch.parse(req.body)));
    return { ok: true };
  });
  app.post('/v1/admin/pricing-rules', async (req, reply) => {
    const u = need(req, 'config_admin');
    return reply.status(201).send(await tx((c) => admin.setPrice(c, u, admin.PricingInput.parse(req.body))));
  });
  app.get('/v1/admin/commission-rules', async (req) => { need(req, 'finance', 'config_admin'); return admin.listCommissionRules(pool); });
  app.post('/v1/admin/commission-rules', async (req, reply) => {
    const u = need(req, 'finance');
    return reply.status(201).send(await tx((c) => admin.addCommissionRule(c, u, admin.CommissionInput.parse(req.body))));
  });

  // ---- Booking operations ----
  app.get('/v1/admin/bookings', async (req) => {
    need(req, 'dispatcher', 'finance');
    return admin.adminBookings(pool, z.object({ status: z.string().optional(), q: z.string().max(30).optional() }).parse(req.query));
  });
  app.get('/v1/admin/bookings/:id/timeline', async (req) => { need(req, 'dispatcher', 'finance'); return admin.bookingTimeline(pool, Uuid.parse(req.params).id); });
  app.post('/v1/admin/bookings/:id/no-provider', async (req) => {
    const u = need(req, 'dispatcher');
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await tx((c) => admin.markNoProvider(c, u, Uuid.parse(req.params).id, reason));
    return { ok: true };
  });
  app.post('/v1/admin/bookings/:id/reassign', async (req) => {
    const u = need(req, 'dispatcher');
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await tx((c) => admin.reassign(c, u, Uuid.parse(req.params).id, reason));
    return { ok: true };
  });
  app.post('/v1/admin/bookings/:id/visit-charge', async (req) => {
    const u = need(req, 'dispatcher');
    const b = z.object({ reason: z.enum(admin.VISIT_REASONS), note: z.string().trim().min(5).max(300) }).strict().parse(req.body);
    await tx((c) => admin.addVisitCharge(c, u, Uuid.parse(req.params).id, b.reason, b.note));
    return { ok: true };
  });
  app.post('/v1/admin/refunds/:id/paid', async (req) => {
    const u = need(req, 'finance');
    const b = z.object({ method: z.enum(['provider_cash', 'jazzcash', 'easypaisa', 'bank_transfer', 'office_cash']),
      reference: z.string().trim().min(3).max(120) }).strict().parse(req.body);
    await tx((c) => markRefundPaid(c, u, Uuid.parse(req.params).id, b));
    return { ok: true };
  });
  app.post('/v1/admin/providers/:id/adjustments', async (req, reply) => {
    const u = need(req, 'finance');
    const b = z.object({ amount_paisa: z.number().int(), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    return reply.status(201).send(await tx((c) => admin.manualAdjustment(c, u, Uuid.parse(req.params).id, b.amount_paisa, b.reason)));
  });
  app.get('/v1/admin/reports/summary', async (req) => {
    need(req, 'dispatcher', 'finance');
    const q = z.object({ from: z.iso.date(), to: z.iso.date() }).parse(req.query);
    return admin.summaryReport(pool, q.from, q.to);
  });
  app.post('/v1/admin/jobs/run', async (req) => { need(req, 'super_admin'); return runJobsOnce(); });
}
