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
    source: article.source.name,
    publishedAt: article.publishedAt
  }));
};

module.exports = { fetchTopNews };
