require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Routes
const newsRoutes = require('./routes/newsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const articleHistoryRoutes = require('./routes/articleHistory');
const userRoutes = require('./routes/userRoutes');
const apiAccess = require('./middleware/apiAccess');
const { requestContext } = require('./middleware/requestContext');
const { noSqlGuard } = require('./middleware/noSqlGuard');
const { createRateLimits } = require('./middleware/rateLimits');
const { notFound, errorHandler } = require('./middleware/errorHandlers');
const { checkConfig } = require('./utils/config');
const { PROVIDERS } = require('./utils/llmProviders');
const localNli = require('./services/localNli');
const modelHost = require('./services/modelHost');

// DB Connection
const connectDB = require('./utils/db');
const { startRecheckScheduler, stopRecheckScheduler } = require('./services/recheckScheduler');

// Initialize models
require('./models');

const PORT = process.env.PORT || 5000;

// The deployed frontend is served from its own origin, and the browser sends
// that origin on every API call. With only localhost on this list, a deployed
// build is refused by its own backend and every request fails CORS — which is
// what happened, because four frontend files fall back to the Render API URL
// while nothing here ever allowed the Render page to call it. The list is
// configurable so a new deployment does not need a code change.
const allowedOrigins = () => [
  'http://localhost:3000',
  'https://news-curator-deployed.onrender.com',
  ...String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
];

// Which proxy hops to believe about the caller's address. Rate limits count
// per address, so behind Render's proxy every reader would otherwise share
// the proxy's one address; believing every hop would let a caller name any
// address it likes in X-Forwarded-For. TRUST_PROXY sets the number of hops.
const trustProxy = () => {
  const setting = String(process.env.TRUST_PROXY || '').trim();
  if (/^\d+$/.test(setting)) return Number(setting);
  if (setting === 'true' || setting === 'false') return setting === 'true';
  return process.env.RENDER ? 1 : 'loopback';
};

// Body limits per route. A screenshot arrives as base64 inside the JSON body,
// and base64 inflates by about a third: the 8 MB image the upload accepts is
// roughly 11 MB on the wire, so Check Anything takes 12 MB. Nothing else needs
// more than an article (1 MB), and the account and history routes take a few
// fields (100 kB). The analysis bodies are read only after the login check,
// so a caller with no login cannot make the server read 12 MB.
const screenshotBody = express.json({ limit: '12mb' });
const analysisBody = express.json({ limit: '1mb' });
const smallBody = express.json({ limit: '100kb' });
const aiBody = (req, res, next) => (req.path.startsWith('/analyze-content') ? screenshotBody : analysisBody)(req, res, next);

/**
 * The application, without a listening socket or a database connection, so
 * tests can run it on an ephemeral port.
 *
 * @param {Object} [options]
 * @param {Object|false} [options.rateLimits] - overrides for middleware/rateLimits.js; false turns them off
 * @param {Function} [options.log] - where request lines go (console.log)
 */
const createApp = ({ rateLimits = {}, log = console.log } = {}) => {
  const app = express();
  const limits = createRateLimits(rateLimits);

  // Saying "Express" in every response tells a stranger what to look up.
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  // Express 5's "simple" parser never builds objects out of a query string,
  // so ?url[$ne]=x stays the string key "url[$ne]". Set here so a change of
  // default cannot quietly undo it.
  app.set('query parser', 'simple');

  app.use(requestContext({ log }));
  // An API that only ever answers JSON: no page of ours may be framed or run
  // anything, and the frontend, on another origin, may still read responses.
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      // An origin not on the list is declined, not failed: answering with an
      // error turned every such preflight into a 500 and a stack trace in the
      // log. Without the allow header the browser refuses the call anyway.
      return callback(null, allowedOrigins().indexOf(origin) !== -1);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // So the page can quote the request id and honour Retry-After.
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy']
  }));
  app.use((req, res, next) => (req.path.startsWith('/api/ai/') ? next() : smallBody(req, res, next)));
  app.use(noSqlGuard);

  // Routes
  app.use('/api/news', newsRoutes);
  // The analysis endpoints spend the day's news quota and model calls, so they
  // need a signed-in reader (or the evaluation scripts' key), and each reader
  // has an allowance (middleware/apiAccess.js, middleware/rateLimits.js).
  app.use('/api/ai', apiAccess, limits.ai, aiBody, noSqlGuard, aiRoutes);
  app.use('/api/auth/login', limits.login);
  app.use('/api/auth/signup', limits.signup);
  app.use('/api/auth', authRoutes);
  app.use('/api/tracking', trackingRoutes);
  app.use('/api/article-history', articleHistoryRoutes);
  app.use('/api/users', userRoutes);
  // Public and read-only, and it runs text searches: an allowance per address.
  app.use('/api/claims', limits.registry, require('./routes/claimRoutes'));
  // The team's laptop checks in here every minute with where its model is (scripts/ownModelServer.js,
  // services/modelHost.js). Internal key only: a signed-in reader must not be able to redirect model calls.
  app.post('/api/internal/model-host', apiAccess.internalOnly, (req, res) => {
    const result = modelHost.checkIn(req.body || {});
    res.status(result.ok ? 200 : 400).json(result.ok ? { connected: result.connected } : { error: result.error });
  });

  // Liveness: the process is up. Says nothing about the database.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
  });

  // Readiness: the process can do its job. A load balancer sends readers
  // here only when the database is connected and at least one model provider
  // is configured; without either, every check would fail or fall back.
  // Our own pair model is reported, not required: without it the checks it
  // serves fall back to the hosted models, as they did before it existed.
  app.get('/ready', (req, res) => {
    const database = mongoose.connection.readyState === 1;
    const models = Object.values(PROVIDERS).some(p => p.isConfigured());
    res.status(database && models ? 200 : 503).json({
      status: database && models ? 'READY' : 'NOT READY',
      checks: {
        database: database ? 'connected' : 'not connected',
        models: models ? 'configured' : 'none configured',
        ownModel: localNli.status(),
        ownHardware: modelHost.status()
      }
    });
  });

  app.use(notFound);
  app.use(errorHandler());
  return app;
};

