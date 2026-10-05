// Regression tests for app/scripts/dnsq.js — the real script runs against a stub
// UDP DNS server, so no resolver and no TV are needed.
//
// Defect being pinned: with a mode-B filter config (blocked_query_response =
// 'a:0.0.0.0,aaaa::') the answer for a blocked name is NOERROR + A 0.0.0.0. The
// answer-name walk at dnsq.js:27 had no end-of-message bound, so a message whose
// question section is not "QDCOUNT=1 + plain QNAME at offset 12" walked o2 past
// msg.length, then o2 became NaN and the handler spun forever at 100% CPU: zero
// bytes on stdout, the script's own setTimeout could never fire. common.sh:206
// canary_blocked (reached from apply.sh:52 / keeper.sh:73,143) then deadlocked
// while holding the rules lock.
//
// So each fixture asserts BOTH halves of the contract: the exact reported line
// and the exit code the shell callers depend on (0 NOERROR, 2 rcode!=0, 1 timeout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

const DNSQ = fileURLToPath(new URL('../../app/scripts/dnsq.js', import.meta.url));

// The script's own timeout is 4s; this must be shorter so a hang is killed by
// the test (and reported), not papered over by dnsq printing TIMEOUT.
const TIMEOUT_MS = 2000;

const QUESTION_EXAMPLE_COM = '076578616d706c6503636f6d0000010001';

// (a) mode-B synthetic blocked answer: NOERROR, QDCOUNT=0, ANCOUNT=1,
//     answer name = compression pointer to offset 12, A 0.0.0.0.
//     Proven live-reproducing hang packet.
const PKT_MODE_B_NULL = '123481800000000100000000c00c000100010000003c000400000000';
// (b) normal upstream-style answer for example.com: QDCOUNT=1, plain QNAME at
//     offset 12, compressed answer name, A 93.184.216.34.
const PKT_NORMAL_A = '123481800001000100000000' + QUESTION_EXAMPLE_COM + 'c00c000100010000003c00045db8d822';
// (c1) truncated: header claims ANCOUNT=1 but the message ends after the question.
const PKT_TRUNCATED = '123481800001000100000000' + QUESTION_EXAMPLE_COM;
// (c2) garbage: ANCOUNT=1, body starts a 63-byte label but only 4 bytes follow.
const PKT_OVERRUN_LABEL = '1234818000010001000000003f610061';
// (c3) garbage: shorter than the 12-byte header — no field may leak NaN into the line.
const PKT_SHORT_HEADER = '1234818000';
// (d) mode-A blocked answer (template default 'refused'): rcode=5, ANCOUNT=0,
//     question section present. Must keep parsing exactly as before → exit 2.
const PKT_REFUSED = '123481850001000000000000' + QUESTION_EXAMPLE_COM;

// Runs `node dnsq.js <name> 127.0.0.1 <port>` against a stub server that replies
// with packetHex. Resolves once the child exits, or after killMs with
// timedOut=true (the child is the thing under test; it must not be waited on).
function runDnsq(packetHex, name = 'a.test', killMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const server = dgram.createSocket('udp4');
    const startedAt = Date.now();
    let child = null;
    let timedOut = false;
    let killTimer = null;
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      resolve({ ...result, ms: Date.now() - startedAt });
    };

    server.on('message', (msg, rinfo) => {
      server.send(Buffer.from(packetHex, 'hex'), rinfo.port, rinfo.address);
    });
    server.on('error', reject);
    server.bind(0, '127.0.0.1', () => {
      const port = server.address().port;
      child = spawn(process.execPath, [DNSQ, name, '127.0.0.1', String(port)]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.stderr.on('data', (d) => {
        stderr += d;
      });
      child.on('error', reject);
      child.on('close', (code, signal) => done({ code, signal, timedOut, stdout, stderr }));
      killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, killMs);
    });
  });
}

function assertTerminated(r, expectedLine) {
  assert.equal(
    r.timedOut,
    false,
    `dnsq.js did not exit: killed by the test after ${r.ms}ms ` +
      `(stdout=${r.stdout.length} bytes, signal=${r.signal}) — parser walked past the message`
  );
  assert.equal(r.signal, null, `dnsq.js was killed by ${r.signal} instead of exiting`);
  assert.equal(
    r.stdout,
    expectedLine + '\n',
    `unexpected output (stderr=${JSON.stringify(r.stderr)})`
  );
}

test('mode-B null answer (A=0.0.0.0, QDCOUNT=0, compressed name) reports the address and exits', async () => {
  const r = await runDnsq(PKT_MODE_B_NULL);
  assertTerminated(r, 'rcode=0 ancount=1 A=0.0.0.0');
  assert.equal(r.code, 0, 'NOERROR must exit 0');
});

test('normal upstream answer (plain QNAME + compressed answer name) still parses as before', async () => {
  const r = await runDnsq(PKT_NORMAL_A, 'example.com');
  assertTerminated(r, 'rcode=0 ancount=1 A=93.184.216.34');
  assert.equal(r.code, 0, 'NOERROR must exit 0');
});

test('REFUSED answer (mode A default: ancount=0, rcode!=0) still exits 2', async () => {
  const r = await runDnsq(PKT_REFUSED, 'blocked.test');
  assertTerminated(r, 'rcode=5 ancount=0 none');
  assert.equal(r.code, 2, 'rcode!=0 must exit 2 so canary_blocked passes');
});

test('truncated message (ANCOUNT=1, no answer bytes) terminates with no A= value', async () => {
  const r = await runDnsq(PKT_TRUNCATED);
  assertTerminated(r, 'rcode=0 ancount=1 none');
});

test('garbage message (label length runs past the end) terminates with no A= value', async () => {
  const r = await runDnsq(PKT_OVERRUN_LABEL);
  assertTerminated(r, 'rcode=0 ancount=1 none');
  assert.ok(!r.stdout.includes('A='), 'must not print a bogus A= address');
});

test('message shorter than the header terminates with no NaN in the reported line', async () => {
  const r = await runDnsq(PKT_SHORT_HEADER);
  assertTerminated(r, 'rcode=0 ancount=0 none');
});
