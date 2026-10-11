const express = require('express');
const router = express.Router();

const summarizeArticle = require('../agents/summarizeAgent');
const generateDetailedSummary = require('../agents/detailedSummaryAgent');
const { analyzeTrust, REPORT_SCHEMA_VERSION } = require('../agents/trustAnalysisAgent');

/** A cached report is only usable if it came from the current pipeline. */
const isCurrent = (report) => report && report.schemaVersion === REPORT_SCHEMA_VERSION;
const { compareCoverage } = require('../agents/compareCoverageAgent');
const { getSourceReputation } = require('../agents/sourceReputationAgent');
const { extractArticle } = require('../utils/articleExtractor');
const { ingestSocialContent } = require('../utils/socialIngest');
const { readImageText, packForLanguage } = require('../utils/ocr');
const { assessCheckability } = require('../agents/checkability');
const { askPlainModel } = require('../agents/plainModelBaseline');
const { resolveArticleText, limitText, TEXT_BUDGET, fingerprintText } = require('../utils/articleText');
const TrustReportCache = require('../models/TrustReportCache');
const SummaryCache = require('../models/SummaryCache');

/**
 * Is this report a result, or a record of our own failure?
 *
 * A trust report was stored whatever it said, for fourteen days. So an
 * analysis that ran while the model was rate-limited — every check falling
 * back to the pattern matcher, the corroboration search never completing —
 * was written down as the answer for that article, and every later reader was
 * served it instantly. The one time the pipeline could not do its job became
 * the permanent verdict, and re-opening the article could not dislodge it
 * because re-opening the article is exactly what hits the cache. Sixteen of
 * the seventeen reports in the local cache were records of a failure.
 *
 * Only a report built on checks that actually ran is worth keeping.
 */
const isCompleteReport = (report) => {
  if (!report) return false;
  // The corroboration check could not be carried out at all.
  if (report.decision?.rule === 'verification-unavailable') return false;
  // Too new for the news index to have seen. That is true today and false
  // tomorrow, so storing it for fourteen days would go on telling readers a
  // week-old story is "too recent to check" — the same failure as caching an
  // outage, with a later expiry date.
  if (report.decision?.rule === 'too-recent-to-corroborate') return false;
  // One or more content checks fell back to word patterns.
  if (report.degradedFactors?.length > 0) return false;
  return true;
};

/**
 * Store a report, unless it is a record of a failure or about different text.
 *
 * The fingerprint is the same idea as the summary cache: a URL is not a stable
 * name for a piece of writing, so an entry records the text it was built from
 * and a rewritten story does not reuse the old verdict.
 */
const cacheTrustReport = async ({ url, title, source, report, sourcePrint }) => {
  if (!url) return;
  if (!isCompleteReport(report)) {
    console.log(`Not caching an incomplete report for ${url} (${report?.decision?.rule || 'unknown rule'}).`);
    return;
  }
  // Awaited, not fire-and-forget. Responding first left a window where a
  // reader who refreshed immediately missed the cache and paid for a second
  // full analysis. A write failure is still never fatal.
  await TrustReportCache.updateOne(
    { articleUrl: url },
    { $set: { articleUrl: url, title, source, report, sourcePrint, createdAt: new Date() } },
    { upsert: true }
  ).catch(err => console.error('Trust cache write failed:', err.message));
};

/** Is a stored report still about the article in front of us? */
const isUsableCachedReport = (cached, sourcePrint) =>
  Boolean(cached)
  && isCurrent(cached.report)
  && (!sourcePrint || !cached.sourcePrint || cached.sourcePrint === sourcePrint);

/**
 * Fingerprint the text a caller sent, when it sent any.
 *
 * The fingerprint exists to notice a publisher rewriting a story under the
 * same URL. It only works when the caller supplies the article's text. A page
 * that has only the headline — reopening an article from the reading history,
 * which stores no body — used to fingerprint the headline, miss the cache, and
 * pay for a whole new analysis of a story already analysed, sometimes reaching
 * a different verdict from the one the dashboard had counted. With no body to
 * compare, there is nothing to say the story changed, so the URL decides.
 */
