import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Build variants (set by APP_VARIANT in app.config.ts):
 *  - development: Metro / Expo Go on a laptop
 *  - fieldtest:   signed test APK for phones on the office Wi-Fi; HTTP to the laptop is allowed; the tester sets the server address
 *  - staging:     HTTPS staging server, sandbox codes only for listed test numbers
 *  - production:  HTTPS only, no server setting
 */
export type Variant = 'development' | 'fieldtest' | 'staging' | 'production';
const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; apiUrl?: string };
export const VARIANT: Variant = extra.variant ?? 'development';
export const CAN_CHANGE_SERVER = VARIANT === 'fieldtest' || VARIANT === 'development';

const DEFAULT_URL = extra.apiUrl || process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const SERVER_KEY = 'khidmat_server_url';
let current = DEFAULT_URL;

export const apiUrl = () => current;

export async function loadServerUrl() {
  if (!CAN_CHANGE_SERVER) return current;
  const saved = await AsyncStorage.getItem(SERVER_KEY);
  if (saved) current = saved;
  return current;
}

/** Accepts "192.168.1.20", "192.168.1.20:3000" or a full URL. HTTP is accepted only in builds that can change the server. */
export function normaliseServerUrl(input: string): string | null {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  if (!/:\d+$/.test(s.replace(/^https?:\/\//i, '')) && s.startsWith('http://')) s = `${s}:3000`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && !CAN_CHANGE_SERVER) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

export async function setServerUrl(url: string) {
  current = url;
  await AsyncStorage.setItem(SERVER_KEY, url);
}

export const DEFAULT_SERVER_URL = DEFAULT_URL;
