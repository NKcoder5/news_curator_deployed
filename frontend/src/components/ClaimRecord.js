/**
 * What the claim memory already knew about the claims in this message.
 *
 * Every check is kept as a record. When a claim comes back — reworded,
 * translated, asked as a question — the reader is told it has been checked
 * before, how often, and what was concluded then; when a claim comes back with
 * a figure, a date or its polarity changed, the earlier version is shown with
 * the difference spelled out. That is how a rumour that mutates as it spreads
 * ("85 medals" becoming "84 medals") is made visible.
 */
const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const CALL_CLASS = { FAKE: 'against', 'PARTLY FALSE': 'against', REAL: 'for', 'CANNOT VERIFY': 'none' };

const ClaimRecord = ({ memory, call }) => {
  if (!memory || !Array.isArray(memory.claims) || memory.claims.length === 0) return null;
  const anyHistory = memory.claims.some((c) => c.timesSeen > 1 || c.variants.length > 0);

  return (
    <section className="claim-record" aria-label="Claim record">
      <h4>Claim record</h4>
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
                  {' '}Last verdict before this one:{' '}
                  <span className={`claim-record-call call-${CALL_CLASS[c.previous.call] || 'none'}`}>{c.previous.call}</span>
                  {' '}on {formatWhen(c.previous.at)}
                  {c.previous.call !== call ? ' — the verdict has changed since.' : ' — the same as now.'}
                </>
              )}
            </p>
          )}
          {c.variants.map((v) => (
            <p key={v.claimId} className="claim-record-line claim-record-variant">
              <span className="claim-record-tag">Variant checked before</span>{' '}
              “{v.claim}”
              {v.call && (
                <>
                  {' '}→ <span className={`claim-record-call call-${CALL_CLASS[v.call] || 'none'}`}>{v.call}</span>
                </>
              )}
              {v.at ? ` on ${formatWhen(v.at)}` : ''}. <em>Differs: {v.differences.join('; ')}.</em>
            </p>
          ))}
        </div>
      ))}
      {memory.changeReason && <p className="claim-record-change">{memory.changeReason}</p>}
    </section>
  );
};

export default ClaimRecord;
