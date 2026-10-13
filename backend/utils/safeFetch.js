// backend/utils/safeFetch.js
//
// Fetching a page whose address a reader gave us.
//
// "Check this link" means our server opens whatever address it is handed, from
// inside whatever network it runs in. Without care, that is a way to make the
// server read its own admin pages, the database port on the same host, or a
// cloud provider's metadata service at 169.254.169.254, and hand the result
// back as an "article". The address check in articleExtractor.js looked at
// the first address a name resolved to, once, and then let axios follow up to
// three redirects anywhere, and resolve the name again when it connected.
//
// Here every hop is checked: the scheme must be http or https, an address
// written as a number must be public, and the address the connection actually
// uses is checked at the moment of connecting (a lookup guard on the socket),
// so a name that resolves to a public address for the check and a private one
// for the connection gains nothing. Redirects are followed by hand, each one
// checked again, at most three. The body is capped in bytes and the whole
// fetch, redirects included, in time.
const axios = require('axios');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

// Everything that is not the public internet: this host, private networks,
// carrier-grade NAT, link-local (the metadata service), documentation and
// benchmarking ranges, multicast and reserved space; for IPv6 the same, plus
// the translation prefixes that can carry a private IPv4 address inside them.
// IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are matched against the IPv4
// ranges by BlockList itself.
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) PRIVATE.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
]) PRIVATE.addSubnet(address, prefix, 'ipv6');

/** Is this address anywhere but the public internet? Anything unparseable is. */
const isBlockedAddress = (address) => {
  const ip = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(ip);
  if (family === 4) return PRIVATE.check(ip, 'ipv4');
  if (family === 6) return PRIVATE.check(ip, 'ipv6');
  return true;
};

const refusal = (message, code) => Object.assign(new Error(message), { code });
const PRIVATE_MESSAGE = 'That link points to a private address and cannot be checked.';

/** The parsed address, if it is one we may fetch at all. */
const checkUrl = (raw, isBlocked) => {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw refusal('That does not look like a valid link.', 'BAD_URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw refusal('Only web links (http or https) can be checked.', 'BAD_URL');
  }
  // A literal address never reaches the lookup guard: the socket connects to
  // it directly. The URL parser has already turned 0x7f.1 and 2130706433
  // into 127.0.0.1.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlocked(host)) throw refusal(PRIVATE_MESSAGE, 'BLOCKED_ADDRESS');
  return parsed;
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * A fetcher with its own address policy. The default one is exported below;
 * tests build one that also allows the loopback server they run.
 */
const createSafeFetcher = ({ isBlocked = isBlockedAddress } = {}) => {
  // Called by the socket for every connection, with whatever the name
  // resolves to at that moment. Every address must be public, not just the
  // first: a name with one public and one private record must not get a
  // second try at the private one.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return done(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
      if (list.length === 0 || list.some(a => isBlocked(a.address))) {
        return done(refusal(PRIVATE_MESSAGE, 'BLOCKED_ADDRESS'));
      }
      if (opts.all) return done(null, list);
      return done(null, list[0].address, list[0].family);
    });
  };
  const httpAgent = new http.Agent({ lookup });
  const httpsAgent = new https.Agent({ lookup });

  /**
   * GET a page, following redirects only to addresses that pass the same
   * checks. Throws like axios does for a status outside 2xx.
   *
   * @param {string} rawUrl
   * @param {Object} [options]
   * @param {Object} [options.headers]
   * @param {number} [options.timeout=12000]  - ms for the whole fetch, redirects included
   * @param {number} [options.maxBytes=2MB]   - body cap, after decompression
   * @param {number} [options.maxRedirects=3]
   * @param {string} [options.responseType='text']
   * @returns {Promise<{status, headers, data, url}>} url is the address finally read
   */
  const safeGet = async (rawUrl, { headers = {}, timeout = 12000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, responseType = 'text' } = {}) => {
    const deadline = AbortSignal.timeout(timeout);
    let url = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const parsed = checkUrl(url, isBlocked);
      const response = await axios.get(parsed.href, {
        headers, responseType, timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        maxRedirects: 0,
        // A proxy from the environment would make the connection, and the
        // lookup guard would be checking the proxy's address, not the page's.
        proxy: false,
        httpAgent, httpsAgent,
        signal: deadline,
        validateStatus: () => true
      });
      if (REDIRECTS.has(response.status) && response.headers.location) {
        url = new URL(response.headers.location, parsed).href;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error(`Request failed with status code ${response.status}`), { response, code: 'HTTP_STATUS' });
      }
      return { status: response.status, headers: response.headers, data: response.data, url: parsed.href };
    }
    throw refusal('That link redirects too many times to follow.', 'TOO_MANY_REDIRECTS');
  };

  return { safeGet, lookup };
};

const { safeGet } = createSafeFetcher();

/** Was this failure our guard refusing the address, rather than the site failing? */
const isRefusal = (err) => ['BAD_URL', 'BLOCKED_ADDRESS'].includes(err?.code);

module.exports = { safeGet, createSafeFetcher, isBlockedAddress, isRefusal, PRIVATE_MESSAGE };
