// backend/rag/ragPipeline.js
const fs = require('fs').promises;
const path = require('path');

// Path to context file
const CONTEXT_FILE = path.join(__dirname, '../data/contextArticle.json');

// Simple keyword overlap and text similarity for ranking
function getSimilarity(inputText, articleText, inputKeywords = [], articleKeywords = []) {
  // Keyword overlap score (higher weight)
  const keywordOverlap = inputKeywords.filter(k => articleKeywords.includes(k)).length;
  const keywordScore = keywordOverlap / Math.max(inputKeywords.length, articleKeywords.length, 1);

  // Text similarity (word overlap, lower weight)
  const words1 = new Set(inputText.toLowerCase().split(/\s+/));
  const words2 = new Set(articleText.toLowerCase().split(/\s+/));
  const intersection = [...words1].filter(word => words2.has(word));
  const textScore = intersection.length / Math.max(words1.size, words2.size, 1);

  // Combine scores (70% keywords, 30% text)
  return 0.7 * keywordScore + 0.3 * textScore;
}

async function fetchContext({ title, content, source }) {
  try {
    // Read context file
    const rawData = await fs.readFile(CONTEXT_FILE, 'utf8');
    const articles = JSON.parse(rawData);

    // Prepare input
    const inputText = `${title} ${content}`.toLowerCase();
    const inputKeywords = inputText.split(/\s+/).filter(word => word.length > 3); // Basic keyword extraction

    // Rank articles by similarity
    const rankedArticles = articles
      .map(article => ({
        ...article,
        similarity: getSimilarity(
          inputText,
          `${article.title} ${article.content}`,
          inputKeywords,
          article.keywords || []
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3); // Top 3 matches

    // Format as context snippets
    const context = rankedArticles.map(article => ({
      snippet: `${article.title}: ${article.content}`,
      link: article.source || 'Local context',
      similarity: article.similarity,
    }));

    return context.length > 0
      ? context
      : [{ snippet: 'No relevant context found in local data.', link: 'N/A' }];
  } catch (error) {
    console.error('RAG fetch failed:', error.message);
    return [{ snippet: 'Error loading context data.', link: 'N/A' }];
  }
}

module.exports = { fetchContext };