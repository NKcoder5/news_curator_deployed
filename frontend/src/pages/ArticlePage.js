import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleCheck, Columns2, ExternalLink, RefreshCw } from 'lucide-react';
import api from '../services/api';
import TrustReport from '../components/TrustReport';
import { Alert, Button, LoadingRegion, Skeleton, SkeletonText } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/ArticlePage.css';

const CHECKS = 6;

/**
 * Run a streamed trust analysis, reporting each check as the server finishes it.
 *
 * The endpoint answers with newline-delimited JSON rather than Server-Sent
 * Events, because the article body must be POSTed and EventSource is GET-only.
 * If streaming is unavailable for any reason the caller falls back to the plain
 * endpoint, so an older browser or a proxy that buffers still works.
 *
 * The address comes from the shared client (services/api.js): this page used
 * to build its own, expecting REACT_APP_API_URL without "/api" where the
 * client expects it with, so setting the variable broke one or the other.
 *
 * @param {Object} body     - the analysis request
 * @param {Function} onStep - called with {id, name, ms} per completed check
 * @returns {Promise<Object>} the finished report
 */
const streamTrustAnalysis = async (body, onStep) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${api.defaults.baseURL}/ai/trust-analysis/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    // No stream available — fall back to the ordinary endpoint.
    const plain = await api.post('/ai/trust-analysis', body);
    return plain.data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let report = null;

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

      if (event.type === 'progress') onStep(event);
      else if (event.type === 'report') report = event.report;
      else if (event.type === 'error') throw new Error(event.error);
    }
  }

  if (!report) throw new Error('The analysis ended without a report.');
  return report;
};

const formatDate = (iso) => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
};

