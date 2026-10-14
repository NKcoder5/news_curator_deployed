import { CircleCheck, CircleX, CircleAlert, TriangleAlert, CircleHelp, Info } from 'lucide-react';
import cx from './cx';

/**
 * The verdict as a label: icon, word and colour together, so it never
 * depends on colour alone (a reader with red-green colour blindness gets the
 * cross or the tick and the word).
 *
 * The calls are the verdict engine's (agents/verdictEngine.js). MISLEADING is
 * not produced by the engine today but is a fact-checker rating the evidence
 * already shows, so it has a place here rather than falling to "unknown".
 */
export const VERDICTS = {
  REAL: {
    tone: 'real', icon: CircleCheck, label: 'Real',
    description: 'Independent outlets report the same events, or a fact-checker rated it true.'
  },
  FAKE: {
    tone: 'fake', icon: CircleX, label: 'Fake',
    description: 'Outlets report otherwise, fact-checkers rated it false, this week’s news rules it out, or a premise of it is false.'
  },
  'PARTLY FALSE': {
    tone: 'partly', icon: CircleAlert, label: 'Partly false',
    description: 'Part of the message is confirmed and part is contradicted.'
  },
  MISLEADING: {
    tone: 'misleading', icon: TriangleAlert, label: 'Misleading',
    description: 'True in part, but presented so as to give a false impression.'
  },
  // Shown as UNPROVEN, the word fact-checkers use (Snopes among them): it says
  // what is true of the claim — nothing reliable proves it — where "cannot
  // verify" read as a failing of the checker. The engine's value is unchanged.
  'CANNOT VERIFY': {
    tone: 'unknown', icon: CircleHelp, label: 'Unproven', display: 'UNPROVEN',
    description: 'No reliable evidence proves it. Not a finding that it is false.'
  },
  SATIRE: {
    tone: 'info', icon: Info, label: 'Satire',
    description: 'A satirical publisher: not meant as factual reporting.'
  },
  'NOT A FACTUAL CLAIM': {
    tone: 'info', icon: Info, label: 'Not a factual claim',
    description: 'Opinion or argument, with no fact in it to check.'
  }
};

const UNKNOWN = { tone: 'unknown', icon: CircleHelp };

/** The entry for a call, matched without regard to case or spacing. */
export const verdictFor = (call) => {
  const key = String(call || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return VERDICTS[key] || UNKNOWN;
};

/**
 * @param {string} props.call   - the engine's call, e.g. 'FAKE', 'CANNOT VERIFY'
 * @param {'xs'|'sm'|'md'|'lg'} [props.size]
 * @param {string} [props.label] - text to show instead of the call (shown in
 *   capitals either way, so a legend can say "Fake" to screen readers)
 */
const VerdictBadge = ({ call, size = 'md', label, className, ...rest }) => {
  const verdict = verdictFor(call);
  const Icon = verdict.icon;
  return (
    <span
      className={cx('ui-verdict', `ui-verdict--${verdict.tone}`, `ui-verdict--${size}`, className)}
      data-verdict={verdict.tone}
      {...rest}
    >
      <Icon className="ui-verdict__icon" aria-hidden="true" />
      <span className="ui-verdict__label">{label || verdict.display || call}</span>
    </span>
  );
};

export default VerdictBadge;