const printOf = (content, title) => {
  const body = sanitizeContent(content);
  if (!body || body.length < 40 || body.trim() === String(title || '').trim()) return null;
  return fingerprintText(body);
};

// When a reader double-clicks, opens the same story in two tabs, or two feed
// cards request the same report together, run one analysis and share its
// promise. This saves model capacity without changing what is analysed.
const inFlightTrustReports = new Map();
const inFlightSummaries = new Map();

/**
 * Summarise once per article and reuse the result.
 *
 * Regenerating on every page load meant a reader who returned to an article saw
 * a different summary from the one they read before — which looks like the
 * system changing its mind. Caching by URL makes it stable and instant.
 *
 * Requests that carry no URL (a pasted body with nothing to key on) simply run
 * uncached rather than failing.
 */
const summariseWithCache = async (kind, { url, title, text }, generate) => {
  const clean = sanitizeContent(text);
  if (!clean) throw new Error('Article content is required');

  // Cache first — a hit costs nothing and skips the page fetch entirely.
  //
  // But only when it is a summary of THIS text. A URL is not a stable name for
  // a piece of writing: a markets wrap, a live blog or a developing story keeps
  // its address and replaces its contents, and with a 14-day entry keyed on URL
  // alone the reader was shown a summary of the story that used to live there.
  // Seen in the app: a page headlined "Nasdaq rose to a new all-time intraday
  // high" carrying a summary, written nine days earlier, of a sell-off.
  const sourcePrint = printOf(clean, title);
  if (url) {
    const hit = await SummaryCache.findOne({ articleUrl: url, kind }).lean();
    if (hit && (!sourcePrint || !hit.sourcePrint || hit.sourcePrint === sourcePrint)) {
      return {
        summary: hit.summary,
        cached: true,
        sourceText: { chars: hit.summary.length, coverage: 'cached' }
      };
    }
    if (hit) console.log(`Article changed under ${url}; re-summarising.`);
  }

  // The feed supplies ~200 characters, which is why the "long" summary used to
  // come back the same length as the short one — both were working from the
  // same stub. Fetch the article itself so there is something to be detailed
  // about; falls back to the snippet when the page cannot be read.
  const resolved = await resolveArticleText({ url, title, fallback: clean });
  const body = limitText(resolved.text || clean, TEXT_BUDGET.summary);
  const sourceText = {
    chars: resolved.chars,
    coverage: resolved.source === 'full' ? 'article-text' : 'publisher-excerpt'
  };

  const key = url ? `${kind}:${url}:${sourcePrint}` : null;
  let job = key && inFlightSummaries.get(key);
  if (!job) {
    job = generate(body);
    if (key) {
      inFlightSummaries.set(key, job);
      job.then(
        () => inFlightSummaries.delete(key),
        () => inFlightSummaries.delete(key)
      );
    }
  }
  const summary = await job;

  if (url && summary) {
    // Awaited for the same reason as the trust report: a reader who reloads at
    // once must hit the cache, not regenerate. Failure is never fatal.
    await SummaryCache.updateOne(
      { articleUrl: url, kind },
      { $set: { articleUrl: url, kind, summary, sourcePrint, createdAt: new Date() } },
      { upsert: true }
    ).catch(err => console.error('Summary cache write failed:', err.message));
  }

  return { summary, cached: false, sourceText };
};

// NewsAPI truncates article bodies and appends markers like "[+7500 chars]".
// These confuse the LLM and end up inside its JSON output, causing parse
// failures. Strip them before any text reaches an agent.
const sanitizeContent = (text) => {
  if (!text) return text;
  return text.replace(/\[\+\d+\s*chars?\]/gi, '').trim();
};

router.post('/summarize', async (req, res) => {
  const { article, url, title } = req.body;
  if (!article) {
    return res.status(400).json({ error: 'Article content is required' });
  }
  try {
    const result = await summariseWithCache('short', { url, title, text: article }, summarizeArticle);
    res.json(result);
  } catch (err) {
    console.error('Summarize failed:', err.message);
    res.status(500).json({ error: 'Failed to summarize article.' });
  }
});

// agents/credibilityAgent.js has no route. It is the single-prompt baseline
// the evaluation compares the pipeline against (see eval/runEval.js), not a
// feature — it was reachable over HTTP and nothing called it.

