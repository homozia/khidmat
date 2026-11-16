#!/usr/bin/env node
// Khidmat local test environment: one command to start, one to stop. Works on Windows, macOS and Linux.
//   node scripts/test-env.mjs start    database (Docker) → migrations → test data if empty → API → website → addresses
//   node scripts/test-env.mjs stop     stops the API, the website and the database container (data is kept)
//   node scripts/test-env.mjs status   shows what is running and the addresses again
//   node scripts/test-env.mjs reset    erases the test data and loads it fresh (asks first)
// Windows: use start-test-env.ps1 / stop-test-env.ps1 / reset-test-data.ps1, which call this script.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, '.khidmat');
const PIDS = path.join(STATE, 'pids.json');
const WIN = process.platform === 'win32';
const API_PORT = 3000;
const WEB_PORT = 5173;

const say = (s = '') => console.log(s);
const step = (n, total, s) => console.log(`\n[${n}/${total}] ${s}`);
const ok = (s) => console.log(`      OK  ${s}`);
function fail(problem, ...fixes) {
  console.error(`\n  PROBLEM: ${problem}`);
  for (const f of fixes) console.error(`  - ${f}`);
  console.error(`\n  Logs: ${path.join(STATE, 'logs')}`);
  process.exit(1);
}

function readEnv() {
  const f = path.join(ROOT, '.env');
  if (!existsSync(f)) return {};
  return Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: WIN, ...opts });
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

async function health(url, ms = 3000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return await r.json();
  } catch { return null; }
}

async function waitFor(fn, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Private network addresses, Wi-Fi-looking adapters first, virtual adapters (WSL, Docker, VPN) last. */
export function rankAddresses(interfaces) {
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const looksVirtual = (n) => /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth|virbr|Loopback|Bluetooth|tailscale|ZeroTier/i.test(n);
  const looksWifi = (n) => /wi-?fi|wlan|wireless|wl[a-z0-9]+|^en0$/i.test(n);
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal && isPrivate(a.address)).map((a) => ({ name, ip: a.address })))
    .map((a) => ({ ...a, wifi: looksWifi(a.name), virtual: looksVirtual(a.name) }))
    .sort((a, b) => Number(a.virtual) - Number(b.virtual) || Number(b.wifi) - Number(a.wifi));
}
export const lanAddresses = () => rankAddresses(networkInterfaces());

function printAddresses() {
  const all = lanAddresses();
  const real = all.filter((a) => !a.virtual);
  say('\n================================================================');
  say(' Khidmat test environment is running');
  say('================================================================');
  say(`\n On this laptop:  website http://localhost:${WEB_PORT}   API health http://localhost:${API_PORT}/health`);
  if (real.length === 0) {
    say('\n No Wi-Fi or network address found, so phones cannot connect yet.');
    say(' Connect the laptop to the same Wi-Fi as the phone, then run the start command again.');
  }
  real.forEach((a, i) => {
    say(`\n ${i === 0 ? 'USE THIS ONE' : 'Other address'} - adapter "${a.name}"${a.wifi ? ' (Wi-Fi)' : ''}`);
    say(`   Phone app (Khidmat TEST > Test server):  ${a.ip}`);
    say(`   Provider and staff website on a phone:   http://${a.ip}:${WEB_PORT}`);
    say(`   Health check (open in the phone browser): http://${a.ip}:${API_PORT}/health`);
  });
  if (real.length > 1) {
    say('\n More than one address: use the one on the adapter connected to the same Wi-Fi as the phone.');
    say(' Windows: Settings > Network & internet > Wi-Fi > (your network) > Properties shows the IPv4 address.');
  }
  if (all.some((a) => a.virtual)) say(` (Ignored virtual adapters: ${all.filter((a) => a.virtual).map((a) => a.ip).join(', ')})`);
  say('\n If the phone cannot connect:');
  say('  1. Phone and laptop on the SAME Wi-Fi. Guest networks and some office networks block devices from');
  say('     reaching each other ("client isolation"). Try the laptop\'s or another phone\'s hotspot instead.');
  say('  2. Open the health check address in the phone browser. If it does not load, it is the network or the');
  say('     firewall: when Windows asks about Node.js, allow "Private networks". To add the rule yourself,');
  say(`     run in an Administrator PowerShell:  netsh advfirewall firewall add rule name="Khidmat test" dir=in action=allow protocol=TCP localport=${API_PORT},${WEB_PORT} profile=private`);
  say('  3. Make sure the Wi-Fi network is set to "Private" on Windows, not "Public".');
  say('  4. The laptop address can change after a restart or on another network: run start again and use the new one.');
  say('\n Test sign-in code: 123456. Role card: PHONE_TEST_CHECKLIST.md');
  say(` Stop everything: ${WIN ? '.\\stop-test-env.ps1' : 'node scripts/test-env.mjs stop'}   (your test data is kept)`);
  say('================================================================\n');
}

