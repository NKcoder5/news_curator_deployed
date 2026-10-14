import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Newspaper, RefreshCw, Sparkles } from 'lucide-react';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import { Alert, Button, EmptyState, LoadingRegion, PageHeader, Skeleton, SkeletonText } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/HomePage.css';

const SECTIONS = ['general', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'];
const sectionName = (category) => category.charAt(0).toUpperCase() + category.slice(1);

/** Six cards in the shape of the feed, while it loads. */
const FeedSkeleton = () => (
  <LoadingRegion label="Loading the latest stories" className="news-grid">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="news-card news-card--skeleton">
        <Skeleton height="auto" radius="0" style={{ aspectRatio: '16 / 9' }} />
        <div className="news-card__body">
          <Skeleton width="40%" height="10px" />
          <SkeletonText lines={2} />
          <SkeletonText lines={3} />
        </div>
      </div>
    ))}
  </LoadingRegion>
);

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  useDocumentTitle('News');
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

  // Fetch the section again, rather than reloading the whole application.
  const handleRetry = () => {
    fetchNews();
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

  const today = currentDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="page news-page">
      <PageHeader
        eyebrow={today}
        title={selectedCategory === 'general' ? 'Today’s news' : `${sectionName(selectedCategory)} news`}
        description="Today’s stories, each marked with what the checks already know about it. Open one for the full check, the summary and other outlets’ coverage."
      />

      <nav className="news-sections" aria-label="Sections">
        {SECTIONS.map((category) => (
          <button
            key={category}
            type="button"
            className={`news-section ${selectedCategory === category ? 'is-active' : ''}`}
            aria-pressed={selectedCategory === category}
            onClick={() => chooseCategory(category)}
          >
            {sectionName(category)}
          </button>
        ))}
      </nav>

      {personalizedMessage && (
        <Alert tone="info" className="news-personal">
          <span className="news-personal__text"><Sparkles size={14} aria-hidden="true" /> {personalizedMessage}</span>
        </Alert>
      )}

      {isLoading ? (
        <FeedSkeleton />
      ) : error ? (
        <Alert
          tone="danger"
          title="The news could not be loaded"
          action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={handleRetry}>Try again</Button>}
        >
          {error}
        </Alert>
      ) : articles.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="No stories in this section yet"
          description="The feed has nothing for this section right now. Try another section, or come back later."
        />
      ) : (
        <div className="news-grid">
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
    </div>
  );
};

export default HomePage;
