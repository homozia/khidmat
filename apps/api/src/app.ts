import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z, ZodError } from 'zod';
import { config } from './config.ts';
import { pool, tx } from './db.ts';
import { AppError, forbidden } from './lib/errors.ts';
import { authenticate, isStaff, logout, requestOtp, verifyOtp, type AuthUser, type Role } from './services/auth.ts';
import { resolveCoverage } from './services/coverage.ts';
import { catalogueForZone, createJob, NewJobInput, searchPlaces, setJobStatus, setJobZone } from './services/catalogue.ts';
import {
  cancelBooking, completeBooking, confirmPayment, createBooking, CreateBookingInput, previewBooking, decideQuote, getBooking,
  providerSetStatus, QuoteInput, sendQuote, AuthorizationCheckInput, recordAuthorizationCheck,
} from './services/bookings.ts';
import { confirmLocation, dispatchQueue, eligibleProviders, listOffers, offerBooking, respondToOffer } from './services/dispatch.ts';
import { closeWeek, ledgerFor, providerBalance, receipt, recordSettlement, refund, statementsFor } from './services/finance.ts';
import { idempotent } from './services/idempotency.ts';
import { registerM3Routes } from './routes-m3.ts';
import cors from '@fastify/cors';

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

export interface BuildOptions { logStream?: NodeJS.WritableStream; logLevel?: string }

const Uuid = z.object({ id: z.uuid() });

/**
 * Logs never contain phone numbers, names, addresses, coordinates or tokens:
 * request bodies are not logged, query strings are dropped, and headers are reduced to safe fields.
 */
