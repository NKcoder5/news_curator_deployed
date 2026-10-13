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
 * The channel whose finding decided the verdict is marked, so the reader can
 * see which evidence the rule acted on rather than guess.
 */

// Which channel each verdict rule acts on.
const RULE_CHANNEL = {
  'rated-false-by-fact-checkers': 'factChecks',
  'rated-misleading-by-fact-checkers': 'factChecks',
  'rated-true-by-fact-checkers': 'factChecks',
  'fact-checkers-and-reporting-disagree': 'factChecks',
  'contradicted-by-multiple-independent-sources': 'news',
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
  'old-news-presented-as-new': 'news',
  'confirmed-by-reference': 'reference',
  'true-claim-carrying-a-false-one': 'news',
  'only-partly-confirmed': 'news'
};

// What decided it, in a few words, for the line under the verdict.
export const RULE_LABELS = {
  'rated-false-by-fact-checkers': 'Fact-checkers’ rulings',
  'rated-misleading-by-fact-checkers': 'Fact-checkers’ rulings',
  'rated-true-by-fact-checkers': 'Fact-checkers’ rulings',
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

const Panel = ({ id, title, status, decided, summary, children }) => (
  <section className={`eb-panel eb-${status}`} aria-labelledby={`eb-${id}`}>
    <header className="eb-panel-head">
      <h4 id={`eb-${id}`}>{title}</h4>
      <span className={`eb-status eb-status-${status}`}>{STATUS_TEXT[status]}</span>
    </header>
    {decided && <p className="eb-decided">This decided the verdict</p>}
    {summary && <p className="eb-summary">{summary}</p>}
    {children}
  </section>
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

const NewsPanel = ({ report, decided }) => {
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

  return (
    <Panel id="news" title="News reporting" status={status} decided={decided} summary={ran ? summary : null}>
      {detailClaims.map((claim, i) => {
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
              <div className="eb-versus">
                <div className="eb-versus-side">
                  <span className="eb-versus-label">This says</span>
                  <span className="eb-versus-text">{claim.claim}</span>
                </div>
                <div className="eb-versus-side eb-versus-reported">
                  <span className="eb-versus-label">Outlets report</span>
                  <span className="eb-versus-text">{quotes.map((q) => `“${q}”`).join(' · ')}</span>
                </div>
              </div>
            )}
            <ul className="eb-list">
              {[...contra.map((e) => ({ ...e, side: 'against' })), ...confirm.map((e) => ({ ...e, side: 'for' }))]
                .slice(0, 6)
                .map((e, j) => (
                  <li key={j} className={`eb-item eb-item-${e.side}`}>
                    <span className="eb-item-tag">{e.side === 'against' ? 'Says otherwise' : 'Confirms'}</span>
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      <strong>{e.source}</strong>: <Highlighted text={e.title} phrase={e.reported} />
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        );
      })}
    </Panel>
  );
};

const FINDING_TEXT = { false: 'Rated false', misleading: 'Rated misleading', true: 'Rated true' };

const FactCheckPanel = ({ factChecks, decided }) => {
  if (!factChecks) return null;
  const matches = factChecks.matches || [];
  const status = factChecks.status === 'debunked' || factChecks.status === 'misleading' ? 'against'
    : factChecks.status === 'confirmed' ? 'for'
    : factChecks.status === 'disputed' ? 'mixed'
    : factChecks.status === 'error' ? 'unavailable'
    : 'none';
  return (
    <Panel id="factchecks" title="Fact-checkers" status={status} decided={decided} summary={factChecks.explanation}>
      {matches.length > 0 && (
        <ul className="eb-cards">
          {matches.slice(0, 6).map((m, i) => (
            <li key={i} className={`eb-card eb-card-${m.finding}`}>
              <div className="eb-card-head">
                <span className="eb-card-publisher">{m.publisher}</span>
                <span className={`eb-rating eb-rating-${m.finding}`}>
                  {m.rating && m.rating.length <= 24 && m.via !== 'news-search' ? m.rating : FINDING_TEXT[m.finding]}
                </span>
              </div>
              {m.claimReviewed && <p className="eb-card-claim">“{m.claimReviewed}”</p>}
              <div className="eb-card-foot">
                {m.reviewedAt && <span>{formatDate(m.reviewedAt)}</span>}
                {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer">Read the fact-check</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

const WeekPanel = ({ week, decided, newsFound }) => {
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
  return (
    <Panel id="week" title={title} status={status} decided={decided} summary={summary}>
      {week.headlinesRead > 0 && (
        <p className="eb-meta">{week.headlinesRead} headlines from {week.outletsRead} outlets read, from the last seven days.</p>
      )}
      {shown.length > 0 && (
        <ul className="eb-list">
          {shown.slice(0, 5).map((h, i) => (
            <li key={i} className={`eb-item eb-item-${counted ? 'against' : 'for'}`}>
              <span className="eb-item-tag">{formatDate(h.publishedAt) || (counted ? 'Rules it out' : 'Reports it')}</span>
              <a href={h.url} target="_blank" rel="noopener noreferrer">
                <strong>{h.source}</strong>: <Highlighted text={h.title} phrase={h.reported} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

const ReferencePanel = ({ premise, decided }) => {
  if (!premise) return null;
  const contradictions = premise.contradictions || [];
  const confirmations = premise.confirmations || [];
  const status = contradictions.length > 0 ? 'against'
    : confirmations.length > 0 ? 'for'
    : premise.status === 'consistent' ? 'clear'
    : premise.status === 'error' ? 'unavailable'
    : 'none';
  return (
    <Panel id="reference" title="Reference facts" status={status} decided={decided} summary={premise.explanation}>
      {contradictions.length === 0 && confirmations.map((c, i) => (
        <p key={`c${i}`} className="eb-quote">
          {c.reference?.url
            ? <a href={c.reference.url} target="_blank" rel="noopener noreferrer">{c.reference.title || c.entity}</a>
            : (c.reference?.title || c.entity)}
          : “{c.referenceStates}”
        </p>
      ))}
      {contradictions.map((c, i) => (
        <div key={i} className="eb-versus">
          <div className="eb-versus-side">
            <span className="eb-versus-label">This says</span>
            <span className="eb-versus-text">{c.articleStates}</span>
          </div>
          <div className="eb-versus-side eb-versus-reported">
            <span className="eb-versus-label">
              {c.reference?.url
                ? <a href={c.reference.url} target="_blank" rel="noopener noreferrer">{c.reference.title || c.entity}</a>
                : (c.reference?.title || c.entity)}
            </span>
            <span className="eb-versus-text">“{c.referenceStates}”</span>
          </div>
        </div>
      ))}
    </Panel>
  );
};

const EvidenceBoard = ({ report }) => {
  if (!report) return null;
  const decidedBy = RULE_CHANNEL[report.decision?.rule];
  return (
    <div className="evidence-board">
      <h3 className="eb-title">The evidence</h3>
      <div className="eb-grid">
        <NewsPanel report={report} decided={decidedBy === 'news'} />
        <FactCheckPanel factChecks={report.factChecks} decided={decidedBy === 'factChecks'} />
        <WeekPanel
          week={report.currentCoverage}
          decided={decidedBy === 'week'}
          newsFound={(report.evidence?.perClaim || []).some((c) => c.independentSupport > 0 || c.independentContradiction > 0)}
        />
        <ReferencePanel premise={report.premiseCheck} decided={decidedBy === 'reference'} />
      </div>
    </div>
  );
};

export default EvidenceBoard;
