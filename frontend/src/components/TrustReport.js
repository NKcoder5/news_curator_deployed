import { useState } from 'react';
import '../styles/TrustReport.css';

const LEVEL_COLORS = {
  'high': '#4a7c59',
  'medium-high': '#7d9a5f',
  'medium-low': '#c9862b',
  'low': '#a63c3c',
  // Verdict classes. These are the headline answer now, so each gets its own
  // colour rather than inheriting one from the score band.
  'corroborated': '#4a7c59',
  'likely-true': '#7d9a5f',
  'opinion': '#6b7280',
  'unverified': '#8a6d3b',
  'satire': '#6b5b95',
  'likely-false': '#c9862b',
  'false': '#a63c3c'
};

// Reader-facing names for the internal check ids.
const LEDGER_NAMES = {
  prior: 'Who published it',
  'Before reading the article': 'Who published it',
  clickbait: 'Headline honesty',
  bias: 'Fairness of the language',
  manipulation: 'Persuasion tricks',
  transparency: 'Sources you could check',
  sourceReputation: "The outlet's track record",
  'Independent corroboration': 'Other outlets reporting it',
  'style-correlation-damping': 'Overlap between the writing checks',
  'style-weight-cap': 'Limit on how far writing alone can count',
  calibration: 'Adjustment from past checked articles'
};

/**
 * Say what a weight of evidence means, without the arithmetic.
 *
 * The model works in log-odds, which is the right thing for it to do and the
 * wrong thing to put in front of a reader. Nobody needs the word "deciban" to
 * understand "no effect" or "strongly suggests it is made up".
 */
const describeEffect = (decibans) => {
  const size = Math.abs(decibans);
  if (size < 0.5) return 'no effect';
  const strength = size >= 8 ? 'strongly' : size >= 3 ? 'moderately' : 'slightly';
  return decibans > 0
    ? `${strength} suggests it is made up`
    : `${strength} suggests it is genuine`;
};

const effectClass = (decibans) =>
  Math.abs(decibans) < 0.5 ? 'neutral' : (decibans > 0 ? 'toward-fake' : 'toward-real');

/**
 * Not every line of the ledger is evidence.
 *
 * Three of them are bookkeeping: the starting point before anything is read,
 * the discount for writing checks that overlap each other, and the correction
 * that keeps the scale honest against past checked articles. They move the
 * arithmetic, so they have to be shown - but calling a negative one "suggests
 * it is genuine" would claim a fabricated story had something in its favour,
 * which is exactly what the model refuses to do. They get their own words and
 * no colour.
 */
const describeLedgerEntry = (entry) => {
  const size = Math.abs(entry.decibans);
  if (entry.step === 'prior') {
    if (size < 0.5) return 'starts out neutral';
    return entry.decibans > 0 ? 'starts out doubtful' : 'starts out trusted';
  }
  if (entry.step === 'adjustment') {
    if (size < 0.5) return 'changed nothing';
    return entry.decibans > 0
      ? 'counts the writing checks for more'
      : 'counts the writing checks for less';
  }
  return describeEffect(entry.decibans);
};

const ledgerEntryClass = (entry) =>
  entry.step === 'prior' || entry.step === 'adjustment'
    ? 'neutral'
    : effectClass(entry.decibans);

const scoreColor = (score) => {
  if (score >= 7.5) return LEVEL_COLORS['high'];
  if (score >= 5.5) return LEVEL_COLORS['medium-high'];
  if (score >= 4) return LEVEL_COLORS['medium-low'];
  return LEVEL_COLORS['low'];
};

const VERDICT_BADGES = {
  supported: { label: 'Corroborated', className: 'claim-badge supported' },
  contradicted: { label: 'Contradicted', className: 'claim-badge contradicted' },
  unverified: { label: 'Unverified', className: 'claim-badge unverified' },
  'no-coverage': { label: 'No Coverage', className: 'claim-badge unverified' }
};

