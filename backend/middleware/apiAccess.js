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
const hasInternalKey = (req) => {
  const expected = process.env.INTERNAL_API_KEY;
  const given = req.header('x-internal-key');
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const apiAccess = (req, res, next) => {
  if (hasInternalKey(req)) {
    // The evaluation scripts run whole suites back to back; the per-reader
    // rate limits (middleware/rateLimits.js) do not apply to them.
    req.internalCaller = true;
    return next();
  }
  return authMiddleware(req, res, next);
};

/**
 * The internal key and nothing else: for what only the team's own scripts may
 * do, such as the laptop telling the server where its model is. A signed-in
 * reader is not enough there.
 */
const internalOnly = (req, res, next) => (hasInternalKey(req)
  ? next()
  : res.status(401).json({ error: 'This endpoint needs the internal key.' }));

module.exports = apiAccess;
module.exports.internalOnly = internalOnly;
