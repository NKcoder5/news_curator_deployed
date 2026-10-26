const UserActivity = require('../models/UserActivity');
const UserInterest = require('../models/UserInterest');
const { FEED_CATEGORIES } = require('../utils/newsFetcher');

const ACTIVITY_TYPES = new Set(['view', 'click', 'read', 'category']);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Track user activity
exports.trackActivity = async (req, res) => {
  try {
    const { activityType, duration, completed } = req.body || {};
    const articleId = text(req.body?.articleId, 2048);
    const title = text(req.body?.title, 500);
    const source = text(req.body?.source, 200) || 'Unknown Source';
    // The category becomes a reader's interest, and the strongest interest is the section the personalised
    // feed asks the news service for (controllers/newsController.js). Only the feed's own sections count:
    // any other value is recorded as general, which is never an interest. A missing category used to pass
    // the "not general" test and try to save an interest with no category at all.
    const category = FEED_CATEGORIES.has(req.body?.category) ? req.body.category : 'general';

    // Validate required fields
    if (!articleId || !title || !activityType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!ACTIVITY_TYPES.has(activityType)) {
      return res.status(400).json({ error: `activityType must be one of ${[...ACTIVITY_TYPES].join(', ')}.` });
    }

    // Create new activity record
    const activity = new UserActivity({
      userId: req.user._id,
      articleId,
      title,
      category,
      source,
      activityType,
      duration: Number.isFinite(Number(duration)) && Number(duration) >= 0 ? Number(duration) : 0,
      completed: completed === true
    });

    await activity.save();

    // Only update user interests for specific activity types and non-general categories
    if ((activityType === 'read' || activityType === 'category') && category !== 'general') {
      await updateUserInterests(req.user._id, category, source);
    }

    res.status(201).json({ success: true, activity });
  } catch (error) {
    console.error('Error tracking activity:', error);
    res.status(500).json({ error: 'Failed to track activity' });
  }
};

// Get user activity history
exports.getUserActivity = async (req, res) => {
  try {
    const activities = await UserActivity.find({ userId: req.user._id })
      .sort({ timestamp: -1 })
      .limit(50);
    
    res.json(activities);
  } catch (error) {
    console.error('Error fetching activity history:', error);
    res.status(500).json({ error: 'Failed to fetch activity history' });
  }
};

// Get user interests for personalization
exports.getUserInterests = async (req, res) => {
  try {
    const interests = await UserInterest.find({ userId: req.user._id })
      .sort({ interestScore: -1 });
    
    res.json(interests);
  } catch (error) {
    console.error('Error fetching user interests:', error);
    res.status(500).json({ error: 'Failed to fetch user interests' });
  }
};

// Helper function to update user interests
async function updateUserInterests(userId, category, source) {
  try {
    // Skip updating interests for 'general' category
    if (category === 'general') {
      return;
    }
    
    // Find or create user interest for the category
    let userInterest = await UserInterest.findOne({ userId, category });
    
    if (!userInterest) {
      userInterest = new UserInterest({
        userId,
        category,
        interestScore: 1
      });
    } else {
      userInterest.interestScore += 1;
    }

    // Update source preferences
    const sourceIndex = userInterest.sourcePreferences.findIndex(s => s.source === source);
    if (sourceIndex === -1) {
      userInterest.sourcePreferences.push({ source, score: 1 });
    } else {
      userInterest.sourcePreferences[sourceIndex].score += 1;
    }

    userInterest.lastUpdated = new Date();
    await userInterest.save();
  } catch (error) {
    console.error('Error updating user interests:', error);
  }
} 