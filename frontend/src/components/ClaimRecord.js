/**
 * What the claim memory already knew about the claims in this message.
 *
 * Every check is kept as a record. When a claim comes back — reworded,
 * translated, asked as a question — the reader is told it has been checked
 * before, how often, and what was concluded then; when a claim comes back with
 * a figure, a date or its polarity changed, the earlier version is shown with
 * the difference spelled out. That is how a rumour that mutates as it spreads
 * ("85 medals" becoming "84 medals") is made visible.
 *
 * A claim nothing settles yet is looked at again automatically, and its
 * history — every verdict reached on it and what changed each time — is one
 * click away.
 */
import { useState } from 'react';
import { CalendarClock, ChevronDown, History } from 'lucide-react';
import api from '../services/api';
import { VerdictBadge } from './ui';

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const TRIGGER_LABEL = { user: 'Checked', recheck: 'Re-checked automatically', eval: 'Test run' };

const Call = ({ call }) => <VerdictBadge call={call} size="xs" className="claim-record-call" />;

/** Every verdict reached on one claim, oldest first, fetched on request. */
const ClaimHistory = ({ claimId }) => {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: null });

  const toggle = async () => {
    if (state.open) return setState((s) => ({ ...s, open: false }));
    if (state.data) return setState((s) => ({ ...s, open: true }));
    setState({ open: true, loading: true, data: null, error: null });
    try {
      const response = await api.get(`/ai/claims/${claimId}`);
      setState({ open: true, loading: false, data: response.data, error: null });
    } catch (err) {
      setState({ open: true, loading: false, data: null, error: 'The history could not be loaded.' });
    }
  };

  return (
    <div className="claim-history">
      <button type="button" className="claim-history-toggle" onClick={toggle} aria-expanded={state.open}>
        {state.open ? 'Hide the history' : 'Show every verdict on this claim'}
        <ChevronDown size={16} aria-hidden="true" className={state.open ? 'is-open' : ''} />
      </button>
      {state.open && state.loading && <p className="claim-record-note" role="status">Loading the history…</p>}
      {state.open && state.error && <p className="claim-record-note" role="alert">{state.error}</p>}
      {state.open && state.data && (
        <ol className="claim-history-list" aria-label="Verdict history">
          {state.data.history.map((h) => (
            <li key={h.assessmentId}>
              <span className="claim-history-when">{formatWhen(h.at)}</span>
              <span className="claim-history-what">
                <span className="claim-history-how">{TRIGGER_LABEL[h.trigger] || 'Checked'}</span>{' '}
                → <Call call={h.call} />
              </span>
              <span className="claim-history-evidence">
                {h.evidence.for} for, {h.evidence.against} against{h.evidence.rulings ? `, ${h.evidence.rulings} fact-check ${h.evidence.rulings === 1 ? 'ruling' : 'rulings'}` : ''}
              </span>
              {h.changeReason && <span className="claim-history-change">{h.changeReason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const ClaimRecord = ({ memory, call }) => {
  if (!memory || !Array.isArray(memory.claims) || memory.claims.length === 0) return null;
  const anyHistory = memory.claims.some((c) => c.timesSeen > 1 || c.variants.length > 0);
  const recheckDue = memory.claims.map((c) => c.recheckDue).filter(Boolean).sort()[0] || null;

  return (
    <section className="report-section claim-record" aria-label="Claim record">
      <h2 className="report-section__title"><History size={18} aria-hidden="true" /> Claim record</h2>
      {!anyHistory && (
        <p className="claim-record-note">
          {memory.claims.length === 1 ? 'This claim has' : 'These claims have'} not been checked before. The verdict and
          its evidence are now on record, so the claim will be recognised if it comes back — reworded, translated or with
          a figure changed.
        </p>
      )}
      {memory.claims.map((c) => (
        <div key={c.claimId} className="claim-record-item">
          {(c.timesSeen > 1 || c.variants.length > 0) && <p className="claim-record-claim">“{c.claim}”</p>}
          {c.timesSeen > 1 && (
            <p className="claim-record-line">
              Checked <strong>{c.timesSeen} times</strong> since {formatWhen(c.firstSeenAt)}.
              {c.previous && (
                <>
                  {' '}Last verdict before this one: <Call call={c.previous.call} />
                  {' '}on {formatWhen(c.previous.at)}
                  {c.previous.call !== call ? ' — the verdict has changed since.' : ' — the same as now.'}
                </>
              )}
            </p>
          )}
          {c.timesSeen > 1 && <ClaimHistory claimId={c.claimId} />}
          {c.variants.map((v) => (
            <div key={v.claimId} className="claim-record-variant">
              <span className="claim-record-tag">Variant checked before</span>
              <p className="claim-record-line">
                “{v.claim}”
                {v.call && <>{' '}→ <Call call={v.call} /></>}
                {v.at ? ` on ${formatWhen(v.at)}` : ''}.
              </p>
              <p className="claim-record-diff">Differs: {v.differences.join('; ')}.</p>
            </div>
          ))}
        </div>
      ))}
      {memory.changeReason && <p className="claim-record-change">{memory.changeReason}</p>}
      {recheckDue && (
        <p className="claim-record-note claim-record-recheck">
          <CalendarClock size={16} aria-hidden="true" />
          <span>
            Nothing settles this yet. It will be checked again automatically around {formatWhen(recheckDue)}, and again
            over the next three days; any change, and what caused it, will be on this record.
          </span>
        </p>
      )}
    </section>
  );
};

export default ClaimRecord;
