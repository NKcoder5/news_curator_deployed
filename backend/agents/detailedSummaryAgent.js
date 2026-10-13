// agents/detailedSummaryAgent.js
//
// Longer summary, shown when the reader asks to "read a longer summary".
//
// Same history and same shape as summarizeAgent.js — see the note there. The
// answer is requested as a JSON field so the model's own reasoning cannot end
// up in what the reader sees, and the token budget is large enough to hold
// both.
//
// "Detailed" means it uses more of what is in the text — not that it adds
// anything the text does not contain.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { UNTRUSTED_NOTICE, fence, clip } = require('../utils/untrusted');

const REASONING_LEAK = /^\s*(we (need|must|should|can)\b|let me\b|first,? I\b|the text (is|appears)\b|okay,?\s|so we\b|i('| a)m going to\b)/i;

/**
 * Produce a fuller summary using only the text provided.
 * @param {string} article - article text (often truncated by the news feed)
 * @returns {Promise<string>} plain-text summary
 * @throws when the model returns nothing usable
 */
const generateDetailedSummary = async (article) => {
  const text = String(article || '').trim();
  if (!text) throw new Error('No article text was supplied to summarise.');

  // Never ask for more words than the source can honestly support.
  const target = text.length < 400 ? 'about 40 words'
    : text.length < 1200 ? 'about 80 words'
    : '100 to 150 words';

  // The key is DESCRIBED, not shown as a template.
  //
  // Constrained JSON decoding and a placeholder schema do not mix. Given
  // `{"summary": "<the summary, as plain prose>"}` in JSON mode, the model
  // returned a bare `{}` on every attempt — valid JSON, no summary, and the
  // page showed "Failed to analyze summary. Please try again." Asked in words
  // for an object with one key called "summary", the same model answered
  // correctly every time. The difference is the template: with the structure
  // already supplied and the only slot a placeholder, closing the object is a
  // valid completion.
  const prompt = `Read the news text below and write a summary of it for a reader in ${target}, covering its key points and any context the text itself gives.

Cover only what the text actually says. If it breaks off mid-story, summarise the part that is there — do not continue the story yourself.

Return a JSON object with exactly one key, "summary", whose value is that summary as a plain-prose string.

${UNTRUSTED_NOTICE}

Text:
${fence(text, { label: 'news text', max: 6000 })}`;

  const data = await callNimApiJson(prompt, { maxTokens: 1100, temperature: 0.2, requiredKeys: ['summary'], label: 'detailed summary' });

  const summary = clip(data?.summary, 3000);
  if (!summary) throw new Error('The model returned no summary text.');
  if (REASONING_LEAK.test(summary)) {
    throw new Error('The model narrated its instructions instead of summarising.');
  }
  return summary;
};

module.exports = generateDetailedSummary;
