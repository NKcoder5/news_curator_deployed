// backend/middleware/errorHandlers.js
//
// The last two stops for a request: an address that matches no route, and an
// error nothing else handled.
//
// Express's own answers to both are HTML pages, and its error page includes
// the stack trace whenever NODE_ENV is not "production", which on a server
// someone forgot to configure is always. A client of this API reads JSON, and
// a stack trace tells a stranger which files, libraries and versions we run.
// So both answer JSON with a message for the reader, a code, and the request
// id; the stack goes to the log, tagged with the same id.
const { logLine } = require('./requestContext');

const notFound = (req, res) => {
  res.status(404).json({ error: 'There is nothing at this address.', code: 'NOT_FOUND', requestId: req.id });
};

// Errors the body parser raises, which are the caller's to fix.
const PARSER_ERRORS = {
  'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'That request is too large.'],
  'entity.parse.failed': [400, 'INVALID_JSON', 'The request body is not valid JSON.'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'That request encoding is not supported.'],
  'charset.unsupported': [415, 'UNSUPPORTED_ENCODING', 'That character set is not supported.'],
  'request.aborted': [400, 'REQUEST_ABORTED', 'The request was cut off before it arrived.']
};

const errorHandler = ({ log = console.error } = {}) => (err, req, res, next) => {
  const known = PARSER_ERRORS[err?.type];
  const status = known ? known[0] : (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500);
  if (status >= 500) {
    logLine({ level: 'error', msg: 'unhandled error', id: req.id, method: req.method,
      path: String(req.originalUrl || req.url).split('?')[0], error: err?.message, stack: err?.stack }, log);
  }
  // A stream that already started cannot change its status; close it.
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: known ? known[2] : status >= 500 ? 'Something went wrong on our side. Please try again.' : 'That request could not be handled.',
    code: known ? known[1] : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    requestId: req.id
  });
};

module.exports = { notFound, errorHandler };
