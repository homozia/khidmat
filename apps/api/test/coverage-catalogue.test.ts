import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, freshApp, idem, loginAll, pool, tomorrowAt, ids, JOB, LOCALITY, ZONE, type Client, type Users } from './helpers.ts';

const G10 = { lat: 33.6762, lng: 73.0128 };
const SATELLITE = { lat: 33.6380, lng: 73.0700 };
const CHAKLALA = { lat: 33.5900, lng: 73.0880 };
const BLUE_AREA = { lat: 33.7100, lng: 73.0600 }; // not in any pilot zone

/** Acceptance check 2 (API): manual location, outside coverage, and overlapping zones. */
describe('AC2 - coverage resolution', () => {
  let app: FastifyInstance;
  let anon: Client;
  beforeAll(async () => { app = await freshApp(); anon = client(app); });
  afterAll(async () => { await app.close(); });

  it('a GPS point inside G-10 resolves to zone ISB-G', async () => {
    const r = await anon.post('/v1/coverage/resolve', G10);
    expect(r.body).toMatchObject({ status: 'covered', zone: { code: 'ISB-G' } });
  });

  it('manual area selection without GPS works and needs no dispatcher check when the area is wholly in one zone', async () => {
    const r = await anon.post('/v1/coverage/resolve', { locality_id: LOCALITY.SATELLITE });
    expect(r.body).toMatchObject({ status: 'covered', zone: { code: 'RWP-ST' } });
  });

  it('outside coverage is explained with nearby covered zones', async () => {
    const r = await anon.post('/v1/coverage/resolve', BLUE_AREA);
    expect(r.body.status).toBe('outside');
    expect(r.body.nearby.length).toBeGreaterThan(0);
  });

  it('overlapping zones: higher precedence wins, then smaller area, the same way every time', async () => {
    // A small demo zone over part of G-10 with the same precedence: the smaller area wins.
    await pool.query(`INSERT INTO app.service_zones (id, code, name_en, name_ur, boundary, status, precedence)
      VALUES ($1, 'ISB-G10-CORE', 'G-10 core', 'جی ٹین مرکز',
              ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(73.0128, 33.6762), 4326), 0.002)), 'active', 0)`, [ids.zone('ISB-G10-CORE')]);
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => anon.post('/v1/coverage/resolve', G10)));
    expect(new Set(runs.map((r) => r.body.zone.code))).toEqual(new Set(['ISB-G10-CORE']));
    // Raise the big zone's precedence: it now wins everywhere it overlaps.
    await pool.query(`UPDATE app.service_zones SET precedence = 10 WHERE code = 'ISB-G'`);
    expect((await anon.post('/v1/coverage/resolve', G10)).body.zone.code).toBe('ISB-G');
    // A paused zone is ignored.
    await pool.query(`UPDATE app.service_zones SET status = 'paused' WHERE code = 'ISB-G'`);
    expect((await anon.post('/v1/coverage/resolve', G10)).body.zone.code).toBe('ISB-G10-CORE');
  });

  it('a locality that straddles zones is flagged for dispatcher confirmation', async () => {
    // G-10 is no longer wholly inside one active zone (ISB-G paused; the core zone covers only part).
    const r = await anon.post('/v1/coverage/resolve', { locality_id: LOCALITY.G10 });
    expect(r.body.status).toBe('needs_confirmation');
  });
});

