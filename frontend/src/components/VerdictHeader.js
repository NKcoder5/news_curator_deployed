import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { RULE_LABELS } from './EvidenceBoard';
import { TrackRecord } from './DecisionExplanation';
import { Button, VerdictBadge, verdictFor } from './ui';

/**
 * The answer, laid out the way fact-checkers lay out a rating: the claim that
 * was checked, the verdict as a labelled badge, one sentence saying why, and
 * what decided it with that rule's measured record. A score out of ten is
 * deliberately absent — beside a fabricated story it read as a mark for
 * truthfulness.
 *
 * The permanent page for the claim (the public registry, /claims/:id) is the
 * link to share: it outlives this page and shows the claim's history.
 */

const formatDate = (iso) => {
  const date = iso ? new Date(iso) : new Date();
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The one claim the verdict is about, when there is exactly one. */
const claimOf = (report) => {
  const checkable = (report.understanding?.claims || []).filter((c) => c.checkable);
  if (checkable.length === 1) return checkable[0].claim;
  const perClaim = report.evidence?.perClaim || [];
  return perClaim.length === 1 ? perClaim[0].claim : null;
};

const ShareActions = ({ report, claim }) => {
  const [copied, setCopied] = useState(false);
  const claimId = report.memory?.claims?.length === 1 ? report.memory.claims[0].claimId : null;
  const url = claimId ? `${window.location.origin}/claims/${claimId}` : null;
  const rule = RULE_LABELS[report.decision?.rule];
  const summary = [
    `${report.call}: ${report.oneLine || ''}`.trim(),
    claim ? `Claim: “${claim}”` : null,
    rule ? `Decided by: ${rule}.` : null,
    `Checked by Pure Press on ${formatDate(report.analyzedAt)}.`,
    url
  ].filter(Boolean).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url || summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      setCopied(false);
    }
  };

  const share = () => navigator.share({ title: `Pure Press: ${report.call}`, text: summary, url: url || undefined }).catch(() => {});
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);

  if (!canShare && !canCopy) return null;
  return (
    <div className="verdict-actions">
      {canCopy && (
        <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? 'Copied' : url ? 'Copy link' : 'Copy result'}
        </Button>
      )}
      {canShare && <Button variant="secondary" size="sm" icon={Share2} onClick={share}>Share</Button>}
      <span className="sr-only" aria-live="polite">{copied ? 'Copied to the clipboard.' : ''}</span>
    </div>
  );
};

/**
 * @param {Object}  props.report
 * @param {boolean} [props.full] - the Check page's version: the claim, the
 *   rule and its record, and the share actions. The article page shows the
 *   answer alone and keeps the rest behind its buttons.
 */
const VerdictHeader = ({ report, full = false }) => {
  const call = report.call || report.verdict;
  const tone = verdictFor(call).tone;
  const claim = full ? claimOf(report) : null;
  const rule = RULE_LABELS[report.decision?.rule];

  return (
    <section className={`verdict-card verdict-card--${tone} ${full ? 'verdict-card--full' : ''}`} aria-label="Verdict">
      {claim && (
        <div className="verdict-claim">
          <span className="verdict-claim__label">Claim checked</span>
          <p className="verdict-claim__text">“{claim}”</p>
        </div>
      )}
      <div className="verdict-main">
        <VerdictBadge call={call} size="lg" className="verdict-call" />
        <div className="verdict-text">
          {report.oneLine && <p className="verdict-oneline">{report.oneLine}</p>}
          {/* The same reason in the reader's language, for a message written in it. */}
          {full && report.oneLineLocal?.oneLine && (
            <p className="verdict-oneline-local" lang={report.understanding?.language}>
              {report.oneLineLocal.call && <strong>{report.oneLineLocal.call}: </strong>}
              {report.oneLineLocal.oneLine}
            </p>
          )}
          {full && report.advice && <p className="verdict-advice">{report.advice}</p>}
        </div>
      </div>
      {full && report.decision && (
        <div className="verdict-basis">
          <div className="verdict-meta">
            {rule && <span className="verdict-decided">Decided by: <strong>{rule}</strong></span>}
            {/* How often this rule has been right on labelled test messages,
                counted (eval/ruleReliability.js) — not a hand-set confidence. */}
            <TrackRecord record={report.trackRecord} />
          </div>
          <ShareActions report={report} claim={claim} />
        </div>
      )}
    </section>
  );
};

export default VerdictHeader;