export function loggerOptions(opts: BuildOptions): FastifyServerOptions['logger'] {
  return {
    level: opts.logLevel ?? config.LOG_LEVEL,
    stream: opts.logStream,
    redact: { paths: ['req.headers.authorization', '*.phone', '*.phone_e164', '*.address_line', '*.location', '*.lat', '*.lng'], censor: '[redacted]' },
    serializers: {
      req: (req: FastifyRequest) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const options: FastifyServerOptions = {
    logger: loggerOptions(opts), bodyLimit: 256 * 1024, trustProxy: true,
    // Every response carries a request id that testers can quote in defect reports; logs carry the same id.
    genReqId: () => `req-${randomUUID().slice(0, 13)}`,
  };
  const app = Fastify(options);

  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-khidmat-test-fault'],
    exposedHeaders: ['x-request-id'],
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id).header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer');
  });

  // Test stack only (TEST_FAULTS=1, refused on staging and production): the field-test app can ask the server to
  // save a booking or file normally and then drop the connection instead of replying, reproducing a reply lost
  // after the database commit. The client must recover by retrying with the same Idempotency-Key / client_ref.
  const FAULT_ROUTES = /^\/v1\/bookings(\/[0-9a-f-]{36}\/attachments)?(\?|$)/;
  app.addHook('onSend', async (req, reply, payload) => {
    if (config.TEST_FAULTS && req.method === 'POST' && req.headers['x-khidmat-test-fault'] === 'drop-reply'
      && reply.statusCode < 400 && FAULT_ROUTES.test(req.url)) {
      req.log.warn({ url: req.url }, 'test fault: reply dropped after commit');
      req.raw.socket?.destroy();
    }
    return payload;
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    req.user = h?.startsWith('Bearer ') ? await authenticate(h.slice(7)) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, request_id: req.id } });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid request', details: z.flattenError(err).fieldErrors } });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'This conflicts with an existing record.' } });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: e.message } });
    req.log.error({ err: { message: e.message, code: pgCode } }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', request_id: req.id } });
  });

  const need = (req: FastifyRequest, ...roles: Role[]): AuthUser => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
    if (roles.length && !isStaff(req.user, ...roles)) throw forbidden();
    return req.user;
  };
  const idemKey = (req: FastifyRequest) => req.headers['idempotency-key'] as string | undefined;
  const send = (reply: FastifyReply, r: { status: number; body: unknown }) => reply.status(r.status).send(r.body);

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, app: config.APP_NAME, env: config.APP_ENV, sandbox_sms: config.SMS_PROVIDER === 'sandbox', test_faults: config.TEST_FAULTS };
  });

  // ---- Auth ----
  app.post('/v1/auth/otp/request', async (req) => {
    const body = z.object({ phone: z.string().max(30) }).parse(req.body);
    return requestOtp(body.phone);
  });
  app.post('/v1/auth/otp/verify', async (req) => {
    const body = z.object({ phone: z.string().max(30), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return verifyOtp(body.phone, body.code);
  });
  app.post('/v1/auth/logout', async (req, reply) => {
    need(req);
    await logout(req.headers.authorization!.slice(7));
    return reply.status(204).send();
  });
  app.get('/v1/me', async (req) => {
    const u = need(req);
    return { id: u.id, roles: [...u.roles], provider_id: u.providerId };
  });

  // ---- Places, coverage, catalogue ----
  app.get('/v1/places', async (req) => searchPlaces(pool, z.object({ q: z.string().max(60) }).parse(req.query).q));
  app.post('/v1/coverage/resolve', async (req) => {
    const b = z.object({ job_id: z.uuid().optional(), lat: z.number().optional(), lng: z.number().optional(), locality_id: z.uuid().optional() }).parse(req.body);
    const r = await resolveCoverage(pool, { jobId: b.job_id, lat: b.lat, lng: b.lng, localityId: b.locality_id });
    return r.status === 'covered'
      ? { status: r.needsConfirmation ? 'needs_confirmation' : 'covered', zone: { id: r.zone.id, code: r.zone.code, name_en: r.zone.name_en, name_ur: r.zone.name_ur } }
      : { status: 'outside', nearby: r.nearby };
  });
  app.get('/v1/catalogue', async (req) => {
    const q = z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), locality_id: z.uuid().optional() }).parse(req.query);
    const r = await resolveCoverage(pool, { lat: q.lat, lng: q.lng, localityId: q.locality_id });
    if (r.status === 'outside') return { status: 'outside', nearby: r.nearby, categories: [] };
    return { status: 'covered', zone: { code: r.zone.code, name_en: r.zone.name_en, name_ur: r.zone.name_ur }, categories: await catalogueForZone(pool, r.zone.id) };
  });

  // ---- Customer bookings ----
  app.post('/v1/bookings', async (req, reply) => {
    const u = need(req, 'customer');
    const input = CreateBookingInput.parse(req.body);
    return send(reply, await idempotent(u.id, 'POST /v1/bookings', idemKey(req), req.body,
      async (c) => ({ status: 201, body: await createBooking(c, u, input) })));
  });
  /** Price and terms the customer will see before confirming, with the token that confirms them. Saves nothing. */
  app.post('/v1/bookings/preview', async (req) => {
    const u = need(req, 'customer');
    return previewBooking(pool, u, CreateBookingInput.parse(req.body));
  });
  app.get('/v1/bookings', async (req) => {
    const u = need(req);
    const { rows } = await pool.query(
      `SELECT b.id, b.ref, b.status, b.scheduled_start, j.name_en AS job_name_en, j.name_ur AS job_name_ur
       FROM bookings b JOIN jobs j ON j.id = b.job_id WHERE b.customer_id = $1 ORDER BY b.created_at DESC LIMIT 50`, [u.id]);
    return rows;
  });
  app.get('/v1/bookings/:id', async (req) => getBooking(pool, need(req), Uuid.parse(req.params).id));
  app.get('/v1/bookings/:id/receipt', async (req) => receipt(pool, need(req), Uuid.parse(req.params).id));
  app.post('/v1/bookings/:id/cancel', async (req) => {
    const u = need(req);
    const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).parse(req.body);
    await tx((c) => cancelBooking(c, u, Uuid.parse(req.params).id, reason));
    return { ok: true };
  });
  app.post('/v1/bookings/:id/confirm-payment', async (req) => {
    const u = need(req);
    await tx((c) => confirmPayment(c, u, Uuid.parse(req.params).id));
    return { ok: true };
  });
  app.post('/v1/quotes/:id/approve', async (req, reply) => {
    const u = need(req);
    const id = Uuid.parse(req.params).id;
    return send(reply, await idempotent(u.id, `POST /v1/quotes/${id}/approve`, idemKey(req), {},
      async (c) => { await decideQuote(c, u, id, 'approve'); return { status: 200, body: { ok: true } }; }, false));
  });
  app.post('/v1/quotes/:id/decline', async (req) => {
    const u = need(req);
    await tx((c) => decideQuote(c, u, Uuid.parse(req.params).id, 'decline'));
    return { ok: true };
  });

  // ---- Provider ----
  app.get('/v1/provider/offers', async (req) => listOffers(pool, need(req, 'provider')));
  app.post('/v1/provider/offers/:id/accept', async (req) => {
    const u = need(req, 'provider');
    return tx((c) => respondToOffer(c, u, Uuid.parse(req.params).id, true));
  });
  app.post('/v1/provider/offers/:id/decline', async (req) => {
    const u = need(req, 'provider');
    return tx((c) => respondToOffer(c, u, Uuid.parse(req.params).id, false));
  });
  app.post('/v1/provider/bookings/:id/status', async (req) => {
    const u = need(req, 'provider');
    const { to } = z.object({ to: z.enum(['en_route', 'on_site', 'in_progress']) }).parse(req.body);
    await tx((c) => providerSetStatus(c, u, Uuid.parse(req.params).id, to));
    return { ok: true };
  });
  app.post('/v1/provider/bookings/:id/authorization-check', async (req) => {
    const u = need(req, 'provider');
    const input = AuthorizationCheckInput.parse(req.body);
    return tx((c) => recordAuthorizationCheck(c, u, Uuid.parse(req.params).id, input));
  });
  app.post('/v1/provider/bookings/:id/quotes', async (req, reply) => {
    const u = need(req, 'provider');
    const input = QuoteInput.parse(req.body);
    const id = Uuid.parse(req.params).id;
    return send(reply, await idempotent(u.id, `POST /v1/provider/bookings/${id}/quotes`, idemKey(req), req.body,
      async (c) => ({ status: 201, body: await sendQuote(c, u, id, input) })));
  });
  app.post('/v1/provider/bookings/:id/complete', async (req, reply) => {
    const u = need(req, 'provider');
    const { cash_collected_paisa } = z.object({ cash_collected_paisa: z.number().int().nonnegative() }).parse(req.body);
    const id = Uuid.parse(req.params).id;
    return send(reply, await idempotent(u.id, `POST /v1/provider/bookings/${id}/complete`, idemKey(req), req.body,
      async (c) => ({ status: 200, body: await completeBooking(c, u, id, cash_collected_paisa) })));
  });
  app.get('/v1/provider/ledger', async (req) => {
    const u = need(req, 'provider');
    if (!u.providerId) throw forbidden();
    return { balance_paisa: await providerBalance(pool, u.providerId), entries: await ledgerFor(pool, u.providerId) };
  });
  app.get('/v1/provider/statements', async (req) => {
    const u = need(req, 'provider');
    if (!u.providerId) throw forbidden();
    return statementsFor(pool, u.providerId);
  });

  // ---- Dispatch (staff) ----
  app.get('/v1/admin/dispatch/queue', async (req) => { need(req, 'dispatcher'); return dispatchQueue(pool); });
  app.get('/v1/admin/bookings/:id/eligible-providers', async (req) => {
    need(req, 'dispatcher');
    return eligibleProviders(pool, Uuid.parse(req.params).id);
  });
  app.post('/v1/admin/bookings/:id/offers', async (req, reply) => {
    const u = need(req, 'dispatcher');
    const { provider_id } = z.object({ provider_id: z.uuid() }).parse(req.body);
    return reply.status(201).send(await tx((c) => offerBooking(c, u, Uuid.parse(req.params).id, provider_id)));
  });
  app.post('/v1/admin/bookings/:id/confirm-location', async (req) => {
    const u = need(req, 'dispatcher');
    const b = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
    await tx((c) => confirmLocation(c, u, Uuid.parse(req.params).id, b.lat, b.lng));
    return { ok: true };
  });

  // ---- Finance (staff) ----
  app.post('/v1/admin/bookings/:id/refunds', async (req, reply) => {
    const u = need(req, 'finance');
    const input = z.object({
      charge_type: z.enum(['labour', 'inspection_fee', 'driver_hours', 'overtime', 'visit_charge', 'travel_charge', 'materials', 'reimbursement']),
      amount_paisa: z.number().int().positive(), reason: z.string().trim().min(3).max(500),
    }).strict().parse(req.body);
    const id = Uuid.parse(req.params).id;
    return send(reply, await idempotent(u.id, `POST /v1/admin/bookings/${id}/refunds`, idemKey(req), req.body,
      async (c) => ({ status: 201, body: await refund(c, u, id, input) })));
  });
  app.post('/v1/admin/settlements', async (req, reply) => {
    const u = need(req, 'finance');
    const input = z.object({
      provider_id: z.uuid(), amount_paisa: z.number().int().positive(),
      method: z.enum(['bank_transfer', 'jazzcash', 'easypaisa', 'cash_office']), reference: z.string().trim().min(3).max(80),
      received_at: z.iso.datetime({ offset: true }),
    }).strict().parse(req.body);
    return reply.status(201).send(await tx((c) => recordSettlement(c, u, input)));
  });
  app.post('/v1/admin/statements/close', async (req) => {
    const u = need(req, 'finance');
    const { week_start } = z.object({ week_start: z.iso.date() }).parse(req.body);
    return tx((c) => closeWeek(c, u, week_start));
  });
  app.get('/v1/admin/providers/:id/ledger', async (req) => {
    need(req, 'finance');
    const id = Uuid.parse(req.params).id;
    return { balance_paisa: await providerBalance(pool, id), entries: await ledgerFor(pool, id) };
  });

  // ---- Catalogue configuration (staff) ----
  app.post('/v1/admin/jobs', async (req, reply) => {
    const u = need(req, 'config_admin');
    const input = NewJobInput.parse(req.body);
    return reply.status(201).send(await tx((c) => createJob(c, u, input)));
  });
  app.post('/v1/admin/jobs/:id/status', async (req) => {
    const u = need(req, 'config_admin');
    const { status } = z.object({ status: z.enum(['active', 'paused', 'draft']) }).parse(req.body);
    await tx((c) => setJobStatus(c, u, Uuid.parse(req.params).id, status));
    return { ok: true };
  });
  app.put('/v1/admin/jobs/:id/zones/:zoneId', async (req) => {
    const u = need(req, 'config_admin');
    const p = z.object({ id: z.uuid(), zoneId: z.uuid() }).parse(req.params);
    const b = z.object({ status: z.enum(['enabled', 'paused']), same_day: z.boolean().optional(), scheduled: z.boolean().optional() }).parse(req.body);
    await tx((c) => setJobZone(c, u, p.id, p.zoneId, b));
    return { ok: true };
  });

  registerM3Routes(app);
  return app;
}
