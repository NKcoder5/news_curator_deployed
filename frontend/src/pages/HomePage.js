import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, RefreshCw } from 'lucide-react';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import { Alert, Button, EmptyState, LoadingRegion, PageHeader, Skeleton } from '../components/ui';
import '../styles/HomePage.css';

const CATEGORIES = [
  ['general', 'Top stories'],
  ['business', 'Business'],
  ['technology', 'Technology'],
  ['entertainment', 'Entertainment'],
  ['sports', 'Sports'],
  ['science', 'Science'],
  ['health', 'Health']
];

const validCategory = (value) => CATEGORIES.some(([key]) => key === value) ? value : 'general';

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedCategory = validCategory(new URLSearchParams(location.search).get('category'));
  const [articles, setArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [personalizedMessage, setPersonalizedMessage] = useState('');
  const [trustBadges, setTrustBadges] = useState({});
  const [badgeError, setBadgeError] = useState(false);

  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      let response;
      if (token && selectedCategory === 'general') {
        try {
          response = await api.get('/news/personalized');
          if (!response.data.articles?.length) response = await api.get(`/news?category=${selectedCategory}`);
        } catch (_) {
          response = await api.get(`/news?category=${selectedCategory}`);
        }
      } else {
        response = await api.get(`/news?category=${selectedCategory}`);
      }
      setArticles(response.data.articles || []);
      setPersonalizedMessage(response.data.message || '');
    } catch (err) {
      setArticles([]);
      setPersonalizedMessage('');
      setError(err.response?.data?.error || 'The news desk could not load this section.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  useEffect(() => {
    if (!articles.length) {
      setTrustBadges({});
      return undefined;
    }
    let cancelled = false;
    setBadgeError(false);
    api.post('/ai/trust-badges', { articles: articles.map(article => ({ url: article.url, source: article.source })) })
      .then(response => {
        if (cancelled) return;
        const badges = {};
        (response.data.badges || []).forEach(badge => { if (badge.url) badges[badge.url] = badge; });
        setTrustBadges(badges);
      })
      .catch(() => {
        if (!cancelled) setBadgeError(true);
      });
    return () => { cancelled = true; };
  }, [articles]);

  const categoryLabel = useMemo(
    () => CATEGORIES.find(([key]) => key === selectedCategory)?.[1] || 'Top stories',
    [selectedCategory]
  );

  const chooseCategory = async (category) => {
    if (category === selectedCategory) return;
    try {
      if (localStorage.getItem('token')) {
        await api.post('/tracking/activity', {
          articleId: `category_${category}`,
          title: `${category} News`,
          category,
          source: 'Category Selection',
          activityType: 'category',
          duration: 0,
          completed: true
        });
      }
    } catch (_) {
      // Category navigation should not be blocked by optional tracking.
    }
    navigate(`/home?category=${category}`);
  };

  return (
    <div className="newspaper-container page">
      <header className="newspaper-masthead">
        <p className="newspaper-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <h1 className="newspaper-name">The Daily Chronicle</h1>
        <p className="newspaper-tagline">Independent news, clearly checked.</p>
        <div className="newspaper-masthead-actions">
          <PageHeader
            eyebrow="The daily desk"
            title={categoryLabel}
            description="A curated news feed with a clear path to checking what each story claims."
            actions={<Button variant="secondary" icon={RefreshCw} onClick={fetchNews}>Refresh</Button>}
          />
        </div>
      </header>

      <nav className="news-sections newspaper-categories" aria-label="News sections">
        {CATEGORIES.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`news-section ${selectedCategory === key ? 'is-active' : ''}`}
            aria-current={selectedCategory === key ? 'page' : undefined}
            onClick={() => chooseCategory(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {personalizedMessage && (
        <Alert tone="info" title="Picked for you" className="news-personal editor-note">
          <span className="news-personal__text"><BookOpen size={16} aria-hidden="true" />{personalizedMessage}</span>
        </Alert>
      )}

      {badgeError && (
        <Alert tone="warning" title="Trust stamps are unavailable">
          The stories are still available. Open one to run the full analysis.
        </Alert>
      )}

      {error && (
        <Alert
          tone="danger"
          title="News could not be loaded"
          action={<Button variant="secondary" onClick={fetchNews}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      {isLoading && (
        <LoadingRegion label="Loading news stories">
          <div className="news-grid">
            {[1, 2, 3, 4, 5, 6].map(item => (
              <div className="news-card news-card--skeleton" key={item}>
                <Skeleton height="160px" />
                <div className="news-card__body">
                  <Skeleton width="35%" height="12px" />
                  <Skeleton height="22px" />
                  <Skeleton height="22px" />
                  <Skeleton width="75%" height="16px" />
                </div>
              </div>
            ))}
          </div>
        </LoadingRegion>
      )}

      {!isLoading && !error && articles.length === 0 && (
        <EmptyState title="No stories in this section" description="Try another section or refresh the desk." action={<Button onClick={fetchNews}>Refresh stories</Button>} />
      )}

      {!isLoading && !error && articles.length > 0 && (
        <section aria-labelledby="news-results-title">
          <h2 id="news-results-title" className="sr-only">{categoryLabel} stories</h2>
          <div className="news-grid">
            {articles.map((article, index) => (
              <NewsCard key={article.url || `${article.title}-${index}`} article={article} trustBadge={trustBadges[article.url]} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default HomePage;
