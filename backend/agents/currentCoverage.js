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
const { filterRelevant } = require('./evidenceRelevance');
const { signatureOf } = require('../services/claimSignature');
const { UNTRUSTED_NOTICE, fence, addressesModel, asBool, oneOf, clip, numberedItems } = require('../utils/untrusted');

const CLAIMED_WHEN = new Set(['this_week', 'earlier', 'future', 'ongoing', 'unclear']);

/** The window of coverage read. Long enough to cover a quiet week. */
const WINDOW = '7d';
const MAX_HEADLINES = 20;

const norm = (text) => String(text || '').toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim();

/** The subjects to read coverage of: what the extractor named, once each. */
// A subject is a name the claim itself uses: a person, place or organisation. "All pensioners are receiving
// the ninth consecutive budget pension increase" (a Maltese ruling, rated true) names no country; read as
// the subject "pensioners", a week of Indian coverage of delayed dearness relief ruled it out and it came
// back FAKE. A week of coverage can only rule out an event about a definite subject.
const namedIn = (subject, claimText) => {
  if (/[^\x00-\x7F]/.test(subject)) return true;   // another script: no capitals to read a name by
  const names = new Set(signatureOf(claimText || subject).entities);
  return subject.toLowerCase().split(/\s+/).some(w => names.has(w));
};

const subjectsFor = (claims = []) => {
  const subjects = [];
  // A claim about two parties — "Elon Musk bought Reliance Jio" — is ruled
  // out by either one's week: Jio's coverage says it is planning its own IPO.
  // So each claim's second subject is read too, after every claim's first.
  const add = (raw, claimText) => {
    const subject = String(raw || '').replace(/[^\p{L}\p{N}\s.&-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (subject && subject.split(' ').length <= 5 && namedIn(subject, claimText) && !subjects.some(s => norm(s) === norm(subject))) subjects.push(subject);
  };
  for (const c of claims.slice(0, 2)) add(c.subject, c.claim);
  for (const c of claims.slice(0, 2)) add(c.otherSubject, c.claim);
  return subjects.slice(0, 3);
};

const judge = async (claimText, headlines) => {
  const today = new Date().toISOString().slice(0, 10);
  // One line per headline, so a line break inside a retrieved headline cannot
  // open a numbered item of its own.
  const lines = headlines
    .map((h, i) => `${i + 1}. [${String(h.publishedAt || '').slice(0, 10) || 'undated'}] ${h.source}: ${h.title}`.replace(/\s+/g, ' ').slice(0, 300))
    .join('\n');

  const prompt = `Today is ${today}. A user wants to know whether this claim is true:

${fence(claimText, { label: 'claim', max: 500 })}

${UNTRUSTED_NOTICE}

Below are this week's news headlines about the claim's subject, with their dates and outlets. Most will not be about the claim at all. Read each one and decide:

- "reports_event": true when the headline reports that the claimed event or state of affairs is real.
- "presupposes_false": true only when the headline, dated AFTER the claimed event would have happened, describes something that could not be happening if the claim were true. Examples: claim "Modi resigned as Prime Minister on Monday", headline dated Wednesday "PM Modi inaugurates projects in Chennai" (he is still Prime Minister); claim "income tax has been abolished", headline "ITR filing deadline extended" (income tax still exists); claim "Kohli retired from all cricket", headline "Kohli to play ODI series next week". A headline that is merely silent about the claim, or about a different matter, is NOT presupposing it false. If the claim is about the future, nothing presupposes it false.
- "reported": the exact words copied from the headline that report the event or that show the claim is false. Empty when neither applies.

Then judge the claim as a whole:
- "event_scale": "dominant" when, had the claimed event happened in the time it claims, it would be the biggest story about this subject — most of the week's headlines about the subject would be about it (a head of government resigning, a national tax being abolished, a famous athlete retiring). "minor" otherwise: an announcement, a scheme, a local decision, an ordinary result, which could easily go unmentioned among these headlines.
- "claimed_when": "this_week" when the claimed event is said to have happened within the dates these headlines cover, "earlier" when before them, "future" when it has not happened yet, "ongoing" when the claim describes a continuing state of affairs (an office held, a law in force), "unclear" otherwise.

Use only these headlines and dates, not your own knowledge.

Headlines:
${fence(lines, { label: 'headlines', max: (MAX_HEADLINES + 8) * 301 })}

Return a JSON object: {"event_scale": "dominant" | "minor", "claimed_when": "this_week" | "earlier" | "future" | "ongoing" | "unclear", "items": [{"n": <headline number>, "reports_event": true or false, "presupposes_false": true or false, "reported": "<exact words or empty>"}]}`;

  return callNimApiJson(prompt, {
    maxTokens: 2400, temperature: 0, requiredKeys: ['items', 'event_scale'], label: 'current coverage'
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
  // Every subject's week is read, in parallel, and the headlines interleaved
  // so that no one subject crowds out another.
  const batches = await Promise.allSettled(subjects.map(s => searchGoogleNews(`${s} when:${WINDOW}`, '', MAX_HEADLINES, 'en')));
  if (batches.every(b => b.status === 'rejected')) {
    return empty('error', 'This week\'s coverage could not be read just now.');
  }
  const lists = batches.map(b => (b.status === 'fulfilled' ? b.value : []));
  const seenTitles = new Set();
  let headlines = [];
  for (let i = 0; i < MAX_HEADLINES; i++) {
    for (const list of lists) {
      const h = list[i];
      if (!h || seenTitles.has(norm(h.title))) continue;
      seenTitles.add(norm(h.title));
      headlines.push(h);
    }
  }
  // A headline that tells the model what to answer is not reporting, and is
  // not read (utils/untrusted.js).
  headlines = headlines.filter(h => !addressesModel(h.title)).slice(0, MAX_HEADLINES + 8);
  const subject = subjects.filter((s, i) => lists[i].length > 0).join(' and ') || subjects[0];

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
  // the stance judgement is held to. Only headlines that were shown count,
  // each once.
  const items = numberedItems(result?.items, headlines.length);
  const pick = (flag) => items
    .filter(it => asBool(it[flag]) === true)
    .map(it => {
      const h = headlines[it.n - 1];
      const reported = clip(it.reported, 300);
      const quoted = norm(reported);
      if (!h || quoted.length < 4 || !norm(h.title).includes(quoted)) return null;
      return { source: h.source, title: h.title, url: h.url, publishedAt: h.publishedAt, reported, reliability: 0 };
    })
    .filter(Boolean);

  const reportedByModel = pick('reports_event');
  // Subject coverage is not automatically evidence for the event. A headline
  // about WASP-189b can be relevant to the subject while saying nothing about
  // the article's specific distance or discovery claim. Keep only headlines
  // that also pass the same deterministic event-identity gate used by direct
  // verification.
  const reporting = filterRelevant(
    claims.slice(0, 2).map(c => c.claim).join(' '),
    reportedByModel
  ).kept;
  const presupposingFalse = pick('presupposes_false');
  const eventScale = oneOf(result?.event_scale, ['dominant', 'minor'], 'minor');
  // Read against the five answers the prompt offers. The rules downstream
  // compare it with 'this_week' and 'future', so anything else is "unclear".
  const claimedWhen = oneOf(result?.claimed_when, CLAIMED_WHEN, 'unclear');
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
