import { useState } from 'react';
import { Bot } from 'lucide-react';
import api from '../services/api';
import { Button, VerdictBadge } from './ui';

/**
 * "Could a chatbot do this?" — answered on the page, on request.
 *
 * Asks the same hosted model the pipeline uses, zero-shot, with today's date
 * and nothing to read, and sets its answer beside ours. The point is not that
 * the model is always wrong: it is that its answer comes from memory, with no
 * source anyone can open, and for this week's news memory has nothing in it.
 */
const PlainAnswer = ({ question, ourCall, sourceCount }) => {
  const [state, setState] = useState({ status: 'idle', answer: null });

  if (!question) return null;

  const ask = async () => {
    setState({ status: 'loading', answer: null });
    try {
      const { data } = await api.post('/ai/plain-answer', { text: question });
      setState({ status: 'done', answer: data });
    } catch (_) {
      setState({ status: 'error', answer: null });
    }
  };

  const { status, answer } = state;
  const agrees = answer && answer.call === ourCall;

  return (
    <section className="report-section plain-answer" aria-label="Could a chatbot do this?">
      <div className="plain-answer-head">
        <div>
          <h2 className="report-section__title"><Bot size={18} aria-hidden="true" /> Could a chatbot do this?</h2>
          {status === 'idle' && (
            <p className="plain-answer-note">
              See what the same AI model says when it answers from memory, with no search and no evidence.
            </p>
          )}
        </div>
        {status !== 'done' && (
          <Button variant="secondary" size="sm" onClick={ask} loading={status === 'loading'}>
            {status === 'loading' ? 'Asking…' : 'Ask a plain AI model the same thing'}
          </Button>
        )}
      </div>
      {status === 'error' && <p className="plain-answer-note" role="alert">The model could not be reached just now.</p>}
      {status === 'done' && answer && (
        <div className="plain-answer-body">
          <div className="plain-answer-row">
            <span className="plain-answer-label">Plain AI model</span>
            <VerdictBadge call={answer.call} size="sm" className="plain-answer-call" />
            <span className="plain-answer-reason">{answer.reason}</span>
          </div>
          <div className="plain-answer-row">
            <span className="plain-answer-label">Pure Press</span>
            <VerdictBadge call={ourCall} size="sm" className="plain-answer-call" />
            <span className="plain-answer-reason">
              {sourceCount > 0
                ? `Backed by ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} you can open above.`
                : 'Backed by the evidence channels above.'}
            </span>
          </div>
          <p className="plain-answer-note">
            {agrees
              ? 'They agree this time — but the plain model gives no source you can check, and it answers from memory, which stops before this week’s news.'
              : 'They disagree. The plain model answered from memory with no source to check; the verdict above rests on evidence you can open.'}
            {answer.model ? ` (Model: ${answer.model}, asked with today’s date.)` : ''}
          </p>
        </div>
      )}
    </section>
  );
};

export default PlainAnswer;
