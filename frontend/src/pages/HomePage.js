import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import '../styles/HomePage.css';

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [personalizedMessage, setPersonalizedMessage] = useState('');
  const [currentDate] = useState(new Date());
  const [trustBadges, setTrustBadges] = useState({});

  // The section is read from the address and nowhere else. It used to be kept
  // in state as well, starting at "general" and corrected from the address
  // afterwards, so a link to ?category=technology fetched the general feed
  // first and then technology — two requests against a daily allowance of 100
  // for one page view. With the address as the only source, a visit fetches
  // once, and a refresh stays on the section the reader chose.
  const selectedCategory = new URLSearchParams(location.search).get('category') || 'general';

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
      // The backend explains recoverable causes (a used-up daily quota, a bad
      // key). Show that rather than a generic failure the reader can't act on.
      setError(err.response?.data?.error || 'Failed to load news. Please try again later.');
      console.error('News fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory]);

  // Trust stamps for the visible clippings. Cheap on the server (cache lookup
  // plus the source database), so every card can carry a verdict without the
  // reader clicking anything.
  useEffect(() => {
    if (!articles.length) return;
    let cancelled = false;

    api.post('/ai/trust-badges', {
      articles: articles.map(a => ({ url: a.url, source: a.source }))
    })
      .then(res => {
        if (cancelled) return;
        const map = {};
        (res.data.badges || []).forEach(b => { if (b.url) map[b.url] = b; });
        setTrustBadges(map);
      })
      .catch(err => console.error('Trust badge fetch failed:', err));

    return () => { cancelled = true; };
  }, [articles]);

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

  // One fetch per section. This effect used to depend on an "initial load"
  // flag that the fetch itself cleared, so every visit ran it twice — two news
  // requests per page view — and the second run recorded a category click the
  // reader never made.
  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // Choosing a section is the reader's act, so it is recorded here, once.
  const chooseCategory = (category) => {
    if (category === selectedCategory) return;
    trackCategoryClick(category);
    navigate(`/home?category=${category}`);
  };

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
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    return `${categoryName} Daily`;
  };

  const formatCurrentDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return currentDate.toLocaleDateString(undefined, options);
  };

  return (
    <div className="newspaper-container">
      <div className="newspaper-masthead">
        <div className="newspaper-date">{formatCurrentDate()}</div>
        <h1 className="newspaper-name">The Daily Chronicle</h1>
        <div className="newspaper-tagline">All the News That's Fit to Print</div>
      </div>
      
      <div className="newspaper-categories">
        <div className="category-label">SECTIONS:</div>
        <div className="categories-list">
          <button 
            className={`category-btn ${selectedCategory === 'general' ? 'active' : ''}`}
            onClick={() => chooseCategory('general')}
          >
            General
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'business' ? 'active' : ''}`}
            onClick={() => chooseCategory('business')}
          >
            Business
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'technology' ? 'active' : ''}`}
            onClick={() => chooseCategory('technology')}
          >
            Technology
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'entertainment' ? 'active' : ''}`}
            onClick={() => chooseCategory('entertainment')}
          >
            Entertainment
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'sports' ? 'active' : ''}`}
            onClick={() => chooseCategory('sports')}
          >
            Sports
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'science' ? 'active' : ''}`}
            onClick={() => chooseCategory('science')}
          >
            Science
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'health' ? 'active' : ''}`}
            onClick={() => chooseCategory('health')}
          >
            Health
          </button>
        </div>
      </div>
      
      <div className="section-header">
        <div className="section-divider"></div>
        <h2 className="section-title">
          {getCategoryEmoji(selectedCategory)} {getCategoryTitle(selectedCategory)}
        </h2>
        <div className="section-divider"></div>
      </div>
      
      {personalizedMessage && (
        <div className="editor-note">
          <div className="editor-note-inner">
            <h3 className="editor-title">Editor's Pick</h3>
            <p>{personalizedMessage}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="newspaper-loading">
          <div className="typewriter">
            <div className="typewriter-text">Loading latest headlines...</div>
          </div>
          <div className="loading-text">Please wait while we prepare your newspaper</div>
        </div>
      ) : error ? (
        <div className="newspaper-error">
          <div className="error-headline">BREAKING: NEWS UNAVAILABLE</div>
          <p className="error-subheading">Our press machines are experiencing technical difficulties</p>
          <p>{error}</p>
          <button onClick={handleRetry} className="retry-button">Refresh Paper</button>
        </div>
      ) : articles.length === 0 ? (
        <div className="newspaper-empty">
          <h3 className="empty-headline">SLOW NEWS DAY</h3>
          <p>Our reporters are currently investigating stories for this section.</p>
          <p>Please check back in our evening edition.</p>
        </div>
      ) : (
        <div className="newspaper-grid">
          {articles.map((article, index) => (
            // Feed stories carry no section of their own, so every read was
            // filed under "general", which personalisation ignores. The
            // section the reader is browsing is the best available label.
            <NewsCard
              key={article.url || index}
              article={article.category ? article : { ...article, category: selectedCategory }}
              trustBadge={trustBadges[article.url]}
            />
          ))}
        </div>
      )}
      
      <div className="newspaper-footer">
        <div className="footer-divider"></div>
        <p>© {currentDate.getFullYear()} The Daily Chronicle • All Rights Reserved</p>
        <p>Our reporters strive to deliver accurate, fair, and thorough news reporting</p>
      </div>
    </div>
  );
};

export default HomePage;