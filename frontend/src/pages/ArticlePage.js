import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import FeedbackModal from '../components/FeedbackModal';
import '../styles/ArticlePage.css';

const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const article = location.state?.article;
  const startTime = location.state?.startTime;

  const [summary, setSummary] = useState('');
  const [feedback, setFeedback] = useState('');
  const [credibility, setCredibility] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    summary: true,
    feedback: false,
    credibility: false,
  });
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);

  // Define trackActivity function using useCallback to avoid recreation on each render
  const trackActivity = useCallback(async (activityType, duration = 0) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.post('http://localhost:5000/api/tracking/activity', {
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
          console.warn('Unknown analysis type:', type);
          return;
      }

      const response = await axios.post(`http://localhost:5000${endpoint}`, body);

      switch (type) {
        case 'summary':
          setSummary(response.data.summary);
          break;
        case 'feedback':
          setFeedback(response.data.suggestion);
          break;
        case 'credibility':
          setCredibility(response.data);
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

  // Automatically start summarization when page loads
  useEffect(() => {
    if (article) {
      analyze('summary');
    }
  }, [article, analyze]);

  const handleShowFullFeedback = () => {
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleSubmitFeedback = async (userFeedback) => {
    if (!article) return;
    
    setLoadingStates(prev => ({ ...prev, feedback: true }));
    
    try {
      const content = article.content || article.description || article.title;
      const response = await axios.post('http://localhost:5000/api/ai/feedback', {
        article: content,
        userFeedback
      });
      
      setFeedback(response.data.suggestion);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError('Failed to submit feedback. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, feedback: false }));
      setShowModal(false);
    }
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
      <div className="article-header">
        <h1 className="article-title">{article.title}</h1>
        <div className="article-meta">
          <span className="article-source">{article.source?.name || 'Unknown Source'}</span>
          <span className="article-date">
            {new Date(article.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </span>
        </div>
        {article.urlToImage && (
          <img 
            className="article-image"
            src={article.urlToImage} 
            alt={article.title}
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'https://via.placeholder.com/800x400?text=No+Image+Available';
            }}
          />
        )}
        <div className="article-content">
          <p>{article.description}</p>
        </div>
        <div className="article-actions">
          <a 
            href={article.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="feedback-button"
          >
            Read Original Article
          </a>
        </div>
      </div>

      <div className="article-bottom-section">
        <div className="summary-section">
          <h3 className="summary-title">AI Summary</h3>
          {loadingStates.summary ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p className="loading-text">Generating summary...</p>
            </div>
          ) : error ? (
            <div className="error-message">
              <p>{error}</p>
              <button 
                className="feedback-button"
                onClick={() => analyze('summary')}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="summary-content">
              <p>{summary}</p>
            </div>
          )}
        </div>

        <div className="right-cards">
          <div className="credibility-card">
            <h3 className="credibility-title">Credibility Analysis</h3>
            {loadingStates.credibility ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p className="loading-text">Analyzing credibility...</p>
              </div>
            ) : error ? (
              <div className="error-message">
                <p>{error}</p>
                <button 
                  className="feedback-button"
                  onClick={() => analyze('credibility')}
                >
                  Retry
                </button>
              </div>
            ) : credibility ? (
              <div className="credibility-content">
                <div className="credibility-score">
                  <div className="score-circle" style={{
                    background: `conic-gradient(#4CAF50 ${credibility.score * 10}%, #f0f0f0 0)`
                  }}>
                    <div className="score-inner">
                      <span>{credibility.score}</span>
                      <span className="score-label">/10</span>
                    </div>
                  </div>
                </div>
                <p className="credibility-reasoning">{credibility.reasoning}</p>
              </div>
            ) : (
              <button 
                className="feedback-button"
                onClick={() => analyze('credibility')}
              >
                Check Credibility
              </button>
            )}
          </div>

          <div className="feedback-card">
            <h3 className="feedback-title">AI Feedback</h3>
            {loadingStates.feedback ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p className="loading-text">Generating feedback...</p>
              </div>
            ) : error ? (
              <div className="error-message">
                <p>{error}</p>
                <button 
                  className="feedback-button"
                  onClick={() => analyze('feedback')}
                >
                  Retry
                </button>
              </div>
            ) : feedback ? (
              <div className="feedback-content">
                <p>{feedback}</p>
                <button 
                  className="feedback-button"
                  onClick={handleShowFullFeedback}
                >
                  Provide Your Feedback
                </button>
              </div>
            ) : (
              <button 
                className="feedback-button"
                onClick={() => analyze('feedback')}
              >
                Get AI Feedback
              </button>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <FeedbackModal 
          onSubmit={handleSubmitFeedback} 
          onClose={handleCloseModal} 
        />
      )}
    </div>
  );
};

export default ArticlePage;