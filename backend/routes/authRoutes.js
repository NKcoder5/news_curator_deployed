const express = require('express');
const { signup, login, verify } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected routes
router.get('/verify', authMiddleware, verify);

module.exports = router;