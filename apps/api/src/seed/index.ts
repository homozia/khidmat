import type pg from 'pg';
import { detId } from '../lib/ids.ts';
import { CATALOGUE, CHARGE_TYPES } from './catalogue.ts';

/**
 * Deterministic synthetic seed. Every id is derived from a stable name, so two runs
 * produce identical data. All places, boundaries, prices and people are DEMO data.
 */

interface Place { code: string; en: string; ur: string; roman: string[]; lat: number; lng: number; half: [number, number] }

const ISB_LOCALITIES: Place[] = [
  { code: 'ISB-G9', en: 'G-9', ur: 'جی نائن', roman: ['g 9', 'g nine', 'karachi company'], lat: 33.6870, lng: 73.0330, half: [0.007, 0.009] },
  { code: 'ISB-G10', en: 'G-10', ur: 'جی ٹین', roman: ['g 10', 'g ten'], lat: 33.6760, lng: 73.0130, half: [0.007, 0.009] },
  { code: 'ISB-G11', en: 'G-11', ur: 'جی الیون', roman: ['g 11', 'g eleven'], lat: 33.6680, lng: 72.9940, half: [0.007, 0.009] },
  { code: 'ISB-F10', en: 'F-10', ur: 'ایف ٹین', roman: ['f 10', 'f ten'], lat: 33.6950, lng: 73.0130, half: [0.007, 0.009] },
  { code: 'ISB-F11', en: 'F-11', ur: 'ایف الیون', roman: ['f 11', 'f eleven'], lat: 33.6840, lng: 72.9880, half: [0.007, 0.009] },
];
const RWP_LOCALITIES: Place[] = [
  { code: 'RWP-SATELLITE-TOWN', en: 'Satellite Town', ur: 'سیٹلائٹ ٹاؤن', roman: ['satellite town', 'setlite town'], lat: 33.6380, lng: 73.0700, half: [0.007, 0.009] },
  { code: 'RWP-COMMERCIAL-MARKET', en: 'Commercial Market', ur: 'کمرشل مارکیٹ', roman: ['commercial market', 'kamarshal market'], lat: 33.6345, lng: 73.0760, half: [0.002, 0.002] },
  { code: 'RWP-CHAKLALA-III', en: 'Chaklala Scheme III', ur: 'چکلالہ اسکیم تھری', roman: ['chaklala scheme 3', 'chaklala 3'], lat: 33.5900, lng: 73.0880, half: [0.007, 0.009] },
];

export const ZONES = [
  { code: 'ISB-G', en: 'Islamabad G-9 to G-11', ur: 'اسلام آباد جی نائن تا جی الیون', localities: ['ISB-G9', 'ISB-G10', 'ISB-G11'], city: 'ISB', district: 'ICT-ISB' },
  { code: 'ISB-F', en: 'Islamabad F-10 and F-11', ur: 'اسلام آباد ایف ٹین اور ایف الیون', localities: ['ISB-F10', 'ISB-F11'], city: 'ISB', district: 'ICT-ISB' },
  { code: 'RWP-ST', en: 'Rawalpindi Satellite Town', ur: 'راولپنڈی سیٹلائٹ ٹاؤن', localities: ['RWP-SATELLITE-TOWN', 'RWP-COMMERCIAL-MARKET'], city: 'RWP', district: 'PB-RWP' },
  { code: 'RWP-CS3', en: 'Rawalpindi Chaklala Scheme III', ur: 'راولپنڈی چکلالہ اسکیم تھری', localities: ['RWP-CHAKLALA-III'], city: 'RWP', district: 'PB-RWP' },
] as const;

export const DEMO_USERS = {
  admin: { phone: '+923000000001', name: 'Ayesha (super admin)', roles: ['super_admin', 'dispatcher', 'finance', 'config_admin', 'verification'] },
  dispatcher: { phone: '+923000000002', name: 'Bilal (dispatcher)', roles: ['dispatcher'] },
  finance: { phone: '+923000000003', name: 'Fatima (finance)', roles: ['finance'] },
  config: { phone: '+923000000004', name: 'Kamran (config admin)', roles: ['config_admin'] },
  verifier: { phone: '+923000000005', name: 'Sana (verification)', roles: ['verification'] },
  customerIsb: { phone: '+923001110001', name: 'Usman (customer, Islamabad)', roles: ['customer'] },
  customerRwp: { phone: '+923001110002', name: 'Hina (customer, Rawalpindi)', roles: ['customer'] },
  plumberIsb: { phone: '+923002220001', name: 'Asif (plumber)', roles: ['provider'] },
  electricianPending: { phone: '+923002220002', name: 'Naveed (electrician, skill pending)', roles: ['provider'] },
  driver: { phone: '+923002220003', name: 'Tariq (driver)', roles: ['provider'] },
  locksmithPending: { phone: '+923002220004', name: 'Zahid (locksmith, skill pending)', roles: ['provider'] },
  plumberRwp: { phone: '+923002220005', name: 'Imran (plumber, Rawalpindi)', roles: ['provider'] },
  locksmith: { phone: '+923002220006', name: 'Rashid (locksmith, licensed)', roles: ['provider'] },
} as const;

