import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
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
  const [initialLoad, setInitialLoad] = useState(true);
  const [personalizedMessage, setPersonalizedMessage] = useState('');

  const fetchNews = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Check if user is logged in
      const token = localStorage.getItem('token');
      
      // If user is logged in and on general category, fetch personalized news
      if (token && selectedCategory === 'general') {
        try {
          const response = await api.get('/news/personalized');
          
          if (response.data.articles && response.data.articles.length > 0) {
            setArticles(response.data.articles);
            setPersonalizedMessage(response.data.message);
          } else {
            // Fallback to regular news if no personalized articles
            const res = await api.get(`/news?category=${selectedCategory}`);
            setArticles(res.data.articles || []);
            setPersonalizedMessage('');
          }
        } catch (personalizedError) {
          // If personalized news fails, fallback to regular news
          const res = await api.get(`/news?category=${selectedCategory}`);
          setArticles(res.data.articles || []);
          setPersonalizedMessage('');
        }
      } else {
        // Regular news fetch for non-logged in users or specific categories
        const res = await api.get(`/news?category=${selectedCategory}`);
        setArticles(res.data.articles || []);
        setPersonalizedMessage('');
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to load news. Please try again later.');
      console.error('News fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory]);

  const handleRetry = () => {
    window.location.reload();
  };

  const trackCategoryClick = async (category) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await api.post('/tracking/activity', {
        articleId: `category_${category}`,
        title: `${category} News`,
        category: category,
        source: 'Category Selection',
        activityType: 'category',
        duration: 0,
        completed: true
      });
    } catch (error) {
      console.error('Error tracking category click:', error);
    }
  };

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    if (!initialLoad) {
      trackCategoryClick(category);
    }
  };

  useEffect(() => {
    fetchNews();
  }, [selectedCategory, fetchNews]);

  useEffect(() => {
    setInitialLoad(false);
  }, []);

  return (
    <div className="homepage-container">
      <div className="page-header">
        <div className="header-content">
          <h1>Your News Dashboard</h1>
          <p>Stay updated with the latest {selectedCategory} news</p>
          {personalizedMessage && (
            <div className="personalized-message">
              <p>{personalizedMessage}</p>
            </div>
          )}
        </div>
        
        <div className="category-selector">
          <label htmlFor="news-category">Filter by:</label>
          <select
            id="news-category"
            onChange={(e) => handleCategoryChange(e.target.value)}
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
          <button onClick={handleRetry} className="retry-button">
            Retry
          </button>
        </div>
      ) : (
        <>
          {articles.length > 0 ? (
            <div className="news-grid">
              {articles.map((article, idx) => (
                <div 
                  key={`${article.url}-${idx}`}
                  className="news-card-container"
                  data-article-id={article.url}
                >
                  <NewsCard article={article} />
                </div>
              ))}
            </div>
          ) : (
            <div className="no-results">
              <p>No articles found for this category.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HomePage;