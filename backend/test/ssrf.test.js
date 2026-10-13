// A link a reader pastes must not be a way into our own network.
//
// The redirect tests run a server on 127.0.0.1 and a fetcher that allows that
// one address, because every other private address must stay refused: the
// test server stands in for "a public site", and its redirects aim at the
// metadata service, a file and itself.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { isBlockedAddress, createSafeFetcher, safeGet } = require('../utils/safeFetch');
const { assertPublicUrl } = require('../utils/articleExtractor');

test('private, loopback, link-local and unique-local addresses are refused; public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', 'not-an-ip']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.183.14', '2606:4700:4700::1111', '2404:6800:4007:80a::200e']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('the link check refuses other schemes and private addresses however they are written', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'javascript:alert(1)',
    'http://127.0.0.1:5000/health', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://0x7f.1/',
    'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'http://localhost:27017/', 'not a url']) {
    await assert.rejects(assertPublicUrl(url), (err) => err.code === 'BAD_URL', url);
  }
});

// A stand-in "public site" on loopback.
const startSite = async () => {
  const server = http.createServer((req, res) => {
    const port = server.address().port;
    const go = (location) => { res.writeHead(302, { location }); res.end(); };
    if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><p>ok</p></html>'); }
    if (req.url === '/to-ok') return go('/ok');
    if (req.url === '/to-metadata') return go('http://169.254.169.254/latest/meta-data/iam/');
    if (req.url === '/to-mapped') return go('http://[::ffff:a9fe:a9fe]/');
    if (req.url === '/to-file') return go('file:///etc/passwd');
    if (req.url === '/to-localhost') return go(`http://localhost:${port}/ok`);
    if (req.url === '/loop') return go('/loop');
    if (req.url === '/big') { res.writeHead(200); return res.end('x'.repeat(3 * 1024 * 1024)); }
    if (req.url === '/slow') return;   // never answers
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close(); } };
};

// Allows exactly the test server's address; everything else private stays refused.
const { safeGet: siteGet } = createSafeFetcher({ isBlocked: (ip) => ip !== '127.0.0.1' && isBlockedAddress(ip) });

test('redirects are followed only to addresses that pass the same check', async () => {
  const site = await startSite();
  try {
    const ok = await siteGet(`${site.base}/to-ok`);
    assert.equal(ok.status, 200);
    assert.equal(ok.url, `${site.base}/ok`);

    await assert.rejects(siteGet(`${site.base}/to-metadata`), (err) => err.code === 'BLOCKED_ADDRESS');
    await assert.rejects(siteGet(`${site.base}/to-mapped`), (err) => err.code === 'BLOCKED_ADDRESS');
    await assert.rejects(siteGet(`${site.base}/to-file`), (err) => err.code === 'BAD_URL');
    // localhost resolves to a loopback address; the guard at connect time
    // checks what the name resolves to, not how it is spelled.
    await assert.rejects(siteGet(`${site.base}/to-localhost`, { timeout: 3000 }), (err) => err.code === 'BLOCKED_ADDRESS' || /private/.test(err.message));
    await assert.rejects(siteGet(`${site.base}/loop`), (err) => err.code === 'TOO_MANY_REDIRECTS');
  } finally {
    site.close();
  }
});

test('the body is capped in bytes and the fetch in time', async () => {
  const site = await startSite();
  try {
    await assert.rejects(siteGet(`${site.base}/big`, { maxBytes: 1024 * 1024 }), /maxContentLength|exceeded/i);
    const started = Date.now();
    await assert.rejects(siteGet(`${site.base}/slow`, { timeout: 300 }));
    assert.ok(Date.now() - started < 3000);
  } finally {
    site.close();
  }
});

test('the default fetcher refuses loopback outright', async () => {
  const site = await startSite();
  try {
    await assert.rejects(safeGet(`${site.base}/ok`), (err) => err.code === 'BLOCKED_ADDRESS');
  } finally {
    site.close();
  }
});
