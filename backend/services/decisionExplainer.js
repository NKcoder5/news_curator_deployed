// backend/services/decisionExplainer.js
//
// What decided this verdict, and what would change it.
//
// An explanation written by a language model is a story about a decision; it
// may or may not be why the decision came out as it did. Here the verdict is
// reached by fixed rules from recorded evidence (agents/verdictEngine.js), so
// the explanation can be computed instead of told: the same rules are run
// again with a line of evidence taken away, or with a hypothetical piece of
// evidence added, and the verdicts compared. Whatever this says decided the
// verdict really did, by construction.
//
// Two questions are answered:
//   decisive   — which channels the verdict depends on. If removing the
//                fact-checkers' rulings leaves the verdict standing, the
//                verdict did not depend on them alone; if removing every
//                channel but one still gives it, it rests on several lines of
//                evidence, which is worth saying.
//   wouldChange — the smallest evidence that would change it: how many
//                independent outlets confirming the claim it would take to
//                outweigh those contradicting it; whether one fact-check
//                ruling would make it fake; and so on.
const { replayVerdict } = require('../agents/verdictEngine');

const clone = (x) => JSON.parse(JSON.stringify(x));

// The channels a verdict can rest on, and how to take each away.
const CHANNELS = [
  { id: 'news-against', label: 'the outlets reporting otherwise', has: (i) => i.claims.some(c => (c.contradictingEvidence || []).length),
    remove: (i) => { i.claims.forEach(c => { c.contradictingEvidence = []; }); } },
  { id: 'news-for', label: 'the outlets confirming it', has: (i) => i.claims.some(c => (c.supportingEvidence || []).length),
    remove: (i) => { i.claims.forEach(c => { c.supportingEvidence = []; }); } },
  { id: 'fact-checkers', label: 'the fact-checkers’ rulings', has: (i) => (i.factCheckResult?.matches || []).length > 0,
    remove: (i) => { i.factCheckResult = { status: 'none', matches: [] }; } },
  { id: 'this-week', label: 'this week’s coverage of the subject', has: (i) => ['presupposed-false', 'absent'].includes(i.currentCoverageResult?.status),
    remove: (i) => { i.currentCoverageResult = { ...(i.currentCoverageResult || {}), status: 'silent', presupposingFalse: [] }; } },
  { id: 'reference', label: 'the encyclopedia entry', has: (i) => (i.premiseResult?.contradictions || []).length + (i.premiseResult?.confirmations || []).length > 0,
    remove: (i) => { i.premiseResult = { ...(i.premiseResult || {}), contradictions: [], confirmations: [] }; } },
  // The warning signs in the writing count only towards rule R7 (nothing
  // confirms a consequential claim and it carries several marks of engineered
  // content). Taken away, the persuasion techniques are gone and the sourcing
  // reads as unremarkable.
  { id: 'writing', label: 'the warning signs in the writing',
    has: (i) => (i.manipulationResult?.techniques || []).length >= 2 || (Number(i.transparencyResult?.score) > 0 && Number(i.transparencyResult?.score) < 4),
    remove: (i) => { i.manipulationResult = { techniques: [] }; i.transparencyResult = { score: 6 }; } }
];

// Hypothetical outlets, each independent of the others and of the real ones:
// separate owners, and headlines that share too few words to be read as the
// same copy (agents/independence.js merges headlines that overlap by 75%).
// They are dated at the moment of the check, as fresh reports would be.
// Measured (eval/counterfactualFaithfulness.js): undated, they could never
// show that one fresh report would confirm a claim whose only coverage was
// old news passed off as new.
const CODEWORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const synthetic = (n, stance, asOf) => Array.from({ length: n }, (_, k) => ({
  source: `Hypothetical ${stance === 'for' ? 'Confirming' : 'Contradicting'} Outlet ${CODEWORDS[k]}`,
  title: `Hypothetical ${CODEWORDS[k]} report`,
  description: '', url: `https://hypothetical-${stance}-${CODEWORDS[k]}.example/`,
  publishedAt: new Date(asOf).toISOString(), reported: stance === 'for' ? 'confirms it' : 'reports otherwise', reliability: 7
}));

const outcome = (input) => {
  const d = replayVerdict(input);
  return { call: d.call, rule: d.rule };
};

/**
 * @param {Object} ledgerInput - the compact inputs the verdict was reached from
 * @returns {{decisive: Array, restsOn: number, wouldChange: Array}|null}
 */
const explainDecision = (ledgerInput) => {
  if (!ledgerInput || !Array.isArray(ledgerInput.claims)) return null;
  const base = outcome(ledgerInput);

  const present = CHANNELS.filter(ch => ch.has(ledgerInput));
  const decisive = present.map(ch => {
    const without = clone(ledgerInput);
    ch.remove(without);
    const result = outcome(without);
    return { channel: ch.id, label: ch.label, without: result, decisive: result.call !== base.call };
  });

  // With every line of evidence taken away. When the answer stands even
  // then, it comes from what is missing (no outlet reports the claim), not
  // from anything found, and no channel can be said to support it.
  const bare = clone(ledgerInput);
  present.forEach(ch => ch.remove(bare));
  const withoutAll = outcome(bare);
  const fromAbsence = withoutAll.call === base.call;

  // The channels each of which, on its own with the others removed, would
  // still reach the same answer — named, so the reader can see which.
  const sufficient = fromAbsence ? [] : present.filter(ch => {
    const alone = clone(ledgerInput);
    present.filter(o => o.id !== ch.id).forEach(o => o.remove(alone));
    return outcome(alone).call === base.call;
  });
  const restsOn = sufficient.length;
  const restsOnChannels = sufficient.map(ch => ({ channel: ch.id, label: ch.label }));

  // The smallest hypothetical evidence that would change the answer. Each
  // step is kept: against three contradicting outlets, three confirming ones
  // leave the claim undecided and a fourth confirms it, and both are worth
  // knowing.
  const wouldChange = [];
  const main = ledgerInput.claims[0];
  if (main) {
    for (const stance of ['for', 'against']) {
      const reached = new Set([base.call]);
      for (let n = 1; n <= CODEWORDS.length; n++) {
        const trial = clone(ledgerInput);
        const target = trial.claims[0];
        const key = stance === 'for' ? 'supportingEvidence' : 'contradictingEvidence';
        target[key] = [...(target[key] || []), ...synthetic(n, stance, ledgerInput.asOf || Date.now())];
        const result = outcome(trial);
        if (reached.has(result.call)) continue;
        reached.add(result.call);
        wouldChange.push({
          change: `${n} more independent ${n === 1 ? 'outlet' : 'outlets'} ${stance === 'for' ? 'confirming' : 'contradicting'} it`,
          added: { stance, outlets: n },
          result
        });
      }
    }
    if (base.call !== 'FAKE' || ledgerInput.factCheckResult?.status !== 'debunked') {
      const trial = clone(ledgerInput);
      trial.factCheckResult = {
        status: 'debunked',
        matches: [{ publisher: 'A hypothetical fact-checker', finding: 'false', rating: 'False', claimReviewed: main.claim, url: '', via: 'claimreview' }]
      };
      const result = outcome(trial);
      if (result.call !== base.call) wouldChange.push({ change: 'a fact-checker rating this exact claim false', result });
    }
  }

  return { verdict: base, decisive, restsOn, restsOnChannels, withoutAll, fromAbsence, wouldChange };
};

module.exports = { explainDecision };
