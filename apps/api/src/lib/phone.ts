/**
 * Normalises a Pakistani mobile number to E.164 (+923XXXXXXXXX).
 * Accepts 03XX..., 3XX..., 923XX..., +92 3XX..., 0092 3XX..., with spaces or dashes.
 * Returns null for anything that is not a Pakistani mobile number.
 */
export function normalizePkMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^3\d{9}$/.test(digits)) return null;
  return `+92${digits}`;
}

/** +923001234567 -> +92 300 ***4567 (for screens that must not show the full number) */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ${e164.slice(3, 6)} ***${e164.slice(-4)}`;
}
