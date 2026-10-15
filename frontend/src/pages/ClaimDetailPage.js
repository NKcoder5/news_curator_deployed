/**
 * One claim's permanent page: what the claim is, what we concluded and why,
 * every verdict reached on it and what changed each time, the evidence with
 * links to where it was published, and the same claim with a figure or a date
 * changed. The address never changes, so it can be shared and cited.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getClaim } from '../services/claimsApi';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  VerdictBadge, TrackRecord, TRIGGER_LABEL, formatDate, formatDateTime, languageList, ruleLabel, useLoaded
} from './ClaimsShared';
import '../styles/Claims.css';

// The channels an evidence list is grouped under, in the order a reader
// weighs them: fact-checkers' rulings first.
const CHANNELS = [
  ['factcheck', 'Fact-checkers'],
  ['news', 'News coverage'],
  ['week', 'This week’s coverage of the subject'],
  ['reference', 'Reference works']
];

const SIDE_TEXT = { for: 'Supports the claim', against: 'Against the claim' };

const EvidenceItem = ({ item }) => (
  <li className={`claims-evidence-item side-${item.side}`}>
    <span className="claims-evidence-side">{SIDE_TEXT[item.side]}</span>
    <div className="claims-evidence-body">
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="claims-evidence-title">
          {item.title || item.source || item.url}
        </a>
      ) : (
        <span className="claims-evidence-title">{item.title || item.source}</span>
      )}
      <span className="claims-evidence-source">
        {item.source}{item.publishedAt ? `, ${formatDate(item.publishedAt) || item.publishedAt}` : ''}
      </span>
      {item.reported && <span className="claims-evidence-reported">Reported: {item.reported}</span>}
    </div>
  </li>
);

const Evidence = ({ evidence }) => {
  if (!evidence.length) {
    return <p className="claims-note">No evidence is on record for the latest check.</p>;
  }
  return (
    <>
      {CHANNELS.map(([channel, name]) => {
        const items = evidence.filter(e => e.channel === channel);
        return items.length ? (
          <div key={channel} className="claims-evidence-group">
            <h3>{name}</h3>
            <ul className="claims-evidence-list">
              {items.map((item, i) => <EvidenceItem key={`${item.url}-${i}`} item={item} />)}
            </ul>
          </div>
        ) : null;
      })}
    </>
  );
};

const Timeline = ({ history }) => (
  <ol className="claims-timeline" aria-label="Verdict history">
    {history.map((h, i) => {
      const changed = i > 0 && history[i - 1].call !== h.call;
      const counts = [`${h.evidence.for} for`, `${h.evidence.against} against`];
      if (h.evidence.rulings) counts.push(`${h.evidence.rulings} fact-check ${h.evidence.rulings === 1 ? 'ruling' : 'rulings'}`);
      return (
        <li key={h.assessmentId} className={changed ? 'is-change' : ''}>
          <div className="claims-timeline-head">
            <time dateTime={h.at}>{formatDateTime(h.at)}</time>
            <span className="claims-timeline-how">{TRIGGER_LABEL[h.trigger] || 'Checked'}</span>
            <VerdictBadge call={h.call} />
          </div>
          {h.oneLine && <p className="claims-timeline-reason">{h.oneLine}</p>}
          <p className="claims-timeline-evidence">
            Evidence: {counts.join(', ')}.{h.rule ? ` Decided by: ${ruleLabel(h.rule)}.` : ''}
          </p>
          {h.changeReason && <p className="claims-timeline-change">{h.changeReason}</p>}
        </li>
      );
    })}
  </ol>
);

const CopyLink = () => {
  const [copied, setCopied] = useState(false);
  if (!navigator.clipboard?.writeText) return null;
  const copy = () => navigator.clipboard.writeText(window.location.href).then(
    () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
    () => {}
  );
  return (
    <button type="button" className="press-btn press-btn-outline press-btn-sm" onClick={copy}>
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
};

const NotFound = ({ missing }) => (
  <div className="press-empty claims-gone">
    <p>{missing ? 'There is no record of that claim.' : 'That claim could not be loaded just now.'}</p>
  </div>
);

const ClaimDetailPage = () => {
  const { claimId } = useParams();
  const load = useCallback(() => getClaim(claimId), [claimId]);
  const [state, retry] = useLoaded(load);
  const claim = state.data;
  useDocumentTitle(claim ? claim.claim : 'Claim');

  // Arriving from the list (or from a variant) should start at the top of the page.
  useEffect(() => { window.scrollTo?.(0, 0); }, [claimId]);

  return (
    <div className="page page--narrow claims-page claim-detail">
      <p className="claims-back"><Link to="/claims"><ArrowLeft size={16} aria-hidden="true" /> All checked claims</Link></p>

      {state.status === 'loading' && <p className="claims-note" role="status">Loading the claim…</p>}
      {state.status === 'error' && (
        <>
          <NotFound missing={[400, 404].includes(state.error?.response?.status)} />
          {![400, 404].includes(state.error?.response?.status) && (
            <p className="claims-gone-actions">
              <button type="button" className="press-btn press-btn-sm" onClick={retry}>Try again</button>
            </p>
          )}
        </>
      )}

      {claim && (
        <>
          <header className="claim-head">
            <span className="press-kicker">Claim on record</span>
            <h1 className="claim-title">{claim.claim}</h1>
            <div className="claim-verdict">
              <VerdictBadge call={claim.call} large />
              {claim.oneLine && <p className="claim-reason">{claim.oneLine}</p>}
            </div>
            <p className="claim-facts">
              Checked <strong>{claim.timesChecked} {claim.timesChecked === 1 ? 'time' : 'times'}</strong>
              , first on {formatDate(claim.firstCheckedAt)} and most recently on {formatDate(claim.lastCheckedAt)}.
              {claim.languages.length > 0 && <> Seen in {languageList(claim.languages)}.</>}
            </p>
            <div className="claim-actions">
              {/* The check page opens with the claim already in its box. */}
              <Link to="/check" state={{ text: claim.claim }} className="press-btn">Check it again</Link>
              <CopyLink />
            </div>
            {claim.recheckDue && (
              <p className="claims-note">
                Nothing settles this yet. It will be checked again automatically around {formatDateTime(claim.recheckDue)};
                any change, and what caused it, will appear below.
              </p>
            )}
          </header>

          {claim.decidedBy && (
            <section className="claim-section" aria-labelledby="claim-decided">
              <h2 id="claim-decided" className="claim-section-title">What decided it</h2>
              <p className="claim-rule">{ruleLabel(claim.decidedBy.rule)}</p>
              <TrackRecord record={claim.decidedBy.trackRecord} />
            </section>
          )}

          <section className="claim-section" aria-labelledby="claim-timeline">
            <h2 id="claim-timeline" className="claim-section-title">Every verdict on this claim</h2>
            <Timeline history={claim.history} />
          </section>

          <section className="claim-section" aria-labelledby="claim-evidence">
            <h2 id="claim-evidence" className="claim-section-title">The evidence, as of the latest check</h2>
            <Evidence evidence={claim.evidence} />
          </section>

          {claim.variants.length > 0 && (
            <section className="claim-section" aria-labelledby="claim-variants">
              <h2 id="claim-variants" className="claim-section-title">The same claim, changed</h2>
              <ul className="claims-variants">
                {claim.variants.map(v => (
                  <li key={v.claimId}>
                    <Link to={`/claims/${v.claimId}`} className="claims-side-claim">{v.claim}</Link>
                    <span className="claims-side-meta">
                      <VerdictBadge call={v.call} />
                      {v.differences.length > 0 && <em>Differs: {v.differences.join('; ')}.</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ClaimDetailPage;
