/** Synthetic accounts in the test server's demo data, with what each role can do. Shown only on a sandbox server. */
export const ROLE_CARD: { phone: string; who: string; where: 'app' | 'web'; can: string }[] = [
  { phone: '0300 1110001', who: 'Usman, customer (Islamabad, G-10)', where: 'app', can: 'Book, approve prices, confirm cash, rate, complain, cancel' },
  { phone: '0300 1110002', who: 'Hina, customer (Rawalpindi, Satellite Town)', where: 'app', can: 'Same as Usman; use for driver bookings' },
  { phone: '0300 2220001', who: 'Asif, plumber (G and F sectors)', where: 'web', can: 'Accept offers, update status, send prices, record cash, see earnings' },
  { phone: '0300 2220005', who: 'Imran, plumber (Rawalpindi)', where: 'web', can: 'Same as Asif, Rawalpindi zones' },
  { phone: '0300 2220003', who: 'Tariq, driver (Satellite Town and G sectors)', where: 'web', can: 'Driver jobs; overlapping bookings are refused' },
  { phone: '0300 2220006', who: 'Rashid, licensed locksmith', where: 'web', can: 'Lockouts: must record the occupancy check before work' },
  { phone: '0300 2220004', who: 'Zahid, locksmith (skill pending)', where: 'web', can: 'Gets no lockout offers until verification approves him' },
  { phone: '0300 2220002', who: 'Naveed, electrician (skill pending)', where: 'web', can: 'Gets no offers until verification approves him' },
  { phone: '0300 0000002', who: 'Bilal, dispatcher', where: 'web', can: 'Dispatch, bookings, reassign, cancel, visit charge, complaints' },
  { phone: '0300 0000003', who: 'Fatima, finance', where: 'web', can: 'Refunds (mark paid), settlements, statements, reports' },
  { phone: '0300 0000005', who: 'Sana, verification', where: 'web', can: 'Review documents, approve skills, approve or suspend providers' },
  { phone: '0300 0000004', who: 'Kamran, setup', where: 'web', can: 'Services, prices, places, skills, service areas' },
  { phone: '0300 0000001', who: 'Ayesha, super admin', where: 'web', can: 'Everything staff can do' },
];
