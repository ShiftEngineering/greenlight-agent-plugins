#!/usr/bin/env node
// @greenlight-spec: 14-local-development.md
// @greenlight-spec: 29-app-environment-variables.md
// @greenlight-spec: decisions/0022-local-dev-credential-policy-cli-exploration.md
//
// The paired `greenlight` CLI — a dependency-free, single-file Node script
// bundled in the agent plugin (ADR-0022 §4); it is copied byte-for-byte into a
// customer's marketplace, so it imports nothing outside the Node stdlib.
//
// Surface is local-dev only: `login` (pair over the agent's MCP session),
// `run` (resolve the app's env contract and inject it into a child process —
// no file on disk, no local server), `whoami`, `logout`. It never deploys or
// mutates infra/env. Secret values reach the laptop only here, over TLS, never
// through MCP.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

const KEYCHAIN_SERVICE = 'greenlight-cli';
const KEYCHAIN_ACCOUNT = 'session-token';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
// setTimeout overflows past ~24.8 days; clamp the restart-on-expiry timer.
const MAX_TIMER_MS = 2_147_483_647;

class CliError extends Error {}

// ── Config ──────────────────────────────────────────────────────────────────

// The control-plane MCP URL — the one customer-specific value in the plugin.
// The marketplace-zero default is the Shift dogfood host; when the plugin is
// rendered per customer, the generator (T-057, packages/plugin-generators)
// rewrites this exact string the same way it rewrites the URL in `.mcp.json`.
// Keep it a plain single-line literal so that raw-string swap stays unambiguous;
// do NOT locate it via `import.meta.url` / sibling files — the value is baked in.
const BUNDLED_MCP_URL = 'https://dev.greenlight.shifthq.ai/mcp';

/**
 * The control-plane API base. `GREENLIGHT_API_URL` overrides (tests, CI, cloud
 * agents); otherwise the baked {@link BUNDLED_MCP_URL} is used. The CLI's
 * `/api/cli/*` REST endpoints share an origin with `/mcp`, so a trailing `/mcp`
 * is dropped.
 */
function resolveApiBase() {
  const base = process.env['GREENLIGHT_API_URL'] ?? BUNDLED_MCP_URL;
  return base.replace(/\/+$/, '').replace(/\/mcp$/, '');
}