// Full explainable trust analysis: source reputation + clickbait + bias +
// cross-source claim verification, aggregated into a weighted trust score.
// Results are cached by article URL so the analysis runs once per article
// and every later reader gets it instantly.
router.post('/trust-analysis', async (req, res) => {
  const { title, content, source, url, publishedAt } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required.' });
  }
  // What the caller is asking about, so a cached verdict written about a
  // different version of this page is not reused.
  const sourcePrint = printOf(content, title);
  try {
    if (url) {
      const cached = await TrustReportCache.findOne({ articleUrl: url }).lean();
      // A report from an older pipeline is missing factors this one reports,
      // and one written about text the publisher has since replaced is about a
      // different article. Either way, re-analyse.
      if (isUsableCachedReport(cached, sourcePrint)) {
        return res.json({ ...cached.report, cached: true });
      }
    }

    // Coalesce duplicate work for the same article. A URL is the normal key;
    // pasted articles without one deliberately remain independent.
    let job = url && inFlightTrustReports.get(url);
    if (!job) {
      // Give the factors the real article rather than the feed's ~200-character
      // stub. This costs one page fetch (1-3s, no model call) and is what lets
      // transparency, bias and persuasion checks see actual sourcing.
      job = resolveArticleText({ url, title, fallback: sanitizeContent(content) })
        .then(resolved => analyzeTrust({
          title,
          content: limitText(resolved.text || content, TEXT_BUDGET.factors),
          source,
          url,
          publishedAt: publishedAt || null,
          textCoverage: resolved.source
        }));
      if (url) {
        inFlightTrustReports.set(url, job);
        job.then(
          () => inFlightTrustReports.delete(url),
          () => inFlightTrustReports.delete(url)
        );
      }
    }
    const report = await job;

    await cacheTrustReport({ url, title, source, report, sourcePrint });

    res.json({ ...report, cached: false });
  } catch (err) {
    console.error('Trust analysis failed:', err);
    res.status(500).json({ error: 'Failed to run trust analysis.' });
  }
});

