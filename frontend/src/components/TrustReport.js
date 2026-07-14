import { useState } from 'react';
import '../styles/TrustReport.css';

const LEVEL_COLORS = {
  'high': '#4a7c59',
  'medium-high': '#7d9a5f',
  'medium-low': '#c9862b',
  'low': '#a63c3c'
};

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

const FactorDetail = ({ factor }) => {
  switch (factor.id) {
    case 'sourceReputation':
      return (
        <div className="factor-detail">
          {factor.detail.matched ? (
            <p>
              Recognized as <strong>{factor.detail.matchedName}</strong> ({factor.detail.type})
              {factor.detail.bias && factor.detail.bias !== 'unknown' && (
                <> &middot; editorial lean: <strong>{factor.detail.bias}</strong></>
              )}
            </p>
          ) : (
            <p>This source is not in the reputation database, so it is treated neutrally.</p>
          )}
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

  if (!report || !report.factors) return null;

  const color = LEVEL_COLORS[report.verdictLevel] || scoreColor(report.overallScore);

  return (
    <div className="trust-report">
      <div className="trust-overall">
        <div
          className="score-circle"
          style={{ background: `conic-gradient(${color} ${report.overallScore * 10}%, #f0ede2 0)` }}
        >
          <div className="score-inner">
            <span>{report.overallScore}</span>
            <span className="score-label">/10</span>
          </div>
        </div>
        <div className="trust-verdict" style={{ color }}>
          {report.verdict}
        </div>
      </div>

      <div className="trust-factors">
        {report.factors.map((factor) => (
          <div key={factor.id} className="trust-factor">
            <button
              className="factor-row"
              onClick={() => setExpanded(expanded === factor.id ? null : factor.id)}
            >
              <div className="factor-info">
                <span className="factor-name">{factor.name}</span>
                <span className="factor-weight">{factor.weight}% weight</span>
              </div>
              <div className="factor-bar-track">
                <div
                  className="factor-bar-fill"
                  style={{ width: `${factor.score * 10}%`, background: scoreColor(factor.score) }}
                />
              </div>
              <span className="factor-score">{factor.score}</span>
              <span className={`factor-chevron ${expanded === factor.id ? 'open' : ''}`}>▾</span>
            </button>
            {expanded === factor.id && (
              <div className="factor-expanded">
                <p className="factor-explanation">{factor.explanation}</p>
                <FactorDetail factor={factor} />
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="trust-footnote">
        Score = weighted combination of the four factors above. Click a factor to see its evidence.
      </p>
    </div>
  );
};

export default TrustReport;
