import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import FeedbackModal from '../components/FeedbackModal';
import '../styles/ArticlePage.css';

const BASE_URL = 'https://news-curator-deployed.onrender.com';

const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const article = location.state?.article;
  const startTime = location.state?.startTime || Date.now();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [summary, setSummary] = useState('');
  const [detailedSummary, setDetailedSummary] = useState('');
  const [feedback, setFeedback] = useState('');
  const [credibility, setCredibility] = useState(null);
  const [articleFeedbacks, setArticleFeedbacks] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    summary: true,
    detailedSummary: false,
    feedback: false,
    credibility: false,
    articleFeedbacks: true
  });
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);

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
          body = { article: content };
          break;
        case 'detailedSummary':
          endpoint = '/api/ai/detailed-summary';
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

      // Get the token from localStorage
      const token = localStorage.getItem('token');
      
      // Add authorization header if token exists
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const response = await axios.post(`${BASE_URL}${endpoint}`, body, { headers });

      switch (type) {
        case 'summary':
          setSummary(response.data.summary);
          break;
        case 'detailedSummary':
          setDetailedSummary(response.data.summary);
          break;
        case 'feedback':
          setFeedback(response.data.suggestion);
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

  // Automatically start summarization when page loads
  useEffect(() => {
    if (article) {
      analyze('summary');
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

  useEffect(() => {
    const fetchArticleFeedbacks = async () => {
      if (!article) return;
      
      try {
        const response = await axios.get(`${BASE_URL}/api/article-feedback/all/${encodeURIComponent(article.url)}`);
        setArticleFeedbacks(response.data.data || []);
      } catch (error) {
        console.error('Error fetching article feedbacks:', error);
      } finally {
        setLoadingStates(prev => ({ ...prev, articleFeedbacks: false }));
      }
    };

    fetchArticleFeedbacks();
  }, [article]);

  const handleShowFullFeedback = () => {
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleSubmitFeedback = async (userFeedback) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Please login to submit feedback');
        return;
      }

      // Submit feedback to the backend
      await axios.post(
        `${BASE_URL}/api/article-feedback/submit`,
        {
          articleId: article.url,
          feedback: userFeedback.feedback,
          rating: userFeedback.rating
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // Close the modal
      setShowModal(false);

      // Show success message
      alert('Thank you for your feedback!');

    } catch (error) {
      console.error('Error submitting feedback:', error);
      setError('Failed to submit feedback. Please try again.');
    }
  };

  const handleDetailedSummary = () => {
    analyze('detailedSummary');
  };

  const handleQuizClick = () => {
    if (!detailedSummary) {
      alert('Please generate a detailed summary first before taking the quiz.');
      return;
    }
    
    // Navigate to the quiz page with the detailed summary and article title
    navigate('/quiz', { 
      state: { 
        detailedSummary,
        articleTitle: article.title
      } 
    });
  };

  const renderArticleFeedbacks = () => {
    if (loadingStates.articleFeedbacks) {
      return (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading feedbacks...</p>
        </div>
      );
    }

    if (articleFeedbacks.length === 0) {
      return <p className="no-feedbacks">No feedbacks yet. Be the first to share your thoughts!</p>;
    }

    return (
      <div className="article-feedbacks">
        {articleFeedbacks.map((feedback) => (
          <div key={feedback._id} className="feedback-item">
            <div className="feedback-header">
              <span className="feedback-user">{feedback.userId?.email || 'Anonymous User'}</span>
              <span className="feedback-date">
                {new Date(feedback.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="feedback-rating">
              {'★'.repeat(feedback.rating)}{'☆'.repeat(5 - feedback.rating)}
            </div>
            <p className="feedback-text">{feedback.feedback}</p>
          </div>
        ))}
      </div>
    );
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
          <h2>Summary</h2>
          {loadingStates.summary ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Generating summary...</p>
            </div>
          ) : (
            <>
              <p>{summary}</p>
              <div className="summary-actions">
                <button 
                  className="action-button"
                  onClick={handleDetailedSummary}
                  disabled={loadingStates.detailedSummary}
                >
                  {loadingStates.detailedSummary ? 'Generating...' : 'Detailed Summary'}
                </button>
                <button 
                  className="action-button"
                  onClick={handleQuizClick}
                  disabled={!detailedSummary}
                >
                  Wanna validate yourself? Take Quiz
                </button>
              </div>
              {detailedSummary && (
                <div className="detailed-summary">
                  <h3>Detailed Summary</h3>
                  <p>{detailedSummary}</p>
                </div>
              )}
            </>
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

        <div className="article-feedbacks-section">
          <h3 className="feedback-title">User Feedbacks</h3>
          {renderArticleFeedbacks()}
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