/** Read `app_id` from greenlight.yml in `cwd` or the nearest ancestor. */
function readAppId(cwd) {
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    try {
      const text = readFileSync(join(dir, 'greenlight.yml'), 'utf8');
      const match = text.match(/^app_id:\s*["']?([^"'\s#]+)/m);
      if (match) return match[1];
      throw new CliError('greenlight.yml has no app_id. Register the app first.');
    } catch (err) {
      if (err instanceof CliError) throw err;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError(
    'No greenlight.yml found in this directory or its parents. Run from your app repo.',
  );
}

// ── HTTP ──────────────────────────────────────────────────────────────────--

/** Minimal JSON request over http/https. Resolves `{ status, body }`. */
function jsonRequest(method, url, { token, body } = {}) {
  const u = new URL(url);
  const transport = u.protocol === 'http:' ? httpRequest : httpsRequest;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = { accept: 'application/json' };
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  if (token) headers['authorization'] = `Bearer ${token}`;
  return new Promise((resolvePromise, reject) => {
    const req = transport(u, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = { raw: text };
        }
        resolvePromise({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Keychain ─────────────────────────────────────────────────────────────--
//
// macOS Keychain (`security`) on Darwin; a 0600 file under ~/.greenlight
// elsewhere. `GREENLIGHT_CLI_TOKEN` overrides for CI / cloud agents and wins on
// read. (Linux Secret Service / Windows Credential Manager are a follow-up; the
// 0600 file keeps those platforms functional in the meantime.)

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const fallbackPath = () => join(homedir(), '.greenlight', 'cli-session.json');

function readFallback(apiBase) {
  try {
    return JSON.parse(readFileSync(fallbackPath(), 'utf8'))[apiBase];
  } catch {
    return undefined;
  }
}

function loadToken(apiBase) {
  if (process.env['GREENLIGHT_CLI_TOKEN']) return process.env['GREENLIGHT_CLI_TOKEN'];
  if (platform() === 'darwin') {
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', accountFor(apiBase), '-w'],
      { encoding: 'utf8' },
    );
    if (r.status === 0) return r.stdout.trim();
  }
  return readFallback(apiBase);
}

function saveToken(apiBase, token) {
  if (platform() === 'darwin') {
    const r = spawnSync('security', [
      'add-generic-password',
      '-U', // update if it already exists
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      accountFor(apiBase),
      '-w',
      token,
    ]);
    if (r.status === 0) return;
  }
  const path = fallbackPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let store = {};
  try {
    store = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // first write
  }
  store[apiBase] = token;
  writeFileSync(path, JSON.stringify(store), { mode: 0o600 });
}

function deleteToken(apiBase) {
  if (platform() === 'darwin') {
    spawnSync('security', [
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      accountFor(apiBase),
    ]);
  }
  try {
    const path = fallbackPath();
    const store = JSON.parse(readFileSync(path, 'utf8'));
    delete store[apiBase];
    writeFileSync(path, JSON.stringify(store), { mode: 0o600 });
  } catch {
    // nothing stored
  }
}

// One keychain entry per control plane, so multiple installs don't clobber.
const accountFor = (apiBase) => `${KEYCHAIN_ACCOUNT}:${sha256(apiBase).slice(0, 16)}`;

// ── Startup summary ─────────────────────────────────────────────────────────

const INTEGRATION_LABEL = {
  live_raw: 'live (raw, injected)',
  fixtures_policy_off: 'fixtures (local dev off)',
  fixtures_proxied: 'fixtures (proxied — needs T-893)',
  fixtures_user_delegated: 'fixtures (user-delegated)',
};
const RESOURCE_LABEL = {
  live_sas: 'live (short-TTL SAS)',
  fixtures_inspect: 'fixtures + inspectAppDb',
  pending: 'pending (provisioning)',
};

/** Per-dependency local-status lines — names and modes only, never values. */
function formatSummary(contract) {
  const lines = [];
  for (const i of contract.integrations ?? []) {
    lines.push(`  ${i.integration}: ${INTEGRATION_LABEL[i.local] ?? i.local}`);
  }
  for (const r of contract.resources ?? []) {
    lines.push(`  ${r.kind}: ${RESOURCE_LABEL[r.local] ?? r.local}`);
  }
  return lines;
}

// ── Commands ────────────────────────────────────────────────────────────────

function genPairingCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no ambiguous chars
  const pick = () => Array.from(randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return `GL-${pick()}-${pick()}`;
}

async function cmdLogin(apiBase) {
  const code = genPairingCode();
  const created = await jsonRequest('POST', `${apiBase}/api/cli/sessions`, {
    body: { pairing_code_hash: sha256(code) },
  });
  if (created.status !== 201) {
    throw new CliError(`Could not start pairing (HTTP ${created.status}).`);
  }
  const sessionId = created.body.session_id;
  process.stdout.write(
    `\nPairing code: ${code}\n\n` +
      'Approve it from your agent (it is already signed in to Greenlight):\n' +
      `  approveCliSession({ code: "${code}" })\n\n` +
      'Waiting for approval…\n',
  );

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const polled = await jsonRequest('GET', `${apiBase}/api/cli/sessions/${sessionId}`);
    const status = polled.body?.status;
    if (status === 'active' && polled.body.session_token) {
      saveToken(apiBase, polled.body.session_token);
      process.stdout.write('Paired. The CLI session is stored in your OS keychain.\n');
      return;
    }
    if (status === 'expired' || status === 'revoked') {
      throw new CliError('Pairing was not approved in time. Run `greenlight login` again.');
    }
    if (Date.now() > deadline) {
      throw new CliError('Timed out waiting for approval. Run `greenlight login` again.');
    }
  }
}

async function cmdRun(apiBase, devCommand) {
  if (devCommand.length === 0) {
    throw new CliError('Usage: greenlight run -- <command> [args…]');
  }
  const token = requireToken(apiBase);
  const appId = readAppId(process.cwd());

  const res = await jsonRequest('POST', `${apiBase}/api/cli/run-context`, {
    token,
    body: { app_id: appId },
  });
  if (res.status === 401) {
    throw new CliError('CLI session expired or revoked. Re-pair with `greenlight login`.');
  }
  if (res.status === 403) {
    throw new CliError(
      'This CLI session is not scoped to this app. Re-pair from an owner/co-owner.',
    );
  }
  if (res.status !== 200) {
    const msg = res.body?.message ?? `HTTP ${res.status}`;
    throw new CliError(`Could not resolve the run contract: ${msg}`);
  }
  const contract = res.body;

  process.stdout.write(`\ngreenlight run — ${contract.app_slug} (local)\n`);
  for (const line of formatSummary(contract)) process.stdout.write(`${line}\n`);
  process.stdout.write(`Credentials valid until ${contract.expires_at}.\n\n`);

  return spawnChild(devCommand, contract);
}

/** Spawn the dev command with the resolved contract injected — no file on disk. */
function spawnChild(devCommand, contract) {
  const [cmd, ...args] = devCommand;
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...contract.env },
    // On Windows the dev command is usually a `.cmd`/`.bat` shim (`npm`, `pnpm`,
    // `next`), which `spawn` can't resolve without a shell; on POSIX we exec
    // directly so signal forwarding stays exact. The command is the developer's
    // own argv after `--`, so the shell is not a new trust boundary.
    shell: process.platform === 'win32',
  });

  const restartTimer = scheduleExpiryNotice(contract.expires_at, () => child.killed === false);
  const forward = (sig) => () => child.kill(sig);
  const onSigint = forward('SIGINT');
  const onSigterm = forward('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  return new Promise((resolvePromise, reject) => {
    child.on('error', (err) => {
      cleanup();
      reject(new CliError(`Failed to start \`${cmd}\`: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolvePromise(signal ? 1 : (code ?? 0));
    });
    function cleanup() {
      if (restartTimer) clearTimeout(restartTimer);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
  });
}

/**
 * MVP is restart-on-expiry: env injection can't refresh a live child, so when
 * the startup-minted SAS / token deadline passes we surface an actionable
 * message rather than silently running with dead credentials (AC-CLIRUN-06).
 */
function scheduleExpiryNotice(expiresAt, stillRunning) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMER_MS) return null;
  const timer = setTimeout(() => {
    if (stillRunning()) {
      process.stderr.write(
        '\n[greenlight] Local credentials have expired. Proxy/blob calls will start failing — ' +
          'restart `greenlight run` to mint fresh ones.\n',
      );
    }
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function cmdWhoami(apiBase) {
  const token = requireToken(apiBase);
  const res = await jsonRequest('GET', `${apiBase}/api/cli/whoami`, { token });
  if (res.status === 401) {
    throw new CliError('CLI session expired or revoked. Re-pair with `greenlight login`.');
  }
  if (res.status !== 200) throw new CliError(`whoami failed (HTTP ${res.status}).`);
  process.stdout.write(
    `${res.body.user_email}\n` +
      `  org: ${res.body.org_id}\n` +
      `  apps in scope: ${res.body.app_scope.length}\n` +
      `  session expires: ${res.body.expires_at}\n`,
  );
}

function cmdLogout(apiBase) {
  deleteToken(apiBase);
  process.stdout.write('Logged out — the CLI session credential was removed from this machine.\n');
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function requireToken(apiBase) {
  const token = loadToken(apiBase);
  if (!token) {
    throw new CliError('No paired CLI session. Run `greenlight login` first.');
  }
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Split argv into a command and, for `run`, the dev command after `--`. */
function parseArgs(argv) {
  const command = argv[0];
  const sep = argv.indexOf('--');
  const rest = sep === -1 ? argv.slice(1) : argv.slice(sep + 1);
  return { command, rest };
}

async function main(argv) {
  const { command, rest } = parseArgs(argv);
  // Usage needs no control-plane config; only the real commands resolve it.
  if (command !== 'login' && command !== 'run' && command !== 'whoami' && command !== 'logout') {
    process.stdout.write('Usage: greenlight <login|run -- <cmd>|whoami|logout>\n');
    return command === undefined || command === 'help' ? 0 : 1;
  }
  const apiBase = resolveApiBase();
  switch (command) {
    case 'login':
      return cmdLogin(apiBase).then(() => 0);
    case 'run':
      return cmdRun(apiBase, rest);
    case 'whoami':
      return cmdWhoami(apiBase).then(() => 0);
    default:
      cmdLogout(apiBase);
      return 0;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      process.stderr.write(`${err instanceof CliError ? err.message : (err?.stack ?? err)}\n`);
      process.exit(1);
    });
}

export {
  parseArgs,
  readAppId,
  resolveApiBase,
  formatSummary,
  genPairingCode,
  accountFor,
  scheduleExpiryNotice,
};
