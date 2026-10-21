/**
 * The reader's record: what the checks found about the stories this reader opened, week by week and
 * outlet by outlet. Pure functions over the reading history (one entry per article: articleId is its
 * URL, lastViewed, source) and the cached verdicts (one per checked article: url, call).
 *
 * A story with no cached verdict is "not checked", never counted as clean: an unchecked article is not
 * a confirmed one.
 */

// The outcomes a week is split into, in the order they are drawn.
export const OUTCOMES = [
  { key: 'confirmed', label: 'Confirmed', tone: 'real' },
  { key: 'mixed', label: 'Partly false or misleading', tone: 'partly' },
  { key: 'false', label: 'Found false', tone: 'fake' },
  { key: 'unproven', label: 'Unproven', tone: 'unknown' },
  { key: 'unchecked', label: 'Not checked', tone: 'none' },
];

const OUTCOME_OF_CALL = {
  REAL: 'confirmed',
  FAKE: 'false',
  'PARTLY FALSE': 'mixed',
  MISLEADING: 'mixed',
  'CANNOT VERIFY': 'unproven',
};

const DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00, local time, of the week holding `date`. */
export const weekStart = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

const emptyCounts = () => Object.fromEntries(OUTCOMES.map((o) => [o.key, 0]));

const outcomeOf = (callByUrl, article) => {
  const call = callByUrl.get(article.articleId);
  // A satire or "not a factual claim" verdict is a check that found nothing to confirm or deny.
  return call ? OUTCOME_OF_CALL[call] || 'unproven' : 'unchecked';
};

const indexCalls = (verdicts) => new Map((verdicts || []).filter((v) => v && v.url && v.call).map((v) => [v.url, v.call]));

/**
 * The last `weeks` weeks, oldest first, each with how many stories were opened and what the checks
 * found about them. A week with nothing opened is kept, so the gaps show.
 */
export const weeklyRecord = (history, verdicts, { weeks = 8, now = Date.now() } = {}) => {
  const callByUrl = indexCalls(verdicts);
  const thisWeek = weekStart(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * i);
    out.push({ start, opened: 0, counts: emptyCounts() });
  }
  const first = out[0].start.getTime();
  for (const article of history || []) {
    if (!article || !article.lastViewed) continue;
    const t = new Date(article.lastViewed).getTime();
    if (!Number.isFinite(t) || t < first || t > now + DAY) continue;
    const week = out[Math.min(out.length - 1, Math.floor((weekStart(t).getTime() - first) / (7 * DAY) + 0.01))];
    week.opened += 1;
    week.counts[outcomeOf(callByUrl, article)] += 1;
  }
  return out;
};

/** The outlets read most, with what the checks found about their stories this reader opened. */
export const outletRecord = (history, verdicts, { top = 6 } = {}) => {
  const callByUrl = indexCalls(verdicts);
  const byOutlet = new Map();
  for (const article of history || []) {
    if (!article) continue;
    const name = String(article.source || '').trim() || 'Unknown outlet';
    const row = byOutlet.get(name) || { source: name, opened: 0, checked: 0, counts: emptyCounts() };
    const outcome = outcomeOf(callByUrl, article);
    row.opened += 1;
    if (outcome !== 'unchecked') row.checked += 1;
    row.counts[outcome] += 1;
    byOutlet.set(name, row);
  }
  return [...byOutlet.values()]
    .sort((a, b) => b.opened - a.opened || b.checked - a.checked || a.source.localeCompare(b.source))
    .slice(0, top);
};

/** One sentence for the reader, from the whole record. Null when nothing has been checked. */
export const recordSummary = (history, verdicts) => {
  const callByUrl = indexCalls(verdicts);
  const counts = emptyCounts();
  for (const article of history || []) if (article) counts[outcomeOf(callByUrl, article)] += 1;
  const checked = Object.entries(counts).filter(([k]) => k !== 'unchecked').reduce((s, [, n]) => s + n, 0);
  if (!checked) return null;
  const parts = [`${counts.confirmed} of ${checked} checked ${checked === 1 ? 'story was' : 'stories were'} confirmed`];
  if (counts.false) parts.push(`${counts.false} found false`);
  if (counts.mixed) parts.push(`${counts.mixed} partly false or misleading`);
  return `${parts.join(', ')}.`;
};
