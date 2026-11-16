# Operator guide (pilot, Milestone 2 scope)

Until the admin web app ships (Milestone 3) these tasks run through the API (see `docs/api.md`).

## Daily dispatch

1. Open the queue (`GET /v1/admin/dispatch/queue`). Oldest first; `needs_location_confirmation = true`
   means the customer chose an area without a pin that straddles zones: call them, then
   `confirm-location` with the right pin before offering.
2. For each booking, list eligible providers. The list already excludes anyone without an approved,
   unexpired skill, outside the zone (pickup and destination for drivers), busy at that time, at the
   daily cap, or overdue on commission.
3. Send an offer to the top provider. If it expires (10 minutes) or is declined, offer the next.
   If nobody accepts within 30 minutes for a same-day job, call the customer and offer another slot.

## Locksmith lockouts

The customer must tick "I live here or am authorised". On site the locksmith checks photo ID against
the address (utility bill, tenancy, or guard/neighbour confirmation) and records a photo before
opening. If it cannot be verified, the locksmith stops and calls dispatch.

## Money

- The provider collects the full approved total in cash. The app refuses a different amount.
- Commission (default 8% of retained labour) is posted automatically at completion, once.
- Refunds: finance records the refunded amount against its charge type with a reason; the system
  recomputes the commission and posts the difference. Materials and reimbursement refunds do not change it.
- Every Monday, close last week (`statements/close` with that Monday's date). Statements are snapshots;
  the ledger stays the source of truth.
- Record each provider payment with its JazzCash/Easypaisa/bank reference. A reference can be used once.
- Providers whose unpaid balance is over PKR 5,000, or who have charges older than 14 days still unpaid,
  stop receiving offers until they settle.

## Changing the catalogue

Create the job (it starts as a draft), enable it in the zones where it is offered, then set it active.
Pausing a job hides it from new bookings only; existing bookings keep the terms they were booked on.
