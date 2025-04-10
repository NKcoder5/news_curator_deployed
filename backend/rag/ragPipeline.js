const fs = require('fs');
const path = require('path');

// Very basic keyword-based matcher
function getRelevantContext(query, topN = 2) {
  const dataPath = path.join(__dirname, '..', 'data', 'contextArticles.json');
  const contextArticles = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const lowerQuery = query.toLowerCase();

  const scored = contextArticles.map(article => {
    const score = (article.title + ' ' + article.content)
      .toLowerCase()
      .split(/\s+/)
      .filter(word => lowerQuery.includes(word))
      .length;

    return { ...article, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(article => article.content);
}

module.exports = { getRelevantContext };
