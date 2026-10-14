import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Newspaper } from 'lucide-react';
import api from '../services/api';
import { Badge } from './ui';
import '../styles/NewsCard.css';

/**
 * What the checks know about a story, at a glance.
 *  - "analyzed"    this article already has a full report (served from cache):
 *                  shown by its VERDICT, in the verdict's colour
 *  - "source-only" only the publisher's record is known so far: shown in
 *                  neutral, because a publisher's rating is not a verdict on
 *                  this story and must not borrow a verdict's green or red
 */
const VERDICT_TONE = {
  corroborated: 'real',
  'likely-true': 'real',
  opinion: 'info',
  satire: 'info',
  unverified: 'unknown',
  'likely-false': 'fake',
  false: 'fake'
};

export const TrustBadge = ({ badge }) => {
  if (!badge) return <span className="news-card__badge-pending" aria-hidden="true" />;

  if (badge.kind === 'analyzed') {
    return (
      <Badge tone={VERDICT_TONE[badge.level] || 'unknown'} title={`We checked this article: ${badge.verdict}`}>
        {badge.verdict}
        {badge.concernCount > 0 && <span className="news-card__badge-note"> · {badge.concernCount} to check</span>}
      </Badge>
    );
  }

  return (
    <Badge
      tone="neutral"
      title={badge.sourceMatched
        ? `${badge.sourceName} is rated ${badge.score}/10 for accuracy. Open the article for the full check.`
        : 'We have no reliability record for this outlet. Open the article for the full check.'}
    >
      {badge.label}
    </Badge>
  );
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  if (!dateString || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// Feed headlines end with " - Outlet name", which the card already shows.
const headlineOf = (article) => {
  const title = String(article.title || '');
  const source = article.source?.name;
  return source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title;
};

const NewsCard = ({ article, trustBadge }) => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);

  const trackActivity = async (activityType) => {
    try {
      if (!localStorage.getItem('token')) return;
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

  const open = () => {
    if (localStorage.getItem('token')) {
      trackActivity('click');
      navigate('/article', { state: { article, startTime: Date.now() } });
    } else {
      navigate('/article', { state: { article } });
    }
  };

  return (
    <article className="news-card">
      <div className="news-card__media">
        {!imageError && article.urlToImage ? (
          <img src={article.urlToImage} alt="" loading="lazy" onError={() => setImageError(true)} />
        ) : (
          <span className="news-card__placeholder" aria-hidden="true"><Newspaper size={28} /></span>
        )}
      </div>
      <div className="news-card__body">
        <p className="news-card__meta">
          <span className="news-card__source">{article.source?.name || 'Unknown outlet'}</span>
          {formatDate(article.publishedAt) && <span> · {formatDate(article.publishedAt)}</span>}
        </p>
        <h3 className="news-card__title">
          {/* The whole card is clickable through this one button, so the card
              is a single tab stop with the headline as its name. */}
          <button type="button" className="news-card__link" onClick={open} data-article-card>
            {headlineOf(article)}
          </button>
        </h3>
        {article.description && <p className="news-card__description">{article.description}</p>}
        <div className="news-card__footer">
          <TrustBadge badge={trustBadge} />
        </div>
      </div>
    </article>
  );
};

export default NewsCard;
