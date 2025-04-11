// backend/rag/ragPipeline.js
const fs = require('fs').promises;
const path = require('path');
const { fetchWikipediaContent, extractKeywords } = require('../utils/wikipedia');

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
    // Prepare input
    const inputText = `${title} ${content}`.toLowerCase();
    const inputKeywords = extractKeywords(inputText);
    
    // Try to fetch Wikipedia content first
    const wikiArticles = await fetchWikipediaContent(title, 3);
    
    // Read local context file as fallback
    let localArticles = [];
    try {
      const rawData = await fs.readFile(CONTEXT_FILE, 'utf8');
      localArticles = JSON.parse(rawData);
    } catch (error) {
      console.warn('Could not read local context file:', error.message);
    }
    
    // Combine Wikipedia and local articles
    const allArticles = [...wikiArticles, ...localArticles];
    
    if (allArticles.length === 0) {
      return [{ snippet: 'No relevant context found.', link: 'N/A' }];
    }
    
    // Rank articles by similarity
    const rankedArticles = allArticles
      .map(article => ({
        ...article,
        similarity: getSimilarity(
          inputText,
          `${article.title} ${article.content}`,
          inputKeywords,
          article.keywords || extractKeywords(article.content)
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5); // Top 5 matches

    // Format as context snippets
    const context = rankedArticles.map(article => ({
      snippet: `${article.title}: ${article.content.substring(0, 300)}${article.content.length > 300 ? '...' : ''}`,
      link: article.url || (typeof article.source === 'object' ? article.source.name : article.source) || 'Local context',
      similarity: article.similarity,
    }));

    return context;
  } catch (error) {
    console.error('RAG fetch failed:', error.message);
    return [{ snippet: 'Error loading context data.', link: 'N/A' }];
  }
}

module.exports = { fetchContext };