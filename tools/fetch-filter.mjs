#!/usr/bin/env node
/*
 * fetch-filter.mjs — download + verify the pinned dnscrypt-proxy build.
 *
 * The static ARM binary is NOT committed (it is a release artifact, not
 * source); local builds and CI fetch it here. BOTH the release archive and
 * the extracted binary are verified against pinned sha256 constants before
 * the binary is placed at app/filter/dnscrypt-proxy (chmod 755).
 *
 * Bump VERSION and both hashes together — deliberately, in one commit.
 * Cache-friendly: a destination that already matches the pin short-circuits;
 * a valid cached archive skips the download.
 *
 * Usage: node tools/fetch-filter.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- pinned constants ----
const VERSION = '2.1.18';
const ARCHIVE_NAME = 'dnscrypt-proxy-linux_arm-' + VERSION + '.tar.gz';
const RELEASE_URL =
  'https://github.com/DNSCrypt/dnscrypt-proxy/releases/download/' + VERSION + '/' + ARCHIVE_NAME;
const ARCHIVE_SHA256 = 'f5bb0ce9c168b4afc6d7babe71462599d5bd15903931a67a44fb86e1f90a44e6';
const BIN_SHA256 = 'c5af4b287084d82fbf7cefa6833cdf865efe12e4286b56b9ceaf46de310007f7';
const ARCHIVE_MEMBER = 'linux-arm/dnscrypt-proxy';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(REPO_ROOT, '.cache');
const ARCHIVE_PATH = join(CACHE_DIR, ARCHIVE_NAME);
const DEST = join(REPO_ROOT, 'app', 'filter', 'dnscrypt-proxy');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function download(url, dest) {
  console.log('download: ' + url);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) {
    throw new Error('download failed: HTTP ' + res.status + ' from ' + url);
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

if (existsSync(DEST) && sha256(DEST) === BIN_SHA256) {
  console.log('cached: app/filter/dnscrypt-proxy sha256 ' + BIN_SHA256);
  process.exit(0);
}

mkdirSync(CACHE_DIR, { recursive: true });
if (!(existsSync(ARCHIVE_PATH) && sha256(ARCHIVE_PATH) === ARCHIVE_SHA256)) {
  await download(RELEASE_URL, ARCHIVE_PATH);
}

const archiveHash = sha256(ARCHIVE_PATH);
if (archiveHash !== ARCHIVE_SHA256) {
  console.error('FAIL: archive sha256 mismatch');
  console.error('  got  ' + archiveHash);
  console.error('  want ' + ARCHIVE_SHA256);
  process.exit(1);
}
console.log('archive sha256 OK: ' + archiveHash);

const tmp = mkdtempSync(join(tmpdir(), 'dnscrypt-proxy-'));
try {
  execFileSync('tar', ['-xzf', ARCHIVE_PATH, '-C', tmp]);
  let bin = join(tmp, ARCHIVE_MEMBER);
  if (!existsSync(bin)) {
    bin = join(tmp, 'dnscrypt-proxy'); // flat-layout fallback
  }
  if (!existsSync(bin)) {
    console.error('FAIL: extracted archive does not contain a dnscrypt-proxy binary');
    process.exit(1);
  }
  const binHash = sha256(bin);
  if (binHash !== BIN_SHA256) {
    console.error('FAIL: binary sha256 mismatch');
    console.error('  got  ' + binHash);
    console.error('  want ' + BIN_SHA256);
    process.exit(1);
  }
  console.log('binary sha256 OK: ' + binHash);
  mkdirSync(dirname(DEST), { recursive: true });
  copyFileSync(bin, DEST);
  chmodSync(DEST, 0o755);
  console.log('placed: app/filter/dnscrypt-proxy (' + VERSION + ')');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
