const axios = require('axios');

/**
 * Fetches Wikipedia content based on a search query
 * @param {string} query - The search query
 * @param {number} limit - Maximum number of articles to return
 * @returns {Promise<Array>} - Array of Wikipedia articles with title, content, and URL
 */
async function fetchWikipediaContent(query, limit = 3) {
  try {
    // First, search for relevant articles
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const searchResponse = await axios.get(searchUrl);
    
    if (!searchResponse.data.query || !searchResponse.data.query.search || searchResponse.data.query.search.length === 0) {
      console.log('No Wikipedia articles found for query:', query);
      return [];
    }
    
    // Get the top results
    const searchResults = searchResponse.data.query.search.slice(0, limit);
    
    // Fetch full content for each article
    const articles = await Promise.all(
      searchResults.map(async (result) => {
        const pageId = result.pageid;
        const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
        
        const contentResponse = await axios.get(contentUrl);
        const page = contentResponse.data.query.pages[pageId];
        
        return {
          title: page.title,
          content: page.extract,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/\s+/g, '_'))}`,
          source: 'Wikipedia',
          similarity: 1.0 // Default similarity score
        };
      })
    );
    
    return articles;
  } catch (error) {
    console.error('Error fetching Wikipedia content:', error.message);
    return [];
  }
}

/**
 * Extracts keywords from text
 * @param {string} text - The text to extract keywords from
 * @returns {Array} - Array of keywords
 */
function extractKeywords(text) {
  // Simple keyword extraction (words longer than 3 characters)
  const words = text.toLowerCase().split(/\s+/);
  return words.filter(word => word.length > 3);
}

module.exports = { fetchWikipediaContent, extractKeywords }; 