type DemoKey = keyof typeof DEMO_USERS;

const PROVIDERS: { user: DemoKey; skills: [string, 'approved' | 'pending', string?][]; zones: string[]; base: [number, number] }[] = [
  { user: 'plumberIsb', skills: [['plumbing', 'approved']], zones: ['ISB-G', 'ISB-F'], base: [33.6760, 73.0130] },
  { user: 'electricianPending', skills: [['electrical', 'pending']], zones: ['ISB-G'], base: [33.6870, 73.0330] },
  { user: 'driver', skills: [['driver', 'approved', 'DEMO: LTV licence checked, expires 2027-12-31']], zones: ['RWP-ST', 'ISB-G'], base: [33.6380, 73.0700] },
  { user: 'locksmithPending', skills: [['locksmith', 'pending']], zones: ['ISB-G', 'ISB-F'], base: [33.6950, 73.0130] },
  { user: 'plumberRwp', skills: [['plumbing', 'approved']], zones: ['RWP-ST', 'RWP-CS3'], base: [33.5900, 73.0880] },
  // Ready for the lockout test without a verification detour (Zahid stays pending for the verification test).
  { user: 'locksmith', skills: [['locksmith', 'approved', 'DEMO: locksmith certificate checked, expires 2027-12-31']], zones: ['ISB-G', 'ISB-F'], base: [33.6930, 73.0150] },
];

export const ids = {
  user: (k: DemoKey) => detId(`user:${k}`),
  provider: (k: DemoKey) => detId(`provider:${k}`),
  zone: (code: string) => detId(`zone:${code}`),
  region: (code: string) => detId(`region:${code}`),
  category: (code: string) => detId(`category:${code}`),
  job: (code: string) => detId(`job:${code}`),
};

const box = (p: Place) => {
  const [h, w] = p.half;
  const ring = [[p.lng - w, p.lat - h], [p.lng + w, p.lat - h], [p.lng + w, p.lat + h], [p.lng - w, p.lat + h], [p.lng - w, p.lat - h]];
  return `MULTIPOLYGON(((${ring.map(([x, y]) => `${x} ${y}`).join(', ')})))`;
};