// Analyse anything, not only a news article.
//
// A reader rarely meets a claim as a news article. They meet it as a YouTube
// video somebody sent them, a screenshot of an Instagram post, or a forwarded
// WhatsApp message with no source at all. This endpoint takes any of those,
// normalises it into the shape the pipeline already consumes, and runs the same
// six checks and the same verdict rules over it.
//
// Accepts exactly one of:
//   { url }          - article, YouTube video, or social post
//   { text }         - a pasted message or caption
//   { imageBase64 }  - a screenshot, read with OCR
// plus optional { account } and { languageHint } for the screenshot case.
// A refusal or a fault, carried with the status and body the JSON route sends
// and the stream reports.
class ContentCheckError extends Error {
  constructor(status, payload) {
    super(payload.error);
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Ingest whatever was sent, gate it, and run the full check.
 *
 * Shared by the JSON route and the streamed one, so the two cannot drift.
 * `onStage` hears what was read; `onChannel` hears each evidence channel
 * land, with its one-line finding.
 */
const runContentCheck = async (requestBody, { onStage, onChannel } = {}) => {
  const { url, text, imageBase64, account, languageHint } = requestBody || {};
  const stage = (event) => { try { onStage?.(event); } catch (_) { /* listener faults never fail a check */ } };

  if (!url && !text && !imageBase64) {
    throw new ContentCheckError(400, { error: 'Send a link, some text, or a screenshot to check.' });
  }

  try {
    let ingested = null;
    let ocrResult = null;

    if (imageBase64) {
      const buffer = Buffer.from(String(imageBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
      if (buffer.length === 0) throw new ContentCheckError(400, { error: 'That image could not be decoded.' });
      if (buffer.length > 8 * 1024 * 1024) throw new ContentCheckError(413, { error: 'That image is too large. Send one under 8 MB.' });
      stage({ id: 'ocr', name: 'Reading the text out of the screenshot' });

      const packs = ['eng', packForLanguage(languageHint)].filter(Boolean);
      ocrResult = await readImageText(buffer, [...new Set(packs)]);
      if (!ocrResult.text || ocrResult.text.length < 40) {
        throw new ContentCheckError(422, {
          error: 'We could not read enough text from that screenshot. Try a sharper image, or paste the text instead.',
          readText: ocrResult.text || ''
        });
      }
      ingested = await ingestSocialContent({ imageText: ocrResult.text, account });
    } else if (!url) {
      ingested = await ingestSocialContent({ text, account });
    } else {
      stage({ id: 'fetch', name: 'Opening the link' });
      // A platform link is read by the social ingester; anything else is an
      // ordinary web page and goes to the article reader.
      ingested = await ingestSocialContent({ url, account });
      if (!ingested) {
        const article = await extractArticle(url);
        ingested = {
          title: article.title,
          content: article.content,
          source: article.source.name,
          url: article.url,
          modality: 'article',
          provenance: null,
          // When the publisher blocked reading and only the headline could be
          // recovered, the reader is told that is all that was checked.
          ingestNotes: article.readNote ? [article.readNote] : [],
          // Only a date the page actually carried. The extractor falls back to
          // "now" for its own callers; here a guessed date would make every
          // undated article look too recent to check.
          publishedAt: article.publishedAtKnown ? article.publishedAt : null
        };
      }
    }

    // Before anything expensive, and before anything is claimed: can this be
    // checked at all? Most of what people paste — "they are hiding the truth,
    // wake up" — asserts nothing a newsroom could confirm or deny. Running the
    // pipeline on it yields a verdict, and the verdict is meaningless. A system
    // that answers the questions it cannot answer teaches people to distrust
    // the answers it gets right, so this refuses instead, and says what would
    // make the input usable.
    const checkability = assessCheckability(ingested.content, ingested.title);
    if (!checkability.checkable) {
      throw new ContentCheckError(422, {
        error: checkability.reason,
        checkable: false,
        kind: checkability.kind,
        missing: checkability.missing,
        readText: ocrResult ? { chars: ocrResult.text.length, confidence: ocrResult.confidence } : null
      });
    }

    stage({
      id: 'read',
      name: 'Read',
      title: ingested.title,
      modality: ingested.modality || 'text',
      source: ingested.source || null,
      chars: String(ingested.content || '').length
    });

    const report = await analyzeTrust({
      title: ingested.title,
      content: limitText(ingested.content, TEXT_BUDGET.factors),
      source: ingested.source,
      url: ingested.url,
      provenance: ingested.provenance,
      modality: ingested.modality,
      publishedAt: ingested.publishedAt || null,
      textCoverage: 'full',
      onChannel
    });

    return {
      ...report,
      ingestNotes: ingested.ingestNotes,
      readText: ocrResult ? { chars: ocrResult.text.length, confidence: ocrResult.confidence, languages: ocrResult.languages } : null,
      cached: false
    };
  } catch (err) {
    if (err instanceof ContentCheckError) throw err;
    // A platform that refuses to be read is not a server fault, and the message
    // tells the reader exactly what to do instead.
    if (err.code === 'PLATFORM_UNREADABLE') {
      throw new ContentCheckError(422, { error: err.message, platform: err.platform, canRetryWith: ['text', 'screenshot'] });
    }
    if (err.code === 'OCR_UNAVAILABLE' || err.code === 'OCR_FAILED') {
      throw new ContentCheckError(503, { error: err.message });
    }
    // A link we cannot parse is a bad request; a site that refuses automated
    // reading is a condition upstream of us. Reporting either as 500 says the
    // server broke, which is both untrue and unhelpful to whoever is reading
    // the logs.
    if (err.code === 'BAD_URL') {
      throw new ContentCheckError(400, { error: err.message });
    }
    // A host that does not resolve, a page that is not an article, a body too
    // short to check: each is a fact about the link, and each already carries
    // a message written for the reader. Only an unrecognised fault is a 500.
    if (err.code === 'FETCH_BLOCKED' || err.code === 'FETCH_FAILED') {
      throw new ContentCheckError(422, { error: err.message, canRetryWith: ['text', 'screenshot'] });
    }
    console.error('Content analysis failed:', err.message);
    throw new ContentCheckError(500, { error: err.message || 'Failed to analyse that content.' });
  }
};

router.post('/analyze-content', async (req, res) => {
  try {
    res.json(await runContentCheck(req.body));
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: 'Failed to analyse that content.' });
  }
});

// What a plain language model says about the same text, with nothing to read.
// Shown beside the verdict on request, so the difference evidence makes is
// visible rather than asserted. See agents/plainModelBaseline.js.
router.post('/plain-answer', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Send the text to ask about.' });
  res.json(await askPlainModel(text));
});

// The same check, streamed: what was read, then each evidence channel as it
// lands with its one-line finding, then the report. Newline-delimited JSON,
// for the same reason as the article stream below — the input is POSTed.
router.post('/analyze-content/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => { closed = true; });
  const emit = (event) => {
    if (closed || res.writableEnded) return;
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    emit({ type: 'start' });
    const report = await runContentCheck(req.body, {
      onStage: (event) => emit({ type: 'stage', ...event }),
      onChannel: (event) => emit({ type: 'channel', ...event })
    });
    emit({ type: 'report', report });
  } catch (err) {
    // A refusal travels with its status so the page can show it as a refusal,
    // not as a fault.
    emit({ type: 'error', status: err.status || 500, ...(err.payload || { error: 'Failed to analyse that content.' }) });
  }
  res.end();
});

