// backend/services/recheckScheduler.js
//
// Looking again at claims that could not be settled.
//
// "Cannot verify" is often only "not yet": a rumour that breaks at noon is
// reported, or ruled on by a fact-checker, by the evening. A claim a reader
// checked that came back CANNOT VERIFY is therefore booked for another look
// after 6 hours, then 24, then 72 (services/claimMemory.js books it), and this
// runs the booked checks. Each re-check is an ordinary check of the claim as
// stored — the neutral English sentence, never the reader's message — and is
// filed as a new assessment that supersedes the last, with what changed.
//
// It spends the same search and model quota as a reader's check, so it is
// capped: at most RECHECK_DAILY_CAP re-checks (default 40) in any 24 hours,
// counted from the stored assessments, so a server restart cannot reset it;
// a few per tick, one at a time. Claims filed by the evaluation scripts are
// never re-checked. RECHECK_ENABLED=false turns it off.
const mongoose = require('mongoose');
const ClaimRecord = require('../models/ClaimRecord');
const ClaimAssessment = require('../models/ClaimAssessment');

const HOUR = 3600000;
const TICK_MS = 15 * 60000;
const FIRST_TICK_MS = 2 * 60000;
const PER_TICK = 3;

const dailyCap = () => {
  const n = Number(process.env.RECHECK_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? n : 40;
};

const connected = () => mongoose.connection.readyState === 1;

/** How many re-checks may still run in the current 24 hours. */
const remainingToday = async (now = Date.now()) => {
  const used = await ClaimAssessment.countDocuments({ trigger: 'recheck', createdAt: { $gte: new Date(now - 24 * HOUR) } });
  return Math.max(0, dailyCap() - used);
};

/** The booked claims whose time has come, oldest booking first. */
const dueRecords = (limit, now = Date.now()) => ClaimRecord.find({
  origin: 'user',
  'recheck.due': { $ne: null, $lte: new Date(now) }
}).sort({ 'recheck.due': 1 }).limit(limit);

let running = false;

/**
 * Run the re-checks that are due, within the cap.
 * @param {Object} [options]
 * @param {Function} [options.check] - the check to run (services/contentCheck.js's runContentCheck)
 * @returns {Promise<Array<{claimId, claim, before, after, changeReason}>>}
 */
const runDueRechecks = async ({ check = null, limit = PER_TICK, now = Date.now() } = {}) => {
  if (running || !connected()) return [];
  running = true;
  const done = [];
  try {
    const allowed = Math.min(limit, await remainingToday(now));
    if (!allowed) return done;
    const runCheck = check || require('./contentCheck').runContentCheck;
    for (const record of await dueRecords(allowed, now)) {
      const before = record.current?.call || null;
      // Taken off the book first, so a check that fails is not retried every
      // tick; claimMemory books the next stage when the check is filed.
      record.recheck = { due: null, stage: record.recheck?.stage || 0, attempts: (record.recheck?.attempts || 0) + 1 };
      await record.save();
      try {
        const report = await runCheck({ text: record.claim }, { trigger: 'recheck', recheckOf: String(record._id) });
        done.push({ claimId: String(record._id), claim: record.claim, before, after: report.call, changeReason: report.memory?.changeReason || null });
      } catch (err) {
        done.push({ claimId: String(record._id), claim: record.claim, before, after: null, error: err.message });
      }
    }
  } finally {
    running = false;
  }
  return done;
};

let timer = null;

/** Start the ticking. Called once the database is connected (app.js). */
const startRecheckScheduler = () => {
  if (timer || String(process.env.RECHECK_ENABLED || 'true').toLowerCase() === 'false') return false;
  const tick = () => runDueRechecks()
    .then(done => done.forEach(d => console.log(`Re-check: "${d.claim.slice(0, 70)}" ${d.before} -> ${d.after || `failed (${d.error})`}`)))
    .catch(err => console.warn('Re-check tick failed:', err.message));
  setTimeout(tick, FIRST_TICK_MS).unref();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  console.log(`Re-checks of unsettled claims: on, at most ${dailyCap()} a day.`);
  return true;
};

module.exports = { runDueRechecks, startRecheckScheduler, remainingToday, dailyCap };
