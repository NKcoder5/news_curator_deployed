const express = require('express');
const { getProfile } = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

// Protected routes
router.get('/profile', authMiddleware, getProfile);

module.exports = router; 