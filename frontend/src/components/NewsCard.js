// src/components/NewsCard.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/NewsCard.css';

const NewsCard = ({ article }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate('/article', { state: { article } });
  };

  return (
    <div className="news-card">
      <h3>{article.title}</h3>
      <p>{article.description}</p>
      <button onClick={handleClick} className="read-more">Read More</button>
    </div>
  );
};

export default NewsCard;
