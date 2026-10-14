import { Languages } from 'lucide-react';
import { Badge } from './ui';

/**
 * How the message was read, before the evidence.
 *
 * A reader who asks a question in Tamil and gets back a verdict on an English
 * sentence deserves to see the step in between: what we took them to be
 * asking, in what language, and which claims we then checked. If we read them
 * wrongly, this is where they can tell — rather than trusting a verdict on
 * something they never said.
 */
const SPEECH_ACT_TEXT = {
  question: 'a question',
  hedged: 'something passed on ("I heard…")',
  sarcasm: 'sarcasm — we checked the claim being mocked',
  opinion: 'an opinion with a factual claim inside it',
  exhortation: 'a call to action',
  prediction: 'a prediction',
  mixed: 'several kinds of statement',
  assertion: 'a statement'
};

const TONE_TEXT = {
  alarmist: 'alarmist', emotional: 'emotional', celebratory: 'celebratory',
  sarcastic: 'sarcastic', angry: 'angry', urgent: 'urgent'
};

// A question gets a direct answer as well as a verdict.
const ANSWER = { FAKE: 'No — this is false.', REAL: 'Yes — this is true.', 'PARTLY FALSE': 'Partly — some of it is false.', 'CANNOT VERIFY': 'Unproven — nothing reliable confirms it.' };

const RESULT_TONE = { against: 'fake', for: 'real', none: 'unknown' };

const ReadAs = ({ understanding, call, perClaim = [] }) => {
  if (!understanding) return null;
  const tones = (understanding.tone || []).filter((t) => TONE_TEXT[t]);
  const language = understanding.romanized
    ? `${understanding.languageName} typed in English letters`
    : understanding.languageName;
  const checked = (understanding.claims || []).filter((c) => c.checkable);
  const resultFor = (claim) => {
    const match = perClaim.find((c) => c.claim === claim);
    if (!match) return null;
    if (match.independentContradiction > 0) return { text: 'Contradicted', cls: 'against' };
    if (match.independentSupport > 0) return { text: 'Confirmed', cls: 'for' };
    return { text: 'Not reported', cls: 'none' };
  };

  return (
    <section className="report-section read-as" aria-label="How we read your message">
      <h2 className="report-section__title"><Languages size={18} aria-hidden="true" /> How we read your message</h2>
      <dl className="read-as-facts">
        <div><dt>Language</dt><dd>{language}</dd></div>
        <div><dt>Read as</dt><dd>{SPEECH_ACT_TEXT[understanding.speechAct] || 'a statement'}{tones.length > 0 ? `, ${tones.map((t) => TONE_TEXT[t]).join(' and ')} in tone` : ''}</dd></div>
        {understanding.language !== 'en' && understanding.english && (
          <div><dt>In English</dt><dd>“{understanding.english}”</dd></div>
        )}
      </dl>
      {checked.length > 0 && (
        <>
          <h3 className="read-as-label">{checked.length === 1 ? 'The claim we checked' : 'The claims we checked'}</h3>
          <ol className="read-as-claims">
            {checked.map((c, i) => {
              const result = resultFor(c.claim);
              return (
                <li key={i}>
                  <span>{c.claim}</span>
                  {result && <Badge tone={RESULT_TONE[result.cls]} size="xs" className={`read-as-chip read-as-${result.cls}`}>{result.text}</Badge>}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {understanding.speechAct === 'question' && ANSWER[call] && (
        <p className="read-as-answer"><strong>Answer:</strong> {ANSWER[call]}</p>
      )}
    </section>
  );
};

export default ReadAs;
