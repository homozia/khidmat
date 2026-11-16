import { createHash } from 'node:crypto';

/** Deterministic UUID (v5-shaped) from a namespace string, so seed data has stable ids. */
export function detId(name: string): string {
  const h = createHash('sha1').update(`khidmat:${name}`).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
