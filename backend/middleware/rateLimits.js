// backend/middleware/rateLimits.js
//
// How often one caller may ask for what.
//
// A Check Anything run spends a share of the day's news quota and six to ten
// model calls from free-tier quotas the whole application shares. One script
// looping on the endpoint would spend the day's quota before a reader
// arrived, and a login form with no limit is an invitation to guess
// passwords. So:
//
//   checks       Check Anything, the plain-model answer, coverage comparison
//                and link reading: 20 per signed-in reader per 10 minutes.
//   analysis     everything else under /api/ai (article reports, summaries,
//                feed badges, mostly cached): 150 per reader per 10 minutes.
//   login        10 failed sign-ins per address per 15 minutes; a correct
//                password is never counted.
//   signup       5 accounts per address per hour.
//   registry     the public claims registry runs text searches against the
//                database: 60 requests per address per minute.
//
// The analysis limits are per reader (the token's account), so readers behind
// one office or college address do not share one allowance; the evaluation
// scripts, which present INTERNAL_API_KEY, are not limited. A refusal is a
// 429 with Retry-After and a message that says when to come back.
//
// Counts are kept in memory, which is right for one server process (as on
// Render). RATE_LIMIT_ENABLED=false turns every limit off.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60 * 1000;

const DEFAULTS = {
  checks: { windowMs: 10 * MINUTE, limit: 20, per: 'reader' },
  analysis: { windowMs: 10 * MINUTE, limit: 150, per: 'reader' },
  login: { windowMs: 15 * MINUTE, limit: 10, per: 'address', failedOnly: true },
  signup: { windowMs: 60 * MINUTE, limit: 5, per: 'address' },
  registry: { windowMs: MINUTE, limit: 60, per: 'address' }
};

// The Check Anything family: each one is a full run of searches and model calls.
const CHECK_PATHS = new Set(['/analyze-content', '/analyze-content/stream', '/plain-answer', '/compare-coverage', '/extract-article']);

const WHAT = {
  checks: 'checks', analysis: 'requests', login: 'sign-in attempts', signup: 'new accounts', registry: 'requests'
};

const passThrough = (req, res, next) => next();

const build = (name, { windowMs, limit, per, failedOnly = false }) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: failedOnly,
  // The caller is the reader when there is one, else the address. IPv6
  // addresses are grouped by /56, the block one customer is usually given.
  keyGenerator: (req) => (per === 'reader' && req.user?._id ? `reader:${req.user._id}` : `address:${ipKeyGenerator(req.ip || '')}`),
  skip: (req) => req.internalCaller === true,
  handler: (req, res) => {
    const reset = req.rateLimit?.resetTime ? Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / MINUTE)) : Math.ceil(windowMs / MINUTE);
    res.status(429).json({
      error: `Too many ${WHAT[name]} in a short time. Please try again in ${reset} minute${reset === 1 ? '' : 's'}.`,
      code: 'RATE_LIMITED',
      requestId: req.id
    });
  }
});

/**
 * The limiters for one app instance. Each instance has its own counts, so a
 * test's app does not share them with another's.
 *
 * @param {Object|false} [settings] - false turns every limit off; an object
 *        overrides any of DEFAULTS (tests use small numbers)
 */
const createRateLimits = (settings = {}) => {
  const off = settings === false || String(process.env.RATE_LIMIT_ENABLED || 'true').toLowerCase() === 'false';
  if (off) return { ai: passThrough, login: passThrough, signup: passThrough, registry: passThrough };
  const config = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { ...v, ...(settings[k] || {}) }]));
  const checks = build('checks', config.checks);
  const analysis = build('analysis', config.analysis);
  return {
    // Mounted after the login check on /api/ai, so it knows the reader.
    ai: (req, res, next) => (CHECK_PATHS.has(req.path) ? checks : analysis)(req, res, next),
    login: build('login', config.login),
    signup: build('signup', config.signup),
    registry: build('registry', config.registry)
  };
};

module.exports = { createRateLimits, DEFAULTS, CHECK_PATHS };
