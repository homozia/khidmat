import { config } from '../config.ts';
import { one, many, type Db } from '../db.ts';
import { unprocessable } from '../lib/errors.ts';
import { commissionFee, lineAmount } from '../lib/money.ts';

export interface LineInput {
  charge_type: string;
  description: string;
  quantity: number;
  unit_price_paisa: number;
}
export interface Line extends LineInput { amount_paisa: number }

export function buildLine(l: LineInput): Line {
  return { ...l, amount_paisa: lineAmount(l.quantity, l.unit_price_paisa) };
}

/**
 * Commission rate for a job in a district at a moment. Most specific rule wins:
 * job+district (5) > job (4) > category+district (3) > category (2) > district (1) > global (0).
 * Ties go to the latest effective_from. Falls back to DEFAULT_COMMISSION_BPS if no rule exists.
 */
export async function resolveCommissionRate(db: Db, jobId: string, districtId: string | null, at = new Date()):
  Promise<{ rateBps: number; ruleId: string | null }> {
  const rule = await one<{ id: string; rate_bps: number }>(db,
    `SELECT cr.id, cr.rate_bps FROM commission_rules cr, jobs j
     WHERE j.id = $1
       AND cr.effective_from <= $3 AND (cr.effective_to IS NULL OR cr.effective_to > $3)
       AND (cr.scope_job_id IS NULL OR cr.scope_job_id = j.id)
       AND (cr.scope_category_id IS NULL OR cr.scope_category_id = j.category_id)
       AND (cr.scope_district_id IS NULL OR cr.scope_district_id IS NOT DISTINCT FROM $2::uuid)
     ORDER BY (CASE WHEN cr.scope_job_id IS NOT NULL THEN 4 ELSE 0 END
             + CASE WHEN cr.scope_category_id IS NOT NULL THEN 2 ELSE 0 END
             + CASE WHEN cr.scope_district_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
             cr.effective_from DESC, cr.id
     LIMIT 1`, [jobId, districtId, at]);
  return rule ? { rateBps: rule.rate_bps, ruleId: rule.id } : { rateBps: config.DEFAULT_COMMISSION_BPS, ruleId: null };
}

export interface PricingRule {
  id: string;
  base_labour_paisa: number;
  unit_label: string | null;
  unit_field_key: string | null;
  unit_labour_paisa: number;
  included_units: number;
  inspection_fee_paisa: number;
  is_demo: boolean;
}

/** Zone-specific rule beats the general rule; latest effective_from wins. */
export async function resolvePricingRule(db: Db, jobId: string, zoneId: string): Promise<PricingRule | undefined> {
  return one<PricingRule>(db,
    `SELECT id, base_labour_paisa, unit_label, unit_field_key, unit_labour_paisa, included_units, inspection_fee_paisa, is_demo
     FROM pricing_rules
     WHERE job_id = $1 AND (zone_id IS NULL OR zone_id = $2)
       AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
     ORDER BY (zone_id IS NOT NULL) DESC, effective_from DESC LIMIT 1`, [jobId, zoneId]);
}

/** Lines the customer approves when confirming the booking (fixed price or inspection fee). */
export function initialLines(mode: 'fixed' | 'quote' | 'inspection', rule: PricingRule, jobName: string,
  labourType: string, intake: Record<string, unknown>, travelChargePaisa: number): Line[] {
  const lines: Line[] = [];
  if (mode === 'fixed') {
    if (rule.base_labour_paisa > 0) {
      lines.push(buildLine({ charge_type: labourType, description: jobName, quantity: 1, unit_price_paisa: rule.base_labour_paisa }));
    }
    if (rule.unit_field_key && rule.unit_labour_paisa > 0) {
      const units = Number(intake[rule.unit_field_key] ?? 0);
      const extra = units - rule.included_units;
      if (extra > 0) {
        lines.push(buildLine({ charge_type: labourType, description: `${rule.unit_label ?? 'unit'} x ${extra}`,
          quantity: extra, unit_price_paisa: rule.unit_labour_paisa }));
      }
    }
    if (lines.length === 0) throw unprocessable('NO_PRICE', 'This job has no fixed price for the details given.');
  } else if (mode === 'inspection') {
    lines.push(buildLine({ charge_type: 'inspection_fee', description: `Inspection: ${jobName}`, quantity: 1, unit_price_paisa: rule.inspection_fee_paisa }));
  }
  if (travelChargePaisa > 0 && mode !== 'quote') {
    lines.push(buildLine({ charge_type: 'travel_charge', description: 'Travel charge', quantity: 1, unit_price_paisa: travelChargePaisa }));
  }
  return lines.filter((l) => l.amount_paisa > 0 || l.charge_type === 'inspection_fee');
}

export interface BookingTotals {
  customerTotalPaisa: number;
  commissionablePaisa: number;
  refundedPaisa: number;
  refundedCommissionablePaisa: number;
  retainedCommissionablePaisa: number;
  feePaisa: number;
  byGroup: Record<'labour' | 'materials' | 'visit_travel' | 'reimbursements', number>;
}

/** Totals from approved quotes only. Unapproved lines are never billable. */
export async function bookingTotals(db: Db, bookingId: string, rateBps: number): Promise<BookingTotals> {
  const lines = await many<{ amount_paisa: number; commissionable: boolean; receipt_group: keyof BookingTotals['byGroup'] }>(db,
    `SELECT ql.amount_paisa, ct.commissionable, ct.receipt_group
     FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id JOIN charge_types ct ON ct.code = ql.charge_type
     WHERE q.booking_id = $1 AND q.status = 'approved'`, [bookingId]);
  const refunds = await many<{ amount_paisa: number; commissionable: boolean }>(db,
    `SELECT r.amount_paisa, ct.commissionable FROM refunds r JOIN charge_types ct ON ct.code = r.charge_type WHERE r.booking_id = $1`,
    [bookingId]);
  const byGroup = { labour: 0, materials: 0, visit_travel: 0, reimbursements: 0 };
  let total = 0;
  let commissionable = 0;
  for (const l of lines) {
    total += l.amount_paisa;
    byGroup[l.receipt_group] += l.amount_paisa;
    if (l.commissionable) commissionable += l.amount_paisa;
  }
  const refunded = refunds.reduce((s, r) => s + r.amount_paisa, 0);
  const refundedCommissionable = refunds.filter((r) => r.commissionable).reduce((s, r) => s + r.amount_paisa, 0);
  const retained = commissionable - refundedCommissionable;
  return {
    customerTotalPaisa: total,
    commissionablePaisa: commissionable,
    refundedPaisa: refunded,
    refundedCommissionablePaisa: refundedCommissionable,
    retainedCommissionablePaisa: retained,
    feePaisa: commissionFee(retained, rateBps),
    byGroup,
  };
}