function savePids(p) { mkdirSync(STATE, { recursive: true }); writeFileSync(PIDS, JSON.stringify(p)); }
function loadPids() { try { return JSON.parse(readFileSync(PIDS, 'utf8')); } catch { return {}; } }

function startDetached(name, cmd, args, cwd) {
  const logs = path.join(STATE, 'logs');
  mkdirSync(logs, { recursive: true });
  const out = openSync(path.join(logs, `${name}.log`), 'a');
  const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env } });
  child.unref();
  return child.pid;
}

function killPid(pid) {
  if (!pid) return;
  try {
    if (WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ } }
}

async function start() {
  const TOTAL = 7;
  say('Starting the Khidmat test environment. This takes about a minute the first time.');

  step(1, TOTAL, 'Checking Node.js and settings');
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 18)) fail(`Node.js ${process.versions.node} is too old.`, 'Install Node.js 22 LTS (22.18 or newer) from https://nodejs.org, close this window, open a new one and try again.');
  if (!existsSync(path.join(ROOT, '.env'))) { copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env')); ok('Created .env with the test settings'); }
  const env = readEnv();
  if (env.APP_ENV && !['development', 'test'].includes(env.APP_ENV)) fail(`.env says APP_ENV=${env.APP_ENV}.`, 'This command is for the local test environment only. Use APP_ENV=development.');
  ok(`Node.js ${process.versions.node}`);

  step(2, TOTAL, 'Installing packages (first time only)');
  if (!existsSync(path.join(ROOT, 'node_modules', '.package-lock.json'))) {
    const r = run('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'inherit' });
    if (r.status !== 0) fail('Installing packages failed.', 'Check the internet connection and run the start command again.');
  }
  ok('Packages installed');

  step(3, TOTAL, 'Starting the database (PostgreSQL + PostGIS in Docker)');
  if (process.env.KHIDMAT_NO_DOCKER === '1') {
    ok('Skipping Docker (KHIDMAT_NO_DOCKER=1): using DATABASE_URL from .env');
  } else {
    if (run('docker', ['--version']).status !== 0) {
      fail('Docker is not installed (or not on the PATH).', 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and restart the laptop.',
        'Advanced: to use your own PostgreSQL 16 + PostGIS instead, set DATABASE_URL in .env and run with KHIDMAT_NO_DOCKER=1.');
    }
    if (run('docker', ['info']).status !== 0) {
      fail('Docker Desktop is installed but not running.', 'Open Docker Desktop and wait until it says "Engine running", then run the start command again.');
    }
    const up = run('docker', ['compose', 'up', '-d', '--wait', 'db']);
    if (up.status !== 0) {
      const msg = `${up.stdout}\n${up.stderr}`;
      if (/port is already allocated|address already in use|bind/i.test(msg)) {
        fail('Port 5432 is already used by another database on this laptop.', 'Stop the other PostgreSQL (Windows: Services > postgresql > Stop), then run the start command again.');
      }
      fail('The database container did not start.', msg.trim().split('\n').slice(-3).join(' '), 'Try: open Docker Desktop > Troubleshoot > Restart, then run the start command again.');
    }
    ok('Database container is up');
  }

  step(4, TOTAL, 'Preparing the database (your existing test data is kept)');
  const init = run(process.execPath, ['--env-file-if-exists=../../.env', 'scripts/init.ts'], { cwd: path.join(ROOT, 'apps/api'), shell: false });
  if (init.status !== 0) {
    fail('Could not prepare the database.', (init.stderr || init.stdout).trim().split('\n').slice(-2).join(' '),
      'If the database was just started, wait 10 seconds and run the start command again.');
  }
  for (const line of init.stdout.trim().split('\n')) ok(line);

  step(5, TOTAL, 'Building the provider and staff website');
  const build = run(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], { cwd: path.join(ROOT, 'apps/web'), shell: false });
  if (build.status !== 0) fail('Building the website failed.', build.stderr.trim().split('\n').slice(-3).join(' '));
  ok('Website built');

  step(6, TOTAL, 'Starting the API and the website');
  const pids = loadPids();
  const running = await health(`http://127.0.0.1:${API_PORT}/health`);
  if (running?.app && pids.api) {
    ok(`API already running (process ${pids.api})`);
  } else {
    if (!(await portFree(API_PORT))) fail(`Port ${API_PORT} is used by another program.`, 'Close the other program (or a previous test server window), or restart the laptop, then run the start command again.');
    pids.api = startDetached('api', process.execPath, ['--env-file-if-exists=../../.env', 'src/index.ts'], path.join(ROOT, 'apps/api'));
  }
  const webUp = await health(`http://127.0.0.1:${WEB_PORT}/health`);
  if (webUp?.app && pids.web) {
    ok(`Website already running (process ${pids.web})`);
  } else {
    if (!(await portFree(WEB_PORT))) fail(`Port ${WEB_PORT} is used by another program.`, 'Close the other program, then run the start command again.');
    pids.web = startDetached('web', process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '0.0.0.0', '--port', String(WEB_PORT), '--strictPort'], path.join(ROOT, 'apps/web'));
  }
  savePids(pids);

  step(7, TOTAL, 'Checking that everything answers');
  const api = await waitFor(() => health(`http://127.0.0.1:${API_PORT}/health`), 40);
  if (!api?.ok) fail('The API did not start.', `Look at the end of ${path.join(STATE, 'logs', 'api.log')}.`, 'Run the stop command, then the start command again.');
  ok(`API: ${api.app}, ${api.env}, test codes ${api.sandbox_sms ? 'on' : 'off'}`);
  const web = await waitFor(() => health(`http://127.0.0.1:${WEB_PORT}/health`), 30);
  if (!web?.ok) fail('The website did not start.', `Look at the end of ${path.join(STATE, 'logs', 'web.log')}.`);
  ok('Website answers and reaches the API');
  printAddresses();
}

