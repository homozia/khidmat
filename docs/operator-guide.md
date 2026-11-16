# Operator guide (pilot)

Staff work in the website at `http://<server>:5173`. Each person sees only the sections for their role. The test accounts are on the role card in `PHONE_TEST_CHECKLIST.md`.

## Daily dispatch (dispatcher)

1. **Dispatch** lists waiting bookings, oldest first. If a booking is marked as needing pin confirmation, the customer chose an area that crosses zones. Call them, then **Confirm pin** before offering.
2. Open a booking to see the eligible providers. Anyone is already left out who:
   - has no approved, unexpired skill;
   - does not cover the area (for drivers, both pickup and destination);
   - is busy for the requested duration (an 8-hour driver booking blocks 8 hours);
   - is at the daily cap or overdue on commission.
3. **Send offer** to the top provider. Offers expire after 10 minutes. When a provider accepts, the server checks everything again. If something changed (licence expired, suspended, another job accepted meanwhile), the offer is withdrawn and the provider sees why. Offer the next one.
4. If nobody can take it, use **No provider available**. The customer is told and can choose another time.

## Locksmith lockouts

- Before booking, the customer sees the occupancy-check rule and the visit charge (PKR 500 by default).
- On site, the locksmith records how occupancy was checked: photo ID with this address, a utility bill, a tenancy agreement, or the guard or a neighbour. Work cannot start, and the job cannot be completed, until a **verified** check is recorded. This also applies to bookings made before M4.1.
- If it cannot be verified, the locksmith records "Could not verify" and calls dispatch. Dispatch opens the booking, chooses **Occupancy could not be verified**, and bills the agreed visit charge. Nothing else can be billed, and the locksmith then completes the job for that amount.
- The same visit-only charge can be used when the customer is absent or refuses access. It is only allowed when the service has a visit charge that the customer saw before booking.

## Money (finance)

- The provider collects the full approved total in cash; any other amount is refused. The customer confirms the cash payment in the app, or it closes automatically after 72 hours.
- Commission (default 8% of labour) is posted once, at completion. The provider sees the total, the amount the fee is charged on, the fee and their earnings.
- **Refunds:** record the amount against its charge type with a reason. The commission is recalculated: labour refunds lower it; materials and reimbursements do not. When you pay the customer back, use **Mark paid** with the method and a reference (required). Until then, the receipt shows the refund as owed.
- Every Monday, close last week's statements. Record each provider payment with its JazzCash, Easypaisa or bank reference; a reference can be used only once.
- Providers who owe over PKR 5,000, or have charges older than 14 days, get no offers until they pay.

## Verification

Review uploaded documents (each view is logged), then approve skills. Restricted skills (driving, electrical, locks, solar) need an **accepted** document chosen as evidence and a future expiry date.

## Setup (services, places, areas)

- **Places:** add districts, cities and localities with Urdu names and Roman Urdu spellings; customers can search them at once.
- **Service areas:** draw or import a zone, verify it on the ground, then activate it.
- **Services and prices:** a new service starts as a draft. Edit its settings and customer questions (including choice questions), set a price, enable it in the zones where it is offered, then activate it. The customer app picks up all of this without an update.
- Pausing a service hides it from new bookings only. Existing bookings keep the terms the customer accepted.
