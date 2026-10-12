// backend/services/contentCheck.js
//
// Check Anything as a service: ingest whatever was sent (text, a link, a
// screenshot), gate it, and run the full check. The JSON route, the streamed
// route and the evaluation suites all call this, so what is measured is
// exactly what the page does.
const { analyzeTrust } = require('../agents/trustAnalysisAgent');
const { extractArticle } = require('../utils/articleExtractor');
const { ingestSocialContent } = require('../utils/socialIngest');
const { readImageText, packForLanguage } = require('../utils/ocr');
const { assessCheckability } = require('../agents/checkability');
const { limitText, TEXT_BUDGET } = require('../utils/articleText');
const { understandInput } = require('../agents/inputUnderstanding');
const { recordCheck } = require('./claimMemory');
const { runWithContext, currentContext } = require('../utils/runContext');
const { translateVerdict } = require('../agents/verdictTranslation');

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

const checkContent = async (requestBody, { onStage, onChannel, trigger = 'user' } = {}) => {
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

    // A message someone typed or forwarded is read for what it asserts before
    // the gate decides. The regular-expression gate alone refused every
    // question, and could not see past a hedge, sarcasm, Tanglish or a forward
    // in capitals; this reading can. Articles and transcripts keep the
    // ordinary path. If the reading fails, the gate below decides as before.
    let understanding = null;
    // Too short for the gate is not too short to read: "indai won 84 medels in
    // asian games 2026" is 39 characters, one under the gate's minimum, and a
    // Tamil headline is often three words. Only a scrap is skipped.
    const words = String(ingested.content || '').trim().split(/\s+/).filter(Boolean).length;
    const readable = String(ingested.content || '').trim().length >= 12 && words >= 3;
    if (['text', 'image'].includes(ingested.modality || 'text') && (checkability.kind !== 'too-short' || readable)) {
      stage({ id: 'understanding', name: 'Working out what the message claims' });
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

    let ledgerInput = null;
    const report = await analyzeTrust({
      title: ingested.title,
      content: limitText(ingested.content, TEXT_BUDGET.factors),
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
      onLedgerInput: (input) => { ledgerInput = input; }
    });

    // The one-line reason in the reader's own language, for a message written
    // in an Indian script. Romanised Tamil or Hindi readers read English.
    const localLine = understanding && understanding.language !== 'en' && !understanding.romanized
      ? await translateVerdict(report.oneLine, report.call, understanding.language, understanding.languageName)
      : null;

    // Kept as a record: the claim, its evidence and the inputs the verdict
    // was reached from (services/claimMemory.js). What the memory already knew
    // — checked before, a variant of an earlier claim — comes back for the page.
    // A failure here is logged and ignored: the reader's answer never waits on it.
    let memory = null;
    try {
      memory = await recordCheck({
        report, understanding, ledgerInput,
        modelCalls: currentContext()?.calls || [],
        messageText: ingested.content, trigger, modality: ingested.modality || 'text'
      });
    } catch (err) {
      console.warn('Claim memory: could not record this check:', err.message);
    }

    return {
      ...report,
      oneLineLocal: localLine,
      memory,
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

module.exports = { runContentCheck, ContentCheckError };
