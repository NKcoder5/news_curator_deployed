// backend/agents/claimVerificationAgent.js
// Factor 4: Cross-source verification — extract the article's key checkable
// claims, search for coverage from OTHER outlets, and have the LLM judge
// whether that independent coverage supports or contradicts each claim.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchNewsCoverage } = require('../utils/newsFetcher');
const { getSourceReputation } = require('./sourceReputationAgent');

/**
 * Step 1: extract up to `maxClaims` checkable factual claims plus search keywords.
 */
const extractClaims = async (title, content, maxClaims = 2) => {
  const prompt = `You are a fact-checking assistant. Extract the most important CHECKABLE factual claims from this news article — concrete statements about events, numbers, or actions that other news outlets would also report if true. Skip opinions and vague statements.

Title: ${title}
Content: ${(content || '').slice(0, 2000)}

Respond with ONLY a JSON object, no other text:
{
  "claims": [
    {
      "claim": "<the factual claim in one sentence>",
      "search_keywords": "<3-6 keywords another news site would use for this story, no quotes or operators>"
    }
  ]
}
Return at most ${maxClaims} claims. If the article contains no checkable claims, return an empty array.`;

  const result = await callNimApiJson(prompt, { maxTokens: 400 });
  const claims = Array.isArray(result.claims) ? result.claims : [];
  return claims
    .filter(c => c && c.claim && c.search_keywords)
    .slice(0, maxClaims)
    .map(c => ({ claim: String(c.claim), keywords: String(c.search_keywords) }));
};

/**
 * Step 2: judge one claim against headlines/descriptions from other outlets.
 */
const judgeClaim = async (claim, coverage) => {
  const evidenceText = coverage
    .map((a, i) => `[${i + 1}] ${a.source}: "${a.title}" — ${a.description}`.slice(0, 300))
    .join('\n');

  const prompt = `You are a claim verification system. Determine whether independent news coverage supports, contradicts, or does not address this claim.

Claim: "${claim}"

Coverage from other news outlets:
${evidenceText}

Respond with ONLY a JSON object, no other text:
{
  "verdict": "<supported | contradicted | unverified>",
  "supporting_indices": [<numbers of coverage items that clearly report the same fact>],
  "contradicting_indices": [<numbers of coverage items that clearly report conflicting facts>],
  "explanation": "<one sentence>"
}
Use "supported" only if at least one item clearly reports the same fact. Use "contradicted" if any item reports conflicting facts. Otherwise "unverified".`;

  const result = await callNimApiJson(prompt, { maxTokens: 300 });
  const pick = (indices) =>
    (Array.isArray(indices) ? indices : [])
      .map(n => coverage[Number(n) - 1])
      .filter(Boolean)
      .map(a => ({ source: a.source, title: a.title, url: a.url, reliability: getSourceReputation(a.source, a.url).score }));

  const verdict = ['supported', 'contradicted', 'unverified'].includes(result.verdict)
    ? result.verdict
    : 'unverified';

  return {
    verdict,
    supportingEvidence: pick(result.supporting_indices),
    contradictingEvidence: pick(result.contradicting_indices),
    explanation: String(result.explanation || '')
  };
};

/**
 * Full cross-source verification for an article.
 * @returns {Promise<{score: number, status: string, claims: Array, explanation: string}>}
 *          score 0-10: supported claims from reliable outlets push it up,
 *          contradicted claims push it down, no coverage stays neutral.
 */
const verifyClaims = async (title, content, sourceName) => {
  try {
    const claims = await extractClaims(title, content);
    if (claims.length === 0) {
      return {
        score: 5,
        status: 'no-claims',
        claims: [],
        explanation: 'No independently checkable claims were found in this article.'
      };
    }

    const results = [];
    for (const { claim, keywords } of claims) {
      const coverage = await searchNewsCoverage(keywords, sourceName, 8);
      if (coverage.length === 0) {
        results.push({
          claim,
          verdict: 'no-coverage',
          supportingEvidence: [],
          contradictingEvidence: [],
          explanation: 'No coverage of this claim was found from other outlets.'
        });
        continue;
      }
      const judgement = await judgeClaim(claim, coverage);
      results.push({ claim, ...judgement });
    }

    // Aggregate claim verdicts into a 0-10 factor score.
    // Baseline 5 (unknown). Each supported claim adds, each contradicted subtracts,
    // weighted by how reliable the corroborating outlets are.
    let score = 5;
    let supported = 0, contradicted = 0, unverified = 0;
    for (const r of results) {
      if (r.verdict === 'supported') {
        const bestReliability = Math.max(...r.supportingEvidence.map(e => e.reliability), 5);
        score += 2.5 * (bestReliability / 10);
        supported++;
      } else if (r.verdict === 'contradicted') {
        score -= 3;
        contradicted++;
      } else {
        unverified++;
      }
    }
    score = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;

    const status = contradicted > 0 ? 'contradicted'
      : supported > 0 ? 'corroborated'
      : 'unverified';

    const parts = [];
    if (supported) parts.push(`${supported} claim(s) corroborated by other outlets`);
    if (contradicted) parts.push(`${contradicted} claim(s) contradicted by other coverage`);
    if (unverified) parts.push(`${unverified} claim(s) could not be verified`);

    return { score, status, claims: results, explanation: parts.join('; ') + '.' };
  } catch (err) {
    console.error('Claim verification failed:', err.message);
    return {
      score: 5,
      status: 'error',
      claims: [],
      explanation: 'Cross-source verification unavailable — treated as neutral.',
      failed: true
    };
  }
};

module.exports = { verifyClaims, extractClaims };
