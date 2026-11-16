// node --test scripts/test-env.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankAddresses } from './test-env.mjs';

const nic = (address) => [{ family: 'IPv4', internal: false, address }];

test('a typical Windows laptop: Wi-Fi first, Ethernet next, WSL/Hyper-V/VirtualBox last, public and loopback ignored', () => {
  const r = rankAddresses({
    'vEthernet (WSL (Hyper-V firewall))': nic('172.25.160.1'),
    'Ethernet': nic('192.168.0.15'),
    'VirtualBox Host-Only Network': nic('192.168.56.1'),
    'Wi-Fi': nic('192.168.1.20'),
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    'Mobile broadband': nic('100.64.3.9'),
  });
  assert.deepEqual(r.map((a) => a.ip), ['192.168.1.20', '192.168.0.15', '172.25.160.1', '192.168.56.1']);
  assert.equal(r[0].wifi, true);
  assert.deepEqual(r.filter((a) => a.virtual).map((a) => a.ip), ['172.25.160.1', '192.168.56.1']);
});

test('macOS and Linux Wi-Fi names are recognised', () => {
  assert.equal(rankAddresses({ en0: nic('10.0.0.5') })[0].wifi, true);
  assert.equal(rankAddresses({ wlp2s0: nic('192.168.8.4') })[0].wifi, true);
});

test('no private address: nothing to show', () => {
  assert.deepEqual(rankAddresses({ eth0: nic('8.8.8.8') }), []);
});
