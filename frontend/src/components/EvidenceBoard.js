import { BookOpen, CalendarDays, ExternalLink, Newspaper, SearchCheck, Target } from 'lucide-react';
import { Badge } from './ui';
import '../styles/EvidenceBoard.css';

/**
 * The evidence behind a verdict, one panel per channel.
 *
 * A verdict alone invites the question "how would you know?", and a panel of
 * examiners asks it first. Each channel answers a different part of it, so
 * each gets its own panel, says what it found in plain words, quotes the
 * evidence and links to it:
 *
 *   News reporting       — do other outlets report this event, or something else?
 *   Fact-checkers        — has a professional desk already ruled on this claim?
 *   This week's news     — does current coverage of the subject rule it out?
 *   Reference facts      — does an encyclopedia contradict a stated fact?
 *
 * The channel whose finding decided the verdict is marked and comes first, then
 * the channels that found something; the ones that found nothing follow in a
 * compact list, so the evidence that matters is not buried among empty panels.
 */

// Which channel each verdict rule acts on.
const RULE_CHANNEL = {
  'rated-false-by-fact-checkers': 'factChecks',
  'rated-misleading-by-fact-checkers': 'factChecks',
  'rated-true-by-fact-checkers': 'factChecks',
  'page-is-a-published-fact-check': 'factChecks',
  'fact-checkers-and-reporting-disagree': 'factChecks',
  'contradicted-by-multiple-independent-sources': 'news',
  'media-not-confirmed-by-reports': 'news',
  'contradicted-by-one-independent-source': 'news',
  'corroborated-by-multiple-independent-sources': 'news',
  'corroborated-by-one-independent-source': 'news',
  'corroborated-state-media-only': 'news',
  'no-independent-coverage': 'news',
  'contradicted-by-current-coverage': 'week',
  'absent-from-heavy-coverage': 'week',
  'premise-contradicted-by-reference': 'reference',
  'claims-partly-false': 'news',
  'confirmed-claim-on-a-false-premise': 'reference',
  'claim-ruled-out-by-current-coverage': 'week',
  'old-news-presented-as-new': 'news',
  'confirmed-by-reference': 'reference',
  'true-claim-carrying-a-false-one': 'news',
  'only-partly-confirmed': 'news'
};

// What decided it, in a few words, for the line under the verdict.
export const RULE_LABELS = {
  'rated-false-by-fact-checkers': 'Fact-checkers’ rulings',
  'media-not-confirmed-by-reports': 'Reports of the event do not confirm the footage',
  'rated-misleading-by-fact-checkers': 'Fact-checkers’ rulings',
  'rated-true-by-fact-checkers': 'Fact-checkers’ rulings',
  'page-is-a-published-fact-check': 'The page is a published fact-check',
  'fact-checkers-and-reporting-disagree': 'Fact-checkers and current reporting disagree',
  'contradicted-by-multiple-independent-sources': 'Independent outlets report otherwise',
  'contradicted-by-one-independent-source': 'An independent outlet reports otherwise',
  'corroborated-by-multiple-independent-sources': 'Independent outlets confirm it',
  'corroborated-by-one-independent-source': 'One independent outlet confirms it',
  'corroborated-state-media-only': 'Confirmed by state media only',
  'premise-contradicted-by-reference': 'Reference facts contradict it',
  'contradicted-by-current-coverage': 'This week’s news rules it out',
  'absent-from-heavy-coverage': 'Missing from heavy coverage',
  'uncorroborated-high-impact-with-risk-signals': 'No coverage, and warning signs',
  'no-independent-coverage': 'Nothing found either way',
  'too-recent-to-corroborate': 'Too recent to check',
  'verification-unavailable': 'Search could not run',
  'satirical-publisher': 'Satirical publisher',
  'no-checkable-claims': 'No factual claim',
  'no-checkable-claims-poor-record-publisher': 'Nothing checkable, poor-record publisher',
  'claims-partly-false': 'One claim confirmed, another contradicted',
  'confirmed-claim-on-a-false-premise': 'Confirmed, but on a false premise',
  'claim-ruled-out-by-current-coverage': 'This week’s news rules part of it out',
  arithmetic: 'Worked out',
  'title-contradicted': 'The title is contradicted',
  'old-news-presented-as-new': 'Old news shared as new',
  'confirmed-by-reference': 'A reference work confirms it',
  'true-claim-carrying-a-false-one': 'A true claim carrying a false one',
  'only-partly-confirmed': 'Only part of it is confirmed'
};

