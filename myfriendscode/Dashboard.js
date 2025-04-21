import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/Dashboard.css';

const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showArticleHistory, setShowArticleHistory] = useState(false);
  const [showQuizHistory, setShowQuizHistory] = useState(false);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false); // Fixed typo
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const navigate = useNavigate();

  // API calls and functions remain unchanged
  const fetchUserProfile = async () => {
    try {
      const response = await api.get('/users/profile');
      setUserProfile(response.data);
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError('Failed to load user profile');
    }
  };

  const fetchArticleHistory = async () => {
    try {
      const response = await api.get('/article-history/history');
      setArticleHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching article history:', err);
      setError('Failed to load article history');
    }
  };

  const fetchQuizHistory = async () => {
    try {
      const response = await api.get('/prompt-quiz/history');
      setQuizHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching quiz history:', err);
      setError('Failed to load quiz history');
    }
  };

  const fetchFeedbackHistory = async () => {
    try {
      const response = await api.get('/article-feedback/history/all');
      setFeedbackHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching feedback history:', err);
      setError('Failed to load feedback history');
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchUserProfile(),
        fetchArticleHistory(),
        fetchQuizHistory(),
        fetchFeedbackHistory(),
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handleArticleClick = (article) => {
    const articleData = {
      url: article.articleId,
      title: article.title,
      source: {
        name: article.source,
      },
      category: article.category,
    };

    navigate('/article', {
      state: {
        article: articleData,
        startTime: Date.now(),
      },
    });
  };

  const getArticleStats = () => {
    const totalArticles = articleHistory.length;
    const totalViews = articleHistory.reduce((sum, article) => sum + article.viewCount, 0);
    const categories = [...new Set(articleHistory.map((article) => article.category))];
    return { totalArticles, totalViews, categories: categories.length };
  };

  const getQuizStats = () => {
    const totalQuizzes = quizHistory.length;
    const averageScore =
      quizHistory.length > 0
        ? Math.round(
            quizHistory.reduce((sum, quiz) => sum + (quiz.score / quiz.totalQuestions) * 100, 0) /
              quizHistory.length
          )
        : 0;
    return { totalQuizzes, averageScore };
  };

  const getFeedbackStats = () => {
    const totalFeedback = feedbackHistory.length;
    const averageRating =
      feedbackHistory.length > 0
        ? Math.round(
            (feedbackHistory.reduce((sum, item) => sum + item.rating, 0) / feedbackHistory.length) *
              10
          ) / 10
        : 0;
    return { totalFeedback, averageRating };
  };

  const handleQuizClick = (quiz) => {
    setSelectedQuiz(quiz);
    setShowQuizModal(true);
  };

  const closeQuizModal = () => {
    setShowQuizModal(false);
    setSelectedQuiz(null);
  };

  if (loading) {
    return (
      <div className="newspaper-dashboard-container">
        <div className="newspaper-loading-state">
          <div className="newspaper-spinner"></div>
          <p>Fetching your latest news...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="newspaper-dashboard-container">
        <div className="newspaper-error-message">
          <p className="error-headline">{error}</p>
          <button className="newspaper-btn" onClick={fetchAllData}>
            Refresh News
          </button>
        </div>
      </div>
    );
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="newspaper-dashboard-container">
      {/* Newspaper Header */}
      <div className="newspaper-header">
        <div className="newspaper-date">{currentDate}</div>
        <h1 className="newspaper-title">THE READER'S CHRONICLE</h1>
        <div className="newspaper-subtitle">Your Personal Reading Journal</div>
        <div className="newspaper-divider"></div>
      </div>

      {/* Floating and Emoji Elements */}
      <div className="floating-elements">
        <div className="floating-element"></div>
        <div className="floating-element"></div>
        <div className="floating-element"></div>
        <div className="floating-element"></div>
        <div className="floating-element"></div>
        <div className="floating-element"></div>
      </div>
      <div className="emoji-elements">
        <div className="emoji-element">📊</div>
        <div className="emoji-element">📈</div>
        <div className="emoji-element">📉</div>
        <div className="emoji-element">📰</div>
        <div className="emoji-element">📋</div>
        <div className="emoji-element">📱</div>
      </div>

      <div className="newspaper-content">
        {/* User Profile Sidebar */}
        <div className="newspaper-sidebar">
          <div className="newspaper-user-profile">
            <h3 className="sidebar-heading">READER PROFILE</h3>
            <div className="newspaper-avatar">
              {userProfile?.email?.charAt(0).toUpperCase() || 'R'}
            </div>
            <div className="newspaper-profile-info">
              <h4 className="newspaper-name">Distinguished Reader</h4>
              <p className="newspaper-email">{userProfile?.email}</p>
            </div>
            <div className="newspaper-interests">
              <h4 className="newspaper-section-title">Topics of Interest</h4>
              <div className="newspaper-tags">
                {userProfile?.interests?.length > 0 ? (
                  userProfile.interests.map((interest, index) => (
                    <span key={index} className="newspaper-tag">
                      {interest}
                    </span>
                  ))
                ) : (
                  <span className="newspaper-tag-empty">No interests recorded</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="newspaper-main">
          {/* Article History */}
          <div className="newspaper-section">
            <div
              className="newspaper-section-header"
              onClick={() => setShowArticleHistory(!showArticleHistory)}
            >
              <h2 className="newspaper-heading">READING ARCHIVES</h2>
              <div className="newspaper-stats">
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getArticleStats().totalArticles}</span>
                  <span className="newspaper-stat-label">Articles</span>
                </div>
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getArticleStats().totalViews}</span>
                  <span className="newspaper-stat-label">Views</span>
                </div>
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getArticleStats().categories}</span>
                  <span className="newspaper-stat-label">Categories</span>
                </div>
                <button className="newspaper-toggle-btn">
                  {showArticleHistory ? 'COLLAPSE ▼' : 'EXPAND ▶'}
                </button>
              </div>
            </div>

            {showArticleHistory && (
              <div className="newspaper-expanded-content">
                {articleHistory.length > 0 ? (
                  <div className="newspaper-grid">
                    {articleHistory.map((article) => (
                      <div
                        key={article._id}
                        className="newspaper-article-card"
                        onClick={() => handleArticleClick(article)}
                      >
                        <div className="newspaper-card-header">
                          <h3 className="newspaper-article-title">{article.title}</h3>
                          <div className="newspaper-source">{article.source}</div>
                        </div>
                        <div className="newspaper-card-content">
                          <div className="newspaper-category">{article.category}</div>
                          <div className="newspaper-article-details">
                            <span className="newspaper-views">Views: {article.viewCount}</span>
                            <span className="newspaper-date">
                              Last read: {formatDate(article.lastViewed)}
                            </span>
                          </div>
                          {article.quizAttempted && (
                            <div className="newspaper-quiz-note">
                              <div className="newspaper-score">
                                Quiz Score: {article.quizScore}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="newspaper-empty-state">Your reading history will appear here</div>
                )}
              </div>
            )}
          </div>

          {/* Quiz History */}
          <div className="newspaper-section">
            <div
              className="newspaper-section-header"
              onClick={() => setShowQuizHistory(!showQuizHistory)}
            >
              <h2 className="newspaper-heading">QUIZ ARCHIVES</h2>
              <div className="newspaper-stats">
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getQuizStats().totalQuizzes}</span>
                  <span className="newspaper-stat-label">Quizzes</span>
                </div>
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getQuizStats().averageScore}%</span>
                  <span className="newspaper-stat-label">Avg. Score</span>
                </div>
                <button className="newspaper-toggle-btn">
                  {showQuizHistory ? 'COLLAPSE ▼' : 'EXPAND ▶'}
                </button>
              </div>
            </div>

            {showQuizHistory && (
              <div className="newspaper-expanded-content">
                {quizHistory.length > 0 ? (
                  <div className="newspaper-grid">
                    {quizHistory.map((quiz) => (
                      <div
                        key={quiz._id}
                        className="newspaper-quiz-card"
                        onClick={() => handleQuizClick(quiz)}
                      >
                        <div className="newspaper-card-header">
                          <h3 className="newspaper-quiz-title">Knowledge Assessment</h3>
                          <div className="newspaper-quiz-date">{formatDate(quiz.createdAt)}</div>
                        </div>
                        <div className="newspaper-card-content">
                          <div className="newspaper-quiz-prompt">
                            "{quiz.prompt.substring(0, 80)}..."
                          </div>
                          <div className="newspaper-quiz-result">
                            Score: {quiz.score}/{quiz.totalQuestions}
                          </div>
                          {quiz.feedback && (
                            <div className="newspaper-quiz-feedback">
                              "{quiz.feedback.substring(0, 60)}..."
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="newspaper-empty-state">Your quiz results will appear here</div>
                )}
              </div>
            )}
          </div>

          {/* Feedback History */}
          <div className="newspaper-section">
            <div
              className="newspaper-section-header"
              onClick={() => setShowFeedbackHistory(!showFeedbackHistory)}
            >
              <h2 className="newspaper-heading">READER'S OPINIONS</h2>
              <div className="newspaper-stats">
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getFeedbackStats().totalFeedback}</span>
                  <span className="newspaper-stat-label">Feedbacks</span>
                </div>
                <div className="newspaper-stat">
                  <span className="newspaper-stat-value">{getFeedbackStats().averageRating}</span>
                  <span className="newspaper-stat-label">Avg. Rating</span>
                </div>
                <button className="newspaper-toggle-btn">
                  {showFeedbackHistory ? 'COLLAPSE ▼' : 'EXPAND ▶'} {/* Fixed toggle variable */}
                </button>
              </div>
            </div>

            {showFeedbackHistory && (
              <div className="newspaper-expanded-content">
                {feedbackHistory.length > 0 ? (
                  <div className="newspaper-grid">
                    {feedbackHistory.map((item) => (
                      <div key={item._id} className="newspaper-feedback-card">
                        <div className="newspaper-card-header">
                          <h3 className="newspaper-feedback-title">
                            {item.articleTitle || 'Article Review'}
                          </h3>
                          <div className="newspaper-feedback-date">
                            {formatDate(item.createdAt)}
                          </div>
                        </div>
                        <div className="newspaper-card-content">
                          <div className="newspaper-rating">
                            <span className="newspaper-stars">
                              {'★'.repeat(item.rating) + '☆'.repeat(5 - item.rating)}
                            </span>
                            <span className="newspaper-rating-value">{item.rating}/5</span>
                          </div>
                          <div className="newspaper-feedback-text">"{item.feedback}"</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="newspaper-empty-state">Your article reviews will appear here</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quiz Details Modal */}
      {showQuizModal && selectedQuiz && (
        <div className="newspaper-modal-overlay" onClick={closeQuizModal}>
          <div className="newspaper-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="newspaper-modal-header">
              <h2 className="newspaper-modal-title">QUIZ DETAILS</h2>
              <button className="newspaper-close-btn" onClick={closeQuizModal}>
                ×
              </button>
            </div>
            <div className="newspaper-modal-body">
              <div className="newspaper-quiz-details">
                <h3 className="newspaper-quiz-prompt-title">Inquiry</h3>
                <p className="newspaper-prompt-text">{selectedQuiz.prompt}</p>
                <div className="newspaper-results-summary">
                  <span className="newspaper-score-detail">
                    Score: {selectedQuiz.score}/{selectedQuiz.totalQuestions}
                  </span>
                  <span className="newspaper-percentage">
                    Success rate:{' '}
                    {Math.round((selectedQuiz.score / selectedQuiz.totalQuestions) * 100)}%
                  </span>
                </div>
                {selectedQuiz.feedback && (
                  <div className="newspaper-feedback-detail">
                    <h3 className="newspaper-feedback-title">Instructor's Notes</h3>
                    <p className="newspaper-feedback-content">{selectedQuiz.feedback}</p>
                  </div>
                )}
              </div>

              <div className="newspaper-questions-section">
                <h3 className="newspaper-questions-title">QUESTIONS & RESPONSES</h3>
                {selectedQuiz.questions && selectedQuiz.questions.length > 0 ? (
                  selectedQuiz.questions.map((question, index) => (
                    <div
                      key={index}
                      className={`newspaper-question-item ${question.isCorrect ? 'correct' : 'incorrect'}`}
                    >
                      <div className="newspaper-question-header">
                        <h4 className="newspaper-question-number">Question {index + 1}</h4>
                        <span className="newspaper-question-result">
                          {question.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                        </span>
                      </div>
                      <p className="newspaper-question-text">{question.question}</p>
                      <div className="newspaper-options">
                        {question.options &&
                          question.options.map((option, optionIndex) => (
                            <div
                              key={optionIndex}
                              className={`newspaper-option ${
                                optionIndex === question.correctAnswer ? 'correct-answer' : ''
                              } ${
                                optionIndex === question.selectedAnswer &&
                                optionIndex !== question.correctAnswer
                                  ? 'wrong-answer'
                                  : ''
                              } ${optionIndex === question.selectedAnswer ? 'selected' : ''}`}
                            >
                              {option}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="newspaper-no-questions">No questions available</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;