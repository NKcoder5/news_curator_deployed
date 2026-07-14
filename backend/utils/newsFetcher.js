// backend/utils/newsFetcher.js
const axios = require('axios');
require('dotenv').config();

const fetchTopNews = async (category = 'general') => {
  const apiKey = process.env.NEWS_API_KEY;

  const url = `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=30&apiKey=${apiKey}`;

  const response = await axios.get(url);

  return response.data.articles.map(article => ({
    title: article.title,
    description: article.description,
    content: article.content,
    url: article.url,
    urlToImage: article.urlToImage,
    source: { name: article.source.name },
    publishedAt: article.publishedAt
  }));
};

/**
 * Search all indexed articles for coverage of a topic/claim (NewsAPI "everything" endpoint).
 * Used by cross-source verification to find how OTHER outlets report the same story.
 * @param {string} query - Search keywords
 * @param {string} [excludeSourceName] - Source name to filter out (the article's own outlet)
 * @param {number} [pageSize=10] - Max results
 * @returns {Promise<Array<{title: string, description: string, url: string, source: string, publishedAt: string}>>}
 */
const searchNewsCoverage = async (query, excludeSourceName = '', pageSize = 10) => {
  const apiKey = process.env.NEWS_API_KEY;
  const url = 'https://newsapi.org/v2/everything';

  try {
    const response = await axios.get(url, {
      params: {
        q: query,
        language: 'en',
        sortBy: 'relevancy',
        pageSize,
        apiKey
      }
    });

    const exclude = String(excludeSourceName || '').toLowerCase();
    return (response.data.articles || [])
      .filter(a => a.title && a.source && String(a.source.name).toLowerCase() !== exclude)
      .map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt
      }));
  } catch (error) {
    console.error('News coverage search failed:', error.response?.data?.message || error.message);
    return [];
  }
};

module.exports = { fetchTopNews, searchNewsCoverage };
