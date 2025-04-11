// backend/routes/trackingRoutes.js (+ New File)
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const trackingController = require('../controllers/trackingController');

// Track user activity (requires authentication)
router.post('/activity', authMiddleware, trackingController.trackActivity);

// Get user activity history (requires authentication)
router.get('/activity', authMiddleware, trackingController.getUserActivity);

module.exports = router;