import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import FeedbackModal from '../components/FeedbackModal';
import '../styles/ArticlePage.css';

const ArticlePage = () => {
  const location = useLocation();
  const article = location.state?.article;

  const [summary, setSummary] = useState('');
  const [feedback, setFeedback] = useState('');
  const [credibility, setCredibility] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!article) return;

    const content = article.content || article.description || article.title;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const [summaryRes, feedbackRes, credibilityRes] = await Promise.all([
          fetch('http://localhost:5000/api/ai/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article: content })
          }).then(res => res.json()),

          fetch('http://localhost:5000/api/ai/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article: content, userFeedback: "None" })
          }).then(res => res.json()),

          fetch('http://localhost:5000/api/ai/credibility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: article.title,
              content,
              source: article.source
            })
          }).then(res => res.json())
        ]);

        setSummary(summaryRes.summary || 'No summary');
        setFeedback(feedbackRes.suggestion || 'No feedback');
        setCredibility(credibilityRes.result || 'N/A');
      } catch (err) {
        console.error('Agent error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [article]);

  if (!article) return <div>Error loading article.</div>;

  return (
    <div className="article-page">
      <h2>{article.title}</h2>
      <p>{article.content || article.description}</p>

      {loading ? (
        <div className="loading">🧠 AI is analyzing this article...</div>
      ) : (
        <div className="ai-cards">
          <div className="card">
            <h4>📝 Summary</h4>
            <p>{summary}</p>
          </div>
          <div className="card">
            <h4>🔍 Credibility</h4>
            <p>{credibility}</p>
          </div>
          <div className="card">
            <h4>💬 Feedback</h4>
            <p>{feedback.slice(0, 100)}...</p>
            <button onClick={() => setShowModal(true)}>Read Full Feedback</button>
          </div>
        </div>
      )}

      {showModal && (
        <FeedbackModal feedback={feedback} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
};

export default ArticlePage;
