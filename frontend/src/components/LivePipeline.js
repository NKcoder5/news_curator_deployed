import { useState } from 'react';

/**
 * The check as it runs: each evidence channel, and what it found the moment
 * it finds it.
 *
 * The backend streams one event per channel. Showing them as they land does
 * two things a spinner cannot: the reader sees that several independent
 * kinds of evidence were consulted, and sees each one's finding in its own
 * words before the verdict arrives.
 */
export const PIPELINE = [
  { id: 'claimExtraction', name: 'Reading out the claims' },
  { id: 'verification', name: 'Searching news coverage' },
  { id: 'factChecks', name: 'Asking the fact-checkers' },
  { id: 'currentCoverage', name: 'Reading this week’s news on the subject' },
  { id: 'premises', name: 'Checking reference facts' },
  { id: 'writing', name: 'Reading how it is written', of: 4 }
];

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

const SPEECH = { question: 'a question', hedged: 'something passed on', sarcasm: 'sarcasm', opinion: 'an opinion with a claim in it', mixed: 'a mixed message', assertion: 'a statement' };

const LivePipeline = ({ stage, understood, channels, finished, elapsedMs }) => {
  const [open, setOpen] = useState(false);
  const doneCount = PIPELINE.filter((step) => {
    const c = channels[step.id];
    return c && (!step.of || c.count >= step.of);
  }).length;

  // Once the verdict is in, the steps fold into one line: the evidence board
  // below now carries their findings in full.
  if (finished && !open) {
    return (
      <div className="pipeline pipeline-folded">
        <span>
          Checked across {PIPELINE.length - 1} evidence channels and 4 writing checks
          {elapsedMs ? ` in ${seconds(elapsedMs)}` : ''}.
        </span>
        <button type="button" className="pipeline-toggle" onClick={() => setOpen(true)}>Show the steps</button>
      </div>
    );
  }

  return (
    <div className="pipeline" aria-live="polite">
      <div className="pipeline-head">
        <span className="pipeline-title">{finished ? 'How it was checked' : 'Checking…'}</span>
        <span className="pipeline-count">{doneCount} of {PIPELINE.length}</span>
      </div>
      {stage && (
        <p className="pipeline-stage">
          {stage.id === 'read'
            ? `Read ${stage.modality === 'article' ? 'the article' : stage.modality === 'video' ? 'the video transcript' : stage.modality === 'image' ? 'the screenshot' : 'the text'}${stage.title ? `: “${stage.title.slice(0, 90)}${stage.title.length > 90 ? '…' : ''}”` : ''}`
            : `${stage.name}…`}
        </p>
      )}
      {understood && (
        <p className="pipeline-stage">
          Read as {SPEECH[understood.speechAct] || 'a statement'}
          {understood.languageName && understood.languageName !== 'English'
            ? ` in ${understood.languageName}${understood.romanized ? ' (typed in English letters)' : ''}` : ''}
          {understood.claims?.length ? ` — checking: ${understood.claims.map((c) => `“${c}”`).join(' and ')}` : ''}
        </p>
      )}
      <ol className="pipeline-steps">
        {PIPELINE.map((step) => {
          const c = channels[step.id];
          const done = c && (!step.of || c.count >= step.of);
          return (
            <li key={step.id} className={`pipeline-step ${done ? 'is-done' : 'is-running'}`}>
              <span className="pipeline-dot" aria-hidden="true">{done ? '✓' : ''}</span>
              <span className="pipeline-name">
                {step.name}
                {step.of && c && !done ? ` (${c.count} of ${step.of})` : ''}
              </span>
              {done && c.ms ? <span className="pipeline-ms">{seconds(c.ms)}</span> : null}
              {done && c.summary && <span className="pipeline-summary">{c.summary}</span>}
            </li>
          );
        })}
      </ol>
      {finished && (
        <button type="button" className="pipeline-toggle" onClick={() => setOpen(false)}>Fold the steps</button>
      )}
    </div>
  );
};

export default LivePipeline;
