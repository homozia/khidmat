/**
 * Booking state machine. The server refuses any transition not listed here.
 * Actor 'system' means the transition happens as a side effect of another action
 * (an offer accepted, a quote approved, an auto-close job).
 */

export const BOOKING_STATUSES = [
  'requested', 'assigned', 'en_route', 'on_site', 'awaiting_approval',
  'in_progress', 'completed', 'closed', 'cancelled', 'no_provider',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type Actor = 'customer' | 'provider' | 'dispatcher' | 'system';

const T: Record<BookingStatus, Partial<Record<BookingStatus, Actor[]>>> = {
  requested: { assigned: ['system'], no_provider: ['dispatcher', 'system'], cancelled: ['customer', 'dispatcher'] },
  assigned: { en_route: ['provider'], awaiting_approval: ['provider'], requested: ['dispatcher'], cancelled: ['customer', 'dispatcher'] },
  en_route: { on_site: ['provider'], requested: ['dispatcher'], cancelled: ['customer', 'dispatcher'] },
  on_site: { in_progress: ['provider'], awaiting_approval: ['provider'], completed: ['provider'] },
  awaiting_approval: {
    // Approve/decline returns the booking to where it was (resume_status).
    assigned: ['system'], en_route: ['system'], on_site: ['system'], in_progress: ['system'],
    cancelled: ['dispatcher'],
  },
  in_progress: { awaiting_approval: ['provider'], completed: ['provider'] },
  completed: { closed: ['customer', 'system'] },
  closed: {},
  cancelled: {},
  no_provider: { requested: ['dispatcher'], cancelled: ['customer', 'dispatcher'] },
};

export function canTransition(from: BookingStatus, to: BookingStatus, actor: Actor): boolean {
  return T[from]?.[to]?.includes(actor) ?? false;
}

export function allowedTargets(from: BookingStatus, actor: Actor): BookingStatus[] {
  return (Object.entries(T[from] ?? {}) as [BookingStatus, Actor[]][])
    .filter(([, actors]) => actors.includes(actor))
    .map(([to]) => to);
}

/** Statuses in which a provider is actively holding the booking. */
export const ACTIVE_PROVIDER_STATUSES: BookingStatus[] = ['assigned', 'en_route', 'on_site', 'awaiting_approval', 'in_progress'];
