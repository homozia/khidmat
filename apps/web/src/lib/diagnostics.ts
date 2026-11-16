/**
 * Developer details kept off normal screens: recent failed requests with the server's request id, the page and
 * booking the tester was on. Stored in this tab only (sessionStorage). No tokens, phone numbers or addresses.
 */
export interface DiagEntry { at: string; method: string; path: string; status: number; code: string; request_id?: string; page: string }
const KEY = 'khidmat.diagnostics';
let entries: DiagEntry[] = [];
try { entries = JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { entries = []; }
let bookingRef: string | null = null;

export function recordFailure(e: Omit<DiagEntry, 'at' | 'page'>) {
  entries = [{ ...e, path: e.path.split('?')[0]!, at: new Date().toISOString(), page: location.hash || '#/' }, ...entries].slice(0, 30);
  try { sessionStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* storage unavailable */ }
}
export const recentFailures = () => entries;
export function clearDiagnostics() { entries = []; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
export const setLastBookingRef = (r: string | null) => { bookingRef = r; };
export const lastBookingRef = () => bookingRef;
export const maskIds = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '…');
