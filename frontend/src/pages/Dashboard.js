import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ReadingRecord from '../components/ReadingRecord';
import '../styles/Dashboard.css';

const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showArticleHistory, setShowArticleHistory] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const navigate = useNavigate();

  const fetchUserProfile = useCallback(async () => {
    try {
      const response = await api.get('/users/profile');
      setUserProfile(response.data);
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError('Failed to load user profile');
    }
  }, []);

  const fetchArticleHistory = useCallback(async () => {
    try {
      const response = await api.get('/article-history/history');
      const history = response.data.data || [];
      setArticleHistory(history);

      // What the checks concluded about what this reader actually opened.
      // Counting articles read says the app was used; counting verdicts says
      // what using it found, which is the only thing here worth a reader's
      // attention. The verdicts are already cached per article, so this is a
      // lookup rather than a re-analysis.
      const urls = history.map(a => a.articleId).filter(Boolean);
      if (urls.length === 0) return;

      const badges = await api.post('/ai/trust-badges', {
        articles: urls.map(url => ({ url }))
      });
      setVerdicts(
        (badges.data.badges || []).filter(b => b.kind === 'analyzed' && b.call)
      );
    } catch (err) {
      console.error('Error fetching article history:', err);
      setError('Failed to load article history');
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchUserProfile(),
        fetchArticleHistory(),
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [fetchUserProfile, fetchArticleHistory]);

  useEffect(() => {
    fetchAllData();

    // Cleanup to prevent memory leaks
    return () => {
      setArticleHistory([]);
      setVerdicts([]);
      setUserProfile(null);
    };
  }, [fetchAllData]);

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handleArticleClick = (article) => {
    const articleData = {
      url: article.articleId,
      title: article.title,
      source: {
        name: article.source,
      },
      category: article.category,
    };

    navigate('/article', {
      state: {
        article: articleData,
        startTime: Date.now(),
      },
    });
  };

  /* One pass over each history list — the figures below all come from here. */
  const stats = useMemo(() => {
    const totalViews = articleHistory.reduce((sum, a) => sum + (a.viewCount || 0), 0);
    const categories = [...new Set(articleHistory.map((a) => a.category).filter(Boolean))];

    // The topic that appears most often in the reading history.
    const tally = {};
    articleHistory.forEach((a) => {
      if (a.category) tally[a.category] = (tally[a.category] || 0) + (a.viewCount || 1);
    });
    const topTopic = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null;

    const lastRead = articleHistory
      .map((a) => a.lastViewed)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];

    // Tally of what the checks concluded, over the articles that have been
    // checked. Articles with no cached verdict are excluded rather than counted
    // as anything — an unchecked article is not a clean one.
    const calls = verdicts.reduce((acc, v) => {
      acc[v.call] = (acc[v.call] || 0) + 1;
      return acc;
    }, {});

    return {
      totalArticles: articleHistory.length,
      totalViews,
      categories: categories.length,
      topTopic,
      lastRead,
      checked: verdicts.length,
      callReal: calls.REAL || 0,
      callFake: calls.FAKE || 0,
      callUnverified: calls['CANNOT VERIFY'] || 0,
      callOther: verdicts.length - ((calls.REAL || 0) + (calls.FAKE || 0) + (calls['CANNOT VERIFY'] || 0)),
    };
  }, [articleHistory, verdicts]);

  const handleNameEdit = () => {
    setIsEditingName(true);
    setNewName(userProfile?.name || '');
  };

  // A rejected name is a form error, said beside the field. It used to go to
  // the page-level error, which replaced the whole dashboard with "Failed to
  // update profile" and a retry button that reloaded everything.
  const handleNameSave = async () => {
    const name = newName.trim();
    if (!name) {
      setNameError('Please enter a name.');
      return;
    }
    try {
      const response = await api.put('/users/profile', { name });
      setUserProfile(response.data.user);
      setIsEditingName(false);
      setNameError('');
    } catch (err) {
      console.error('Error updating profile:', err);
      setNameError(err.response?.data?.error || 'Your name could not be saved just now.');
    }
  };

  const handleNameCancel = () => {
    setIsEditingName(false);
    setNewName('');
    setNameError('');
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  /* The masthead figures, printed as one hairline-ruled strip. */
  const summaryFigures = [
    { label: 'Stories opened', value: stats.totalArticles },
    { label: 'Checked', value: stats.checked },
    { label: 'Confirmed', value: stats.callReal },
    { label: 'Not confirmed', value: stats.callUnverified },
    { label: 'Found false', value: stats.callFake },
    { label: 'Topics', value: stats.categories },
  ];

  return (
    <div className="newspaper-dashboard">
      {loading ? (
        <div className="newspaper-loading-state">
          <div className="newspaper-spinner"></div>
          <p>Setting today's edition…</p>
        </div>
      ) : error ? (
        <div className="newspaper-error-message">
          <p className="error-headline">{error}</p>
          <button className="newspaper-btn" onClick={fetchAllData}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="newspaper-header">
            <div className="newspaper-date">{currentDate}</div>
            <h1 className="newspaper-title">THE READER&apos;S CHRONICLE</h1>
            <div className="newspaper-subtitle">
              {userProfile?.name ? `Compiled for ${userProfile.name}` : 'Your personal reading journal'}
            </div>
            <div className="newspaper-divider"></div>
          </div>

          {/* Everything the reader has done, in one glance */}
          <div className="newspaper-stats newspaper-summary-strip">
            {summaryFigures.map((figure) => (
              <div className="newspaper-stat" key={figure.label}>
                <span className="newspaper-stat-value">{figure.value}</span>
                <span className="newspaper-stat-label">{figure.label}</span>
              </div>
            ))}
          </div>

          <div className="newspaper-content">
            <div className="newspaper-sidebar">
              <div className="newspaper-user-profile">
                <h3 className="sidebar-heading">Reader profile</h3>
                <div className="newspaper-avatar">
                  {(userProfile?.name || userProfile?.email || 'R').charAt(0).toUpperCase()}
                </div>
                <div className="newspaper-profile-info">
                  {isEditingName ? (
                    <div className="newspaper-name-edit">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setNameError(''); }}
                        className="newspaper-name-input"
                        placeholder="Enter your name"
                        maxLength={60}
                        aria-invalid={Boolean(nameError)}
                      />
                      {nameError && <p className="newspaper-name-error" role="alert">{nameError}</p>}
                      <div className="newspaper-name-actions">
                        <button onClick={handleNameSave} className="newspaper-name-btn save">
                          Save
                        </button>
                        <button onClick={handleNameCancel} className="newspaper-name-btn cancel">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="newspaper-name-container">
                      <h4 className="newspaper-name">
                        {userProfile?.name || 'Distinguished Reader'}
                      </h4>
                      <button onClick={handleNameEdit} className="newspaper-name-btn edit">
                        Edit
                      </button>
                    </div>
                  )}
                  <p className="newspaper-email">{userProfile?.email}</p>
                </div>

                <div className="newspaper-interests">
                  <h4 className="sidebar-heading">Topics of interest</h4>
                  <div className="newspaper-tags">
                    {userProfile?.interests?.length > 0 ? (
                      userProfile.interests.map((interest, index) => (
                        <span key={index} className="newspaper-tag">
                          {interest}
                        </span>
                      ))
                    ) : (
                      <span className="newspaper-tag-empty">No interests recorded</span>
                    )}
                  </div>
                </div>
              </div>

              {/* A short standing column of facts drawn from the history above */}
              <div className="newspaper-glance">
                <h3 className="sidebar-heading">At a glance</h3>
                <dl className="newspaper-glance-list">
                  <div className="newspaper-glance-row">
                    <dt>Most-read topic</dt>
                    <dd className={stats.topTopic ? 'newspaper-glance-topic' : undefined}>
                      {stats.topTopic || 'Not yet known'}
                    </dd>
                  </div>
                  <div className="newspaper-glance-row">
                    <dt>Last read</dt>
                    <dd>{stats.lastRead ? formatDate(stats.lastRead) : 'Never'}</dd>
                  </div>
                </dl>
                <button className="newspaper-btn newspaper-glance-btn" onClick={() => navigate('/home')}>
                  Read something new
                </button>
              </div>
            </div>

            <div className="newspaper-main">
              <ReadingRecord history={articleHistory} verdicts={verdicts} />
              <div className="newspaper-section">
                <div className="newspaper-section-header">
                  <h2 className="newspaper-section-title">Reading archives</h2>
                  <span className="newspaper-section-byline">
                    {stats.totalArticles} {stats.totalArticles === 1 ? 'article' : 'articles'} ·{' '}
                    {stats.totalViews} opened
                  </span>
                  <button
                    className="newspaper-toggle-btn"
                    onClick={() => setShowArticleHistory(!showArticleHistory)}
                    aria-expanded={showArticleHistory}
                  >
                    {showArticleHistory ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                {showArticleHistory && (
                  <div className="newspaper-expanded-content">
                    {articleHistory.length > 0 ? (
                      <div className="newspaper-grid">
                        {articleHistory.map((article) => (
                          <div
                            key={article._id}
                            className="newspaper-article-card"
                            onClick={() => handleArticleClick(article)}
                          >
                            <div className="newspaper-card-header">
                              <h3 className="newspaper-article-title">{article.title}</h3>
                              <div className="newspaper-source">{article.source}</div>
                            </div>
                            <div className="newspaper-card-content">
                              <div className="newspaper-article-details">
                                {article.category && (
                                  <span className="newspaper-category">{article.category}</span>
                                )}
                                <span className="newspaper-views">
                                  Opened {article.viewCount}{' '}
                                  {article.viewCount === 1 ? 'time' : 'times'}
                                </span>
                                <span className="newspaper-read-date">
                                  Last read {formatDate(article.lastViewed)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="newspaper-empty-state">
                        <p>Nothing filed here yet.</p>
                        <button className="newspaper-btn" onClick={() => navigate('/home')}>
                          Browse the front page
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
