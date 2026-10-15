import { useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Link2, ClipboardType, Image as ImageIcon } from 'lucide-react';
import api from '../services/api';
import TrustReport from '../components/TrustReport';
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
const OCR_MAX_DIMENSION = 2800;

// Small newspaper text benefits more from extra pixels and contrast than from
// sending the original thumbnail straight to OCR. Keep the original preview,
// but submit a normalized lossless image when the browser can process it.
const prepareImageForOcr = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(3, Math.max(1, OCR_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      resolve(dataUrl);
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = (0.299 * pixels.data[i]) + (0.587 * pixels.data[i + 1]) + (0.114 * pixels.data[i + 2]);
      const contrast = Math.max(0, Math.min(255, ((gray - 128) * 1.18) + 128));
      pixels.data[i] = contrast;
      pixels.data[i + 1] = contrast;
      pixels.data[i + 2] = contrast;
    }
    context.putImageData(pixels, 0, 0);
    const png = canvas.toDataURL('image/png');
    if ((png.length * 0.75) <= MAX_IMAGE_BYTES) {
      resolve(png);
      return;
    }
    const compressed = canvas.toDataURL('image/jpeg', 0.9);
    resolve((compressed.length * 0.75) <= MAX_IMAGE_BYTES ? compressed : dataUrl);
  };
  image.onerror = () => reject(new Error('That image could not be prepared for reading.'));
  image.src = dataUrl;
});

const CheckPage = () => {
  // A video or social link pasted into the feed's link box is redirected here,
  // arriving prefilled so the reader does not have to paste it twice.
  const handedOverState = useLocation().state || {};
  const handedOver = handedOverState.url;
  const handedOverText = handedOverState.text || '';

  const [mode, setMode] = useState(handedOver ? 'link' : 'text');
  const [text, setText] = useState(handedOverText);
  const [url, setUrl] = useState(handedOver || '');
  const [account, setAccount] = useState('');
  const [imageName, setImageName] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageReading, setImageReading] = useState(false);
  const [imageEnhanced, setImageEnhanced] = useState(false);
  const imageData = useRef(null);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState('');

  const reset = () => {
    setReport(null);
    setRefusal(null);
    setError('');
  };

  const chooseMode = (id) => {
    setMode(id);
    reset();
  };

  const handleImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();

    if (!file.type.startsWith('image/')) {
      setError('Choose a PNG, JPEG, or another supported image file.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is larger than 8 MB. Try a screenshot rather than a photo.');
      event.target.value = '';
      return;
    }

    setImageReading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const prepared = await prepareImageForOcr(reader.result);
        imageData.current = prepared;
        setImagePreview(reader.result);
        setImageEnhanced(prepared !== reader.result);
      } catch (_) {
        imageData.current = reader.result;
        setImagePreview(reader.result);
        setImageEnhanced(false);
      }
      setImageName(file.name);
      setImageReading(false);
    };
    reader.onerror = () => {
      imageData.current = null;
      setImagePreview('');
      setImageName('');
      setImageEnhanced(false);
      setImageReading(false);
      setError('That file could not be read. Try saving it again as a PNG or JPEG.');
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    imageData.current = null;
    setImagePreview('');
    setImageName('');
    setImageEnhanced(false);
    setImageReading(false);
    reset();
    const input = document.getElementById('check-image');
    if (input) input.value = '';
  };

  const payload = () => {
    if (mode === 'link') return { url: url.trim() };
    if (mode === 'image') return { imageBase64: imageData.current, account: account.trim() || undefined };
    return { text: text.trim(), account: account.trim() || undefined };
  };

  const ready = () => {
    if (mode === 'link') return url.trim().length > 0;
    if (mode === 'image') return Boolean(imageData.current) && !imageReading;
    return text.trim().length > 0;
  };

  const handleSubmit = async (event, options = {}) => {
    event.preventDefault();
    if (!ready() || loading) return;

    reset();
    setLoading(true);
    try {
      const response = await api.post('/ai/analyze-content', {
        ...payload(),
        ...(options.rerun ? { rerun: true } : {})
      });
      setReport(response.data);
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

  const rerun = () => handleSubmit({ preventDefault: () => {} }, { rerun: true });

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

      <div className="check-workflow" aria-label="How checking works">
        <div><span>01</span><strong>Bring the claim</strong><small>Paste, link, or screenshot</small></div>
        <div><span>02</span><strong>We read the context</strong><small>Source, wording, and evidence</small></div>
        <div><span>03</span><strong>See the grounds</strong><small>Verdict with supporting detail</small></div>
      </div>

      {/* Two columns, because one narrow form adrift in a full-width sheet is
          what the page looked like before: a lot of bare paper and nothing to
          justify it. The right-hand column carries what a reader needs BEFORE
          they submit — the three answers they can get, and the fact that some
          input gets none — which until now only appeared after the fact, in a
          refusal they had no way to anticipate. */}
      <div className="check-layout">
        <form className="check-form" onSubmit={handleSubmit}>
          <div className="check-form__intro">
            <p className="check-form__eyebrow">Start a new check</p>
            <h2>{active.label}</h2>
            <p>Give us one piece of content. We will keep the original context while checking the claim.</p>
          </div>
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
              rows={6}
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
            <div className={`check-upload ${imagePreview ? 'has-image' : ''}`}>
              <input id="check-image" type="file" accept="image/*" onChange={handleImage} />
              <label htmlFor="check-image" className="check-upload-label">
                {imageReading ? 'Reading image…' : imageName || 'Choose a screenshot…'}
              </label>
              {imagePreview && (
                <div className="check-image-preview">
                  <img src={imagePreview} alt="Selected screenshot preview" />
                  <div>
                    <strong>{imageName}</strong>
                    <small>{imageEnhanced ? 'Enhanced for small text · ready for OCR' : 'Ready for OCR · under 8 MB'}</small>
                    <button type="button" onClick={clearImage}>Remove image</button>
                  </div>
                </div>
              )}
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

          <div className="check-submit-row">
            <span className="check-submit-note">
              {mode === 'text' ? `${text.length.toLocaleString()} characters` : mode === 'image' ? 'PNG or JPEG · up to 8 MB' : 'We will open the source page'}
            </span>
            <button className="press-btn check-submit" type="submit" disabled={!ready() || loading}>
              {loading ? 'Checking…' : 'Check it'}
            </button>
          </div>
          {loading && (
            <div className="check-form-progress" role="status" aria-live="polite">
              <span className="check-form-progress__spinner" aria-hidden="true" />
              <span>
                <strong>Checking your submission</strong>
                <small>Reading the claim and gathering independent evidence…</small>
              </span>
            </div>
          )}
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
              <dd>Independent reporting contradicts it, or a premise of it is false.</dd>
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

      {report && (
        <section className="check-result">
          <div className="check-result__heading">
            <div>
              <p className="check-form__eyebrow">Completed analysis</p>
              <h2>What the evidence says</h2>
            </div>
            <span className="check-result__mode">{active.label}</span>
          </div>
          <button
            type="button"
            className="press-btn press-btn-outline check-rerun"
            onClick={rerun}
            disabled={loading}
          >
            {loading ? 'Running again…' : 'Run analysis again'}
          </button>
          <TrustReport report={report} evidenceFirst />
        </section>
      )}
    </div>
  );
};

export default CheckPage;
