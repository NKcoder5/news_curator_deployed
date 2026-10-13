/**
 * What the two registry pages share: how a verdict is named and coloured, how
 * dates and languages are written, and the small hook that loads one thing
 * with a loading, ready and error state.
 */
import { useState, useEffect } from 'react';
import { RULE_LABELS } from '../components/EvidenceBoard';
import { VerdictBadge as DesignVerdictBadge } from '../components/ui';

// Colour is never the only signal: the badge always carries the verdict's name.
const CALL_CLASS = { REAL: 'for', FAKE: 'against', 'PARTLY FALSE': 'mixed', 'CANNOT VERIFY': 'none' };
export const callClass = (call) => `call-${CALL_CLASS[call] || 'none'}`;

export const CALL_NAMES = {
  REAL: 'Real', FAKE: 'Fake', 'PARTLY FALSE': 'Partly false', 'CANNOT VERIFY': 'Cannot verify'
};

/** The design system's verdict badge, named as the registry names verdicts. */
export const VerdictBadge = ({ call, large = false }) => (
  <DesignVerdictBadge call={call} size={large ? 'md' : 'xs'} label={CALL_NAMES[call] || call || 'No verdict'} />
);

export const TRIGGER_LABEL = { user: 'Checked', recheck: 'Re-checked automatically' };

const parse = (iso) => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

export const formatDate = (iso) => {
  const date = parse(iso);
  return date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

export const formatDateTime = (iso) => {
  const date = parse(iso);
  return date
    ? date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
};

/** "ta" as "Tamil"; a code the browser does not know is shown as it came. */
export const languageName = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch (_) {
    return String(code).toUpperCase();
  }
};

export const languageList = (codes) => (codes || []).map(languageName).join(', ');

/** What decided a verdict, in a few words; an unknown rule id is read as written. */
export const ruleLabel = (rule) => RULE_LABELS[rule] || String(rule || '').replace(/-/g, ' ');

/**
 * The rule's measured record: how often it was right on labelled test
 * messages, counted by backend/eval/ruleReliability.js. A rule that only ever
 * declines to answer is described by what it declined, not by a hit rate.
 */
export const TrackRecord = ({ record }) => {
  if (!record) {
    return <p className="claims-track">No labelled test message has ended at this rule yet, so it has no measured record.</p>;
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  const messages = `${record.n} test ${record.n === 1 ? 'message' : 'messages'}`;
  if (record.abstains) {
    return (
      <p className="claims-track">
        Ended here in <strong>{messages}</strong>
        {record.missed > 0 ? `; ${record.missed} had an answer the evidence did not reach.` : '; none had an answer it missed.'}
      </p>
    );
  }
  return (
    <p className="claims-track">
      Right in <strong>{record.right} of {messages}</strong>
      <span className="claims-track-range"> (95% range {pct(record.low)} to {pct(record.high)})</span>.
    </p>
  );
};

/**
 * Load one thing when the page opens (and again on retry).
 * `load` must keep its identity between renders: it is what the effect watches.
 * @returns {[{status: 'loading'|'ready'|'error', data, error}, Function]}
 */
export const useLoaded = (load) => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null, error: null });
    load().then(
      (data) => live && setState({ status: 'ready', data, error: null }),
      (error) => live && setState({ status: 'error', data: null, error })
    );
    return () => { live = false; };
  }, [load, attempt]);

  return [state, () => setAttempt((n) => n + 1)];
};
