import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Developer details kept off normal screens. Recent failed requests (time, method, path, status, error code and
 * the server's request id) are listed in the Diagnostics screen and in a draft problem report.
 * No tokens, phone numbers, addresses or file contents are recorded: paths contain only ids.
 */
export interface DiagEntry { at: string; method: string; path: string; status: number; code: string; request_id?: string; screen?: string }

const KEY = 'khidmat_diagnostics';
const MAX = 30;
let entries: DiagEntry[] = [];
let loaded = false;
let screen = '';
let bookingRef: string | null = null;

export async function loadDiagnostics() {
  if (loaded) return entries;
  try { entries = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'); } catch { entries = []; }
  loaded = true;
  return entries;
}
export function recordFailure(e: Omit<DiagEntry, 'at' | 'screen'>) {
  const path = e.path.split('?')[0]!; // query strings can carry search text
  entries = [{ ...e, path, at: new Date().toISOString(), screen }, ...entries].slice(0, MAX);
  void AsyncStorage.setItem(KEY, JSON.stringify(entries)).catch(() => undefined);
}
export const recentFailures = () => entries;
export async function clearDiagnostics() { entries = []; await AsyncStorage.removeItem(KEY); }

/** The screen and booking the tester was last looking at, for the problem report. */
export const setCurrentScreen = (s: string) => { screen = s; };
export const currentScreen = () => screen;
export const setCurrentBookingRef = (r: string | null) => { bookingRef = r; };
export const currentBookingRef = () => bookingRef;

/**
 * Test builds only, and only when the server allows it (TEST_FAULTS=1): the next booking or file upload asks the
 * server to save normally and then drop its reply, reproducing a reply lost after the database commit.
 */
let nextFault: 'booking' | 'upload' | null = null;
export const armFault = (f: 'booking' | 'upload' | null) => { nextFault = f; };
export const armedFault = () => nextFault;
export function takeFault(kind: 'booking' | 'upload'): boolean {
  if (nextFault !== kind) return false;
  nextFault = null;
  return true;
}
