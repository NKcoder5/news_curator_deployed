// backend/agents/sourceReputationAgent.js
// Factor 1: Source reputation — deterministic lookup against a curated
// database of media reliability ratings. No LLM involved.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/sourceReputation.json');
let db = null;

function loadDb() {
  if (!db) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  }
  return db;
}

// Normalize a source name/domain for comparison:
// lowercase, strip protocol/www, drop punctuation and common suffixes.
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|in|co\.uk|co|news)(\/.*)?$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Look up the reputation of a news source.
 * @param {string} sourceName - Source name as reported by the news API (e.g. "BBC News")
 * @param {string} [articleUrl] - Optional article URL, used as a fallback domain match
 * @returns {{score: number, bias: string, type: string, matched: boolean, matchedName: string|null, notes: string}}
 */
function getSourceReputation(sourceName, articleUrl) {
  const { sources, unknownSource } = loadDb();
  const normName = normalize(sourceName);

  let normDomain = '';
  if (articleUrl) {
    try {
      normDomain = normalize(new URL(articleUrl).hostname);
    } catch (_) { /* invalid URL — ignore */ }
  }

  for (const entry of sources) {
    const candidates = [entry.name, ...(entry.aliases || [])].map(normalize);
    const nameHit = normName && candidates.some(c =>
      c === normName || (normName.length > 3 && (c.includes(normName) || normName.includes(c)))
    );
    const domainHit = normDomain && candidates.some(c => c === normDomain);
    if (nameHit || domainHit) {
      return {
        score: entry.reliability,
        bias: entry.bias,
        type: entry.type,
        matched: true,
        matchedName: entry.name,
        notes: entry.notes || `Rated ${entry.reliability}/10 for factual reporting; editorial lean: ${entry.bias}.`
      };
    }
  }

  return {
    score: unknownSource.reliability,
    bias: unknownSource.bias,
    type: unknownSource.type,
    matched: false,
    matchedName: null,
    notes: unknownSource.notes
  };
}

module.exports = { getSourceReputation };
