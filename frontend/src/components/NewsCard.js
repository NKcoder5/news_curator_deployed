import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Badge } from './ui';
import '../styles/NewsCard.css';

const TrustStamp = ({ badge }) => {
  if (!badge) return <span className="news-card__badge-pending" aria-label="Trust analysis loading" />;
  if (badge.kind === 'analyzed') {
    const tone = ['corroborated', 'likely-true'].includes(badge.level) ? 'success'
      : ['false', 'likely-false'].includes(badge.level) ? 'danger'
        : 'warning';
    return <Badge tone={tone}>{badge.verdict}{badge.concernCount > 0 && <span className="news-card__badge-note"> · {badge.concernCount} to check</span>}</Badge>;
  }
  return <Badge tone={badge.sourceMatched ? 'info' : 'neutral'}>{badge.label || 'Open to check'}</Badge>;
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const NewsCard = ({ article, trustBadge }) => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const source = article.source?.name || article.source || 'Unknown source';

  const openArticle = () => {
    const token = localStorage.getItem('token');
    if (token) {
      api.post('/tracking/activity', {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source,
        activityType: 'click',
        duration: 0,
        completed: false
      }).catch(() => {});
    }
    navigate('/article', { state: { article, startTime: Date.now() } });
  };

  return (
    <article className="news-card">
      <div className="news-card__media">
        {!imageError && article.urlToImage
          ? <img src={article.urlToImage} alt="" onError={() => setImageError(true)} />
          : <div className="news-card__placeholder"><ImageOff size={28} aria-hidden="true" /><span className="sr-only">No image available</span></div>}
      </div>
      <div className="news-card__body">
        <p className="news-card__meta"><span className="news-card__source">{source}</span>{formatDate(article.publishedAt) && ` · ${formatDate(article.publishedAt)}`}</p>
        <h3 className="news-card__title">
          <button type="button" className="news-card__link" onClick={openArticle}>{article.title || 'Untitled story'}</button>
        </h3>
        {article.description && <p className="news-card__description">{article.description}</p>}
        <footer className="news-card__footer"><TrustStamp badge={trustBadge} /></footer>
      </div>
    </article>
  );
};

export default NewsCard;
