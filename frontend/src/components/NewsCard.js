import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/NewsCard.css';

const NewsCard = ({ article }) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleClick = () => {
    const token = localStorage.getItem('token');
    if (token) {
      // Track click activity
      trackActivity('click');
      
      // Navigate to article page
      navigate('/article', { 
        state: { 
          article,
          startTime: Date.now()
        } 
      });
    } else {
      // If not logged in, just navigate without tracking
      navigate('/article', { 
        state: { article } 
      });
    }
  };

  const trackActivity = async (activityType) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await api.post('/tracking/activity', {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source: article.source?.name || 'Unknown Source',
        activityType,
        duration: 0,
        completed: false
      });
    } catch (error) {
      console.error('Error tracking activity:', error);
    }
  };

  const handleImageError = () => {
    setImageError(true);
  };

  return (
    <div className="news-card" onClick={handleClick}>
      <div className="news-image">
        {!imageError && article.urlToImage ? (
          <img 
            src={article.urlToImage} 
            alt={article.title}
            onError={handleImageError}
          />
        ) : (
          <div className="image-placeholder">
            <span className="placeholder-icon">📰</span>
            <span className="placeholder-text">No Image Available</span>
          </div>
        )}
      </div>
      <div className="news-content">
        <h3>{article.title}</h3>
        <p>{article.description}</p>
        <div className="news-meta">
          <span className="source">{article.source?.name || 'Unknown Source'}</span>
          <span className="date">
            {new Date(article.publishedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default NewsCard;