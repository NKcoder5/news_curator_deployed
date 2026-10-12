/**
 * What decided this verdict, and what would change it.
 *
 * Not a story told about the verdict after the fact: the backend runs the same
 * rules again with each line of evidence taken away, and with hypothetical
 * outlets or a fact-check ruling added, and reports what the verdict became
 * (services/decisionExplainer.js). "Without the outlets reporting otherwise,
 * the answer would be CANNOT VERIFY" is therefore true by construction.
 */
const CALL_CLASS = { FAKE: 'against', 'PARTLY FALSE': 'against', MISLEADING: 'against', REAL: 'for', 'CANNOT VERIFY': 'none' };

const Call = ({ call }) => <span className={`claim-record-call call-${CALL_CLASS[call] || 'none'}`}>{call}</span>;

const DecisionExplanation = ({ explanation }) => {
  if (!explanation || !Array.isArray(explanation.decisive)) return null;
  const { decisive, restsOn, restsOnChannels = [], fromAbsence, verdict, wouldChange = [] } = explanation;
  const deciding = decisive.filter((d) => d.decisive);
  // When the answer stands with every line of evidence removed, saying each
  // one 'would still' give it is true and tells the reader nothing; and the
  // lines it rests on are named once, above, rather than again here.
  const named = new Set(restsOn >= 2 ? restsOnChannels.map((c) => c.channel) : []);
  const standing = fromAbsence ? [] : decisive.filter((d) => !d.decisive && !named.has(d.channel));
  const andList = (items) => (items.length <= 1 ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
  if (decisive.length === 0 && wouldChange.length === 0) return null;

  return (
    <section className="claim-record decision-explanation" aria-label="What decided it">
      <h4>What decided it</h4>
      {restsOn >= 2 && (
        <p className="claim-record-line">
          It rests on <strong>{restsOn} separate lines of evidence</strong>
          {restsOnChannels.length === restsOn ? ` — ${andList(restsOnChannels.map((c) => c.label))} — ` : ': '}
          each of which, on its own, gives the same answer.
        </p>
      )}
      {deciding.map((d) => (
        <p key={d.channel} className="claim-record-line">
          Without {d.label}, the answer would be <Call call={d.without.call} />.
        </p>
      ))}
      {standing.map((d) => (
        <p key={d.channel} className="claim-record-line decision-standing">
          Without {d.label}, it would still be <Call call={d.without.call} />.
        </p>
      ))}
      {fromAbsence && (
        <p className="claim-record-line">
          {verdict?.call === 'CANNOT VERIFY'
            ? 'Nothing found confirms or refutes the claim, and that absence is the answer.'
            : <>With every line of evidence taken away it would still be <Call call={verdict?.call} />: it rests on what was not found and on the warning signs under “How do you know?”.</>}
        </p>
      )}
      {wouldChange.length > 0 && (
        <>
          <p className="claim-record-tag decision-subhead">What would change it</p>
          <ul className="decision-changes">
            {wouldChange.map((w) => (
              <li key={w.change}>
                {w.change.charAt(0).toUpperCase() + w.change.slice(1)} → <Call call={w.result.call} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

/**
 * The deciding rule's record on labelled test messages, with its 95% range.
 * Shown where a hand-set "confidence" used to be.
 */
export const TrackRecord = ({ record }) => {
  if (!record) {
    return <span className="verdict-track">Track record: <strong>none yet</strong> — no test message has ended at this rule.</span>;
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (record.abstains) {
    return (
      <span className="verdict-track" title={`95% range ${pct(record.low)}–${pct(record.high)}`}>
        Track record: ended here in <strong>{record.n} test {record.n === 1 ? 'message' : 'messages'}</strong>
        {record.missed > 0 ? `; ${record.missed} had an answer the evidence did not reach` : '; none had an answer it missed'}
      </span>
    );
  }
  return (
    <span className="verdict-track">
      Track record: right in <strong>{record.right} of {record.n}</strong> test {record.n === 1 ? 'message' : 'messages'}
      <span className="verdict-range"> (95% range {pct(record.low)}–{pct(record.high)})</span>
    </span>
  );
};

export default DecisionExplanation;
