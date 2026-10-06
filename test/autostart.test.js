import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  cdpPort,
  autoStartEnabled,
  parsePortOwners,
  ensureCdp,
} from '../src/autostart.js';

describe('cdpPort', () => {
  test('defaults to 9222', () => {
    delete process.env.HOLST_DEBUG_PORT;
    assert.equal(cdpPort(), 9222);
  });

  test('honors HOLST_DEBUG_PORT', () => {
    process.env.HOLST_DEBUG_PORT = '9333';
    assert.equal(cdpPort(), 9333);
  });

  test('ignores garbage values', () => {
    process.env.HOLST_DEBUG_PORT = 'not-a-port';
    assert.equal(cdpPort(), 9222);
  });
});

describe('autoStartEnabled (default ON)', () => {
  afterEach(() => delete process.env.HOLST_AUTO_START);

  test('enabled by default', () => {
    delete process.env.HOLST_AUTO_START;
    assert.equal(autoStartEnabled(), true);
  });

  test('disabled by 0/false/off/no', () => {
    for (const v of ['0', 'false', 'off', 'no', 'FALSE']) {
      process.env.HOLST_AUTO_START = v;
      assert.equal(autoStartEnabled(), false, v);
    }
  });

  test('enabled by 1/true/anything else', () => {
    for (const v of ['1', 'true', 'yes']) {
      process.env.HOLST_AUTO_START = v;
      assert.equal(autoStartEnabled(), true, v);
    }
  });
});

describe('parsePortOwners', () => {
  test('extracts unique command names, skips header', () => {
    const lsof = `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
Holst    12345  me   24u  IPv4  0x123      0t0  TCP 127.0.0.1:9222 (LISTEN)
Holst    12345  me   25u  IPv4  0x124      0t0  TCP 127.0.0.1:9222 (LISTEN)
Python   999    me   10u  IPv4  0x125      0t0  TCP *:9222 (LISTEN)`;
    assert.deepEqual(parsePortOwners(lsof), ['Holst', 'Python']);
  });

  test('empty output → empty array', () => {
    assert.deepEqual(parsePortOwners(''), []);
  });
});

describe('ensureCdp guards', () => {
  afterEach(() => delete process.env.HOLST_AUTO_START);

  test('refuses when a non-Holst process holds the port (anti-spoofing)', async () => {
    const srv = net.createServer(() => {});
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const port = srv.address().port;
    process.env.HOLST_AUTO_START = '1';
    process.env.HOLST_DEBUG_PORT = String(port);
    await assert.rejects(
      () => ensureCdp(),
      /not Holst|spoof/i
    );
    delete process.env.HOLST_DEBUG_PORT;
    srv.close();
  });

  test('clear error when auto-start disabled and port is down', async () => {
    const srv = net.createServer(() => {});
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const port = srv.address().port; // port busy would spoof-check first — use a FREE port instead
    srv.close();
    await new Promise((res) => srv.on('close', res));
    process.env.HOLST_AUTO_START = '0';
    process.env.HOLST_DEBUG_PORT = String(port);
    await assert.rejects(
      () => ensureCdp(),
      /HOLST_AUTO_START/i
    );
    delete process.env.HOLST_DEBUG_PORT;
  });
});
