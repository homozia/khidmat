import { signOutEverywhere } from './api';
import { settleCurrentWork } from './outbox';
import { setServerUrl } from './config';

/**
 * Switching test servers: end the session on the old server (while it is still the current one), clear this
 * phone's session, then point the app at the new address. The tester must sign in again. Unsent bookings and
 * files stay stored under the old server and reappear when the tester switches back to it.
 */
export async function switchServer(url: string) {
  await settleCurrentWork(); // a booking or file already on its way finishes on its own server first
  await signOutEverywhere();
  await setServerUrl(url);
}
