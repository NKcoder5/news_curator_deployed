const axios = require('axios');

/**
 * Raised when the reference work could not be reached.
 *
 * An empty result and an unreachable index are both "no articles" to an HTTP
 * client, and the caller reports the first as a finding about the article:
 * "No reference entry was found for the names in this article." Said about an
 * outage, that is a claim we did not establish.
 */
class ReferenceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceUnavailableError';
    this.referenceUnavailable = true;
  }
}

/**
 * Fetches Wikipedia content based on a search query
 * @param {string} query - The search query
 * @param {number} limit - Maximum number of articles to return
 * @returns {Promise<Array>} - Array of Wikipedia articles with title, content, and URL
 */
// Both requests had no timeout at all, so a stalled connection held the
// reference check — and the reader's answer with it — for as long as the
// operating system kept the socket open. Measured answers take 0.4-0.7 s.
const TIMEOUT_MS = 6000;

async function fetchWikipediaContent(query, limit = 3) {
  try {
    // Wikipedia requires a User-Agent header
    const headers = {
      'User-Agent': 'NewsCurator/1.0 (contact: nandhakumar4115@gmail.com)'
    };

    // First, search for relevant articles
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    const searchResponse = await axios.get(searchUrl, { headers, timeout: TIMEOUT_MS });

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
        const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&exintro=1&explaintext=1&format=json`;

        const contentResponse = await axios.get(contentUrl, { headers, timeout: TIMEOUT_MS });
        const page = contentResponse.data.query.pages[pageId];
        const rawContent = String(page.extract || '');
        const cleanContent = rawContent.replace(/^(?:%[0-9A-Fa-f]{2}|[{}\[\]\s\n]|Wikipedia:[^\n]+)+\s*/g, '').trim();

        return {
          title: page.title,
          content: cleanContent || rawContent,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/\s+/g, '_'))}`,
          source: 'Wikipedia',
          similarity: 1.0 // Default similarity score
        };
      })
    );

    return articles;
  } catch (error) {
    console.error('Error fetching Wikipedia content:', error.message);
    // A search that ran and matched nothing returns [] above. Reaching here
    // means the lookup did not happen, which the caller has to be able to
    // tell apart from a subject the reference work does not cover.
    throw new ReferenceUnavailableError(error.message);
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

module.exports = { fetchWikipediaContent, extractKeywords, ReferenceUnavailableError }; 