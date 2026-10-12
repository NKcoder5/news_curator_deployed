const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Routes
const newsRoutes = require('./routes/newsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes'); // New
const trackingRoutes = require('./routes/trackingRoutes');
const articleHistoryRoutes = require('./routes/articleHistory');
const userRoutes = require('./routes/userRoutes');
const apiAccess = require('./middleware/apiAccess');

// DB Connection
const connectDB = require('./utils/db'); // New

// Initialize models
require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
//
// The deployed frontend is served from its own origin, and the browser sends
// that origin on every API call. With only localhost on this list, a deployed
// build is refused by its own backend and every request fails CORS — which is
// what happened, because four frontend files fall back to the Render API URL
// while nothing here ever allowed the Render page to call it. The list is
// configurable so a new deployment does not need a code change.
const allowedOrigins = [
  'http://localhost:3000',
  'https://news-curator-deployed.onrender.com',
  ...String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // An origin not on the list is declined, not failed: answering with an
    // error turned every such preflight into a 500 and a stack trace in the
    // log. Without the allow header the browser refuses the call anyway.
    return callback(null, allowedOrigins.indexOf(origin) !== -1);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// A screenshot arrives as base64 inside the JSON body, and base64 inflates by
// about a third: the 8 MB image the upload endpoint accepts is roughly 11 MB on
// the wire. The default 100 kB limit would reject every screenshot with a
// parser error before the route ever ran.
app.use(bodyParser.json({ limit: '12mb' }));

// Database
connectDB().then(() => {
  console.log('Models initialized');
  // Claims that came back CANNOT VERIFY are looked at again after 6, 24 and
  // 72 hours, within a daily cap (services/recheckScheduler.js).
  require('./services/recheckScheduler').startRecheckScheduler();
}).catch(err => {
  console.error('Failed to initialize models:', err);
});

// Routes
app.use('/api/news', newsRoutes);
// The analysis endpoints spend the day's news quota and model calls, so they
// need a signed-in reader (or the evaluation scripts' key). See
// middleware/apiAccess.js.
app.use('/api/ai', apiAccess, aiRoutes);
app.use('/api/auth', authRoutes); // New
app.use('/api/tracking', trackingRoutes);
app.use('/api/article-history', articleHistoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/claims', require('./routes/claimRoutes')); // public, read-only registry

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});