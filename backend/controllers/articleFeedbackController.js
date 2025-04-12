const ArticleFeedback = require('../models/ArticleFeedback');
const ArticleHistory = require('../models/ArticleHistory');

// Submit or update feedback for an article
exports.submitFeedback = async (req, res) => {
  try {
    const { articleId, feedback, rating } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!articleId || !feedback || !rating) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Find existing feedback or create new one
    const existingFeedback = await ArticleFeedback.findOneAndUpdate(
      { userId, articleId },
      { feedback, rating },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      data: existingFeedback
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Error submitting feedback'
    });
  }
};

// Get feedback for a specific article
exports.getArticleFeedback = async (req, res) => {
  try {
    const { articleId } = req.params;
    const userId = req.user._id;

    const feedback = await ArticleFeedback.findOne({ userId, articleId });

    if (!feedback) {
      return res.status(404).json({
        success: false,
        error: 'No feedback found for this article'
      });
    }

    res.status(200).json({
      success: true,
      data: feedback
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching feedback'
    });
  }
};

// Get user's feedback history
exports.getUserFeedbackHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all feedback entries for the user, sorted by creation date
    const feedbackHistory = await ArticleFeedback.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (!feedbackHistory || feedbackHistory.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No feedback history found'
      });
    }

    // Get article titles from ArticleHistory
    const articleIds = feedbackHistory.map(item => item.articleId);
    const articleHistories = await ArticleHistory.find({ 
      userId, 
      articleId: { $in: articleIds } 
    }).select('articleId title').lean();

    // Create a map of articleId to title
    const articleTitleMap = {};
    articleHistories.forEach(article => {
      articleTitleMap[article.articleId] = article.title;
    });

    // Add article titles to feedback history
    const feedbackHistoryWithTitles = feedbackHistory.map(item => ({
      ...item,
      articleTitle: articleTitleMap[item.articleId] || 'Unknown Article'
    }));

    res.status(200).json({
      success: true,
      data: feedbackHistoryWithTitles
    });
  } catch (error) {
    console.error('Error fetching feedback history:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching feedback history'
    });
  }
}; 