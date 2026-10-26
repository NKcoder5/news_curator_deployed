const UserInterest = require('../models/UserInterest');
const { fetchTopNews, FEED_CATEGORIES } = require('../utils/newsFetcher');

// Get personalized news based on user interests.
//
// This used to call the news service itself, with its own query: US headlines
// only, where the main feed asks for English from anywhere, and none of the
// shared error handling, so a used-up daily quota reached the reader as an
// unexplained server error while the main feed explained it. It now asks the
// same fetcher the feed uses, for the reader's strongest interest.
exports.getPersonalizedNews = async (req, res) => {
  try {
    const userId = req.user._id;

    const userInterests = await UserInterest.find({ userId })
      .sort({ interestScore: -1 })
      .limit(10);
    // Interests recorded before categories were checked can name a section the feed does not have.
    const usable = (userInterests || []).filter(i => FEED_CATEGORIES.has(i.category));

    if (usable.length === 0) {
      return res.status(200).json({
        articles: [],
        message: 'No personalized interests found. Showing general news.'
      });
    }

    const topInterest = usable[0].category;
    const articles = await fetchTopNews(topInterest);

    if (articles.length > 0) {
      return res.status(200).json({
        articles,
        message: `Showing personalized news from ${topInterest} category based on your interests.`
      });
    }
    return res.status(200).json({
      articles: [],
      message: 'No articles found for your interests. Showing general news.'
    });
  } catch (error) {
    console.error('Error fetching personalized news:', error.message);
    // Pass through the explained reason (quota reached, key invalid) rather
    // than flattening every cause into one unhelpful server error.
    res.status(error.httpStatus || 500).json({
      error: error.message || 'Failed to fetch personalized news',
      code: error.code || 'NEWS_ERROR'
    });
  }
};
