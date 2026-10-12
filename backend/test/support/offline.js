// backend/test/support/offline.js
//
// Preloaded by `npm run test:ci` (node --require). With CI_OFFLINE=1 it makes
// the machine behave as if it had no network: any lookup or connection to a
// host other than this one fails the way a dropped connection does.
//
// Why the suite needs this. Measured with every non-loopback connection
// refused and the attempts logged, three test files still reach for the
// network: pipeline.nomodel, excerptCoverage and verificationFailure ask Google
// News, the fact-check index, Wikipedia, RDAP and NewsAPI as part of running
// the real pipeline with no model. They are written to pass when none of those
// answer (that is what they test), but on a runner that has a network they get
// answers, and an answer from Google or Wikipedia on the day of the run is not
// something a unit test should depend on. Refusing the connection makes the
// run the same on a laptop, on a runner and on a plane.
//
// With CI_OFFLINE unset this file does nothing, so `npm test` is unchanged.
const net = require('net');
const dns = require('dns');

const ON = ['1', 'true', 'yes'].includes(String(process.env.CI_OFFLINE || '').toLowerCase());
const isLocal = (host) => !host || host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host);

if (ON) {
  const lookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (isLocal(hostname)) return lookup.apply(dns, arguments);
    const done = typeof options === 'function' ? options : callback;
    const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname
    });
    process.nextTick(() => done(err));
  };

  // A literal address never goes through a lookup.
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const [options] = net._normalizeArgs(args);
    if (!options.path && net.isIP(options.host) && !isLocal(options.host)) {
      const err = Object.assign(new Error(`connect ENETUNREACH ${options.host}`), { code: 'ENETUNREACH', syscall: 'connect' });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return connect.apply(this, args);
  };
}
