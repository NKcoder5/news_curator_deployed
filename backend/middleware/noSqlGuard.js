// backend/middleware/noSqlGuard.js
//
// Field names a database would read as operators are refused.
//
// Several routes put what a caller sent straight into a query: the article
// URL into TrustReportCache.findOne({ articleUrl: url }), an article id into
// ArticleHistory.findOne. Sent as {"url": {"$ne": null}} instead of a string,
// that is "any cached report at all". A key that begins with "$" is a MongoDB
// operator and a key with a dot reaches into a nested field; no request this
// API takes needs either, so a request carrying one is refused outright.
//
// Refused rather than cleaned: Express 5 computes req.query afresh from the
// URL on every read, so it cannot be edited in place, and a request that was
// silently altered is harder to reason about than one that was turned away.
const MAX_DEPTH = 20;

const unsafeKey = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some(v => unsafeKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.keys(value).some(k => k.startsWith('$') || k.includes('.') || unsafeKey(value[k], depth + 1));
  }
  return false;
};

const noSqlGuard = (req, res, next) => {
  if (unsafeKey(req.body) || unsafeKey(req.query)) {
    return res.status(400).json({
      error: 'The request contains field names that are not allowed.',
      code: 'INVALID_FIELD_NAME',
      requestId: req.id
    });
  }
  next();
};

module.exports = { noSqlGuard, unsafeKey };
