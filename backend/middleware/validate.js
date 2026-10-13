// backend/middleware/validate.js
//
// The shape of what the analysis endpoints accept, checked before any work.
//
// Each route already refused a missing field in its own words. What reached
// the pipeline unchecked was the wrong kind of field: a number for "text", an
// object for "url", a 5 MB paste. Those failed somewhere deep inside as a 500,
// or ran a full check on text no reader typed. A field of the wrong type or
// length is now a 400 with a message and a machine-readable code, and the
// route's own messages for a missing field are unchanged.
const LIMITS = {
  url: 2048,
  text: 20000,          // the check reads the first 1,800 characters; a long forward still fits
  article: 100000,
  title: 500,
  account: 200
};

/**
 * @param {Object<string, {type: 'string'|'array', max?: number, pattern?: RegExp, label?: string}>} fields
 * @returns {Function} middleware answering 400 for a field of the wrong type, length or form
 */
const checkFields = (fields) => (req, res, next) => {
  const body = req.body;
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    return res.status(400).json({ error: 'Send the request as a JSON object.', code: 'INVALID_INPUT', requestId: req.id });
  }
  for (const [name, rule] of Object.entries(fields)) {
    const value = body?.[name];
    if (value === undefined || value === null || value === '') continue;
    const label = rule.label || name;
    if (rule.type === 'array') {
      if (!Array.isArray(value)) {
        return res.status(400).json({ error: `"${name}" must be a list.`, code: 'INVALID_INPUT', field: name, requestId: req.id });
      }
      if (rule.max && value.length > rule.max) {
        return res.status(400).json({ error: `Send at most ${rule.max} items in "${name}".`, code: 'TOO_LONG', field: name, requestId: req.id });
      }
      continue;
    }
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `The ${label} must be text.`, code: 'INVALID_INPUT', field: name, requestId: req.id });
    }
    if (rule.max && value.length > rule.max) {
      return res.status(400).json({
        error: `The ${label} is too long (${value.length.toLocaleString('en-IN')} characters; the limit is ${rule.max.toLocaleString('en-IN')}).`,
        code: 'TOO_LONG', field: name, requestId: req.id
      });
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      return res.status(400).json({ error: `The ${label} is not in a form we accept.`, code: 'INVALID_INPUT', field: name, requestId: req.id });
    }
  }
  next();
};

// Check Anything: one of a link, text or a screenshot. The screenshot's size
// is held by the body limit on this route (app.js) and decoded size by
// services/contentCheck.js.
const contentCheck = checkFields({
  url: { type: 'string', max: LIMITS.url, label: 'link' },
  text: { type: 'string', max: LIMITS.text, label: 'text' },
  imageBase64: { type: 'string', label: 'screenshot' },
  account: { type: 'string', max: LIMITS.account, label: 'account name' },
  languageHint: { type: 'string', max: 12, pattern: /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/i, label: 'language hint' }
});

const article = checkFields({
  title: { type: 'string', max: LIMITS.title, label: 'headline' },
  content: { type: 'string', max: LIMITS.article, label: 'article text' },
  article: { type: 'string', max: LIMITS.article, label: 'article text' },
  url: { type: 'string', max: LIMITS.url, label: 'link' },
  publishedAt: { type: 'string', max: 64, label: 'date' }
});

const plainAnswer = checkFields({ text: { type: 'string', max: LIMITS.text, label: 'text' } });
const link = checkFields({ url: { type: 'string', max: LIMITS.url, label: 'link' } });
const coverage = checkFields({
  title: { type: 'string', max: LIMITS.title, label: 'headline' },
  query: { type: 'string', max: LIMITS.title, label: 'search' },
  url: { type: 'string', max: LIMITS.url, label: 'link' }
});
const badges = checkFields({ articles: { type: 'array', max: 100 } });

module.exports = { checkFields, validate: { contentCheck, article, plainAnswer, link, coverage, badges }, LIMITS };
