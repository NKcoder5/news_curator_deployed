// backend/agents/currentCoverage.js
//
// What does this week's news about the SUBJECT take for granted?
//
// The news search looks for the claimed event and, for an invented event,
// finds nothing — and nothing is all it can report. But an invented event
// about a heavily covered subject leaves a different trace: the rest of the
// week's coverage carries on as though it never happened, because it didn't.
//
//   "PM Modi resigned today"           — today's headlines: "PM Modi launches
//                                        projects worth Rs 13,000 crore in Chennai"
//   "Income tax abolished from 2026"   — this week's: "Income Tax Dept launches
//                                        'Kar Saathi' to simplify tax filing"
//   "Kohli retired from all cricket"   — "Virat Kohli's final ODI window to
//                                        break Sachin's record"
//
// None of those headlines is ABOUT the claim, so the stance judge rightly
// calls them unrelated. Each one, though, only makes sense if the claim is
// false. That is an implicit contradiction, and it is checkable: the headline
// is quoted, dated and published by an outlet that can be counted like any
// other.
//
// A second, weaker signal is plain absence. If the claimed event would have
// dominated coverage of a subject that is covered every day, and a week of
// that coverage never mentions it, that silence means something. The guards
// on this are deliberately tight — see verdictEngine R6c — because an ordinary
// event going unmentioned in twenty headlines means nothing at all.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchGoogleNews } = require('../utils/newsFetcher');

/** The window of coverage read. Long enough to cover a quiet week. */
const WINDOW = '7d';
const MAX_HEADLINES = 20;

const norm = (text) => String(text || '').toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim();

