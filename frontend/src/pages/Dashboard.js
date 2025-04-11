import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/Dashboard.css';

const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get('http://localhost:5000/api/auth/verify', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUserProfile(response.data);
      } catch (err) {
        console.error('Error fetching user profile:', err);
      }
    };

    const fetchArticleHistory = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get('http://localhost:5000/api/article-history/history', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setArticleHistory(response.data.data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching article history:', err);
        setError('Failed to fetch article history');
        setLoading(false);
      }
    };

    fetchUserProfile();
    fetchArticleHistory();
  }, []);

  const handleArticleClick = (article) => {
    // Create a minimal article object with the required data
    const articleData = {
      url: article.articleId,
      title: article.title,
      source: { name: article.source },
      category: article.category,
      publishedAt: article.lastViewed,
      // Add any other required fields with default values
      description: '',
      content: '',
      urlToImage: ''
    };
    
    // Navigate to the article page with the article data
    navigate('/article', { 
      state: { 
        article: articleData,
        startTime: Date.now()
      } 
    });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Your Dashboard</h1>
        {userProfile && (
          <div className="user-profile">
            <div className="profile-avatar">
              <span>{userProfile.email ? userProfile.email.charAt(0).toUpperCase() : 'U'}</span>
            </div>
            <div className="profile-info">
              <h2>{userProfile.email}</h2>
              <p>Member since {new Date().getFullYear()}</p>
              {userProfile.interests && userProfile.interests.length > 0 && (
                <div className="user-interests">
                  <h3>Your Interests:</h3>
                  <div className="interest-tags">
                    {userProfile.interests.map((interest, index) => (
                      <span key={index} className="interest-tag">{interest}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      <div className="dashboard-section">
        <h2>Reading History</h2>
        <div className="history-grid">
          {articleHistory.map((article) => (
            <div
              key={article._id}
              className="history-card"
              onClick={() => handleArticleClick(article)}
            >
              <div className="card-header">
                <h3>{article.title}</h3>
                <span className="source">{article.source}</span>
              </div>
              <div className="card-content">
                <p className="category">{article.category}</p>
                <p className="view-count">Views: {article.viewCount}</p>
                <p className="last-viewed">Last viewed: {formatDate(article.lastViewed)}</p>
                {article.quizAttempted && (
                  <div className="quiz-info">
                    <span className="quiz-badge">Quiz Completed</span>
                    {article.quizScore !== null && (
                      <span className="quiz-score">Score: {article.quizScore}%</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {articleHistory.length === 0 && (
          <div className="no-history">
            <p>No reading history yet. Start exploring articles!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard; 