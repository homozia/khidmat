/** Money is held as integer paisa (1 PKR = 100 paisa). */

export function assertPaisa(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number of paisa`);
  }
}

/**
 * Commission fee in paisa: round-half-up(commissionable x rate_bps / 10,000).
 * Computed once on the booking's final eligible total, never per line.
 */
export function commissionFee(commissionablePaisa: number, rateBps: number): number {
  assertPaisa(commissionablePaisa, 'commissionable amount');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 5000) {
    throw new RangeError('rate must be 0-5000 basis points');
  }
  return Math.floor((commissionablePaisa * rateBps + 5000) / 10000);
}

/** Line amount from a quantity with up to 2 decimals, rounded half-up to the paisa. */
export function lineAmount(quantity: number, unitPricePaisa: number): number {
  assertPaisa(unitPricePaisa, 'unit price');
  if (!(quantity > 0) || Math.round(quantity * 100) !== quantity * 100) {
    throw new RangeError('quantity must be positive with at most 2 decimals');
  }
  return Math.floor((Math.round(quantity * 100) * unitPricePaisa + 50) / 100);
}

export const rupees = (pkr: number): number => Math.round(pkr * 100);

/** "PKR 1,250" or "PKR 98.72" */
export function formatPkr(paisa: number): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = abs % 100;
  return `${sign}PKR ${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
