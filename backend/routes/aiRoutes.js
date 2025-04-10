const express = require('express');
const router = express.Router();

const summarizeArticle = require('../agents/summarizeAgent');
const checkCredibility = require('../agents/credibilityAgent');
const processFeedback = require('../agents/feedbackAgent');

router.post('/summarize', async (req, res) => {
  const { article } = req.body;
  try {
    const summary = await summarizeArticle(article);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarize article.' });
  }
});

router.post('/credibility', async (req, res) => {
  const { title, content, source } = req.body;
  try {
    const { score, reasoning } = await checkCredibility(title, content, source);
    res.json({ score, reasoning }); // Send flat { score, reasoning }
  } catch (err) {
    res.status(500).json({ error: 'Failed to check credibility.' });
  }
});

router.post('/feedback', async (req, res) => {
  const { article, userFeedback } = req.body;
  try {
    const suggestion = await processFeedback(article, userFeedback);
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process feedback.' });
  }
});

module.exports = router;