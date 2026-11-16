import type { PoolClient } from 'pg';
import { z } from 'zod';
import { many, one, type Db } from '../db.ts';
import { conflict, notFound } from '../lib/errors.ts';
import type { AuthUser } from './auth.ts';

/** Categories and jobs bookable in one zone, in admin-defined order. */
export async function catalogueForZone(db: Db, zoneId: string) {
  const rows = await many<{ cat_id: string; cat_code: string; cat_en: string; cat_ur: string; job: Record<string, unknown> }>(db,
    `SELECT c.id AS cat_id, c.code AS cat_code, c.name_en AS cat_en, c.name_ur AS cat_ur,
            json_build_object('id', j.id, 'code', j.code, 'name_en', j.name_en, 'name_ur', j.name_ur,
              'booking_modes', j.booking_modes, 'same_day', a.same_day, 'scheduled', a.scheduled,
              'needs_destination', j.needs_destination, 'requires_authorization_check', j.requires_authorization_check,
              'visit_charge_paisa', j.visit_charge_paisa, 'duration_field_key', j.duration_field_key,
              'description_en', j.description_en, 'description_ur', j.description_ur,
              'fields', coalesce((SELECT json_agg(json_build_object('key', f.key, 'type', f.field_type, 'label_en', f.label_en,
                 'label_ur', f.label_ur, 'required', f.required, 'min', f.min_value, 'max', f.max_value, 'options', f.options) ORDER BY f.display_order)
                 FROM job_intake_fields f WHERE f.job_id = j.id), '[]')) AS job
     FROM categories c JOIN jobs j ON j.category_id = c.id
     JOIN job_zone_availability a ON a.job_id = j.id AND a.zone_id = $1 AND a.status = 'enabled'
     WHERE c.status = 'active' AND j.status = 'active'
     ORDER BY c.display_order, c.id, j.display_order, j.id`, [zoneId]);
  const cats = new Map<string, { id: string; code: string; name_en: string; name_ur: string; jobs: unknown[] }>();
  for (const r of rows) {
    if (!cats.has(r.cat_id)) cats.set(r.cat_id, { id: r.cat_id, code: r.cat_code, name_en: r.cat_en, name_ur: r.cat_ur, jobs: [] });
    cats.get(r.cat_id)!.jobs.push(r.job);
  }
  return [...cats.values()];
}

export const NewJobInput = z.object({
  category_id: z.uuid(),
  code: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),
  name_en: z.string().trim().min(2).max(120),
  name_ur: z.string().trim().min(2).max(120),
  booking_modes: z.array(z.enum(['fixed', 'quote', 'inspection'])).min(1),
  required_skill: z.string(),
  duration_minutes: z.number().int().positive().max(1440).default(90),
  price: z.object({
    base_labour_paisa: z.number().int().nonnegative().default(0),
    inspection_fee_paisa: z.number().int().nonnegative().default(0),
  }),
}).strict();

async function audit(c: Db, actor: string, action: string, entity: string, id: string, after: object) {
  await c.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data) VALUES ($1,$2,$3,$4,$5)`,
    [actor, action, entity, id, JSON.stringify(after)]);
}

/** New jobs start as drafts with no zones: invisible to customers until enabled. */
export async function createJob(c: PoolClient, staff: AuthUser, input: z.infer<typeof NewJobInput>) {
  const exists = await one(c, 'SELECT 1 FROM jobs WHERE code = $1', [input.code]);
  if (exists) throw conflict('JOB_EXISTS', 'A job with this code already exists.');
  const j = await one<{ id: string }>(c,
    `INSERT INTO jobs (id, category_id, code, name_en, name_ur, status, booking_modes, required_skill, duration_minutes, display_order)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,'draft',$5,$6,$7, (SELECT coalesce(max(display_order), 0) + 10 FROM jobs WHERE category_id = $1))
     RETURNING id`,
    [input.category_id, input.code, input.name_en, input.name_ur, input.booking_modes, input.required_skill, input.duration_minutes]);
  await c.query(`INSERT INTO pricing_rules (job_id, base_labour_paisa, inspection_fee_paisa, is_demo) VALUES ($1,$2,$3,false)`,
    [j!.id, input.price.base_labour_paisa, input.price.inspection_fee_paisa]);
  await audit(c, staff.id, 'job.create', 'job', j!.id, input);
  return { id: j!.id };
}

export async function setJobStatus(c: PoolClient, staff: AuthUser, jobId: string, status: 'active' | 'paused' | 'draft') {
  const r = await c.query(`UPDATE jobs SET status = $2, updated_at = now() WHERE id = $1`, [jobId, status]);
  if (!r.rowCount) throw notFound('Job');
  await audit(c, staff.id, 'job.status', 'job', jobId, { status });
}

export async function setJobZone(c: PoolClient, staff: AuthUser, jobId: string, zoneId: string,
  input: { status: 'enabled' | 'paused'; same_day?: boolean; scheduled?: boolean }) {
  await c.query(`INSERT INTO job_zone_availability (job_id, zone_id, status, same_day, scheduled) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (job_id, zone_id) DO UPDATE SET status = EXCLUDED.status, same_day = EXCLUDED.same_day, scheduled = EXCLUDED.scheduled`,
    [jobId, zoneId, input.status, input.same_day ?? true, input.scheduled ?? true]);
  await audit(c, staff.id, 'job.zone', 'job', jobId, { zoneId, ...input });
}

export async function searchPlaces(db: Db, q: string) {
  const norm = q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (norm.length < 2) return [];
  return many(db,
    `SELECT DISTINCT ON (r.id) r.id, r.code, r.name_en, r.name_ur, p.name_en AS city_en, p.name_ur AS city_ur,
            ST_Y(r.centroid) AS lat, ST_X(r.centroid) AS lng
     FROM place_aliases a JOIN regions r ON r.id = a.region_id AND r.level = 'locality' AND r.status = 'active'
     LEFT JOIN regions p ON p.id = r.parent_id
     WHERE a.normalized LIKE $1 || '%' OR a.normalized LIKE '% ' || $1 || '%'
     ORDER BY r.id LIMIT 20`, [norm]);
}
