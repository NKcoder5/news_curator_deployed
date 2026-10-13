// backend/services/contentCheck.js
//
// Check Anything as a service: ingest whatever was sent (text, a link, a
// screenshot), gate it, and run the full check. The JSON route, the streamed
// route and the evaluation suites all call this, so what is measured is
// exactly what the page does.
const crypto = require('crypto');
const { analyzeTrust, startMessageChecks } = require('../agents/trustAnalysisAgent');
const { extractArticle } = require('../utils/articleExtractor');
const { ingestSocialContent } = require('../utils/socialIngest');
const { readImageText, packForLanguage } = require('../utils/ocr');
const { assessCheckability } = require('../agents/checkability');
const { limitText, TEXT_BUDGET } = require('../utils/articleText');
const { understandInput } = require('../agents/inputUnderstanding');
const { lookupClaims, prepareRecord, stillCurrent, noteSeenAgain, ENGINE_VERSION } = require('./claimMemory');
const { explainDecision } = require('./decisionExplainer');
const { trackRecordFor } = require('./ruleReliability');
const { runWithContext, currentContext } = require('../utils/runContext');
const { translateVerdict } = require('../agents/verdictTranslation');

// How long the evidence channels of a reader's check have to land. Measured on
// 12 Oct the slowest channel landed 8.8 s after the claims were known (the
// reference check on NVIDIA NIM), the others within 5.5 s; a busy provider has
// held a check for 25-50 s. A channel still out at 15 s is reported as not
// read in time and counts as absent (agents/trustAnalysisAgent.js, UNREAD).
// Re-checks have no reader waiting and wait for everything.
const EVIDENCE_DEADLINE_MS = 15000;

// The claim memory's lookup runs beside the evidence; if it is still out this
// long after the verdict, the answer goes without the "checked before" panel
// and the check is filed when the lookup finishes.
const MEMORY_GRACE_MS = 1500;

/* ---------------------------------------------------------------------------
   Checked minutes ago

   The same message sent again soon after — a forward pasted by several
   readers, a reader asking twice — is answered from the check just made,
   marked `cached` with its age, instead of spending another 6-12 s and the
   same quota to reach the same evidence.

   Kept short, twenty minutes, because claims about "now" are time-sensitive:
   a result declared at noon is not in the 11:50 coverage. And kept narrow:
   only the identical message (same text, source, link and kind), because the
   stored report quotes the message — its first line, the sentences the
   writing checks flagged, its English reading — and must never be shown to a
   reader who did not send it; and the writing checks, which can decide a
   verdict (verdictEngine R7), read the wording. Served only while its claim
   records still point at the check it came from (no re-check, no later check
   of the same claim since) and the verdict engine is the same version; only
   to readers, never to a re-check or an evaluation run; only from a complete
   check, with every channel read.
--------------------------------------------------------------------------- */
const RECENT_TTL_MS = 20 * 60 * 1000;
const RECENT_MAX = 200;
const recentChecks = new Map();

// Spacing is not a different message; capitals are, since the writing checks
// read a forward in capitals as shouting.
const requestKey = (ingested) => crypto.createHash('sha256').update(JSON.stringify([
  ingested.modality || 'text', ingested.source || null, ingested.url || null, ingested.publishedAt || null,
  String(ingested.title || '').replace(/\s+/g, ' ').trim(),
  String(ingested.content || '').replace(/\s+/g, ' ').trim()
])).digest('hex');

const isComplete = (report) => (report.unreadChannels || []).length === 0
  && (report.degradedFactors || []).length === 0
  && report.decision?.rule !== 'verification-unavailable'
  && ![report.factChecks?.status, report.currentCoverage?.status, report.premiseCheck?.status].includes('error');

const rememberCheck = (key, result, stored) => {
  recentChecks.delete(key);
  recentChecks.set(key, { at: Date.now(), engine: ENGINE_VERSION, ...stored, result: structuredClone(result) });
  while (recentChecks.size > RECENT_MAX) recentChecks.delete(recentChecks.keys().next().value);
};

/** The check this same message had minutes ago, if it is still the claim's latest. */
const recentCheck = async (key) => {
  const hit = recentChecks.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= RECENT_TTL_MS || hit.engine !== ENGINE_VERSION) {
    recentChecks.delete(key);
    return null;
  }
  const timesSeen = await stillCurrent(hit.recordIds, hit.assessmentId);
  if (!timesSeen) {
    recentChecks.delete(key);
    return null;
  }
  noteSeenAgain(hit.recordIds).catch(err => console.warn('Claim memory: could not count a repeat:', err.message));
  const result = structuredClone(hit.result);
  if (result.memory) {
    result.memory.claims = (result.memory.claims || []).map((c, i) => ({ ...c, timesSeen: (timesSeen[i] || 0) + 1 }));
  }
  return { ...result, cached: true, checkedAt: new Date(hit.at).toISOString(), ageSeconds: Math.round((Date.now() - hit.at) / 1000) };
};

