const ArticleHistory = require('../models/ArticleHistory');

// Track article view
exports.trackArticleView = async (req, res) => {
  try {
    const field = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
    const articleId = field(req.body?.articleId, 2048);
    const title = field(req.body?.title, 500);
    const source = field(req.body?.source, 200) || 'Unknown Source';
    const category = field(req.body?.category, 40) || 'general';
    const userId = req.user.id;
    // A missing article id or headline is the request's fault: it used to reach the schema's "required"
    // check and come back as a server error.
    if (!articleId || !title) {
      return res.status(400).json({ success: false, error: 'articleId and title are required.' });
    }

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