/**
 * Check the configuration, listen, connect, and stop cleanly on SIGTERM or
 * SIGINT: no new connections, the re-check timer stopped, requests in flight
 * allowed to finish, then the database closed.
 */
const start = () => {
  const { errors, warnings } = checkConfig();
  for (const warning of warnings) console.warn(`Configuration: ${warning}`);
  if (errors.length) {
    console.error(`The server cannot start. Fix these in backend/.env (see backend/.env.example):\n${errors.map(e => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }

  const server = createApp().listen(PORT, () => {
    console.log(`✅ Server is running at http://localhost:${PORT}`);
  });

  // Loaded now rather than on the first check, and tested on a known pair, so
  // the first reader does not wait for it and /ready can say it runs.
  localNli.warmUp().then((s) => {
    console.log(`Own pair model: ${s.state} (${s.source})${s.selfTest ? `, self-test ${s.selfTest.passed ? 'passed' : 'FAILED'} in ${s.selfTest.ms} ms` : ''}`);
  }).catch(() => {});

  connectDB().then(() => {
    console.log('Models initialized');
    // Claims that came back CANNOT VERIFY are looked at again after 6, 24 and
    // 72 hours, within a daily cap (services/recheckScheduler.js).
    startRecheckScheduler();
  }).catch(err => {
    console.error('Failed to initialize models:', err);
  });

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing requests in flight, then stopping.`);
    stopRecheckScheduler();
    // A streamed check can run for a minute; past 25 seconds (inside the
    // half-minute a host such as Render waits) the process stops anyway.
    setTimeout(() => {
      console.error('Requests still running after 25 s; stopping anyway.');
      process.exit(1);
    }, 25000).unref();
    server.close(async () => {
      await mongoose.connection.close().catch(() => {});
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
};

// `node app.js` (npm start, npm run dev) starts the server; a test that
// requires this file gets the application and starts nothing.
if (require.main === module) start();

module.exports = { createApp, start };
