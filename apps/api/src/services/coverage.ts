import { config } from '../config.ts';
import { one, many, type Db } from '../db.ts';
import { unprocessable } from '../lib/errors.ts';

export interface ResolvedZone {
  id: string;
  code: string;
  name_en: string;
  name_ur: string;
  district_region_id: string | null;
  travel_charge_paisa: number;
}

export type CoverageResult =
  | { status: 'covered'; zone: ResolvedZone; point: { lat: number; lng: number }; source: string; needsConfirmation: boolean }
  | { status: 'outside'; point: { lat: number; lng: number } | null; nearby: { code: string; name_en: string; name_ur: string }[] };

export interface CoverageInput {
  jobId?: string;
  lat?: number;
  lng?: number;
  localityId?: string;
}

// Demo zones are allowed everywhere except production.
const demoClause = () => (config.APP_ENV === 'production' ? 'AND z.is_demo = false' : '');

/**
 * Resolves the zone for a point (GPS or pin) or, without a point, a locality.
 * Overlaps: highest precedence, then smallest area, then lowest id. Deterministic.
 */
export async function resolveCoverage(db: Db, input: CoverageInput): Promise<CoverageResult> {
  let point: { lat: number; lng: number };
  let source = 'gps';
  let needsConfirmation = false;

  if (input.lat !== undefined && input.lng !== undefined) {
    if (input.lat < 23 || input.lat > 37.2 || input.lng < 60.8 || input.lng > 77.9) {
      throw unprocessable('LOCATION_OUTSIDE_PAKISTAN', 'The location is outside Pakistan.');
    }
    point = { lat: input.lat, lng: input.lng };
  } else if (input.localityId) {
    const loc = await one<{ lat: number; lng: number; wholly_in_one_zone: boolean }>(db,
      `SELECT ST_Y(r.centroid) AS lat, ST_X(r.centroid) AS lng,
              (r.boundary IS NOT NULL AND (SELECT count(*) FROM service_zones z
                 WHERE z.status = 'active' ${demoClause()} AND ST_Within(r.boundary, z.boundary)) = 1) AS wholly_in_one_zone
       FROM regions r WHERE r.id = $1 AND r.level = 'locality' AND r.centroid IS NOT NULL`, [input.localityId]);
    if (!loc) throw unprocessable('UNKNOWN_LOCALITY', 'Choose an area from the list.');
    point = { lat: loc.lat, lng: loc.lng };
    source = 'locality_centroid';
    // A dispatcher confirms the pin before dispatch unless the area sits wholly inside one zone.
    needsConfirmation = !loc.wholly_in_one_zone;
  } else {
    throw unprocessable('LOCATION_REQUIRED', 'Share your location or choose your area.');
  }

  const zone = await one<ResolvedZone>(db,
    `SELECT z.id, z.code, z.name_en, z.name_ur, z.district_region_id, z.travel_charge_paisa
     FROM service_zones z
     ${input.jobId ? `JOIN job_zone_availability a ON a.zone_id = z.id AND a.job_id = $3 AND a.status = 'enabled'` : ''}
     WHERE z.status = 'active' ${demoClause()}
       AND ST_Covers(z.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
     ORDER BY z.precedence DESC, ST_Area(z.boundary::geography) ASC, z.id ASC
     LIMIT 1`,
    input.jobId ? [point.lng, point.lat, input.jobId] : [point.lng, point.lat]);

  if (!zone) {
    const nearby = await many<{ code: string; name_en: string; name_ur: string }>(db,
      `SELECT z.code, z.name_en, z.name_ur FROM service_zones z
       WHERE z.status = 'active' ${demoClause()}
       ORDER BY z.boundary <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) LIMIT 3`, [point.lng, point.lat]);
    return { status: 'outside', point, nearby };
  }
  return { status: 'covered', zone, point, source, needsConfirmation };
}
