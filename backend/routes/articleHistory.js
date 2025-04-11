const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const articleHistoryController = require('../controllers/articleHistoryController');

// Track article view
router.post('/track-view', auth, articleHistoryController.trackArticleView);

// Update quiz attempt
router.post('/update-quiz', auth, articleHistoryController.updateQuizAttempt);

// Get user's article history
router.get('/history', auth, articleHistoryController.getUserArticleHistory);

module.exports = router; 