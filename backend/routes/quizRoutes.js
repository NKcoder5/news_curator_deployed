const express = require('express');
const router = express.Router();
const { saveQuiz, getUserQuizzes, getQuizStats } = require('../controllers/quizController');
const auth = require('../middleware/auth');

// Save quiz results
router.post('/save', auth, saveQuiz);

// Get user's quiz history
router.get('/user/:userId', auth, getUserQuizzes);

// Get quiz statistics
router.get('/stats/:userId', auth, getQuizStats);

module.exports = router; 