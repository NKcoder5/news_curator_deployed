import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import TrustReport from '../components/TrustReport';
import '../styles/ArticlePage.css';

const BASE_URL = process.env.REACT_APP_API_URL ||
  (window.location.hostname.includes('onrender.com')
    ? 'https://news-curator-deployed.onrender.com'
    : 'http://localhost:5000');


/**
 * Run a streamed trust analysis, reporting each check as the server finishes it.
 *
 * The endpoint answers with newline-delimited JSON rather than Server-Sent
 * Events, because the article body must be POSTed and EventSource is GET-only.
 * If streaming is unavailable for any reason the caller falls back to the plain
 * endpoint, so an older browser or a proxy that buffers still works.
 *
 * @param {Object} body     - the analysis request
 * @param {Object} headers  - auth headers
 * @param {Function} onStep - called with {id, name, ms} per completed check
 * @returns {Promise<Object>} the finished report
 */
const streamTrustAnalysis = async (body, headers, onStep) => {
  const response = await fetch(`${BASE_URL}/api/ai/trust-analysis/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    // No stream available — fall back to the ordinary endpoint.
    const plain = await axios.post(`${BASE_URL}/api/ai/trust-analysis`, body, { headers });
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

const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const article = location.state?.article;
  const startTime = location.state?.startTime || Date.now();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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
  const [notice, setNotice] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  // Which article the page is currently showing. Replies for anything else are
  // discarded — see the guard in analyze().
  const latestRequest = useRef(article?.url);
  useEffect(() => {
    latestRequest.current = article?.url;
    setImageFailed(false);
  }, [article]);

  // Define trackActivity function using useCallback to avoid recreation on each render
  const trackActivity = useCallback(async (activityType, duration = 0) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.post(`${BASE_URL}/api/tracking/activity`, {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source: article.source?.name || 'Unknown Source',
        activityType,
        duration,
        completed: activityType === 'read'
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      // Silently handle errors
    }
  }, [article]);

  // Define analyze function using useCallback
  const analyze = useCallback(async (type) => {
    if (!article) return;

    const content = article.content || article.description || article.title;
    setLoadingStates(prev => ({ ...prev, [type]: true }));
    setError(null);

    try {
      let endpoint, body;

      switch (type) {
        case 'summary':
          endpoint = '/api/ai/summarize';
          // The URL lets the server reuse this article's existing summary, so
          // the same article always reads the same way.
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'detailedSummary':
          endpoint = '/api/ai/detailed-summary';
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'credibility':
          endpoint = '/api/ai/trust-analysis';
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

      // Get the token from localStorage
      const token = localStorage.getItem('token');

      // Add authorization header if token exists
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      // The trust analysis is streamed so each check can be shown as it lands.
      // Everything else is a single request/response.
      if (type === 'credibility') {
        setCompletedChecks([]);
        const finished = await streamTrustAnalysis(body, headers, (step) => {
          if (latestRequest.current !== article.url) return;
          setCompletedChecks(prev =>
            prev.some(c => c.id === step.id) ? prev : [...prev, step]);
        });
        if (latestRequest.current !== article.url) return;
        setCredibility(finished);
        return;
      }

      const response = await axios.post(`${BASE_URL}${endpoint}`, body, { headers });

      // These calls take seconds. If the reader has moved to another article in
      // the meantime, a late reply belongs to the previous one — dropping it
      // stops one article's summary appearing under another's headline.
      if (latestRequest.current !== article.url) return;

      switch (type) {
        case 'summary':
          setSummary(response.data.summary);
          setSummarySourceText(response.data.sourceText || null);
          break;
        case 'detailedSummary':
          setDetailedSummary(response.data.summary);
          setDetailedSourceText(response.data.sourceText || null);
          break;
        case 'credibility':
          setCredibility(response.data);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error(`Error in ${type} analysis:`, err);
      setError(`Failed to analyze ${type}. Please try again.`);
    } finally {
      setLoadingStates(prev => ({ ...prev, [type]: false }));
    }
  }, [article]);

  // Redirect if no article data
  useEffect(() => {
    if (!article) {
      navigate('/home');
    }
  }, [article, navigate]);

  // Handle tracking when component unmounts
  useEffect(() => {
    return () => {
      // Calculate duration and track activity if user was logged in
      if (startTime) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        trackActivity('read', duration);
      }
    };
  }, [startTime, trackActivity]);

  // Summary and the trust check both start on their own — a reader should
  // never have to ask the paper whether a story can be trusted.
  useEffect(() => {
    if (article) {
      analyze('summary');
      analyze('credibility');
    }
  }, [article, analyze]);

  useEffect(() => {
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  useEffect(() => {
    const trackArticleView = async () => {
      if (isAuthenticated && article) {
        try {
          const token = localStorage.getItem('token');
          await axios.post(
            `${BASE_URL}/api/article-history/track-view`,
            {
              articleId: article.url,
              title: article.title,
              source: article.source?.name || 'Unknown Source',
              category: article.category || 'general'
            },
            {
              headers: { Authorization: `Bearer ${token}` }
            }
          );
        } catch (error) {
          console.error('Error tracking article view:', error);
        }
      }
    };

    if (article) {
      trackArticleView();
    }
  }, [article, isAuthenticated]);

  const handleDetailedSummary = () => {
    analyze('detailedSummary');
  };

  if (!article) {
    return (
      <div className="article-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Loading article...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="article-page">
      {/* Anything that fails is said out loud rather than swallowed. */}
      {error && (
        <div className="page-notice" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      {notice && (
        <div className="page-notice page-notice-good" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
        </div>
      )}

      <div className="article-header">
        <h1 className="article-title">{article.title}</h1>
        <div className="article-meta">
          <span className="article-source">{article.source?.name || 'Unknown Source'}</span>
          {/* Articles reopened from the reading history carry no date, and
              printing one anyway showed "Invalid Date" under the headline. */}
          {article.publishedAt && !Number.isNaN(new Date(article.publishedAt).getTime()) && (
            <span className="article-date">
              {new Date(article.publishedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
          )}
        </div>

      {/* The answer, before the article.
          This sat at the bottom of the right-hand column: the reader scrolled
          past the headline, the photograph, the standfirst and two buttons to
          reach the one thing the page exists to tell them. It reads first now,
          and the story follows. */}
      <div className="article-verdict">
        <div className="credibility-card">
          <h3 className="credibility-title">Can you trust this article?</h3>
          {loadingStates.credibility ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p className="loading-text">
                {completedChecks.length
                  ? `Checked ${completedChecks.length} of 6…`
                  : 'Starting the checks…'}
              </p>
              <ul className="check-progress">
                {completedChecks.map(check => (
                  <li key={check.id} className="check-done">{check.name}</li>
                ))}
              </ul>
              <p className="loading-subtext">
                Six independent checks are combined into one explainable report.
              </p>
            </div>
          ) : credibility ? (
            <TrustReport report={credibility} />
          ) : (
            <div className="error-message">
              <p>We couldn&apos;t check this article just now.</p>
              <button
                className="feedback-button"
                onClick={() => analyze('credibility')}
              >
                Try again
              </button>
            </div>
          )}
      </div>
        {/* A publisher's photo that will not load is left out. The fallback
            used to be a placeholder service that no longer exists, so a
            failed photo became a broken-image icon above the story. */}
        {article.urlToImage && !imageFailed && (
          <img
            className="article-image"
            src={article.urlToImage}
            alt={article.title}
            onError={() => setImageFailed(true)}
          />
        )}
        {/* Some feed entries carry no description at all, or a stray fragment
            like a single full stop. Rendering that leaves a lone mark floating
            under the photo, so the block is skipped unless there is real text. */}
        {(article.description || '').replace(/[^a-zA-Z0-9]/g, '').length > 3 && (
          <div className="article-content">
            <p>{article.description}</p>
          </div>
        )}
        <div className="article-actions">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="feedback-button"
          >
            Read Original Article
          </a>
          <button
            className="feedback-button"
            onClick={() => navigate('/compare', { state: { article } })}
          >
            Compare Coverage
          </button>
        </div>
      </div>

      <div className="article-bottom-section">
        {/* The summary column. Reader comments used to share it; they have
            been removed, so this is the summary alone. */}
        <div className="article-left-column">
          <div className="summary-section">
            <h2>Summary</h2>
            {loadingStates.summary ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Generating summary...</p>
              </div>
            ) : (
              <>
                <p>{summary}</p>
                {summarySourceText?.coverage === 'publisher-excerpt' && (
                  <p className="summary-source-note">
                    Based on the publisher&apos;s short excerpt. Open the original article for fuller context.
                  </p>
                )}
                <div className="summary-actions">
                  <button
                    className="action-button"
                    onClick={handleDetailedSummary}
                    disabled={loadingStates.detailedSummary}
                  >
                    {loadingStates.detailedSummary ? 'Setting type…' : 'Read a longer summary'}
                  </button>
                </div>
                {detailedSummary && (
                  <div className="detailed-summary">
                    <h3>Detailed Summary</h3>
                    <p>{detailedSummary}</p>
                    {detailedSourceText?.coverage === 'publisher-excerpt' && (
                      <p className="summary-source-note">
                        This story was supplied as a short publisher excerpt, so there is no additional verified detail to expand.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

        </div>

        </div>
      </div>

    </div>
  );
};

export default ArticlePage;
