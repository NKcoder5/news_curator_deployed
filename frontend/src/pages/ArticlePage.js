import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import FeedbackModal from '../components/FeedbackModal';
import '../styles/ArticlePage.css';

const ArticlePage = () => {
  const location = useLocation();
  const article = location.state?.article;

  const [summary, setSummary] = useState('');
  const [feedback, setFeedback] = useState('');
  const [credibility, setCredibility] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    summary: false,
    feedback: false,
    credibility: false,
  });
  const [showModal, setShowModal] = useState(false);

  const analyze = async (type) => {
    if (!article) return;

    const content = article.content || article.description || article.title;

    setLoadingStates(prev => ({ ...prev, [type]: true }));

    try {
      let endpoint, body;

      switch (type) {
        case 'summary':
          endpoint = '/api/ai/summarize';
          body = { article: content };
          break;
        case 'feedback':
          endpoint = '/api/ai/feedback';
          body = { article: content, userFeedback: 'None' };
          break;
        case 'credibility':
          endpoint = '/api/ai/credibility';
          body = {
            title: article.title,
            content,
            source: article.source?.name || article.source || 'Unknown',
          };
          break;
        default:
          return;
      }

      const response = await fetch(`http://localhost:5000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      console.log(`${type} API response:`, data);

      switch (type) {
        case 'summary':
          setSummary(data.summary || 'No summary available');
          break;
        case 'feedback':
          setFeedback(data.suggestion || 'No feedback available');
          break;
        case 'credibility':
          setCredibility({
            score: data.score ?? null,
            reasoning: data.reasoning || 'No reasoning provided by the server.',
          });
          break;
      }
    } catch (err) {
      console.error(`${type} analysis error:`, err);
      switch (type) {
        case 'summary':
          setSummary('Error generating summary');
          break;
        case 'feedback':
          setFeedback('Error generating feedback');
          break;
        case 'credibility':
          setCredibility({ score: null, reasoning: 'Error assessing credibility' });
          break;
      }
    } finally {
      setLoadingStates(prev => ({ ...prev, [type]: false }));
    }
  };

  if (!article) return <div>Error loading article.</div>;

  return (
    <div className="article-page">
      <h2>{article.title}</h2>
      <p>{article.content || article.description}</p>

      <div className="analysis-options">
        <div className="analysis-card">
          <h4>📝 Summary</h4>
          <p>Get a concise summary of the article's key points</p>
          <button
            onClick={() => analyze('summary')}
            disabled={loadingStates.summary}
            className="analysis-button"
          >
            {loadingStates.summary ? 'Summarizing...' : 'Generate Summary'}
          </button>
          {summary && (
            <div className="analysis-result">
              <h5>Summary:</h5>
              <p>{summary}</p>
            </div>
          )}
        </div>

        <div className="analysis-card">
          <h4>🔍 Credibility Score</h4>
          <p>Evaluate the trustworthiness of this article</p>
          <button
            onClick={() => analyze('credibility')}
            disabled={loadingStates.credibility}
            className="analysis-button"
          >
            {loadingStates.credibility ? 'Assessing...' : 'Check Credibility'}
          </button>
          {credibility && (
            <div className="analysis-result">
              <h5>Credibility Score:</h5>
              <p>
                {credibility.score !== null ? `${credibility.score}/10` : 'N/A'}
                {credibility.reasoning ? ` - ${credibility.reasoning}` : ' - No reasoning available'}
              </p>
            </div>
          )}
        </div>

        <div className="analysis-card">
          <h4>💬 Feedback</h4>
          <p>Get AI feedback on the article's content</p>
          <button
            onClick={() => analyze('feedback')}
            disabled={loadingStates.feedback}
            className="analysis-button"
          >
            {loadingStates.feedback ? 'Generating...' : 'Get Feedback'}
          </button>
          {feedback && (
            <div className="analysis-result">
              <h5>Feedback:</h5>
              <p>{feedback.slice(0, 100)}...</p>
              <button
                onClick={() => setShowModal(true)}
                className="read-more-button"
              >
                Read Full Feedback
              </button>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <FeedbackModal feedback={feedback} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
};

export default ArticlePage;