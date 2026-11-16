// Prints the laptop's addresses on the local network, and the URLs testers type on their phones.
import { networkInterfaces } from 'node:os';

const ips = Object.entries(networkInterfaces())
  .flatMap(([name, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, ip: a.address })))
  .filter(({ ip }) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));

if (ips.length === 0) {
  console.log('No Wi-Fi or LAN address found. Connect the laptop to the same Wi-Fi as the phones and run this again.');
  process.exit(1);
}
for (const { name, ip } of ips) {
  console.log(`\n${name}: ${ip}`);
  console.log(`  Customer app (Khidmat TEST) → Test server: ${ip}`);
  console.log(`  Provider and staff web       → http://${ip}:5173`);
  console.log(`  API health check             → http://${ip}:3000/health`);
}