const STATUS_TEXT = {
  against: 'Against the claim',
  for: 'Supports the claim',
  mixed: 'Mixed',
  none: 'Nothing found',
  clear: 'No conflict',
  unavailable: 'Could not run'
};

const STATUS_TONE = { against: 'fake', for: 'real', mixed: 'partly', none: 'unknown', clear: 'unknown', unavailable: 'misleading' };

// Order of appearance: what the verdict rests on first, what found nothing last.
const STATUS_RANK = { against: 0, for: 0, mixed: 0, clear: 1, none: 1, unavailable: 1 };

const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "84 medals" in "India wins 84 medals", picked out so the eye lands on it. */
const Highlighted = ({ text, phrase }) => {
  const source = String(text || '');
  const target = String(phrase || '').trim();
  const at = target ? source.toLowerCase().indexOf(target.toLowerCase()) : -1;
  if (at < 0) return <>{source}</>;
  return (
    <>
      {source.slice(0, at)}
      <mark className="eb-mark">{source.slice(at, at + target.length)}</mark>
      {source.slice(at + target.length)}
    </>
  );
};

/** One source: what it says about the claim, who published it, and a link. */
const EvidenceItem = ({ side, tag, source, title, phrase, url, date }) => (
  <li className={`eb-item eb-item-${side}`}>
    <Badge tone={side === 'against' ? 'fake' : 'real'} size="xs" className="eb-item-tag">{tag}</Badge>
    <div className="eb-item-body">
      <a href={url} target="_blank" rel="noopener noreferrer" className="eb-item-link">
        <Highlighted text={title} phrase={phrase} />
        <ExternalLink size={13} aria-hidden="true" className="eb-item-external" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <span className="eb-item-meta">
        <strong>{source}</strong>
        {date && <> · {date}</>}
      </span>
    </div>
  </li>
);

/** A claim set against what the outlets (or the encyclopedia) actually say. */
const Versus = ({ says, reportedLabel, reported }) => (
  <div className="eb-versus">
    <div className="eb-versus-side">
      <span className="eb-versus-label">This says</span>
      <span className="eb-versus-text">{says}</span>
    </div>
    <div className="eb-versus-side eb-versus-reported">
      <span className="eb-versus-label">{reportedLabel}</span>
      <span className="eb-versus-text">{reported}</span>
    </div>
  </div>
);

/** Distinct outlets, with the quote each was judged on. */
const outletsFrom = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.source || item.url || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Each channel is described as { id, title, icon, status, summary, body };
// the board decides the order and which ones get a full panel.

const describeNews = (report) => {
  const perClaim = report.evidence?.perClaim || [];
  const verification = (report.factors || []).find((f) => f.id === 'verification');
  const detailClaims = verification?.detail?.claims || [];
  const ran = report.evidence && verification;

  const against = perClaim.reduce((n, c) => Math.max(n, c.independentContradiction || 0), 0);
  const support = perClaim.reduce((n, c) => Math.max(n, c.independentSupport || 0), 0);
  const failed = /could not/i.test(verification?.standDownReason || '') || verification?.detail?.status === 'error';
  const status = failed ? 'unavailable' : against > 0 ? 'against' : support > 0 ? 'for' : 'none';

  // A message whose claims split: say both halves, not only the damning one.
  const split = against > 0 && perClaim.some((c) => c.independentSupport > 0);
  const summary = split
    ? `One claim is confirmed by ${support} independent ${support === 1 ? 'outlet' : 'outlets'}; on another, ${against} ${against === 1 ? 'outlet reports' : 'outlets report'} something different.`
    : status === 'against'
    ? `${against} independent ${against === 1 ? 'outlet reports' : 'outlets report'} something different from what this says.`
    : status === 'for'
      ? `${support} independent ${support === 1 ? 'outlet reports' : 'outlets report'} the same facts.`
      : status === 'unavailable'
        ? 'The news search could not run just now.'
        : 'No outlet reports this event.';

  const body = detailClaims.map((claim, i) => {
    const contra = outletsFrom(claim.contradictingEvidence);
    const confirm = outletsFrom(claim.supportingEvidence);
    if (contra.length === 0 && confirm.length === 0) return null;
    // Quotes carrying the figure first, then the shortest: "85 medals" and
    // "raises repo rate by 25 basis points" say it; a whole headline buries it.
    const hasFigure = (q) => (/\d/.test(q) ? 0 : 1);
    const quotes = [...new Set(contra.map((e) => e.reported).filter(Boolean))]
      .sort((x, y) => hasFigure(x) - hasFigure(y) || x.length - y.length)
      .slice(0, 2)
      .map((q) => (q.length > 70 ? `${q.slice(0, 67)}…` : q));
    return (
      <div key={i} className="eb-claim">
        {contra.length > 0 && quotes.length > 0 && (
          <Versus says={claim.claim} reportedLabel="Outlets report" reported={quotes.map((q) => `“${q}”`).join(' · ')} />
        )}
        <ul className="eb-list">
          {[...contra.map((e) => ({ ...e, side: 'against' })), ...confirm.map((e) => ({ ...e, side: 'for' }))]
            .slice(0, 6)
            .map((e, j) => (
              <EvidenceItem
                key={j}
                side={e.side}
                tag={e.side === 'against' ? 'Says otherwise' : 'Confirms'}
                source={e.source}
                title={e.title}
                phrase={e.reported}
                url={e.url}
                date={formatDate(e.publishedAt)}
              />
            ))}
        </ul>
      </div>
    );
  }).filter(Boolean);

  return { id: 'news', title: 'News reporting', icon: Newspaper, status, summary: ran ? summary : null, body };
};

