// backend/middleware/requestContext.js
//
// Every request gets an id, and leaves one line in the log.
//
// The id travels back in X-Request-Id and inside every error body, so a
// reader who reports "it said something went wrong" can quote one string and
// the line in the log is found. A caller (a proxy, the evaluation scripts) may
// send its own id; anything that does not look like one is replaced, so a
// header cannot write arbitrary text into the log.
//
// The line is JSON with the method, the path without its query string, the
// status and the time taken. Never a body, a query or a header: bodies are
// readers' messages and headers carry tokens.
const crypto = require('node:crypto');

const ID = /^[A-Za-z0-9._:-]{8,100}$/;

/** One structured log line. Errors carry the request id they belong to. */
const logLine = (fields, write = console.log) => write(JSON.stringify({ time: new Date().toISOString(), ...fields }));

const requestContext = ({ log = console.log } = {}) => (req, res, next) => {
  const given = req.get('x-request-id');
  req.id = given && ID.test(given) ? given : crypto.randomUUID();
  res.set('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  let logged = false;
  const done = () => {
    if (logged) return;
    logged = true;
    logLine({
      level: res.statusCode >= 500 ? 'error' : 'info',
      msg: 'request',
      id: req.id,
      method: req.method,
      path: String(req.originalUrl || req.url).split('?')[0].slice(0, 200),
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1000000n),
      // A streamed check the reader walked away from ends without finishing.
      ...(res.writableFinished ? {} : { aborted: true })
    }, log);
  };
  res.on('finish', done);
  res.on('close', done);
  next();
};

module.exports = { requestContext, logLine };
