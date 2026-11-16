import type { ApiError } from './api';

/** Plain-language messages for the error codes a customer can meet. Keys are English; i18n.tsx holds the Urdu. */
export const ERROR_TEXT: Record<string, string> = {
  NETWORK: 'No internet connection. Check your connection and try again.',
  TIMEOUT: 'The server took too long to answer. Try again in a moment.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  INVALID_PHONE: 'Enter a Pakistani mobile number, for example 0300 1234567.',
  OTP_INVALID: 'That code is not right. Check the SMS and try again.',
  OTP_LOCKED: 'Too many wrong codes. Wait 15 minutes, then ask for a new code.',
  OTP_RATE_LIMITED: 'Too many code requests. Wait a few minutes and try again.',
  TEST_NUMBERS_ONLY: 'This test server only accepts registered test numbers.',
  SMS_UNAVAILABLE: 'We could not send the SMS right now. Try again in a few minutes.',
  INVALID_INTAKE: 'Some details are missing or not valid. Check the fields marked in red.',
  OUTSIDE_COVERAGE: 'We do not serve this area yet.',
  LOCATION_REQUIRED: 'Choose your area or use your location first.',
  LOCATION_OUTSIDE_PAKISTAN: 'That location is outside Pakistan. Choose your area from the list.',
  JOB_UNAVAILABLE: 'This service is not available in your area right now.',
  TIMING_UNAVAILABLE: 'This timing is not available for this service. Choose another time.',
  SCHEDULE_REQUIRED: 'Choose a day and time.',
  SCHEDULE_TOO_SOON: 'That time is too soon. Choose a later time.',
  OUTSIDE_HOURS: 'We book between 9 am and 7 pm. Choose a time in those hours.',
  DESTINATION_REQUIRED: 'Choose where the driver should take you.',
  DESTINATION_OUTSIDE_TRAVEL_AREA: 'That destination is outside the area our drivers cover.',
  NO_PRICE: 'This service has no price in your area yet. Call us to book it.',
  PRICE_CHANGED: 'The price or terms changed. Check the new total and confirm again.',
  PRICE_CONFIRMATION_REQUIRED: 'Review the price, then confirm the booking.',
  IDEMPOTENCY_KEY_REUSED: 'This booking was already sent with different details. Start a new booking.',
  REQUEST_IN_PROGRESS: 'Your booking is still being saved. Wait a moment and check again.',
  TOO_MANY_FILES: 'You can add up to 3 photos and 1 voice note.',
  FILE_TOO_LARGE: 'That file is too large.',
  FILE_TYPE_NOT_ALLOWED: 'That file type cannot be sent. Use a photo or a voice note.',
  BOOKING_FINISHED: 'This booking is finished, so files can no longer be added.',
  QUOTE_NOT_OPEN: 'This price was already answered.',
  INVALID_TRANSITION: 'This booking has already moved on. Pull down to refresh.',
  COMPLAINT_OPEN: 'You already have an open complaint for this booking.',
  COMPLAINT_WINDOW_CLOSED: 'Complaints can be raised up to 7 days after the work.',
  REVIEW_WINDOW_CLOSED: 'Ratings can be given up to 14 days after the work.',
  NOT_FOUND: 'We could not find this booking.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Call support.',
};

export function errorText(e: unknown, t: (s: string) => string): string {
  const err = e as ApiError;
  const known = err?.code ? ERROR_TEXT[err.code] : undefined;
  if (known) return t(known);
  if (err?.status >= 500) return t('Something went wrong on our side. Try again in a moment.');
  return err?.message ?? t('Something went wrong on our side. Try again in a moment.');
}

/** The support reference shown under an error, so a tester can quote it without sharing personal details. */
export const supportRef = (e: unknown) => (e as ApiError)?.requestId ?? null;
