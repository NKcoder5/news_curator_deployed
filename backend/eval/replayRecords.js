// backend/eval/replayRecords.js
//
// Are stored verdicts reproducible?
//
// Every Check Anything assessment stores the exact inputs its verdict was
// reached from (services/claimMemory.js). This replays each one through the
// verdict engine and reports how many reach the identical verdict and rule.
// When the verdict engine or its weights have changed since an assessment was
// stored, a disagreement is expected and is reported separately rather than as
// a failure.
//
// Usage: node eval/replayRecords.js [--limit 500]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const ClaimAssessment = require('../models/ClaimAssessment');
const { replayAssessment } = require('../services/claimMemory');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 500;

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const docs = await ClaimAssessment.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  let same = 0; let differ = 0; let engineChanged = 0;
  for (const doc of docs) {
    const r = replayAssessment(doc);
    if (r.engineChanged) { engineChanged += 1; continue; }
    if (r.same) same += 1;
    else {
      differ += 1;
      console.log(`DIFFERS ${doc._id}: stored ${doc.call}/${doc.rule}, replayed ${r.call}/${r.rule}`);
    }
  }
  console.log(`${docs.length} assessments: ${same} replayed identically, ${differ} differed, ${engineChanged} skipped (engine changed since)`);
  await mongoose.disconnect();
  process.exit(differ ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
