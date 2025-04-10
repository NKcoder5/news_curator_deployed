import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/NewsCard.css';

const NewsCard = ({ article }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/article/${encodeURIComponent(article.title)}`, { 
      state: { article } 
    });
  };

  return (
    <div className="news-card">
      {article.urlToImage && (
        <div className="card-image">
          <img src={article.urlToImage} alt={article.title} />
        </div>
      )}
      <div className="card-content">
        <div className="card-meta">
          <span className="source">{article.source?.name || 'Unknown'}</span>
          <span className="date">{new Date(article.publishedAt).toLocaleDateString()}</span>
        </div>
        <h3>{article.title}</h3>
        <p className="description">{article.description}</p>
        <button onClick={handleClick} className="read-more">
          Read Analysis <span>→</span>
        </button>
      </div>
    </div>
  );
};

export default NewsCard;