const FINDING_TEXT = { false: 'Rated false', misleading: 'Rated misleading', true: 'Rated true' };
const FINDING_TONE = { false: 'fake', misleading: 'misleading', true: 'real' };

const describeFactChecks = (factChecks) => {
  if (!factChecks) return null;
  const matches = factChecks.matches || [];
  const status = factChecks.status === 'debunked' || factChecks.status === 'misleading' ? 'against'
    : factChecks.status === 'confirmed' ? 'for'
    : factChecks.status === 'disputed' ? 'mixed'
    : factChecks.status === 'error' ? 'unavailable'
    : 'none';
  const body = matches.length > 0 ? (
    <ul className="eb-cards">
      {matches.slice(0, 6).map((m, i) => (
        <li key={i} className={`eb-card eb-card-${m.finding}`}>
          <div className="eb-card-head">
            <span className="eb-card-publisher">{m.publisher}</span>
            <Badge tone={FINDING_TONE[m.finding] || 'unknown'} size="xs" className={`eb-rating eb-rating-${m.finding}`}>
              {m.rating && m.rating.length <= 24 && m.via !== 'news-search' ? m.rating : FINDING_TEXT[m.finding]}
            </Badge>
          </div>
          {m.claimReviewed && <p className="eb-card-claim">“{m.claimReviewed}”</p>}
          <div className="eb-card-foot">
            {m.reviewedAt && <span>{formatDate(m.reviewedAt)}</span>}
            {m.url && (
              <a href={m.url} target="_blank" rel="noopener noreferrer">
                Read the fact-check <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  ) : null;
  return { id: 'factchecks', title: 'Fact-checkers', icon: SearchCheck, status, summary: factChecks.explanation, body };
};

const describeWeek = (week, newsFound) => {
  if (!week) return null;
  const counted = Boolean(week.counted);
  const against = week.presupposingFalse || [];
  const reporting = week.reporting || [];
  const status = counted ? 'against'
    : week.status === 'reported' ? 'for'
    : week.status === 'error' ? 'unavailable'
    : 'none';
  const title = week.subject ? `This week’s news on ${week.subject}` : 'This week’s news';
  const shown = counted ? against : status === 'for' ? reporting : [];
  // A finding the verdict did not use is described as what it is — the week's
  // coverage does not mention the claim — and not in the words of the rule
  // that would have acted on it.
  const summary = !counted && (week.status === 'absent' || week.status === 'presupposed-false')
    ? `This week’s coverage${week.subject ? ` of ${week.subject}` : ''} does not mention the claim. Not counted: ${newsFound ? 'outlets already report on the event itself' : 'too little to rely on'}.`
    : week.explanation;
  const body = (
    <>
      {week.headlinesRead > 0 && (
        <p className="eb-meta">{week.headlinesRead} headlines from {week.outletsRead} outlets read, from the last seven days.</p>
      )}
      {shown.length > 0 && (
        <ul className="eb-list">
          {shown.slice(0, 5).map((h, i) => (
            <EvidenceItem
              key={i}
              side={counted ? 'against' : 'for'}
              tag={counted ? 'Rules it out' : 'Reports it'}
              source={h.source}
              title={h.title}
              phrase={h.reported}
              url={h.url}
              date={formatDate(h.publishedAt)}
            />
          ))}
        </ul>
      )}
    </>
  );
  return { id: 'week', title, icon: CalendarDays, status, summary, body };
};

const describeReference = (premise) => {
  if (!premise) return null;
  const contradictions = premise.contradictions || [];
  const confirmations = premise.confirmations || [];
  const status = contradictions.length > 0 ? 'against'
    : confirmations.length > 0 ? 'for'
    : premise.status === 'consistent' ? 'clear'
    : premise.status === 'error' ? 'unavailable'
    : 'none';
  const referenceName = (c) => (c.reference?.url
    ? <a href={c.reference.url} target="_blank" rel="noopener noreferrer">{c.reference.title || c.entity}</a>
    : (c.reference?.title || c.entity));
  const body = (
    <>
      {contradictions.length === 0 && confirmations.map((c, i) => (
        <p key={`c${i}`} className="eb-quote">{referenceName(c)}: “{c.referenceStates}”</p>
      ))}
      {contradictions.map((c, i) => (
        <Versus key={i} says={c.articleStates} reportedLabel={referenceName(c)} reported={`“${c.referenceStates}”`} />
      ))}
    </>
  );
  return { id: 'reference', title: 'Reference facts', icon: BookOpen, status, summary: premise.explanation, body };
};

const Panel = ({ channel, decided }) => {
  const Icon = channel.icon;
  return (
    <section className={`eb-panel eb-${channel.status} ${decided ? 'is-decisive' : ''}`} aria-labelledby={`eb-${channel.id}`}>
      <header className="eb-panel-head">
        <h3 id={`eb-${channel.id}`}><Icon size={17} aria-hidden="true" /> {channel.title}</h3>
        <Badge tone={STATUS_TONE[channel.status]} className={`eb-status eb-status-${channel.status}`}>{STATUS_TEXT[channel.status]}</Badge>
      </header>
      {decided && <p className="eb-decided"><Target size={14} aria-hidden="true" /> This decided the verdict</p>}
      {channel.summary && <p className="eb-summary">{channel.summary}</p>}
      {channel.body}
    </section>
  );
};

const EvidenceBoard = ({ report }) => {
  if (!report) return null;
  const decidedBy = RULE_CHANNEL[report.decision?.rule];
  const newsFound = (report.evidence?.perClaim || []).some((c) => c.independentSupport > 0 || c.independentContradiction > 0);
  const channels = [
    { key: 'news', ...describeNews(report) },
    { key: 'factChecks', ...describeFactChecks(report.factChecks) },
    { key: 'week', ...describeWeek(report.currentCoverage, newsFound) },
    { key: 'reference', ...describeReference(report.premiseCheck) }
  ].filter((c) => c.id);

  // A stable sort: the deciding channel, then findings, then the quiet ones,
  // each group keeping the order above.
  const rank = (c) => (c.key === decidedBy ? -1 : STATUS_RANK[c.status] ?? 1);
  const ordered = channels.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c);
  const full = ordered.filter((c) => rank(c) < 1);
  const quiet = ordered.filter((c) => rank(c) >= 1);

  return (
    <section className="report-section evidence-board" aria-labelledby="eb-title">
      <h2 className="report-section__title" id="eb-title">The evidence</h2>
      {full.length > 0 && (
        <div className="eb-grid">
          {full.map((c) => <Panel key={c.key} channel={c} decided={c.key === decidedBy} />)}
        </div>
      )}
      {quiet.length > 0 && (
        <div className="eb-quiet">
          <p className="eb-quiet-title">{full.length > 0 ? 'Also checked' : 'Checked, with nothing found'}</p>
          {quiet.map((c) => <Panel key={c.key} channel={c} decided={c.key === decidedBy} />)}
        </div>
      )}
    </section>
  );
};

export default EvidenceBoard;
