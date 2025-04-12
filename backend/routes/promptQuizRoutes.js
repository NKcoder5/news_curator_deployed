const express = require('express');
const router = express.Router();
const { savePromptQuiz, getUserPromptQuizzes, getPromptQuizStats } = require('../controllers/promptQuizController');
const auth = require('../middleware/auth');

// Save prompt quiz results
router.post('/save', auth, savePromptQuiz);

// Get user's prompt quiz history
router.get('/history', auth, getUserPromptQuizzes);

// Get prompt quiz statistics
router.get('/stats', auth, getPromptQuizStats);

module.exports = router; 