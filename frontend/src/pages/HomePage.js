import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import '../styles/HomePage.css';

const HomePage = () => {
  const location = useLocation();
  const [articles, setArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [personalizedMessage, setPersonalizedMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('general');

  // Get category from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const category = params.get('category') || 'general';
    setSelectedCategory(category);
  }, [location.search]);

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
      setInitialLoad(false);
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

  useEffect(() => {
    fetchNews();
    if (!initialLoad) {
      trackCategoryClick(selectedCategory);
    }
  }, [selectedCategory, fetchNews, initialLoad]);

  const getCategoryEmoji = (category) => {
    const emojiMap = {
      'general': '🌐',
      'technology': '💻',
      'business': '💼',
      'sports': '⚽',
      'science': '🔬',
      'health': '🏥',
      'entertainment': '🎬'
    };
    return emojiMap[category] || '📰';
  };

  const getCategoryTitle = (category) => {
    const titleMap = {
      'general': 'General News',
      'technology': 'Technology News',
      'business': 'Business News',
      'sports': 'Sports News',
      'science': 'Science News',
      'health': 'Health News',
      'entertainment': 'Entertainment News'
    };
    return titleMap[category] || 'News';
  };

  const getCategoryDescription = (category) => {
    const descriptionMap = {
      'general': 'Stay informed with the latest news from around the world, covering a wide range of topics and current events.',
      'technology': 'Discover the latest innovations, tech trends, and digital developments shaping our future.',
      'business': 'Get insights into market trends, company updates, and economic developments that impact global business.',
      'sports': 'Follow your favorite teams, athletes, and sporting events with comprehensive coverage and analysis.',
      'science': 'Explore groundbreaking discoveries, research findings, and scientific advancements across various fields.',
      'health': 'Stay updated on medical breakthroughs, wellness tips, and health-related news to maintain a healthy lifestyle.',
      'entertainment': 'Keep up with the latest in movies, music, TV shows, and celebrity news from the entertainment industry.'
    };
    return descriptionMap[category] || 'Stay informed with the latest news and updates.';
  };

  return (
    <div className="home-container">
      <div className="category-info-card">
        <div className="category-header">
          <span className="category-emoji">{getCategoryEmoji(selectedCategory)}</span>
          <h1 className="category-title">{getCategoryTitle(selectedCategory)}</h1>
        </div>
        <p className="category-description">{getCategoryDescription(selectedCategory)}</p>
        {personalizedMessage && (
          <div className="personalized-message">
            <p>{personalizedMessage}</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading news...</p>
        </div>
      ) : error ? (
        <div className="error-container">
          <p>{error}</p>
          <button onClick={handleRetry} className="retry-button">Retry</button>
        </div>
      ) : articles.length === 0 ? (
        <div className="no-articles">
          <p>No articles found for this category.</p>
        </div>
      ) : (
        <div className="news-grid">
          {articles.map((article, index) => (
            <NewsCard key={index} article={article} />
          ))}
        </div>
      )}
    </div>
  );
};

export default HomePage;