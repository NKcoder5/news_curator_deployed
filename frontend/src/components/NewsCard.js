import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/NewsCard.css';

/**
 * Trust stamp — the at-a-glance verdict on each clipping.
 *  - "analyzed"    this article already has a full report (served from cache)
 *  - "source-only" we only know the publisher's record so far
 * Styled like an editor's rubber stamp rather than a web badge.
 */
const TrustStamp = ({ badge }) => {
  if (!badge) return <span className="trust-stamp trust-stamp-pending" aria-hidden="true" />;

  const level = (score) => {
    if (score >= 7.5) return 'high';
    if (score >= 5.5) return 'good';
    if (score >= 4) return 'caution';
    return 'low';
  };

  // An article that has been checked is stamped by its VERDICT, not by a score
  // band. "Not confirmed" and "Probably false" are different answers and must
  // not share a colour just because their numbers were close.
  const verdictLevel = {
    corroborated: 'high',
    'likely-true': 'good',
    opinion: 'neutral',
    unverified: 'caution',
    satire: 'neutral',
    'likely-false': 'low',
    false: 'low'
  };

  if (badge.kind === 'analyzed') {
    return (
      <span
        className={`trust-stamp stamp-${verdictLevel[badge.level] || level(badge.score)}`}
        title={`We checked this article: ${badge.verdict}`}
      >
        {badge.verdict}
        {badge.concernCount > 0 && (
          <em className="stamp-note">{badge.concernCount} to check</em>
        )}
      </span>
    );
  }

  return (
    <span
      className={`trust-stamp ${badge.sourceMatched ? `stamp-${level(badge.score)}` : 'stamp-unknown'}`}
      title={
        badge.sourceMatched
          ? `${badge.sourceName} is rated ${badge.score}/10 for accuracy. Open the article for the full check.`
          : 'We have no reliability record for this outlet. Open the article for the full check.'
      }
    >
      {badge.label}
    </span>
  );
};

const NewsCard = ({ article, trustBadge }) => {
  const navigate = useNavigate();
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
    const date = new Date(dateString);
    if (!dateString || Number.isNaN(date.getTime())) return '';
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
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
            
            <TrustStamp badge={trustBadge} />

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