// The same analysis, streamed.
//
// A full analysis takes seconds, and the reader used to see nothing at all
// until every check had finished. This sends each check the moment it lands, so
// the page fills in progressively instead of holding a spinner.
//
// Newline-delimited JSON rather than Server-Sent Events, because the article
// body has to be POSTed and the browser's EventSource is GET-only. The client
// reads it with fetch() and a stream reader.
router.post('/trust-analysis/stream', async (req, res) => {
  const { title, content, source, url, publishedAt } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required.' });
  }
  const sourcePrint = printOf(content, title);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');   // stop proxies buffering the stream
  res.flushHeaders?.();

  // Watch the RESPONSE for the client going away, not the request. A request
  // stream emits 'close' as soon as its body has been read, which for a POST is
  // immediately — listening there suppressed every single event.
  let closed = false;
  res.on('close', () => { closed = true; });
  const emit = (event) => {
    if (closed || res.writableEnded) return;
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    if (url) {
      const cached = await TrustReportCache.findOne({ articleUrl: url }).lean();
      if (isUsableCachedReport(cached, sourcePrint)) {
        emit({ type: 'report', report: { ...cached.report, cached: true } });
        return res.end();
      }
    }

    emit({ type: 'start', total: 6 });

    const resolved = await resolveArticleText({ url, title, fallback: sanitizeContent(content) });
    emit({ type: 'source-text', coverage: resolved.source, chars: resolved.chars });

    const report = await analyzeTrust({
      title,
      content: limitText(resolved.text || content, TEXT_BUDGET.factors),
      source,
      url,
      // The article page is how most stories are opened, and feed headlines
      // are hours old while the news index runs about a day behind. Without the
      // date, every fresh feed story was told no other outlet reported it.
      publishedAt: publishedAt || null,
      textCoverage: resolved.source,
      onProgress: (step) => emit({ type: 'progress', ...step })
    });

    await cacheTrustReport({ url, title, source, report, sourcePrint });

    emit({ type: 'report', report: { ...report, cached: false } });
    res.end();
  } catch (err) {
    console.error('Streamed trust analysis failed:', err.message);
    // The stream is already open, so the failure is reported inside it rather
    // than as a status code the client will never look at.
    emit({ type: 'error', error: 'Failed to run trust analysis.' });
    res.end();
  }
});

