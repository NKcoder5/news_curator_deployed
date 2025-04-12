const express = require('express');
const router = express.Router();
const { submitFeedback, getArticleFeedback, getUserFeedbackHistory } = require('../controllers/articleFeedbackController');
const auth = require('../middleware/auth');

// Submit or update feedback
router.post('/submit', auth, submitFeedback);

// Get feedback for a specific article
router.get('/:articleId', auth, getArticleFeedback);

// Get user's feedback history
router.get('/history/all', auth, getUserFeedbackHistory);

module.exports = router; 