/** The subjects to read coverage of: what the extractor named, once each. */
const subjectsFor = (claims = []) => {
  const subjects = [];
  for (const c of claims.slice(0, 2)) {
    const subject = String(c.subject || '').replace(/[^\p{L}\p{N}\s.&-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (subject && subject.split(' ').length <= 5 && !subjects.some(s => norm(s) === norm(subject))) subjects.push(subject);
  }
  return subjects;
};

const judge = async (claimText, headlines) => {
  const today = new Date().toISOString().slice(0, 10);
  const lines = headlines.map((h, i) => `${i + 1}. [${(h.publishedAt || '').slice(0, 10) || 'undated'}] ${h.source}: ${h.title}`).join('\n');

  const prompt = `Today is ${today}. A user wants to know whether this claim is true:

"${String(claimText).slice(0, 500)}"

Below are this week's news headlines about the claim's subject, with their dates and outlets. Most will not be about the claim at all. Read each one and decide:

- "reports_event": true when the headline reports that the claimed event or state of affairs is real.
- "presupposes_false": true only when the headline, dated AFTER the claimed event would have happened, describes something that could not be happening if the claim were true. Examples: claim "Modi resigned as Prime Minister on Monday", headline dated Wednesday "PM Modi inaugurates projects in Chennai" (he is still Prime Minister); claim "income tax has been abolished", headline "ITR filing deadline extended" (income tax still exists); claim "Kohli retired from all cricket", headline "Kohli to play ODI series next week". A headline that is merely silent about the claim, or about a different matter, is NOT presupposing it false. If the claim is about the future, nothing presupposes it false.
- "reported": the exact words copied from the headline that report the event or that show the claim is false. Empty when neither applies.

Then judge the claim as a whole:
- "event_scale": "dominant" when, had the claimed event happened in the time it claims, it would be the biggest story about this subject — most of the week's headlines about the subject would be about it (a head of government resigning, a national tax being abolished, a famous athlete retiring). "minor" otherwise: an announcement, a scheme, a local decision, an ordinary result, which could easily go unmentioned among these headlines.
- "claimed_when": "this_week" when the claimed event is said to have happened within the dates these headlines cover, "earlier" when before them, "future" when it has not happened yet, "ongoing" when the claim describes a continuing state of affairs (an office held, a law in force), "unclear" otherwise.

Use only these headlines and dates, not your own knowledge.

Headlines:
${lines}

Return a JSON object: {"event_scale": "dominant" | "minor", "claimed_when": "this_week" | "earlier" | "future" | "ongoing" | "unclear", "items": [{"n": <headline number>, "reports_event": true or false, "presupposes_false": true or false, "reported": "<exact words or empty>"}]}`;

  return callNimApiJson(prompt, {
    maxTokens: 1600, temperature: 0, requiredKeys: ['items', 'event_scale'], label: 'current coverage'
  });
};

/**
 * Read this week's coverage of each claim's subject for what it takes for
 * granted.
 *
 * @param {Array} claims - extracted claims, with a `subject` field
 * @returns {Promise<{status: string, subject: string|null, headlinesRead: number,
 *   outletsRead: number, eventScale: string|null, claimedWhen: string|null,
 *   presupposingFalse: Array, reporting: Array, explanation: string}>}
 *   status: 'presupposed-false' | 'absent' | 'reported' | 'silent' | 'thin' | 'none' | 'error'
 */
const checkCurrentCoverage = async (claims = []) => {
  const subjects = subjectsFor(claims);
  const empty = (status, explanation, extra = {}) => ({
    status, subject: subjects[0] || null, headlinesRead: 0, outletsRead: 0, eventScale: null, claimedWhen: null,
    presupposingFalse: [], reporting: [], explanation, ...extra
  });
  if (subjects.length === 0) return empty('none', 'No named subject to read coverage of.');

  // One subject is enough when it is the claim's own; the second claim's
  // subject is read only if the first returns little.
  let headlines = [];
  let subject = subjects[0];
  for (const s of subjects) {
    try {
      headlines = await searchGoogleNews(`${s} when:${WINDOW}`, '', MAX_HEADLINES, 'en');
    } catch (_) {
      return empty('error', 'This week\'s coverage could not be read just now.');
    }
    subject = s;
    if (headlines.length >= 8) break;
  }

  const outlets = new Set(headlines.map(h => h.source.toLowerCase()));
  if (headlines.length < 8 || outlets.size < 4) {
    return empty('thin', `Too little recent coverage of ${subject} for its silence to mean anything.`,
      { subject, headlinesRead: headlines.length, outletsRead: outlets.size });
  }

  let result;
  try {
    result = await judge(claims.slice(0, 2).map(c => c.claim).join(' '), headlines);
  } catch (_) {
    return empty('error', 'This week\'s coverage could not be compared with the claim.', { subject });
  }

  // Every quote must be in the headline it is attributed to — the same rule
  // the stance judgement is held to.
  const pick = (flag) => (Array.isArray(result?.items) ? result.items : [])
    .filter(it => it && it[flag] === true)
    .map(it => {
      const h = headlines[Number(it.n) - 1];
      const quoted = norm(it.reported);
      if (!h || quoted.length < 4 || !norm(h.title).includes(quoted)) return null;
      return { source: h.source, title: h.title, url: h.url, publishedAt: h.publishedAt, reported: String(it.reported).trim(), reliability: 0 };
    })
    .filter(Boolean);

  const reporting = pick('reports_event');
  const presupposingFalse = pick('presupposes_false');
  const eventScale = result?.event_scale === 'dominant' ? 'dominant' : 'minor';
  const claimedWhen = String(result?.claimed_when || 'unclear');
  const base = { subject, headlinesRead: headlines.length, outletsRead: outlets.size, eventScale, claimedWhen, presupposingFalse, reporting };

  if (reporting.length > 0) {
    return { ...base, status: 'reported', explanation: `${reporting.length} of this week's headlines about ${subject} report it.` };
  }
  if (presupposingFalse.length > 0 && claimedWhen !== 'future') {
    return { ...base, status: 'presupposed-false',
      explanation: `This week's coverage of ${subject} only makes sense if the claim is false: "${presupposingFalse[0].reported}" (${presupposingFalse[0].source}).` };
  }
  if (eventScale === 'dominant' && claimedWhen === 'this_week') {
    return { ...base, status: 'absent',
      explanation: `${headlines.length} headlines about ${subject} from ${outlets.size} outlets this week, and not one mentions an event that would have dominated them.` };
  }
  return { ...base, status: 'silent', explanation: `This week's coverage of ${subject} neither mentions nor rules out the claim.` };
};

module.exports = { checkCurrentCoverage, subjectsFor };