const normalizeAlias = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function seed(client: pg.PoolClient): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => client.query(sql, params);
  await q('SET LOCAL search_path = app, public');

  for (const c of CHARGE_TYPES) {
    await q(`INSERT INTO charge_types (code, name_en, name_ur, commissionable, receipt_group) VALUES ($1,$2,$3,$4,$5)`,
      [c.code, c.en, c.ur, c.commissionable, c.group]);
  }

  // Location directory
  const region = async (code: string, parent: string | null, level: string, en: string, ur: string, p?: Place) => {
    await q(`INSERT INTO regions (id, parent_id, level, code, name_en, name_ur, centroid, boundary, is_demo)
             VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326) END,
                     CASE WHEN $9::text IS NULL THEN NULL ELSE ST_GeomFromText($9, 4326) END, true)`,
      [ids.region(code), parent ? ids.region(parent) : null, level, code, en, ur, p?.lat ?? null, p?.lng ?? null, p ? box(p) : null]);
    const aliases: [string, string][] = [[en, 'en'], [ur, 'ur'], ...(p?.roman ?? []).map((r) => [r, 'roman'] as [string, string])];
    for (const [alias, lang] of aliases) {
      await q(`INSERT INTO place_aliases (region_id, alias, lang, normalized) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [ids.region(code), alias, lang, normalizeAlias(alias)]);
    }
  };
  await region('ICT', null, 'province', 'Islamabad Capital Territory', 'اسلام آباد کیپیٹل ٹیریٹری');
  await region('ICT-ISB', 'ICT', 'district', 'Islamabad', 'اسلام آباد');
  await region('ISB', 'ICT-ISB', 'city', 'Islamabad', 'اسلام آباد');
  for (const p of ISB_LOCALITIES) await region(p.code, 'ISB', 'locality', p.en, p.ur, p);
  await region('PB', null, 'province', 'Punjab', 'پنجاب');
  await region('PB-RWP', 'PB', 'district', 'Rawalpindi', 'راولپنڈی');
  await region('PB-RWP-T', 'PB-RWP', 'tehsil', 'Rawalpindi', 'راولپنڈی');
  await region('RWP', 'PB-RWP-T', 'city', 'Rawalpindi', 'راولپنڈی');
  for (const p of RWP_LOCALITIES) await region(p.code, 'RWP', 'locality', p.en, p.ur, p);

  // Service zones: union of their localities plus ~100 m, flagged as demo boundaries.
  for (const z of ZONES) {
    await q(`INSERT INTO service_zones (id, code, name_en, name_ur, city_region_id, district_region_id, boundary, status, is_demo)
             SELECT $1, $2, $3, $4, $5, $6, ST_Multi(ST_Buffer(ST_Union(boundary), 0.001)), 'active', true
             FROM regions WHERE code = ANY($7)`,
      [ids.zone(z.code), z.code, z.en, z.ur, ids.region(z.city), ids.region(z.district), z.localities]);
  }

  // Catalogue
  let catOrder = 0;
  for (const cat of CATALOGUE) {
    catOrder += 10;
    await q(`INSERT INTO skills (code, name_en, name_ur, restricted) VALUES ($1,$2,$3,$4)`,
      [cat.skill.code, cat.skill.en, cat.skill.ur, cat.skill.restricted]);
    await q(`INSERT INTO categories (id, code, name_en, name_ur, display_order, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [ids.category(cat.code), cat.code, cat.en, cat.ur, catOrder]);
    let jobOrder = 0;
    for (const job of cat.jobs) {
      jobOrder += 10;
      const jobId = ids.job(job.code);
      await q(`INSERT INTO jobs (id, category_id, code, name_en, name_ur, display_order, status, booking_modes, required_skill,
                                 duration_minutes, needs_destination)
               VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)`,
        [jobId, ids.category(cat.code), job.code, job.en, job.ur, jobOrder, job.modes, cat.skill.code, job.duration ?? 90, job.destination ?? false]);
      if (job.fields?.some((f) => f.type === 'hours')) await q(`UPDATE jobs SET duration_field_key = 'hours' WHERE id = $1`, [jobId]);
      if (job.code === 'locksmith.lockout') await q(`UPDATE jobs SET requires_authorization_check = true, visit_charge_paisa = 50000 WHERE id = $1`, [jobId]);
      let fieldOrder = 0;
      for (const f of job.fields ?? []) {
        fieldOrder += 10;
        await q(`INSERT INTO job_intake_fields (job_id, key, field_type, label_en, label_ur, required, min_value, max_value, display_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [jobId, f.key, f.type, f.en, f.ur, f.required ?? false, f.min ?? null, f.max ?? null, fieldOrder]);
      }
      await q(`INSERT INTO pricing_rules (job_id, base_labour_paisa, unit_label, unit_field_key, unit_labour_paisa, included_units,
                                          inspection_fee_paisa, effective_from, is_demo)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-01-01',true)`,
        [jobId, (job.labour ?? 0) * 100, job.unit?.label ?? null, job.unit?.key ?? null, (job.unit?.price ?? 0) * 100,
          job.unit?.included ?? 1, (job.inspection ?? 0) * 100]);
      for (const z of ZONES) {
        await q(`INSERT INTO job_zone_availability (job_id, zone_id) VALUES ($1,$2)`, [jobId, ids.zone(z.code)]);
      }
    }
  }
  await q(`INSERT INTO commission_rules (rate_bps, effective_from) VALUES (800, '2026-01-01')`);

  // People (synthetic)
  for (const [key, u] of Object.entries(DEMO_USERS) as [DemoKey, (typeof DEMO_USERS)[DemoKey]][]) {
    await q(`INSERT INTO users (id, phone_e164, full_name) VALUES ($1,$2,$3)`, [ids.user(key), u.phone, u.name]);
    for (const role of u.roles) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [ids.user(key), role]);
  }
  for (const p of PROVIDERS) {
    const pid = ids.provider(p.user);
    await q(`INSERT INTO providers (id, user_id, display_name, status, base_location, approved_by, approved_at)
             VALUES ($1,$2,$3,'approved', ST_SetSRID(ST_MakePoint($4,$5),4326), $6, '2026-01-15')`,
      [pid, ids.user(p.user), DEMO_USERS[p.user].name.split(' ')[0], p.base[1], p.base[0], ids.user('verifier')]);
    for (const [skill, status, note] of p.skills) {
      await q(`INSERT INTO provider_skills (provider_id, skill_code, status, check_note, expires_at, approved_by, approved_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pid, skill, status, note ?? null, status === 'approved' ? '2027-12-31' : null,
          status === 'approved' ? ids.user('verifier') : null, status === 'approved' ? '2026-01-15' : null]);
    }
    for (const z of p.zones) await q(`INSERT INTO provider_zones (provider_id, zone_id) VALUES ($1,$2)`, [pid, ids.zone(z)]);
  }
}
