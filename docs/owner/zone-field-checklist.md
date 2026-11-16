# Field check for service-zone boundaries

The seeded zones are rough rectangles marked as demo data. Before a zone serves real customers,
someone walks or drives its edge, fixes the boundary in the admin dashboard, and records the check.
A zone cannot be switched on until it is verified, and editing its boundary later pauses it until it
is verified again.

## Before going out

- [ ] Print or open the current zone outline (Admin → Zones → the zone → copy its boundary).
- [ ] Decide what the zone should include: whole sectors, specific streets, or a radius around a market.
- [ ] Note where providers will realistically travel from, and any roads that are slow at peak hours.

## On the ground (per zone)

- [ ] Drive or walk the outer edge; drop a phone GPS pin at every corner and where the edge bends.
- [ ] Record pins as latitude, longitude (6 decimal places) in order, going round the edge one way.
- [ ] Mark gated areas or cantonment land where providers cannot enter, and leave them out of the zone.
- [ ] Note landmarks customers use (mosques, markets, schools, petrol pumps) for the address hints.
- [ ] Note the local names and spellings people use, in English, Urdu and Roman Urdu.
- [ ] Check where this zone meets a neighbouring zone: decide which zone owns the shared streets
      (the one with the higher "precedence" number wins where they overlap).

## Pilot candidate areas

| Zone | Areas | Checked by | Date | Notes |
| --- | --- | --- | --- | --- |
| ISB-G | G-9, G-10, G-11 | | | |
| ISB-F | F-10, F-11 | | | |
| RWP-ST | Satellite Town, Commercial Market | | | |
| RWP-CS3 | Chaklala Scheme III | | | |

## Back in the office

1. Admin → Zones → edit the boundary using the recorded pins (a closed shape; the first pin repeated at the end).
2. Set working hours and any travel charge.
3. Press **Verify** and write who walked it and when (this note is kept in the audit log).
4. Enable the jobs offered there, then switch the zone to **Active**.
5. Test: book from a phone standing just inside and just outside the edge.
