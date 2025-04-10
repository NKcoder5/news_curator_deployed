import React, { useEffect, useState } from 'react';
import axios from 'axios';
import NewsCard from '../components/NewsCard';
import '../styles/HomePage.css';

const categories = [
  { value: 'general', label: '🌐 General' },
  { value: 'technology', label: '💻 Technology' },
  { value: 'business', label: '💼 Business' },
  { value: 'sports', label: '⚽ Sports' },
  { value: 'science', label: '🔬 Science' },
  { value: 'health', label: '🏥 Health' },
  { value: 'entertainment', label: '🎬 Entertainment' }
];

const HomePage = () => {
  const [articles, setArticles] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        setIsLoading(true);
        const res = await axios.get(`http://localhost:5000/api/news?category=${selectedCategory}`);
        setArticles(res.data.articles || []);
        setError(null);
      } catch (err) {
        setError('Failed to load news. Please try again later.');
        console.error('News fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNews();
  }, [selectedCategory]);

  return (
    <div className="homepage-container">
      <div className="page-header">
        <div className="header-content">
          <h1>Your News Dashboard</h1>
          <p>Stay updated with the latest {selectedCategory} news</p>
        </div>
        
        <div className="category-selector">
          <label htmlFor="news-category">Filter by:</label>
          <select
            id="news-category"
            onChange={(e) => setSelectedCategory(e.target.value)}
            value={selectedCategory}
            className="category-dropdown"
          >
            {categories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading news...</p>
        </div>
      ) : error ? (
        <div className="error-state">
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="retry-button">
            Retry
          </button>
        </div>
      ) : (
        <>
          {articles.length > 0 ? (
            <div className="news-grid">
              {articles.map((article, idx) => (
                <NewsCard key={`${article.url}-${idx}`} article={article} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No articles found in this category</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HomePage;