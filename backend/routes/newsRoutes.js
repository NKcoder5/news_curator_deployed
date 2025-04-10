// backend/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const { fetchTopNews } = require('../utils/newsFetcher');

router.get('/', async (req, res) => {
  try {
    const { category = 'general' } = req.query;
    const news = await fetchTopNews(category);
    res.json({ articles: news });
  } catch (err) {
    console.error('❌ Error fetching news:', err.message);
    res.status(500).json({ error: 'Error fetching news' });
  }
});

module.exports = router;
