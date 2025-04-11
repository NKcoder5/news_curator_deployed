const axios = require('axios');
const UserInterest = require('../models/UserInterest');

// Get personalized news based on user interests
exports.getPersonalizedNews = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get user interests
    const userInterests = await UserInterest.find({ userId })
      .sort({ interestScore: -1 })
      .limit(3); // Get top 3 interests
    
    // If no interests, return general news
    if (!userInterests || userInterests.length === 0) {
      return res.status(200).json({ 
        articles: [], 
        message: 'No personalized interests found. Showing general news.' 
      });
    }
    
    // Get top interest category
    const topInterest = userInterests[0].category;
    
    // Fetch news from the top interest category
    const apiKey = process.env.NEWS_API_KEY;
    const url = `https://newsapi.org/v2/top-headlines?country=us&category=${topInterest}&apiKey=${apiKey}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === 'ok' && response.data.articles.length > 0) {
      return res.status(200).json({ 
        articles: response.data.articles,
        message: `Showing personalized news from ${topInterest} category based on your interests.`
      });
    } else {
      return res.status(200).json({ 
        articles: [], 
        message: 'No articles found for your interests. Showing general news.' 
      });
    }
  } catch (error) {
    console.error('Error fetching personalized news:', error);
    res.status(500).json({ error: 'Failed to fetch personalized news' });
  }
}; 