// Read any news link the user pastes (e.g. shared on WhatsApp) and return it
// in the same shape as a feed article, so the normal article flow — summary,
// trust check, coverage comparison — works on it unchanged.
router.post('/extract-article', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please paste a news link.' });
  }
  try {
    const article = await extractArticle(url.trim());
    res.json({ article });
  } catch (err) {
    // When a publisher blocks automated reading we still know who published
    // it — report that rather than leaving the reader with nothing.
    if (err.code === 'FETCH_BLOCKED') {
      const reputation = getSourceReputation(err.hostname, err.url);
      return res.status(422).json({
        error: err.message,
        partial: {
          sourceName: reputation.matched ? reputation.matchedName : err.hostname.replace(/^www\./, ''),
          matched: reputation.matched,
          score: reputation.score,
          bias: reputation.matched ? reputation.bias : null,
          note: reputation.matched
            ? `What we can tell you: ${reputation.matchedName} is rated ${reputation.score}/10 for factual reporting${reputation.bias && reputation.bias !== 'unknown' ? `, with a ${reputation.bias} editorial lean` : ''}.`
            : 'We also have no reliability record for this publisher, so treat the article with extra care.'
        }
      });
    }
    // Other messages are already written for the reader.
    res.status(422).json({ error: err.message });
  }
});

// Feed badges: for a list of articles, return what we can show immediately —
// the full cached score when the article has been analyzed before, otherwise
// an instant source-reputation hint. No LLM calls, so this stays fast enough
// to run for a whole page of articles.
router.post('/trust-badges', async (req, res) => {
  const { articles } = req.body;
  if (!Array.isArray(articles)) {
    return res.status(400).json({ error: 'articles array is required.' });
  }
  try {
    const urls = articles.map(a => a && a.url).filter(Boolean);
    const cached = await TrustReportCache.find({ articleUrl: { $in: urls } })
      .select('articleUrl report')
      .lean();
    const cacheByUrl = new Map(
      cached.filter(c => isCurrent(c.report)).map(c => [c.articleUrl, c.report])
    );

    const badges = articles.filter(Boolean).map(article => {
      const hit = article.url && cacheByUrl.get(article.url);
      if (hit) {
        return {
          url: article.url,
          kind: 'analyzed',
          score: hit.overallScore,
          // The one-word answer, so a caller can tally outcomes without
          // re-deriving them from a label that is written for prose.
          call: hit.call || null,
          verdict: hit.verdict,
          level: hit.verdictLevel,
          concernCount: (hit.concernPoints || []).length
        };
      }

      const sourceName = article.source?.name || article.source;
      const reputation = getSourceReputation(sourceName, article.url);
      return {
        url: article.url,
        kind: 'source-only',
        score: reputation.score,
        sourceMatched: reputation.matched,
        sourceName: reputation.matchedName,
        bias: reputation.matched ? reputation.bias : null,
        label: reputation.matched
          ? (reputation.score >= 7.5 ? 'Reliable source'
            : reputation.score >= 5 ? 'Mixed record'
            : 'Low-rated source')
          : 'Unrated source'
      };
    });

    res.json({ badges });
  } catch (err) {
    console.error('Trust badges failed:', err);
    res.status(500).json({ error: 'Failed to load trust badges.' });
  }
});

// Compare Coverage: how different outlets reported the same story, each with
// its source reputation and headline quality, plus a framing comparison.
router.post('/compare-coverage', async (req, res) => {
  const { title, query, source, url } = req.body;
  if (!title && !query) {
    return res.status(400).json({ error: 'An article title or a search query is required.' });
  }
  try {
    const report = await compareCoverage({ title, query, source, url });
    res.json(report);
  } catch (err) {
    console.error('Coverage comparison failed:', err.message);
    // A search that could not run — most often the day's news quota — is a
    // condition the reader can understand and wait out, so it is said plainly
    // rather than as an unexplained failure.
    if (err.searchUnavailable || err.code === 'NEWS_QUOTA_EXHAUSTED') {
      return res.status(err.httpStatus || 503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to compare coverage.' });
  }
});

router.post('/detailed-summary', async (req, res) => {
  try {
    const { article, url, title } = req.body;
    if (!article) {
      return res.status(400).json({ error: 'Article content is required' });
    }

    const result = await summariseWithCache('detailed', { url, title, text: article }, generateDetailedSummary);
    res.json(result);
  } catch (error) {
    console.error('Error generating detailed summary:', error);
    res.status(500).json({ error: 'Failed to generate detailed summary' });
  }
});


// Exposed for tests only: the caching and fingerprint policy are pure functions.
router.__test = { isCompleteReport, isUsableCachedReport, printOf };

module.exports = router;