/** Acceptance check 1: a job added and enabled in one Rawalpindi zone, without an app release. */
describe('AC1 - admin adds a job in one Rawalpindi zone; history keeps its terms', () => {
  let app: FastifyInstance;
  let u: Users;
  let newJobId: string;
  let oldBookingId: string;

  beforeAll(async () => {
    app = await freshApp();
    u = await loginAll(app);
    const b = await u.customerRwp.post('/v1/bookings', {
      job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town', intake: {},
    }, idem());
    oldBookingId = b.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('config admin creates the job as a draft: invisible everywhere', async () => {
    const r = await u.config.post('/v1/admin/jobs', {
      category_id: ids.category('plumbing'), code: 'plumbing.geyser_service', name_en: 'Gas geyser service', name_ur: 'گیس گیزر کی سروس',
      booking_modes: ['fixed'], required_skill: 'plumbing', price: { base_labour_paisa: 1800_00 },
    });
    expect(r.status).toBe(201);
    newJobId = r.body.id;
    const cat = await client(app).get(`/v1/catalogue?lat=${SATELLITE.lat}&lng=${SATELLITE.lng}`);
    expect(JSON.stringify(cat.body)).not.toContain('geyser');
  });

  it('enabled in RWP-ST and activated, it appears in Satellite Town only', async () => {
    expect((await u.config.put(`/v1/admin/jobs/${newJobId}/zones/${ZONE('RWP-ST')}`, { status: 'enabled' })).status).toBe(200);
    expect((await u.config.post(`/v1/admin/jobs/${newJobId}/status`, { status: 'active' })).status).toBe(200);
    const has = async (p: { lat: number; lng: number }) =>
      JSON.stringify((await client(app).get(`/v1/catalogue?lat=${p.lat}&lng=${p.lng}`)).body).includes('plumbing.geyser_service');
    expect(await has(SATELLITE)).toBe(true);
    expect(await has(CHAKLALA)).toBe(false);
    expect(await has(G10)).toBe(false);

    const ok = await u.customerRwp.post('/v1/bookings', { job_id: newJobId, timing: 'scheduled', scheduled_start: tomorrowAt('12:00'),
      location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town', intake: {} }, idem());
    expect(ok.status).toBe(201);
    expect(ok.body.totals.customer_total_paisa).toBe(1800_00);
    const no = await u.customerRwp.post('/v1/bookings', { job_id: newJobId, timing: 'scheduled', scheduled_start: tomorrowAt('12:00'),
      location: { ...CHAKLALA, source: 'gps' }, address_line: 'House 3, Chaklala Scheme III', intake: {} }, idem());
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe('OUTSIDE_COVERAGE');
  });

  it('the action is in the audit log', async () => {
    const a = await pool.query(`SELECT action FROM app.audit_log WHERE entity_id = $1 ORDER BY id`, [newJobId]);
    expect(a.rows.map((r) => r.action)).toEqual(['job.create', 'job.zone', 'job.status']);
  });

  it('renaming, repricing and pausing a job does not change an existing booking', async () => {
    const before = (await u.dispatcher.get(`/v1/bookings/${oldBookingId}`)).body;
    await pool.query(`UPDATE app.jobs SET name_en = 'Drain unblocking (new name)', updated_at = now() WHERE id = $1`, [JOB('plumbing.drain_block')]);
    await pool.query(`UPDATE app.pricing_rules SET base_labour_paisa = 999900 WHERE job_id = $1`, [JOB('plumbing.drain_block')]);
    await u.config.post(`/v1/admin/jobs/${JOB('plumbing.drain_block')}/status`, { status: 'paused' });
    const after = (await u.dispatcher.get(`/v1/bookings/${oldBookingId}`)).body;
    expect(after.terms_snapshot).toEqual(before.terms_snapshot);
    expect(after.terms_snapshot.job.name_en).toBe('Blocked drain clearing');
    expect(after.totals.customer_total_paisa).toBe(1200_00);
    const blocked = await u.customerRwp.post('/v1/bookings', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('14:00'),
      location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town', intake: {} }, idem());
    expect(blocked.body.error.code).toBe('JOB_UNAVAILABLE');
  });

  it('job intake fields are validated (e.g. number of solar panels)', async () => {
    const base = { job_id: JOB('solar.panel_cleaning'), timing: 'scheduled', scheduled_start: tomorrowAt('11:00'),
      location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town' };
    const bad = await u.customerRwp.post('/v1/bookings', { ...base, intake: { panels: 0, colour: 'red' } }, idem());
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toMatchObject({ panels: 'minimum 1', colour: 'unknown field' });
    const good = await u.customerRwp.post('/v1/bookings', { ...base, intake: { panels: 12 } }, idem());
    expect(good.body.totals.customer_total_paisa).toBe(12 * 300_00);
  });

  it('scheduling outside zone hours or in the past is refused', async () => {
    const base = { job_id: JOB('solar.panel_cleaning'), timing: 'scheduled', location: { ...SATELLITE, source: 'gps' },
      address_line: 'House 21, Block C, Satellite Town', intake: { panels: 4 } };
    expect((await u.customerRwp.post('/v1/bookings', { ...base, scheduled_start: tomorrowAt('23:00') }, idem())).body.error.code).toBe('OUTSIDE_HOURS');
    expect((await u.customerRwp.post('/v1/bookings', { ...base, scheduled_start: '2026-01-01T10:00:00+05:00' }, idem())).body.error.code).toBe('SCHEDULE_TOO_SOON');
  });

  it('the seeded catalogue has all 11 categories in admin order, with Urdu names', async () => {
    const cat = await client(app).get(`/v1/catalogue?lat=${CHAKLALA.lat}&lng=${CHAKLALA.lng}`);
    expect(cat.body.categories.map((c: { code: string }) => c.code)).toEqual(
      ['plumbing', 'electrical', 'carpentry', 'painting', 'ac', 'appliance', 'cleaning', 'handyman', 'driver', 'locksmith', 'solar_ups']);
    expect(cat.body.categories[0].name_ur).toBe('پلمبنگ');
  });
});
