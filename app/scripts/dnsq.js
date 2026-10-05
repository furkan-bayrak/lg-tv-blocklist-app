// dnsq.js — minimal UDP DNS A query helper for the S0 harness.
// Usage: node dnsq.js <name> [server] [port]
// Prints: 'rcode=<n> ancount=<n> A=<ip>|CNAME|type=<n>|none' — 'none' = no answer, or an
// answer too short/garbled to parse (every walk is bounded by msg.length).
// Exit: 0 NOERROR, 2 rcode!=0, 1 timeout.
var dgram = require('dgram');
var name = process.argv[2] || '';
var srv = process.argv[3] || '127.0.0.1';
var port = parseInt(process.argv[4] || '53', 10);
var parts = name.replace(/\.$/, '').split('.');
var q = [0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
for (var i = 0; i < parts.length; i++) {
  q.push(parts[i].length);
  for (var j = 0; j < parts[i].length; j++) q.push(parts[i].charCodeAt(j));
}
q.push(0, 0, 1, 0, 1);
var sock = dgram.createSocket('udp4');
var buf = Buffer.from(q);
var timer = setTimeout(function () { console.log('TIMEOUT'); process.exit(1); }, 4000);
sock.on('message', function (msg) {
  var rcode = msg[3] & 0x0f, an = msg.length >= 12 ? msg[6] * 256 + msg[7] : 0;
  var line = 'rcode=' + rcode + ' ancount=' + an;
  if (an > 0) {
    var qd = msg[4] * 256 + msg[5], off = 12, i;   // skip the question section: QDCOUNT entries
    for (i = 0; i < qd && off < msg.length; i++) { // each = name (labels | 0 byte | 2-byte pointer) + 4
      while (off < msg.length && msg[off] !== 0 && (msg[off] & 0xc0) !== 0xc0) off += msg[off] + 1;
      off += (off < msg.length && (msg[off] & 0xc0) === 0xc0) ? 2 : 1;   // name terminator
      off += 4;                                                          // QTYPE + QCLASS
    }
    var o2 = off, ok = o2 < msg.length;   // clamp: never walk a name past the datagram
    if (ok) {
      if ((msg[o2] & 0xc0) === 0xc0) { o2 += 2; } else { while (o2 < msg.length && msg[o2] !== 0) o2 += msg[o2] + 1; o2 += 1; }
      ok = o2 + 10 <= msg.length;         // type + class + ttl + rdlen must be present
    }
    if (!ok) { line += ' none'; }
    else {
      var typ = msg[o2] * 256 + msg[o2 + 1], rdlen = msg[o2 + 8] * 256 + msg[o2 + 9], r = o2 + 10;
      // Deliberate limit: pointers are followed only at the answer-name position, so a name using one deeper in the record (RDATA, label bytes 0x40-0xBF) degrades to 'none' — no pointer loop is possible.
      if (typ === 1) line += (rdlen === 4 && r + 4 <= msg.length) ? ' A=' + msg[r] + '.' + msg[r + 1] + '.' + msg[r + 2] + '.' + msg[r + 3] : ' none';
      else if (typ === 5) line += ' CNAME';
      else line += ' type=' + typ;
    }
  } else { line += ' none'; }
  console.log(line);
  clearTimeout(timer); sock.close(); process.exit(rcode === 0 ? 0 : 2);
});
sock.send(buf, 0, buf.length, port, srv);
