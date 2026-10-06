// Self-sufficient CDP bootstrap: when the Holst desktop app is not running
// with --remote-debugging-port, the MCP server launches it itself.
// This is a JS port of bin/start-holst.sh so MCP consumers never need
// repo files, scripts or paths.

import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const MAC_APP = '/Applications/Holst.app/Contents/MacOS/Holst';

export function cdpPort() {
  const v = Number(process.env.HOLST_DEBUG_PORT);
  return Number.isFinite(v) && v > 0 && v < 65536 ? v : 9222;
}

/**
 * HOLST_AUTO_START: default ON (opt-out with 0/false/off/no).
 */
export function autoStartEnabled() {
  const v = (process.env.HOLST_AUTO_START ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/**
 * Parse `lsof -nP -iTCP:<port> -sTCP:LISTEN` output → unique COMMAND names.
 */
export function parsePortOwners(lsofOutput) {
  const owners = [];
  for (const line of String(lsofOutput).split('\n').slice(1)) {
    const cmd = line.trim().split(/\s+/)[0];
    if (cmd && !owners.includes(cmd)) owners.push(cmd);
  }
  return owners;
}

async function portOwners(port) {
  try {
    const { stdout } = await execFileP('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
    return parsePortOwners(stdout);
  } catch {
    return []; // lsof exits non-zero when nothing listens
  }
}

function probePort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function waitForPort(port, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let inflight = null;

/**
 * Make sure the CDP endpoint on 127.0.0.1:<port> is reachable.
 * - If already up → no-op.
 * - If held by a non-Holst process → refuse (possible CDP spoofing).
 * - If down and auto-start enabled → launch Holst with the debug flag
 *   (detached, logs to ~/Library/Logs/holst-mcp/) and wait for the port.
 * - If down and auto-start disabled → actionable error.
 * Concurrent calls share one launch attempt.
 */
export async function ensureCdp() {
  if (inflight) return inflight;
  inflight = (async () => {
    const port = cdpPort();

    const owners = await portOwners(port);
    if (owners.length && !owners.includes('Holst')) {
      throw new Error(
        `Port :${port} is held by a non-Holst process (${owners.join(', ')}). ` +
        'Possible CDP spoofing — refusing to continue. Free the port or set HOLST_DEBUG_PORT.'
      );
    }

    if (await probePort(port)) return { started: false, port };

    if (!autoStartEnabled()) {
      throw new Error(
        `Holst desktop is not running with --remote-debugging-port=${port} and HOLST_AUTO_START is disabled. ` +
        'Launch Holst with the debug flag or set HOLST_AUTO_START=1.'
      );
    }

    if (!fs.existsSync(MAC_APP)) {
      throw new Error(
        `Holst.app is not installed at ${MAC_APP}. Install it from https://holst.so/download, ` +
        'launch it, log in, then retry.'
      );
    }

    const logDir = path.join(os.homedir(), 'Library', 'Logs', 'holst-mcp');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'autostart.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn(MAC_APP, [`--remote-debugging-port=${port}`], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();

    if (!(await waitForPort(port))) {
      throw new Error(
        `Launched Holst but CDP port :${port} did not open within 25s. ` +
        `Check the app (is the user logged in?) and logs: ${logFile}`
      );
    }
    return { started: true, port };
  })().finally(() => { inflight = null; });
  return inflight;
}
