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

  // Format date to look like newspaper date format (added from friend's code)
  const formatDate = (dateString) => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  return (
    <div className="news-card-container">
      <div className="news-card" onClick={handleClick}>
        <div className="news-card-inner">
          <div className="news-heading">
            <h3 className="news-title">{article.title}</h3>
            <div className="news-divider"></div>
          </div>
          
          <div className="news-body">
            {!imageError && article.urlToImage ? (
              <div className="news-image-wrapper">
                <img 
                  src={article.urlToImage} 
                  alt={article.title}
                  onError={handleImageError}
                />
                <div className="image-caption">Image: {article.source?.name}</div>
              </div>
            ) : (
              <div className="news-no-image">
                <span className="news-no-image-text">No Photograph Available</span>
              </div>
            )}
            
            <p className="news-description">{article.description}</p>
            
            <div className="news-meta">
              <span className="news-source">
                {article.source?.name || 'Unknown Press'}
              </span>
              <span className="news-date">
                {formatDate(article.publishedAt)}
              </span>
            </div>
          </div>
          
          <div className="news-card-torn-effect"></div>
        </div>
      </div>
    </div>
  );
};

export default NewsCard;