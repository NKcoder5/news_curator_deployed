import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Dashboard.css';
import api from '../services/api';

const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showArticleHistory, setShowArticleHistory] = useState(false);
  const [showQuizHistory, setShowQuizHistory] = useState(false);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const navigate = useNavigate();

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
        fetchFeedbackHistory()
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
        name: article.source
      },
      category: article.category
    };

    navigate('/article', { 
      state: { 
        article: articleData,
        startTime: Date.now()
      } 
    });
  };

  const getArticleStats = () => {
    const totalArticles = articleHistory.length;
    const totalViews = articleHistory.reduce((sum, article) => sum + article.viewCount, 0);
    const categories = [...new Set(articleHistory.map(article => article.category))];
    return { totalArticles, totalViews, categories: categories.length };
  };

  const getQuizStats = () => {
    const totalQuizzes = quizHistory.length;
    const averageScore = quizHistory.length > 0 
      ? Math.round(quizHistory.reduce((sum, quiz) => sum + (quiz.score / quiz.totalQuestions * 100), 0) / quizHistory.length)
      : 0;
    return { totalQuizzes, averageScore };
  };

  const getFeedbackStats = () => {
    const totalFeedback = feedbackHistory.length;
    const averageRating = feedbackHistory.length > 0
      ? Math.round(feedbackHistory.reduce((sum, item) => sum + item.rating, 0) / feedbackHistory.length * 10) / 10
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
      <div className="dashboard-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={fetchAllData}>Try Again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
      </div>
      
      <div className="dashboard-content">
        {/* Left Sidebar - User Profile */}
        <div className="dashboard-sidebar">
          <div className="user-profile">
            <div className="profile-avatar">
              {userProfile?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="profile-info">
              <h2>User</h2>
              <p>{userProfile?.email}</p>
            </div>
            <div className="user-interests">
              <h3>Interests</h3>
              <div className="interest-tags">
                {userProfile?.interests?.length > 0 ? (
                  userProfile.interests.map((interest, index) => (
                    <span key={index} className="interest-tag">{interest}</span>
                  ))
                ) : (
                  <span className="interest-tag">No interests set</span>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Main Content Area - History Cards */}
        <div className="dashboard-main">
          {/* Reading History Summary Card */}
          <div className="dashboard-card">
            <div 
              className="summary-header"
              onClick={() => setShowArticleHistory(!showArticleHistory)}
            >
              <h2>Reading History</h2>
              <div className="summary-stats">
                <div className="stat-item">
                  <span className="stat-value">{getArticleStats().totalArticles}</span>
                  <span className="stat-label">Articles Read</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{getArticleStats().totalViews}</span>
                  <span className="stat-label">Total Views</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{getArticleStats().categories}</span>
                  <span className="stat-label">Categories</span>
                </div>
                <button className="expand-button">
                  {showArticleHistory ? '▼' : '▶'}
                </button>
              </div>
            </div>
            
            {showArticleHistory && (
              <div className="history-expanded">
                {articleHistory.length > 0 ? (
                  <div className="history-grid">
                    {articleHistory.map((article) => (
                      <div 
                        key={article._id} 
                        className="history-card"
                        onClick={() => handleArticleClick(article)}
                      >
                        <div className="card-header">
                          <h3>{article.title}</h3>
                          <div className="source">{article.source}</div>
                        </div>
                        <div className="card-content">
                          <div className="category">{article.category}</div>
                          <div className="view-count">Views: {article.viewCount}</div>
                          <div className="last-viewed">Last viewed: {formatDate(article.lastViewed)}</div>
                          {article.quizAttempted && (
                            <div className="quiz-info">
                              <div className="quiz-score">Quiz Score: {article.quizScore}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-history">No reading history available</div>
                )}
              </div>
            )}
          </div>
          
          {/* Quiz History Summary Card */}
          <div className="dashboard-card">
            <div 
              className="summary-header"
              onClick={() => setShowQuizHistory(!showQuizHistory)}
            >
              <h2>Quiz History</h2>
              <div className="summary-stats">
                <div className="stat-item">
                  <span className="stat-value">{getQuizStats().totalQuizzes}</span>
                  <span className="stat-label">Quizzes Taken</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{getQuizStats().averageScore}%</span>
                  <span className="stat-label">Average Score</span>
                </div>
                <button className="expand-button">
                  {showQuizHistory ? '▼' : '▶'}
                </button>
              </div>
            </div>
            
            {showQuizHistory && (
              <div className="history-expanded">
                {quizHistory.length > 0 ? (
                  <div className="history-grid">
                    {quizHistory.map((quiz) => (
                      <div 
                        key={quiz._id} 
                        className="history-card"
                        onClick={() => handleQuizClick(quiz)}
                      >
                        <div className="card-header">
                          <h3>Prompt Quiz</h3>
                          <div className="quiz-date">{formatDate(quiz.createdAt)}</div>
                        </div>
                        <div className="card-content">
                          <div className="quiz-info">
                            <div className="quiz-prompt">{quiz.prompt}</div>
                            <div className="quiz-score">Score: {quiz.score}/{quiz.totalQuestions}</div>
                            {quiz.feedback && (
                              <div className="quiz-feedback">{quiz.feedback}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-history">No quiz history available</div>
                )}
              </div>
            )}
          </div>

          {/* Feedback History Summary Card */}
          <div className="dashboard-card">
            <div 
              className="summary-header"
              onClick={() => setShowFeedbackHistory(!showFeedbackHistory)}
            >
              <h2>Feedback History</h2>
              <div className="summary-stats">
                <div className="stat-item">
                  <span className="stat-value">{getFeedbackStats().totalFeedback}</span>
                  <span className="stat-label">Total Feedback</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{getFeedbackStats().averageRating}</span>
                  <span className="stat-label">Avg Rating</span>
                </div>
                <button className="expand-button">
                  {showFeedbackHistory ? '▼' : '▶'}
                </button>
              </div>
            </div>
            
            {showFeedbackHistory && (
              <div className="history-expanded">
                {feedbackHistory.length > 0 ? (
                  <div className="history-grid">
                    {feedbackHistory.map((item) => (
                      <div key={item._id} className="history-card">
                        <div className="card-header">
                          <h3>{item.articleTitle || 'Unknown Article'}</h3>
                          <div className="feedback-date">{formatDate(item.createdAt)}</div>
                        </div>
                        <div className="card-content">
                          <div className="feedback-info">
                            <div className="feedback-rating">Rating: {item.rating}/5</div>
                            <div className="feedback-text">{item.feedback}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-history">No feedback history available</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quiz Modal */}
      {showQuizModal && selectedQuiz && (
        <div className="modal-overlay" onClick={closeQuizModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Quiz Details</h2>
              <button className="close-button" onClick={closeQuizModal}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="quiz-summary">
                <h3>Prompt</h3>
                <p>{selectedQuiz.prompt}</p>
                <div className="quiz-score-summary">
                  <span>Score: {selectedQuiz.score}/{selectedQuiz.totalQuestions}</span>
                  <span>Percentage: {Math.round((selectedQuiz.score / selectedQuiz.totalQuestions) * 100)}%</span>
                </div>
                {selectedQuiz.feedback && (
                  <div className="quiz-feedback-summary">
                    <h3>Feedback</h3>
                    <p>{selectedQuiz.feedback}</p>
                  </div>
                )}
              </div>
              
              <div className="quiz-questions">
                <h3>Questions & Answers</h3>
                {selectedQuiz.questions && selectedQuiz.questions.length > 0 ? (
                  selectedQuiz.questions.map((question, index) => (
                    <div 
                      key={index} 
                      className={`question-card ${question.isCorrect ? 'correct' : 'incorrect'}`}
                    >
                      <div className="question-header">
                        <h4>Question {index + 1}</h4>
                        <span className="question-status">
                          {question.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                        </span>
                      </div>
                      <p className="question-text">{question.question}</p>
                      <div className="options-list">
                        {question.options && question.options.map((option, optionIndex) => (
                          <div 
                            key={optionIndex} 
                            className={`option-item ${
                              optionIndex === question.correctAnswer ? 'correct-answer' : ''
                            } ${
                              optionIndex === question.selectedAnswer && optionIndex !== question.correctAnswer ? 'wrong-answer' : ''
                            } ${
                              optionIndex === question.selectedAnswer ? 'selected' : ''
                            }`}
                          >
                            {option}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No questions available</p>
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