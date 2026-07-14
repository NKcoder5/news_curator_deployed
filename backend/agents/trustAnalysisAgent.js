// backend/agents/trustAnalysisAgent.js
// Orchestrator: runs the four analysis factors in parallel and combines them
// into one transparent, weighted trust score with a full per-factor breakdown.
// This replaces the single-prompt black-box score with an explainable pipeline.
const { getSourceReputation } = require('./sourceReputationAgent');
const { analyzeClickbait } = require('./clickbaitAgent');
const { analyzeBias } = require('./biasAgent');
const { verifyClaims } = require('./claimVerificationAgent');

// Factor weights — must sum to 1. Cross-source verification carries the most
// weight because it is grounded in independent evidence rather than the
// article's own text.
const WEIGHTS = {
  sourceReputation: 0.25,
  clickbait: 0.15,
  bias: 0.25,
  verification: 0.35
};

const verdictFromScore = (score) => {
  if (score >= 7.5) return { label: 'Trustworthy', level: 'high' };
  if (score >= 5.5) return { label: 'Generally Reliable', level: 'medium-high' };
  if (score >= 4) return { label: 'Exercise Caution', level: 'medium-low' };
  return { label: 'Low Credibility', level: 'low' };
};

/**
 * Run the full trust analysis pipeline for an article.
 * @param {Object} article - { title, content, source, url }
 * @returns {Promise<Object>} structured trust report
 */
const analyzeTrust = async ({ title, content, source, url }) => {
  const text = content || '';

  // Source lookup is synchronous; the three LLM/API factors run in parallel.
  const sourceResult = getSourceReputation(source, url);
  const [clickbaitResult, biasResult, verificationResult] = await Promise.all([
    analyzeClickbait(title),
    analyzeBias(title, text),
    verifyClaims(title, text, source)
  ]);

  // If cross-source verification found nothing to work with, its neutral score
  // shouldn't dilute the factors that DID produce signal — redistribute its
  // weight proportionally across the others.
  const verificationInformative = ['corroborated', 'contradicted'].includes(verificationResult.status);
  let weights = { ...WEIGHTS };
  if (!verificationInformative) {
    const redistribute = weights.verification;
    weights.verification = 0;
    const remaining = 1 - redistribute;
    weights.sourceReputation /= remaining;
    weights.clickbait /= remaining;
    weights.bias /= remaining;
  }

  const overallScore = Math.round((
    sourceResult.score * weights.sourceReputation +
    clickbaitResult.score * weights.clickbait +
    biasResult.score * weights.bias +
    verificationResult.score * weights.verification
  ) * 10) / 10;

  const verdict = verdictFromScore(overallScore);

  return {
    overallScore,
    verdict: verdict.label,
    verdictLevel: verdict.level,
    factors: [
      {
        id: 'sourceReputation',
        name: 'Source Reputation',
        score: sourceResult.score,
        weight: Math.round(weights.sourceReputation * 100),
        detail: {
          matched: sourceResult.matched,
          matchedName: sourceResult.matchedName,
          bias: sourceResult.bias,
          type: sourceResult.type
        },
        explanation: sourceResult.matched
          ? `${sourceResult.matchedName} (${sourceResult.type}) — ${sourceResult.notes}`
          : sourceResult.notes
      },
      {
        id: 'clickbait',
        name: 'Headline Quality',
        score: clickbaitResult.score,
        weight: Math.round(weights.clickbait * 100),
        detail: {
          isClickbait: clickbaitResult.isClickbait,
          signals: clickbaitResult.signals
        },
        explanation: clickbaitResult.explanation
      },
      {
        id: 'bias',
        name: 'Neutral Language',
        score: biasResult.score,
        weight: Math.round(weights.bias * 100),
        detail: {
          biasLevel: biasResult.biasLevel,
          politicalLean: biasResult.politicalLean,
          flaggedSentences: biasResult.flaggedSentences
        },
        explanation: biasResult.explanation
      },
      {
        id: 'verification',
        name: 'Cross-Source Verification',
        score: verificationResult.score,
        weight: Math.round(weights.verification * 100),
        detail: {
          status: verificationResult.status,
          claims: verificationResult.claims
        },
        explanation: verificationResult.explanation
      }
    ],
    analyzedAt: new Date().toISOString()
  };
};

module.exports = { analyzeTrust, WEIGHTS, verdictFromScore };
