import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleSlash2, ClipboardType, Image as ImageIcon, Link2, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import api from '../services/api';
import TrustReport from '../components/TrustReport';
import LivePipeline from '../components/LivePipeline';
import PlainAnswer from '../components/PlainAnswer';
import {
  Alert, Button, Field, LoadingRegion, PageHeader, Skeleton, SkeletonText, TabPanel, Tabs, VerdictBadge, VERDICTS
} from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/CheckPage.css';

/**
 * Check anything — the page for everything that is not an article from our feed.
 *
 * A reader almost never meets a claim as a news article. They meet it as a
 * message somebody forwarded, a caption under a picture, or a sentence spoken
 * in a video. The backend has handled those for a while; until now nothing in
 * the interface could reach it, so the capability existed and no one could use
 * it.
 *
 * This page is also the only place the input gate is visible. Most of what
 * people paste asserts nothing a newsroom could confirm or deny, and the honest
 * answer to that is not a verdict — it is a refusal that says what is missing.
 */

const MODES = [
  { id: 'text', label: 'Paste text', icon: ClipboardType,
    hint: 'A forwarded message, a post, or the claim itself.' },
  { id: 'link', label: 'Paste a link', icon: Link2,
    hint: 'A news article, a YouTube video, or a social post.' },
  { id: 'image', label: 'Upload a screenshot', icon: ImageIcon,
    hint: 'A screenshot of a post or message. We read the text out of it.' }
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// The answers the reader can get, shown before they submit.
const LEGEND = ['REAL', 'FAKE', 'PARTLY FALSE', 'CANNOT VERIFY'];

/**
 * Run the check over the streamed endpoint, reporting each event as it lands.
 *
 * Returns the report, or null when streaming is unavailable (an old browser, a
 * buffering proxy, an expired session) so the caller can fall back to the
 * plain endpoint. A refusal or fault arrives as an event and is thrown in the
 * same shape an axios error has, so one handler serves both routes.
 */
const streamContentCheck = async (body, onEvent) => {
  if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') return null;
  const token = localStorage.getItem('token');
  let response;
  try {
    response = await fetch(`${api.defaults.baseURL}/ai/analyze-content/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
  } catch (_) {
    return null;
  }
  if (!response.ok || !response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }
      if (event.type === 'report') return event.report;
      if (event.type === 'error') {
        const { type, status, ...data } = event;
        const error = new Error(data.error || 'The check failed.');
        error.response = { status, data };
        throw error;
      }
      onEvent(event);
    }
  }
  throw new Error('The check ended without a result.');
};

// Messages of the kinds people forward, one per language the checker reads.
const EXAMPLES = [
  { label: 'A figure', text: 'India won 84 medals at the Asian Games 2026.' },
  { label: 'A WhatsApp forward', text: 'RBI has declared every Saturday a bank holiday from next month. Share with everyone!' },
  { label: 'Tanglish', text: 'Chennai la naalai mudhal ella school-um leave nu Collector announce panniyirukaru nu sonnanga' },
  { label: 'Hindi', text: 'सरकार ने सभी किसानों के खाते में 10,000 रुपये डालने की नई योजना घोषित की है।' }
];

const SPEECH_ACT_READ = {
  opinion: 'an opinion', prediction: 'a prediction', exhortation: 'a call to action', question: 'a question'
};

/** The input gate's answer: not a verdict, and not a failure — what is missing. */
const Refusal = ({ refusal }) => (
  <section className="check-refusal" aria-labelledby="refusal-title">
    <div className="check-refusal__icon" aria-hidden="true"><CircleSlash2 size={22} /></div>
    <div className="check-refusal__body">
      <h2 id="refusal-title">Nothing to check</h2>
      {refusal.readAs && (
        <p className="check-refusal__read">
          We read this as {SPEECH_ACT_READ[refusal.readAs.speechAct] || 'a statement'}
          {refusal.readAs.languageName && refusal.readAs.languageName !== 'English' ? ` in ${refusal.readAs.languageName}` : ''}.
        </p>
      )}
      <p className="check-refusal__reason">{refusal.reason}</p>
      {refusal.missing.length > 0 && (
        <div className="check-refusal__missing">
          <p><strong>To check this we would need:</strong></p>
          <ul>{refusal.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {refusal.canRetryWith.length > 0 && (
        <p className="check-refusal__read">Try pasting the text of the post, or a screenshot of it, instead.</p>
      )}
    </div>
  </section>
);

/** The shape of the answer, while the first events are on their way. */
const ResultSkeleton = () => (
  <LoadingRegion label="Checking. The verdict will appear here." className="check-skeleton">
    <div className="check-skeleton__card">
      <Skeleton width="110px" height="12px" />
      <Skeleton width="80%" height="18px" />
      <div className="check-skeleton__row">
        <Skeleton width="130px" height="40px" radius="8px" />
        <SkeletonText lines={2} />
      </div>
    </div>
    <div className="check-skeleton__grid">
      <Skeleton height="180px" radius="12px" />
      <Skeleton height="180px" radius="12px" />
    </div>
  </LoadingRegion>
);

const CheckPage = () => {
  useDocumentTitle('Check anything');
  // A video or social link pasted into the feed's link box is redirected here,
  // arriving prefilled so the reader does not have to paste it twice. A claim
  // opened from the claims registry ("Check it again") arrives as text.
  const handed = useLocation().state;
  const handedOver = handed?.url;

  const [mode, setMode] = useState(handedOver ? 'link' : 'text');
  const [text, setText] = useState(handed?.text || '');
  const [url, setUrl] = useState(handedOver || '');
  const [account, setAccount] = useState('');
  const [imageName, setImageName] = useState('');
  const imageData = useRef(null);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  // The live view of the check: what was read, and each channel's finding.
  const [stage, setStage] = useState(null);
  const [understood, setUnderstood] = useState(null);
  const [channels, setChannels] = useState({});
  const [elapsedMs, setElapsedMs] = useState(0);
  const [streamed, setStreamed] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState('');

  const formRef = useRef(null);
  const inputRef = useRef(null);

  const reset = () => {
    setReport(null);
    setRefusal(null);
    setError('');
    setStage(null);
    setUnderstood(null);
    setChannels({});
    setStreamed(false);
  };

  // Bring the check into view the moment it starts, since it opens below the
  // form and would otherwise run unseen.
  const resultRef = useRef(null);
  useEffect(() => {
    if (loading && resultRef.current?.scrollIntoView) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading]);

  const onStreamEvent = (event) => {
    setStreamed(true);
    if (event.type === 'stage') {
      if (event.id === 'understood') setUnderstood(event);
      else setStage(event);
    }
    if (event.type === 'channel') {
      // The four writing checks share one line, counted as they land.
      const id = event.group || event.id;
      setChannels((current) => {
        const previous = current[id];
        return {
          ...current,
          [id]: event.group
            ? { count: (previous?.count || 0) + 1, ms: Math.max(previous?.ms || 0, event.ms || 0) }
            : { summary: event.summary, ms: event.ms, count: 1 }
        };
      });
    }
  };

  const chooseMode = (id) => {
    setMode(id);
    reset();
  };

  const fillExample = (example) => {
    setMode('text');
    setText(example);
    reset();
    inputRef.current?.focus();
  };

  const handleImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();

    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is larger than 8 MB. Try a screenshot rather than a photo.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      imageData.current = reader.result;
      setImageName(file.name);
    };
    reader.onerror = () => setError('That file could not be read. Try saving it again as a PNG or JPEG.');
    reader.readAsDataURL(file);
  };

  const payload = () => {
    if (mode === 'link') return { url: url.trim() };
    if (mode === 'image') return { imageBase64: imageData.current, account: account.trim() || undefined };
    return { text: text.trim(), account: account.trim() || undefined };
  };

  const ready = () => {
    if (mode === 'link') return url.trim().length > 0;
    if (mode === 'image') return Boolean(imageData.current);
    return text.trim().length > 0;
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!ready() || loading) return;

    reset();
    setLoading(true);
    const started = Date.now();
    try {
      const streamedReport = await streamContentCheck(payload(), onStreamEvent);
      if (streamedReport) {
        setReport(streamedReport);
      } else {
        const response = await api.post('/ai/analyze-content', payload());
        setReport(response.data);
      }
      setElapsedMs(Date.now() - started);
    } catch (err) {
      const data = err.response?.data;
      // A refusal is not a failure. The backend declines input that asserts
      // nothing checkable and says what would make it checkable; that answer is
      // as useful as a verdict and is shown as its own result, not as an error.
      if (data && (data.checkable === false || data.canRetryWith)) {
        setRefusal({
          readAs: data.understanding || null,
          reason: data.error,
          missing: data.missing || [],
          canRetryWith: data.canRetryWith || []
        });
      } else {
        setError(data?.error || 'We could not check that just now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const checkAnother = () => {
    reset();
    setText('');
    setUrl('');
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    inputRef.current?.focus({ preventScroll: true });
  };

  const active = MODES.find((m) => m.id === mode);
  const busyOrDone = loading || Boolean(report) || Boolean(refusal);

  return (
    <div className={`page check-page ${busyOrDone ? 'has-result' : ''}`}>
      <PageHeader
        eyebrow="Check anything"
        title="Is it true? Check before you share."
        description="Paste a forwarded message, a link or a screenshot — in English, Tamil, Hindi or Tanglish. We look for independent reporting, fact-checks and reference facts, and show you the evidence behind the verdict."
      />

      <div className="check-layout">
        <form className="check-form" onSubmit={handleSubmit} ref={formRef} aria-label="Check a claim">
          <Tabs tabs={MODES} value={mode} onChange={chooseMode} label="What do you want to check?" idPrefix="check" />

          <TabPanel id={mode} idPrefix="check" className="check-panel">
            {mode === 'text' && (
              <Field label="Message, post or claim" hint={active.hint}>
                <textarea
                  ref={inputRef}
                  className="ui-input check-textarea"
                  rows={7}
                  value={text}
                  onChange={(e) => { setText(e.target.value); reset(); }}
                  placeholder="Paste the message or post here…"
                />
              </Field>
            )}

            {mode === 'link' && (
              <Field label="Link" hint={active.hint}>
                <input
                  ref={inputRef}
                  className="ui-input"
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); reset(); }}
                  placeholder="https://…"
                />
              </Field>
            )}

            {mode === 'image' && (
              <div className="ui-field">
                <span className="ui-field__label" id="check-image-label">Screenshot</span>
                <p className="ui-field__hint" id="check-image-hint">{active.hint}</p>
                <div className="check-upload">
                  <input
                    ref={inputRef}
                    id="check-image"
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    onChange={handleImage}
                    aria-labelledby="check-image-label"
                    aria-describedby="check-image-hint"
                  />
                  <label htmlFor="check-image" className="check-upload-label">
                    <Upload size={20} aria-hidden="true" />
                    <span className="check-upload-name">{imageName || 'Choose a screenshot'}</span>
                    <span className="check-upload-hint">PNG or JPEG, up to 8 MB</span>
                  </label>
                </div>
              </div>
            )}

            {mode === 'text' && (
              <div className="check-examples">
                <span className="check-examples__label">Try an example:</span>
                {EXAMPLES.map((example) => (
                  <button key={example.label} type="button" className="check-example" onClick={() => fillExample(example.text)}>
                    {example.label}
                  </button>
                ))}
              </div>
            )}

            {mode !== 'link' && (
              <Field label="Who posted it?" optional hint="A name or handle helps us judge the source.">
                <input
                  className="ui-input check-account"
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="e.g. @handle or the group it came from"
                />
              </Field>
            )}
          </TabPanel>

          <div className="check-submit-row">
            <Button type="submit" size="lg" icon={ShieldCheck} disabled={!ready() || loading} loading={loading} className="check-submit">
              {loading ? 'Checking…' : 'Check it'}
            </Button>
            <p className="check-submit-note">Takes about 20 seconds. Nothing you paste is stored — only the claims in it.</p>
          </div>
        </form>

        <aside className="check-aside" aria-labelledby="check-aside-title">
          {/* What may be given, and the answers there are, before submitting —
              including the fact that some input gets no verdict at all. */}
          <h2 className="check-aside__head" id="check-aside-title">What you will get back</h2>
          <dl className="check-verdicts">
            {LEGEND.map((call) => (
              <div key={call} className="check-verdict">
                <dt><VerdictBadge call={call} size="sm" label={VERDICTS[call].label} /></dt>
                <dd>{VERDICTS[call].description}</dd>
              </div>
            ))}
          </dl>
          <p className="check-aside__note">
            Outlets are counted, not articles: five papers carrying one wire story count as one source.
          </p>
          <h2 className="check-aside__head">What it will refuse</h2>
          <p className="check-aside__note">
            A question, an opinion, or something too vague to place gets no verdict — only a note saying what would
            make it checkable. A system that answers what it cannot answer teaches you to distrust the answers it
            gets right.
          </p>
        </aside>
      </div>

      <div className="check-result-area" ref={resultRef}>
        {error && (
          <Alert tone="danger" title="The check did not finish" action={ready() ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={handleSubmit}>Try again</Button> : null}>
            {error}
          </Alert>
        )}

        {/* A refusal, shown as a result in its own right. */}
        {refusal && <Refusal refusal={refusal} />}

        {loading && !streamed && <ResultSkeleton />}

        {/* The check as it runs, folded to one line once the verdict is in. */}
        {(loading || report) && streamed && (
          <LivePipeline stage={stage} understood={understood} channels={channels} finished={Boolean(report)} elapsedMs={elapsedMs} />
        )}

        {report && (
          <section className="check-result" aria-label="Result">
            <TrustReport report={report} evidenceFirst>
              <PlainAnswer
                question={mode === 'text' ? text.trim() : report.evidence?.perClaim?.[0]?.claim}
                ourCall={report.call}
                sourceCount={
                  (report.factChecks?.matches?.length || 0)
                  + (report.evidence?.perClaim || []).reduce((n, c) => n + (c.independentSupport || 0) + (c.independentContradiction || 0), 0)
                  + (report.currentCoverage?.counted ? (report.currentCoverage.presupposingFalse || []).length : 0)
                }
              />
            </TrustReport>
            <div className="check-again">
              <Button variant="secondary" icon={RotateCcw} onClick={checkAnother}>Check something else</Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default CheckPage;
