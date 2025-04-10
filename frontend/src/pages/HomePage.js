// src/pages/HomePage.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import NewsCard from '../components/NewsCard';
import '../styles/HomePage.css';

const categories = ['general', 'technology', 'business', 'sports', 'science', 'entertainment'];

const HomePage = () => {
  const [articles, setArticles] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('general');

  useEffect(() => {
    axios.get(`http://localhost:5000/api/news?category=${selectedCategory}`)
      .then(res => setArticles(res.data.articles || []))
      .catch(err => console.error('News fetch error:', err));
  }, [selectedCategory]);

  return (
    <div className="homepage">
      <h2>Top News ({selectedCategory})</h2>

      <select onChange={(e) => setSelectedCategory(e.target.value)} value={selectedCategory} className="dropdown">
        {categories.map((cat, idx) => (
          <option key={idx} value={cat}>
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </option>
        ))}
      </select>

      <div className="news-grid">
        {articles.map((article, idx) => (
          <NewsCard key={idx} article={article} />
        ))}
      </div>
    </div>
  );
};

export default HomePage;
