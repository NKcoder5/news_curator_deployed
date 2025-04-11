const express = require('express');
const router = express.Router();

const summarizeArticle = require('../agents/summarizeAgent');
const checkCredibility = require('../agents/credibilityAgent');
const processFeedback = require('../agents/feedbackAgent');
const generateDetailedSummary = require('../agents/detailedSummaryAgent');
const generateQuiz = require('../agents/quizAgent');
const generatePromptQuiz = require('../agents/promptQuizAgent');
const auth = require('../middleware/auth');

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

router.post('/detailed-summary', async (req, res) => {
  try {
    const { article } = req.body;
    if (!article) {
      return res.status(400).json({ error: 'Article content is required' });
    }

    const summary = await generateDetailedSummary(article);
    res.json({ summary });
  } catch (error) {
    console.error('Error generating detailed summary:', error);
    res.status(500).json({ error: 'Failed to generate detailed summary' });
  }
});

router.post('/quiz', async (req, res) => {
  try {
    const { detailedSummary } = req.body;
    if (!detailedSummary) {
      return res.status(400).json({ error: 'Detailed summary is required' });
    }

    const quiz = await generateQuiz(detailedSummary);
    res.json({ quiz });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// Generate quiz from user prompt
router.post('/generate-prompt-quiz', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    const quizData = await generatePromptQuiz(prompt);
    res.json(quizData);
  } catch (error) {
    console.error('Error generating prompt quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

module.exports = router;