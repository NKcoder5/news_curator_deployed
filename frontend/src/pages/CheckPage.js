import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Link2, ClipboardType, Image as ImageIcon } from 'lucide-react';
import api from '../services/api';
import TrustReport from '../components/TrustReport';
import LivePipeline from '../components/LivePipeline';
import PlainAnswer from '../components/PlainAnswer';
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

const CheckPage = () => {
  // A video or social link pasted into the feed's link box is redirected here,
  // arriving prefilled so the reader does not have to paste it twice.
  const handedOver = useLocation().state?.url;

  const [mode, setMode] = useState(handedOver ? 'link' : 'text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState(handedOver || '');
  const [account, setAccount] = useState('');
  const [imageName, setImageName] = useState('');
  const imageData = useRef(null);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  // The live view of the check: what was read, and each channel's finding.
  const [stage, setStage] = useState(null);
  const [channels, setChannels] = useState({});
  const [elapsedMs, setElapsedMs] = useState(0);
  const [streamed, setStreamed] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState('');

  const reset = () => {
    setReport(null);
    setRefusal(null);
    setError('');
    setStage(null);
    setChannels({});
    setStreamed(false);
  };

  // Bring the live check into view the moment it starts, since it opens
  // below the form and would otherwise run unseen.
  const pipelineRef = useRef(null);
  useEffect(() => {
    if (loading && streamed && pipelineRef.current?.scrollIntoView) {
      pipelineRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, streamed]);

  const onStreamEvent = (event) => {
    setStreamed(true);
    if (event.type === 'stage') setStage(event);
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
    event.preventDefault();
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

  const active = MODES.find((m) => m.id === mode);

  return (
    <div className="press-sheet check-page">
      <header className="press-masthead">
        <div className="press-dateline">The Verification Desk</div>
        <h1 className="press-name">Check Anything</h1>
        <div className="press-tagline">
          An article, a video, a forwarded message or a screenshot — we will tell
          you whether it holds up
        </div>
      </header>

      {/* Two columns, because one narrow form adrift in a full-width sheet is
          what the page looked like before: a lot of bare paper and nothing to
          justify it. The right-hand column carries what a reader needs BEFORE
          they submit — the three answers they can get, and the fact that some
          input gets none — which until now only appeared after the fact, in a
          refusal they had no way to anticipate. */}
      <div className="check-layout">
        <form className="check-form" onSubmit={handleSubmit}>
          <div className="check-modes" role="tablist">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.id}
                  className={`check-mode ${mode === m.id ? 'active' : ''}`}
                  onClick={() => chooseMode(m.id)}
                >
                  <Icon size={15} /> {m.label}
                </button>
              );
            })}
          </div>

          <p className="check-hint">{active.hint}</p>

          {mode === 'text' && (
            <textarea
              className="press-input check-textarea"
              rows={9}
              value={text}
              onChange={(e) => { setText(e.target.value); reset(); }}
              placeholder="Paste the message or post here…"
            />
          )}

          {mode === 'link' && (
            <input
              className="press-input"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); reset(); }}
              placeholder="Paste a news link, or a YouTube video — https://…"
            />
          )}

          {mode === 'image' && (
            <div className="check-upload">
              <input id="check-image" type="file" accept="image/*" onChange={handleImage} />
              <label htmlFor="check-image" className="check-upload-label">
                {imageName || 'Choose a screenshot…'}
              </label>
            </div>
          )}

          {mode !== 'link' && (
            <input
              className="press-input check-account"
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Who posted it? (optional — helps us judge the source)"
            />
          )}

          <button className="press-btn check-submit" type="submit" disabled={!ready() || loading}>
            {loading ? 'Checking…' : 'Check it'}
          </button>
        </form>

        <aside className="check-aside">
          {/* What may be given, which was the least discoverable thing on the
              page: video is accepted and always was, but the only mention of
              it sat inside the link tab's hint, and the page opens on the text
              tab. */}
          <h2 className="check-aside__head">What you can give it</h2>
          <ul className="check-inputs">
            <li><strong>A news link</strong> — we read the article itself, not the preview.</li>
            <li><strong>A YouTube video</strong> — we read the transcript, since the claim is in the speech.</li>
            <li><strong>A forwarded message</strong> — paste it as it reached you.</li>
            <li><strong>A screenshot</strong> — we read the text out of the image.</li>
          </ul>

          <h2 className="check-aside__head">What you will get back</h2>
          <dl className="check-verdicts">
            <div className="check-verdict check-verdict--real">
              <dt>Real</dt>
              <dd>Independent outlets report the same events.</dd>
            </div>
            <div className="check-verdict check-verdict--fake">
              <dt>Fake</dt>
              <dd>Outlets report otherwise, fact-checkers have rated it false, this week’s news rules it out, or a premise of it is false.</dd>
            </div>
            <div className="check-verdict check-verdict--unknown">
              <dt>Cannot verify</dt>
              <dd>Nothing independent supports it yet. Not a finding that it is false.</dd>
            </div>
          </dl>

          <p className="check-aside__note">
            Outlets are counted, not articles: five papers carrying one wire
            story count as one source.
          </p>

          <h2 className="check-aside__head">What it will refuse</h2>
          <p className="check-aside__note">
            A question, an opinion, or something too vague to place gets no
            verdict — only a note saying what would make it checkable. A system
            that answers what it cannot answer teaches you to distrust the
            answers it gets right.
          </p>
        </aside>
      </div>

      {error && <p className="check-error">{error}</p>}

      {/* A refusal, shown as a result in its own right. */}
      {refusal && (
        <section className="check-refusal">
          <h2>Nothing to check</h2>
          <p>{refusal.reason}</p>
          {refusal.missing.length > 0 && (
            <p className="check-missing">
              <strong>To check this we would need:</strong> {refusal.missing.join('; ')}.
            </p>
          )}
          {refusal.canRetryWith.length > 0 && (
            <p className="check-missing">
              Try pasting the text of the post, or a screenshot of it, instead.
            </p>
          )}
        </section>
      )}

      {/* The check as it runs, folded to one line once the verdict is in. */}
      {(loading || report) && streamed && (
        <div ref={pipelineRef}>
          <LivePipeline stage={stage} channels={channels} finished={Boolean(report)} elapsedMs={elapsedMs} />
        </div>
      )}

      {report && (
        <section className="check-result">
          <TrustReport report={report} evidenceFirst />
          <PlainAnswer
            question={mode === 'text' ? text.trim() : report.evidence?.perClaim?.[0]?.claim}
            ourCall={report.call}
            sourceCount={
              (report.factChecks?.matches?.length || 0)
              + (report.evidence?.perClaim || []).reduce((n, c) => n + (c.independentSupport || 0) + (c.independentContradiction || 0), 0)
              + (report.currentCoverage?.counted ? (report.currentCoverage.presupposingFalse || []).length : 0)
            }
          />
        </section>
      )}
    </div>
  );
};

export default CheckPage;
