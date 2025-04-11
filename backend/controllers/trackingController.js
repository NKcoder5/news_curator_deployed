const UserActivity = require('../models/UserActivity');
const UserInterest = require('../models/UserInterest');

// Track user activity
exports.trackActivity = async (req, res) => {
  try {
    const { articleId, title, category, source, activityType, duration, completed } = req.body;
    
    // Validate required fields
    if (!articleId || !title || !activityType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create new activity record
    const activity = new UserActivity({
      userId: req.user._id,
      articleId,
      title,
      category: category || 'general',
      source: source || 'Unknown Source',
      activityType,
      duration: duration || 0,
      completed: completed || false
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