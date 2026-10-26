#!/usr/bin/env node
//
// Pre-warm the trust-report cache.
//
// A first analysis of an article costs one round trip per factor. On the free
// NVIDIA tier under load that has been measured at close to four minutes, which
// is fine for a reader who opens one article and unacceptable for a live demo
// where somebody clicks six.
//
// Every report is cached by article URL for fourteen days, so the cost is paid
// exactly once per article. This script pays it in advance: run it before a
// demo or on a schedule, and every headline on the front page opens instantly.
//
// Usage:
//   node scripts/prewarmTrustCache.js                    # default categories
//   node scripts/prewarmTrustCache.js business technology # named categories
//   node scripts/prewarmTrustCache.js --limit 5           # cap per category
//
// Safe to re-run: articles already cached are skipped, so an interrupted run
// picks up where it left off.

require('dotenv').config();
const mongoose = require('mongoose');
const { fetchTopNews } = require('../utils/newsFetcher');
const { analyzeTrust, REPORT_SCHEMA_VERSION } = require('../agents/trustAnalysisAgent');
const TrustReportCache = require('../models/TrustReportCache');

const DEFAULT_CATEGORIES = ['general', 'business', 'technology', 'health', 'sports'];

const parseArgs = (argv) => {
  const categories = [];
  let limit = 8;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (!argv[i].startsWith('--')) {
      categories.push(argv[i]);
    }
  }
  return { categories: categories.length ? categories : DEFAULT_CATEGORIES, limit };
};

const mmss = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

(async () => {
  const { categories, limit } = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGO_URI in .env — cannot reach the cache.');
    process.exit(1);
  }
  await mongoose.connect(uri);

  // Collect the candidate articles first, so the run reports a real total.
  const articles = [];
  const seenUrls = new Set();
  for (const category of categories) {
    let items = [];
    try {
      items = await fetchTopNews(category);
    } catch (err) {
      console.error(`  could not fetch "${category}": ${err.message}`);
      continue;
    }
    for (const a of items.slice(0, limit)) {
      if (!a.url || seenUrls.has(a.url) || !a.title) continue;
      seenUrls.add(a.url);
      articles.push({ ...a, category });
    }
  }

  if (!articles.length) {
    console.log('No articles returned by the news API — nothing to warm.');
    await mongoose.disconnect();
    return;
  }

  // Skip what is already cached so a re-run is cheap — but only entries from
  // the current pipeline. A report from an older version is re-analysed.
  const cachedUrls = new Set(
    (await TrustReportCache.find({ articleUrl: { $in: [...seenUrls] } })
      .select('articleUrl report.schemaVersion').lean())
      .filter(c => c.report?.schemaVersion === REPORT_SCHEMA_VERSION)
      .map(c => c.articleUrl)
  );
  const todo = articles.filter(a => !cachedUrls.has(a.url));

  console.log(`${articles.length} articles across ${categories.length} categories`);
  console.log(`${cachedUrls.size} already cached, ${todo.length} to analyse\n`);

  let done = 0, failed = 0;
  const started = Date.now();

  // Strictly sequential. The API gateway already limits concurrency; adding
  // more here only trips the tier's rate limit and makes the run slower.
  for (const article of todo) {
    const label = article.title.slice(0, 58);
    const t0 = Date.now();
    // Whole lines only — the API gateway logs retry warnings while this runs,
    // and a half-written progress line would be interleaved with them.
    console.log(`[${done + failed + 1}/${todo.length}] ${label}…`);
    try {
      const report = await analyzeTrust({
        title: article.title,
        content: article.content || article.description || '',
        source: article.source?.name || article.source || '',
        url: article.url
      });
      await TrustReportCache.updateOne(
        { articleUrl: article.url },
        {
          $set: {
            articleUrl: article.url,
            title: article.title,
            source: article.source?.name || article.source || '',
            report,
            // Analysed by this server from its own feed, not from text a caller sent (routes/aiRoutes.js).
            shareable: true,
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      done++;
      const degraded = report.degradedFactors?.length
        ? ` (${report.degradedFactors.length} by rules)` : '';
      console.log(`        ${report.overallScore}/10  ${mmss(Date.now() - t0)}${degraded}`);
    } catch (err) {
      failed++;
      console.log(`        failed — ${err.message}`);
    }
  }

  console.log(`\nCached ${done} report${done === 1 ? '' : 's'} in ${mmss(Date.now() - started)}` +
    (failed ? `, ${failed} failed (re-run to retry)` : '') + '.');
  console.log('These articles now open instantly in the app.');

  await mongoose.disconnect();
})().catch(err => {
  console.error('Pre-warm failed:', err.message);
  process.exit(1);
});
