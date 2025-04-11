// backend/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { fetchTopNews } = require('../utils/newsFetcher');
const newsController = require('../controllers/newsController');
const authMiddleware = require('../middleware/authMiddleware');

// Get news articles
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

// Proxy endpoint for news images
router.get('/image-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }
    
    // Fetch the image
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://news.google.com/'
      }
    });
    
    // Set appropriate headers
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    
    // Pipe the image data to the response
    response.data.pipe(res);
  } catch (err) {
    console.error('❌ Error proxying image:', err.message);
    res.status(500).json({ error: 'Error fetching image' });
  }
});

// Search news
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const apiKey = process.env.NEWS_API_KEY;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&apiKey=${apiKey}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === 'ok') {
      res.json({ articles: response.data.articles });
    } else {
      res.status(500).json({ error: 'Error searching news' });
    }
  } catch (err) {
    console.error('❌ Error searching news:', err.message);
    res.status(500).json({ error: 'Error searching news' });
  }
});

// Protected routes (require authentication)
router.get('/personalized', authMiddleware, newsController.getPersonalizedNews);

module.exports = router;