const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const article = location.state?.article;
  const startTime = location.state?.startTime || Date.now();
  useDocumentTitle(article?.title || 'Article');

  const [summary, setSummary] = useState('');
  const [detailedSummary, setDetailedSummary] = useState('');
  const [summarySourceText, setSummarySourceText] = useState(null);
  const [detailedSourceText, setDetailedSourceText] = useState(null);
  const [credibility, setCredibility] = useState(null);
  // The six checks, filled in as the server reports each one finishing. The
  // reader watches the report being built instead of waiting on a spinner.
  const [completedChecks, setCompletedChecks] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    summary: true,
    detailedSummary: false,
    credibility: true
  });
  const [error, setError] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);

  // Which article the page is currently showing. Replies for anything else are
  // discarded — see the guard in analyze().
  const latestRequest = useRef(article?.url);
  useEffect(() => {
    latestRequest.current = article?.url;
    setImageFailed(false);
  }, [article]);

  const trackActivity = useCallback(async (activityType, duration = 0) => {
    try {
      if (!localStorage.getItem('token')) return;
      await api.post('/tracking/activity', {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source: article.source?.name || 'Unknown Source',
        activityType,
        duration,
        completed: activityType === 'read'
      });
    } catch (_) {
      // Tracking is best-effort; a failure must not interrupt reading.
    }
  }, [article]);

  const analyze = useCallback(async (type) => {
    if (!article) return;

    const content = article.content || article.description || article.title;
    setLoadingStates(prev => ({ ...prev, [type]: true }));
    setError(null);

    try {
      let endpoint, body;

      switch (type) {
        case 'summary':
          endpoint = '/ai/summarize';
          // The URL lets the server reuse this article's existing summary, so
          // the same article always reads the same way.
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'detailedSummary':
          endpoint = '/ai/detailed-summary';
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'credibility':
          body = {
            title: article.title,
            content,
            source: article.source?.name || article.source || 'Unknown',
            url: article.url,
            // Feed stories are often hours old, and the news index the check
            // searches runs about a day behind. With the date, a story too new
            // to have been indexed is reported as that, rather than as a story
            // nobody else is carrying.
            publishedAt: article.publishedAt || null,
          };
          break;
        default:
          console.warn('Unknown analysis type:', type);
          return;
      }

      // The trust analysis is streamed so each check can be shown as it lands.
      // Everything else is a single request/response.
      if (type === 'credibility') {
        setCompletedChecks([]);
        const finished = await streamTrustAnalysis(body, (step) => {
          if (latestRequest.current !== article.url) return;
          setCompletedChecks(prev =>
            prev.some(c => c.id === step.id) ? prev : [...prev, step]);
        });
        if (latestRequest.current !== article.url) return;
        setCredibility(finished);
        return;
      }

      const response = await api.post(endpoint, body);

      // These calls take seconds. If the reader has moved to another article in
      // the meantime, a late reply belongs to the previous one — dropping it
      // stops one article's summary appearing under another's headline.
      if (latestRequest.current !== article.url) return;

      if (type === 'summary') {
        setSummary(response.data.summary);
        setSummarySourceText(response.data.sourceText || null);
      } else {
        setDetailedSummary(response.data.summary);
        setDetailedSourceText(response.data.sourceText || null);
      }
    } catch (err) {
      console.error(`Error in ${type} analysis:`, err);
      setError(type === 'credibility'
        ? 'The trust check could not finish just now.'
        : 'The summary could not be written just now.');
    } finally {
      setLoadingStates(prev => ({ ...prev, [type]: false }));
    }
  }, [article]);

  // Without an article (a reload drops router state) there is nothing to show.
  useEffect(() => {
    if (!article) navigate('/home');
  }, [article, navigate]);

  // Record how long the reader spent on the article when they leave it.
  useEffect(() => () => {
    if (startTime) trackActivity('read', Math.round((Date.now() - startTime) / 1000));
  }, [startTime, trackActivity]);

  // Summary and the trust check both start on their own — a reader should
  // never have to ask whether a story can be trusted.
  useEffect(() => {
    if (article) {
      analyze('summary');
      analyze('credibility');
    }
  }, [article, analyze]);

  useEffect(() => {
    if (!article || !localStorage.getItem('token')) return;
    api.post('/article-history/track-view', {
      articleId: article.url,
      title: article.title,
      source: article.source?.name || 'Unknown Source',
      category: article.category || 'general'
    }).catch((err) => console.error('Error tracking article view:', err));
  }, [article]);

  if (!article) return null;

  const published = formatDate(article.publishedAt);
  // Some feed entries carry no description at all, or a stray fragment like a
  // single full stop; the block is skipped unless there is real text.
  const hasDescription = (article.description || '').replace(/[^a-zA-Z0-9]/g, '').length > 3;

  return (
    <div className="page page--narrow article-page">
      <p className="article-back">
        <Link to={`/home?category=${article.category || 'general'}`}><ArrowLeft size={16} aria-hidden="true" /> Back to the news</Link>
      </p>

      {error && <Alert tone="danger" onDismiss={() => setError(null)}>{error}</Alert>}

      <header className="article-header">
        <p className="article-meta">
          <span className="article-source">{article.source?.name || 'Unknown outlet'}</span>
          {/* Articles reopened from the reading history carry no date. */}
          {published && <span> · {published}</span>}
        </p>
        <h1 className="article-title">{article.title}</h1>
        <div className="article-actions">
          <Button as="a" href={article.url} target="_blank" rel="noopener noreferrer" variant="secondary" iconRight={ExternalLink}>
            Read the original
          </Button>
          <Button variant="secondary" icon={Columns2} onClick={() => navigate('/compare', { state: { article } })}>
            Compare coverage
          </Button>
        </div>
      </header>

      {/* The answer, before the article: the one thing the page exists to say. */}
      <section className="article-verdict" aria-labelledby="article-verdict-title">
        <h2 id="article-verdict-title" className="article-section-title">Can you trust this article?</h2>
        {loadingStates.credibility ? (
          <LoadingRegion label="Checking the article" className="article-checking">
            <div className="article-checking__head">
              <span className="ui-spinner" aria-hidden="true" />
              <span>{completedChecks.length ? `Checked ${completedChecks.length} of ${CHECKS}…` : 'Starting the checks…'}</span>
            </div>
            <div className="pipeline-progress" aria-hidden="true">
              <span style={{ width: `${(completedChecks.length / CHECKS) * 100}%` }} />
            </div>
            {completedChecks.length > 0 && (
              <ul className="article-checking__done">
                {completedChecks.map(check => (
                  <li key={check.id}><CircleCheck size={16} aria-hidden="true" /> {check.name}</li>
                ))}
              </ul>
            )}
            <p className="article-checking__note">Six independent checks are combined into one explainable report.</p>
          </LoadingRegion>
        ) : credibility ? (
          <TrustReport report={credibility} />
        ) : (
          <Alert
            tone="warning"
            title="We could not check this article just now"
            action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => analyze('credibility')}>Try again</Button>}
          />
        )}
      </section>

      {/* A publisher's photo that will not load is left out rather than shown broken. */}
      {article.urlToImage && !imageFailed && (
        <img className="article-image" src={article.urlToImage} alt="" onError={() => setImageFailed(true)} />
      )}

      {hasDescription && <p className="article-standfirst">{article.description}</p>}

      <section className="article-summary" aria-labelledby="article-summary-title">
        <h2 id="article-summary-title" className="article-section-title">Summary</h2>
        {loadingStates.summary ? (
          <LoadingRegion label="Writing the summary"><SkeletonText lines={4} /></LoadingRegion>
        ) : (
          <>
            {summary && <p className="article-summary__text">{summary}</p>}
            {summarySourceText?.coverage === 'publisher-excerpt' && (
              <p className="article-note">Based on the publisher’s short excerpt. Open the original article for fuller context.</p>
            )}
            {!detailedSummary && (
              <Button variant="ghost" size="sm" onClick={() => analyze('detailedSummary')} loading={loadingStates.detailedSummary}>
                {loadingStates.detailedSummary ? 'Writing a longer summary…' : 'Read a longer summary'}
              </Button>
            )}
            {loadingStates.detailedSummary && <Skeleton height="60px" />}
            {detailedSummary && (
              <div className="article-detailed">
                <h3>Longer summary</h3>
                <p>{detailedSummary}</p>
                {detailedSourceText?.coverage === 'publisher-excerpt' && (
                  <p className="article-note">This story was supplied as a short publisher excerpt, so there is no additional verified detail to expand.</p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default ArticlePage;
