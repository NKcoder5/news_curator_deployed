const crypto = require('crypto');
const authMiddleware = require('./authMiddleware');

/**
 * Who may call the analysis endpoints.
 *
 * Every one of them spends something scarce: the news index allows 100 requests
 * a day for the whole application, and each analysis makes several, plus the
 * model calls. They used to be open to anyone who could reach the server —
 * the pages that call them require a login, but the endpoints themselves did
 * not, so a script pointed at the deployed backend could exhaust the day's
 * quota before a single reader arrived. They now require what the pages
 * already send: a signed-in reader's token.
 *
 * The evaluation scripts drive the same endpoints over HTTP. They present
 * INTERNAL_API_KEY instead, which exists only in the server's own .env; when
 * that variable is unset, the key route is closed and only a login works.
 */
const apiAccess = (req, res, next) => {
  const expected = process.env.INTERNAL_API_KEY;
  const given = req.header('x-internal-key');
  if (expected && given) {
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(expected));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      // The evaluation scripts run whole suites back to back; the per-reader
      // rate limits (middleware/rateLimits.js) do not apply to them.
      req.internalCaller = true;
      return next();
    }
  }
  return authMiddleware(req, res, next);
};

module.exports = apiAccess;
