const ArticleHistory = require('../models/ArticleHistory');

// Track article view
exports.trackArticleView = async (req, res) => {
  try {
    const { articleId, title, source, category } = req.body;
    const userId = req.user.id;

    // Find existing article history or create new one
    let articleHistory = await ArticleHistory.findOne({ userId, articleId });

    if (articleHistory) {
      // Update existing record
      articleHistory.lastViewed = Date.now();
      articleHistory.viewCount += 1;
      await articleHistory.save();
    } else {
      // Create new record
      articleHistory = await ArticleHistory.create({
        userId,
        articleId,
        title,
        source,
        category
      });
    }

    res.status(200).json({ success: true, data: articleHistory });
  } catch (error) {
    console.error('Error tracking article view:', error);
    res.status(500).json({ success: false, error: 'Error tracking article view' });
  }
};

// Update quiz attempt
exports.updateQuizAttempt = async (req, res) => {
  try {
    const { articleId, score } = req.body;
    const userId = req.user.id;

    const articleHistory = await ArticleHistory.findOneAndUpdate(
      { userId, articleId },
      { 
        quizAttempted: true,
        quizScore: score,
        lastViewed: Date.now()
      },
      { new: true }
    );

    if (!articleHistory) {
      return res.status(404).json({ success: false, error: 'Article history not found' });
    }

    res.status(200).json({ success: true, data: articleHistory });
  } catch (error) {
    console.error('Error updating quiz attempt:', error);
    res.status(500).json({ success: false, error: 'Error updating quiz attempt' });
  }
};

// Get user's article history
exports.getUserArticleHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const articleHistory = await ArticleHistory.find({ userId })
      .sort({ lastViewed: -1 })
      .limit(20);

    res.status(200).json({ success: true, data: articleHistory });
  } catch (error) {
    console.error('Error fetching article history:', error);
    res.status(500).json({ success: false, error: 'Error fetching article history' });
  }
}; 