// Fact-checker ratings, normalised by the backend into these buckets.
const FACTCHECK_BADGES = {
  'false': { label: 'Rated False', className: 'claim-badge contradicted' },
  'mostly-false': { label: 'Rated Misleading', className: 'claim-badge contradicted' },
  'mixed': { label: 'Rated Mixed', className: 'claim-badge unverified' },
  'mostly-true': { label: 'Rated Mostly True', className: 'claim-badge supported' },
  'true': { label: 'Rated True', className: 'claim-badge supported' },
  'unrated': { label: 'Rated (see source)', className: 'claim-badge unverified' },
  'no-factcheck': { label: 'No fact-check found', className: 'claim-badge unverified' }
};

const FactorDetail = ({ factor }) => {
  switch (factor.id) {
    case 'transparency': {
      const checks = factor.detail.checks || [];
      const vague = factor.detail.vagueAttributions || [];
      const named = factor.detail.namedExamples || [];
      return (
        <div className="factor-detail">
          <p>
            This article passes <strong>{factor.detail.passedCount} of {factor.detail.totalChecks}</strong>{' '}
            journalism checks — it is <strong>{factor.detail.level}</strong>.
          </p>

          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.id} className={c.passed ? 'check-pass' : 'check-fail'} title={c.help}>
                <span className="check-mark">{c.passed ? '✓' : '✕'}</span>
                {c.label}
              </li>
            ))}
          </ul>

          {named.length > 0 && (
            <p className="named-sources">
              Names: {named.map((n, i) => <strong key={i}>{n}{i < named.length - 1 ? ', ' : ''}</strong>)}
            </p>
          )}

          {vague.length > 0 && (
            <>
              <p className="vague-heading">Unattributable phrasing it relies on:</p>
              <ul className="vague-list">
                {vague.map((v, i) => <li key={i}>&ldquo;{v}&rdquo;</li>)}
              </ul>
            </>
          )}
        </div>
      );
    }

    case 'manipulation': {
      const techniques = factor.detail.techniques || [];
      if (techniques.length === 0) {
        return (
          <div className="factor-detail">
            <p>No persuasion techniques were detected — the article reads as plain reporting.</p>
          </div>
        );
      }
      return (
        <div className="factor-detail">
          <p>
            Persuasion intensity: <strong>{factor.detail.intensity}</strong>. These are the
            techniques found, in the article&apos;s own words:
          </p>
          <div className="technique-list">
            {techniques.map((t, i) => (
              <figure key={i} className="technique">
                <figcaption className="technique-name">{t.technique}</figcaption>
                <blockquote>&ldquo;{t.quote}&rdquo;</blockquote>
                {t.effect && <p className="technique-effect">{t.effect}</p>}
                {t.definition && <p className="technique-def">{t.definition}</p>}
              </figure>
            ))}
          </div>
        </div>
      );
    }

    case 'factCheck': {
      const checked = factor.detail.checkedClaims || [];
      if (factor.detail.status === 'not-configured') {
        return (
          <div className="factor-detail">
            <p>Professional fact-check matching is not configured on this server.</p>
          </div>
        );
      }
      if (checked.length === 0) {
        return (
          <div className="factor-detail">
            <p>No claims were available to match against fact-check databases.</p>
          </div>
        );
      }
      return (
        <div className="factor-detail">
          {checked.map((c, i) => {
            const badge = FACTCHECK_BADGES[c.verdict] || FACTCHECK_BADGES['no-factcheck'];
            return (
              <div key={i} className="claim-item">
                <div className="claim-header">
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <p className="claim-text">&ldquo;{c.claim}&rdquo;</p>
                {c.note && <p className="claim-explanation">{c.note}</p>}
                {c.matches?.length > 0 && (
                  <ul className="evidence-list">
                    {c.matches.map((m, j) => (
                      <li key={j}>
                        <a href={m.url} target="_blank" rel="noopener noreferrer">
                          <strong>{m.publisher}</strong> rated it &ldquo;{m.rating}&rdquo;
                          {m.title ? ` — ${m.title}` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    case 'sourceReputation':
      return (
        <div className="factor-detail">
          {factor.detail.matched ? (
            <p>
              Recognized as <strong>{factor.detail.matchedName}</strong>
              {factor.detail.type !== 'rated domain' && <> ({factor.detail.type})</>}
              {factor.detail.bias && factor.detail.bias !== 'unknown' && (
                <> &middot; editorial lean: <strong>{factor.detail.bias}</strong></>
              )}
              {factor.detail.ratingSource && (
                <> &middot; rated by {factor.detail.ratingSource}</>
              )}
            </p>
          ) : factor.detail.impersonates ? (
            // The explanation above says why; this says what it cost.
            <p className="source-warning">
              <strong>Posing as {factor.detail.impersonates}.</strong>{' '}
              The story is assessed as if from a publisher with a poor record.
            </p>
          ) : null
          // Otherwise the explanation above already says why the source is
          // unrecognised. It used to be followed by "treated neutrally", which
          // was never true: an unrated publisher starts less trusted than a
          // rated one.
          }
        </div>
      );

    case 'clickbait':
      return (
        <div className="factor-detail">
          {factor.detail.signals && factor.detail.signals.length > 0 ? (
            <>
              <p>Clickbait signals detected:</p>
              <ul>
                {factor.detail.signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          ) : (
            <p>No clickbait signals detected in the headline.</p>
          )}
        </div>
      );

    case 'bias':
      return (
        <div className="factor-detail">
          <p>
            Bias level: <strong>{factor.detail.biasLevel}</strong>
            {factor.detail.politicalLean && factor.detail.politicalLean !== 'none-detected' && (
              <> &middot; political lean: <strong>{factor.detail.politicalLean}</strong></>
            )}
          </p>
          {factor.detail.flaggedSentences && factor.detail.flaggedSentences.length > 0 && (
            <div className="flagged-sentences">
              {factor.detail.flaggedSentences.map((f, i) => (
                <div key={i} className="flagged-sentence">
                  <blockquote>&ldquo;{f.sentence}&rdquo;</blockquote>
                  <span className="flag-type">{f.type}</span>
                  {f.reason && <span className="flag-reason"> — {f.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'verification':
      return (
        <div className="factor-detail">
          {factor.detail.claims && factor.detail.claims.length > 0 ? (
            factor.detail.claims.map((c, i) => {
              const badge = VERDICT_BADGES[c.verdict] || VERDICT_BADGES.unverified;
              const evidence = [...(c.supportingEvidence || []), ...(c.contradictingEvidence || [])];
              return (
                <div key={i} className="claim-item">
                  <div className="claim-header">
                    <span className={badge.className}>{badge.label}</span>
                  </div>
                  <p className="claim-text">&ldquo;{c.claim}&rdquo;</p>
                  {c.explanation && <p className="claim-explanation">{c.explanation}</p>}
                  {evidence.length > 0 && (
                    <ul className="evidence-list">
                      {evidence.map((e, j) => (
                        <li key={j}>
                          <a href={e.url} target="_blank" rel="noopener noreferrer">
                            {e.source}: {e.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <p>No checkable claims were identified for cross-source verification.</p>
          )}
        </div>
      );

    default:
      return null;
  }
};

const TrustReport = ({ report }) => {
  const [expanded, setExpanded] = useState(null);
  const [showWorking, setShowWorking] = useState(false);
  // Three tiers, because most readers want the answer and nothing else. The
  // proof is one click away for anyone who doubts it, and the writing analysis
  // is a click beyond that — it answers a different question and should not be
  // in the way of this one.
  const [showProof, setShowProof] = useState(false);
  const [showQuality, setShowQuality] = useState(false);

  if (!report || !report.factors) return null;

  const color = LEVEL_COLORS[report.verdictLevel] || scoreColor(report.overallScore);
  const concernPoints = report.concernPoints || [];

  const quality = report.quality;
  const evidence = report.evidence || {};

  return (
    <div className="trust-report">
      {/* ── TIER 1: THE ANSWER ────────────────────────────────────────────
          One word, and one sentence saying why. No score: showing "4.9 / 10"
          beside a fabricated story reads as a mark for truthfulness, which is
          the thing readers and reviewers objected to most. */}
      <div className={`verdict-card verdict-${report.verdictLevel || 'unverified'}`}>
        <div className="verdict-call" style={{ color }}>{report.call || report.verdict}</div>
        {report.oneLine && <p className="verdict-oneline">{report.oneLine}</p>}
      </div>

      <div className="tier-buttons">
        <button className="tier-toggle" onClick={() => setShowProof(!showProof)} aria-expanded={showProof}>
          {showProof ? 'Hide the proof' : 'How do you know?'}
        </button>
        {quality && (
          <button className="tier-toggle" onClick={() => setShowQuality(!showQuality)} aria-expanded={showQuality}>
            {showQuality ? 'Hide the writing check' : 'How is it written?'}
          </button>
        )}
      </div>

      {/* ── TIER 2: THE PROOF ─────────────────────────────────────────── */}
      {showProof && report.decision?.grounds?.length > 0 && (
        <section className="verdict-why">
          <h4>What we found</h4>
          <ul>
            {report.decision.grounds
              // The independent-source count is rendered on its own line below,
              // so the ground that repeats it is dropped rather than said twice.
              .filter(ground => !/articles? (were|was) retrieved/i.test(ground))
              .slice(0, 3)
              .map((ground, i) => <li key={i}>{ground}</li>)}
          </ul>
          {evidence.independentSupport > 0 && (
            <p className="evidence-count">
              Found <strong>{evidence.independentSupport}</strong>{' '}
              {evidence.independentSupport === 1 ? 'other outlet' : 'separate outlets'} reporting the same thing
              {evidence.articlesRetrieved > evidence.independentSupport &&
                ` (${evidence.articlesRetrieved} articles, but the rest were the same story reprinted)`}.
            </p>
          )}
        </section>
      )}

      {/* Where it came from, when that is not obvious or not a news site. */}
      {showProof && report.provenance && !report.provenance.knownOutletChannel && (
        <p className="trust-provenance-note">{report.provenance.note}</p>
      )}
      {showProof && report.ingestNotes?.length > 0 && (
        <ul className="trust-ingest-notes">
          {report.ingestNotes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}

      {/* ── TIER 3: A DIFFERENT QUESTION ──────────────────────────────────
          How well it is written. Fenced off from the verdict and behind its own
          button, because the two are unrelated: propaganda is often well
          written and a true local report is often scrappy, so putting this in
          the reader's way while they are asking "is it true?" only confuses. */}
      {showQuality && quality && (
        <section className={`quality-card quality-${quality.level}`}>
          <div className="quality-header">
            <h4>How it is written</h4>
            <span className="quality-score">{quality.score}<span className="quality-outof">/10</span></span>
          </div>
          <p className="quality-caveat">
            This says nothing about whether the story is true — a well-written story
            can still be false, and a true one can be badly written.
          </p>
          <ul className="quality-checks">
            {quality.checks.map(check => (
              <li key={check.id}>
                <span className="quality-check-name">{check.name}</span>
                <span className="quality-check-bar">
                  <span style={{ width: `${check.score * 10}%`, background: scoreColor(check.score) }} />
                </span>
                <span className="quality-check-score">{check.score}</span>
              </li>
            ))}
          </ul>
          {concernPoints.length > 0 && (
            <div className="quality-notes">
              <h5>Worth noticing</h5>
              <ul>{concernPoints.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {showQuality && report.degradedNote && (
        <p className="trust-degraded-note">{report.degradedNote}</p>
      )}

      {(showProof || showQuality) && (
        <button
          className="working-toggle"
          onClick={() => setShowWorking(!showWorking)}
          aria-expanded={showWorking}
        >
          {showWorking ? 'Hide the full working' : 'Show the full working'}
        </button>
      )}

      {/* What actually moved the answer. The underlying arithmetic is a sum of
          log-odds, but nobody needs that word to understand "no effect" or
          "strongly suggests made up". The numbers stay in the API for the
          evaluation; the page says what they mean. */}
      {showWorking && report.evidenceLedger?.length > 0 && (
        <div className="evidence-ledger">
          <h4>What changed our answer</h4>
          <ul className="ledger-list">
            {report.evidenceLedger.map((entry, i) => (
              <li key={i} className={entry.step === 'adjustment' ? 'ledger-adjustment' : ''}>
                <span className="ledger-label">
                  {LEDGER_NAMES[entry.label] || entry.label}
                  {typeof entry.observation === 'number' && (
                    <span className="ledger-band"> — scored {entry.observation}/10</span>
                  )}
                </span>
                <span className={`ledger-effect ${ledgerEntryClass(entry)}`}>
                  {describeLedgerEntry(entry)}
                </span>
              </li>
            ))}
          </ul>
          {typeof report.probabilityPercent === 'number' && (
            <p className="ledger-outcome">
              Putting that together: we estimate a <strong>{report.probabilityPercent}%</strong> chance
              this story is made up.
            </p>
          )}
          <p className="ledger-note">
            Checks that describe the writing can only count against an article, never for it —
            anyone can write neatly, so neat writing is not a reason to believe a story.
            Only other outlets reporting the same thing can count in its favour.
          </p>
          {report.unmeasuredFactors?.length > 0 && (
            <p className="ledger-note">
              These ran but changed nothing, because we do not yet have enough checked examples
              to know what they are worth: {report.unmeasuredFactors.map(u => LEDGER_NAMES[u.factor] || u.factor).join(', ')}.
            </p>
          )}
          {evidence.independenceNotes?.length > 0 && (
            <ul className="independence-notes">
              {evidence.independenceNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
        </div>
      )}

      {showWorking && (
      <div className="trust-factors">
        {report.factors.map((factor) => {
          // A factor that stood down contributed nothing, so it must not look
          // like a middling score that dragged the result down.
          // A check no longer "counts for 18% of the score" — that was an
          // assignment. It now reports what it actually did to the answer, in
          // decibans, measured from labelled data.
          const isEvidence = factor.role === 'evidence';
          const contribution = factor.contribution;

          // Whether the check RAN is a different question from whether it moved
          // the answer. A headline check that returns 9/10 has run and found
          // something; showing a dash because it did not shift the probability
          // hides the finding the reader came for.
          const ran = isEvidence
            ? (factor.counted !== undefined ? factor.counted : true)
            : typeof factor.score === 'number';
          const counted = ran;

          const roleText = isEvidence
            ? (ran ? 'this check decides the verdict' : (factor.standDownReason || 'nothing found either way'))
            // A writing check that could not run has not found "no effect" —
            // it has found nothing, because it was not given the article.
            : !ran
              ? (factor.standDownReason || 'this check could not run')
            // The publisher is not weighed as a check — it sets where the
            // assessment starts, which is a stronger role, so calling it "no
            // effect" here would be plainly wrong.
            : factor.id === 'sourceReputation'
              ? 'sets the starting point for everything below'
              : (contribution && contribution.measured && contribution.decibans !== 0
                  ? describeEffect(contribution.decibans)
                  : 'no effect on the verdict');

          return (
            <div key={factor.id} className={`trust-factor ${counted ? '' : 'factor-stood-down'} ${isEvidence ? 'factor-evidence' : ''}`}>
              <button
                className="factor-row"
                onClick={() => setExpanded(expanded === factor.id ? null : factor.id)}
              >
                <div className="factor-info">
                  <span className="factor-name">{factor.name}</span>
                  <span className="factor-weight">
                    {roleText}
                    {factor.degraded && counted && ' · word-pattern check only'}
                  </span>
                </div>
                <div className="factor-bar-track">
                  {counted ? (
                    <div
                      className="factor-bar-fill"
                      style={{ width: `${factor.score * 10}%`, background: scoreColor(factor.score) }}
                    />
                  ) : (
                    <div className="factor-bar-empty" />
                  )}
                </div>
                <span className={`factor-score ${counted ? '' : 'factor-score-none'}`}>
                  {counted ? factor.score : '—'}
                </span>
                <span className={`factor-chevron ${expanded === factor.id ? 'open' : ''}`}>▾</span>
              </button>
              {expanded === factor.id && (
                <div className="factor-expanded">
                  {/* When a factor stood down its reason is already on the row,
                      so repeating it here (plus an empty detail) just confuses. */}
                  {counted ? (
                    <>
                      <p className="factor-explanation">{factor.explanation}</p>
                      <FactorDetail factor={factor} />
                    </>
                  ) : (
                    <p className="factor-explanation stood-down-note">
                      {factor.standDownReason || factor.explanation}{' '}
                      {isEvidence
                        ? 'A story no one else is reporting cannot be called confirmed, however well it is written.'
                        : 'This check made no difference to the verdict.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {showWorking && (
        <p className="trust-footnote">
          Click any line to see what that check found.
        </p>
      )}
    </div>
  );
};

export default TrustReport;