// Claim-memory writes still in flight after their answers went out.
const pendingWrites = new Set();

/**
 * Settles once every check answered so far has been filed. A script that
 * exits straight after its last check (the evaluation suites) awaits this
 * first, or the last write is cut off with the process.
 */
const recordsSettled = () => Promise.allSettled([...pendingWrites]).then(() => undefined);

/** Settles with the promise's value, or with `fallback` after `ms`. */
const within = (promise, ms, fallback) => {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), Math.max(0, ms)); })])
    .finally(() => clearTimeout(timer));
};

// What each kind of message that asserts nothing checkable is told.
const NOT_CHECKABLE = {
  question: { kind: 'question', reason: 'This asks a question but not about anything specific enough to look up. Ask about a named person, place, event or figure.' },
  opinion: { kind: 'opinion', reason: 'This is an opinion. Opinions are not true or false in a way anyone can check.' },
  prediction: { kind: 'prediction', reason: 'This is about the future, so there is nothing yet for anyone to confirm or deny.' },
  exhortation: { kind: 'unfalsifiable', reason: 'This tells the reader what to do but does not say what actually happened.' }
};

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
const runContentCheck = (requestBody, hooks = {}) => runWithContext(() => checkContent(requestBody, hooks));

const checkContent = async (requestBody, { onStage, onChannel, trigger = 'user', recheckOf = null } = {}) => {
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

    // The same message, checked minutes ago, for a reader.
    const key = trigger === 'user' ? requestKey(ingested) : null;
    if (key) {
      const recent = await recentCheck(key).catch(() => null);
      if (recent) {
        stage({ id: 'cached', name: 'Checked a few minutes ago', checkedAt: recent.checkedAt, ageSeconds: recent.ageSeconds });
        return {
          ...recent,
          ingestNotes: ingested.ingestNotes,
          readText: ocrResult ? { chars: ocrResult.text.length, confidence: ocrResult.confidence, languages: ocrResult.languages } : null
        };
      }
    }

    // A message someone typed or forwarded is read for what it asserts before
    // the gate decides. The regular-expression gate alone refused every
    // question, and could not see past a hedge, sarcasm, Tanglish or a forward
    // in capitals; this reading can. Articles and transcripts keep the
    // ordinary path. If the reading fails, the gate below decides as before.
    let understanding = null;
    let early = null;
    const factorText = limitText(ingested.content, TEXT_BUDGET.factors);
    // Too short for the gate is not too short to read: "indai won 84 medels in
    // asian games 2026" is 39 characters, one under the gate's minimum, and a
    // Tamil headline is often three words. Only a scrap is skipped.
    const words = String(ingested.content || '').trim().split(/\s+/).filter(Boolean).length;
    const readable = String(ingested.content || '').trim().length >= 12 && words >= 3;
    if (['text', 'image'].includes(ingested.modality || 'text') && (checkability.kind !== 'too-short' || readable)) {
      stage({ id: 'understanding', name: 'Working out what the message claims' });
      // How the message is written, and what a reference work says about the
      // names in it, do not wait for the reading (trustAnalysisAgent's
      // startMessageChecks). A message refused below leaves them unused.
      early = startMessageChecks({ title: ingested.title, content: factorText });
      understanding = await understandInput(ingested.content);
    }

    if (understanding) {
      stage({
        id: 'understood',
        name: 'Understood',
        languageName: understanding.languageName,
        romanized: understanding.romanized,
        speechAct: understanding.speechAct,
        claims: understanding.checkableClaims.map(c => c.claim)
      });
      if (understanding.checkableClaims.length === 0) {
        const fallback = NOT_CHECKABLE[understanding.speechAct]
          || { kind: 'too-vague', reason: 'This does not name anyone, anywhere or any figure, so there is nothing specific to look up.' };
        throw new ContentCheckError(422, {
          error: understanding.notCheckableReason || fallback.reason,
          checkable: false,
          kind: fallback.kind,
          missing: checkability.missing.length ? checkability.missing : ['a specific claim about a named person, place, event or figure'],
          understanding: { languageName: understanding.languageName, speechAct: understanding.speechAct, english: understanding.english },
          readText: ocrResult ? { chars: ocrResult.text.length, confidence: ocrResult.confidence } : null
        });
      }
    } else if (!checkability.checkable) {
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

    // What the claim memory already knows about these claims — checked before,
    // a variant of an earlier claim — is looked up beside the evidence, since
    // it needs only the claims. A failure is logged and the check goes on.
    const lookup = (claims) => lookupClaims({ claims, understanding, trigger, recheckOf })
      .catch(err => { console.warn('Claim memory: could not look these claims up:', err.message); return null; });
    let planPromise = understanding ? lookup(understanding.checkableClaims.map(c => c.claim)) : null;

    let ledgerInput = null;
    const deadlineMs = trigger === 'recheck' ? null : EVIDENCE_DEADLINE_MS;
    const report = await analyzeTrust({
      title: ingested.title,
      content: factorText,
      source: ingested.source,
      url: ingested.url,
      provenance: ingested.provenance,
      modality: ingested.modality,
      publishedAt: ingested.publishedAt || null,
      textCoverage: 'full',
      onChannel,
      preparedClaims: understanding ? understanding.checkableClaims : null,
      evidenceText: understanding && understanding.language !== 'en' ? understanding.english : null,
      understanding,
      onLedgerInput: (input) => { ledgerInput = input; },
      early,
      deadlineMs
    });

    // The one-line reason in the reader's own language, for a message written
    // in an Indian script. Romanised Tamil or Hindi readers read English.
    const localLine = understanding && understanding.language !== 'en' && !understanding.romanized
      ? await translateVerdict(report.oneLine, report.call, understanding.language, understanding.languageName)
      : null;

    // Kept as a record: the claim, its evidence and the inputs the verdict
    // was reached from (services/claimMemory.js). The page gets what the
    // memory knew now; the record is written after the answer has gone, and a
    // failure there is logged, never shown: the reader's answer does not wait
    // on a database write.
    if (!planPromise && ledgerInput) planPromise = lookup((ledgerInput.claims || []).map(c => c.claim));
    const recordArgs = {
      report, understanding, ledgerInput,
      modelCalls: currentContext()?.calls || [],
      messageText: ingested.content, trigger, modality: ingested.modality || 'text'
    };
    const prepare = (plan) => {
      try {
        return prepareRecord(plan, recordArgs);
      } catch (err) {
        console.warn('Claim memory: could not record this check:', err.message);
        return null;
      }
    };
    const LATE = Symbol('late');
    const plan = !planPromise ? null
      : deadlineMs ? await within(planPromise, MEMORY_GRACE_MS, LATE)
      : await planPromise;
    const prepared = plan === LATE ? null : prepare(plan);
    const memory = prepared ? prepared.memory : null;

    // What decided the verdict and what would change it, found by running the
    // same rules again with evidence taken away or added (services/
    // decisionExplainer.js). Shown only when the rerun reproduces the verdict
    // the reader was given; an explanation of some other verdict is worse
    // than none.
    let explanation = null;
    try {
      const explained = ledgerInput ? explainDecision(ledgerInput) : null;
      if (explained && explained.verdict.call === report.call) explanation = explained;
    } catch (err) {
      console.warn('Decision explainer failed:', err.message);
    }

    const result = {
      ...report,
      oneLineLocal: localLine,
      memory,
      explanation,
      // How often the rule that decided this has been right on labelled test
      // messages (eval/ruleReliability.js): a count, not a hand-set confidence.
      trackRecord: trackRecordFor(report.decision?.rule),
      ingestNotes: ingested.ingestNotes,
      readText: ocrResult ? { chars: ocrResult.text.length, confidence: ocrResult.confidence, languages: ocrResult.languages } : null,
      cached: false
    };

    // The write, after the answer. A lookup that was still out is waited for
    // here, off the reader's time, and the check is filed all the same.
    const filing = prepared ? Promise.resolve(prepared)
      : plan === LATE ? planPromise.then(prepare)
      : Promise.resolve(null);
    const written = filing
      .then(async (p) => {
        if (!p) return;
        await p.write();
        if (key && isComplete(result) && result.memory) rememberCheck(key, result, { recordIds: p.recordIds, assessmentId: p.assessmentId });
      })
      .catch(err => console.warn('Claim memory: could not record this check:', err.message))
      .finally(() => pendingWrites.delete(written));
    pendingWrites.add(written);

    return result;
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

module.exports = { runContentCheck, recordsSettled, ContentCheckError };