async function stop() {
  const pids = loadPids();
  say('Stopping the Khidmat test environment (your test data is kept).');
  killPid(pids.api); killPid(pids.web);
  if (pids.api || pids.web) say('  OK  API and website stopped');
  rmSync(PIDS, { force: true });
  if (process.env.KHIDMAT_NO_DOCKER !== '1' && run('docker', ['--version']).status === 0 && run('docker', ['info']).status === 0) {
    run('docker', ['compose', 'stop', 'db']);
    say('  OK  Database container stopped (data kept; start brings it back)');
  }
  say('Done.');
}

async function status() {
  const api = await health(`http://127.0.0.1:${API_PORT}/health`);
  const web = await health(`http://127.0.0.1:${WEB_PORT}/health`);
  say(`API:     ${api?.ok ? 'running' : 'not running'}`);
  say(`Website: ${web?.ok ? 'running' : 'not running'}`);
  if (api?.ok) printAddresses();
}

async function reset() {
  say('This ERASES all test bookings, files, refunds and ledger entries and loads fresh test data.');
  const r = spawnSync(process.execPath, ['--env-file-if-exists=../../.env', 'scripts/reset.ts'], { cwd: path.join(ROOT, 'apps/api'), stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const cmd = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('test-env.mjs')) {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'status') await status();
  else if (cmd === 'reset') await reset();
  else { say('Usage: node scripts/test-env.mjs start | stop | status | reset'); process.exit(1); }
}
