// backend/agents/transparencyAgent.js
//
// Source transparency and evidence quality.
//
// The other content factors ask whether the article is slanted, sensational or
// manipulative. This asks a different question, drawn from journalism practice
// rather than from linguistics:
//
//     "Does this article give the reader anything they could go and check?"
//
// Real reporting names people, quotes them directly, cites documents and gives
// concrete dates and figures. Fabricated stories lean on unattributable
// authority — "experts say", "sources close to the investigation", "studies
// show" — because there is nothing behind them to name. That difference is
// visible in the text without knowing anything about the topic, which makes
// this factor useful precisely when the other evidence-based factors go quiet
// (an obscure story with no other coverage and no published fact-check).
//
// Output is a checklist rather than a single opinion, so a reader can see which
// journalistic practice is present and which is missing.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { transparencyByRules } = require('./heuristics');
const { UNTRUSTED_NOTICE, fence, clip, clipList, asBool } = require('../utils/untrusted');

// Each check contributes to the score. Weights reflect how strongly the
// practice separates reported journalism from fabricated copy.
const CHECKS = [
  { id: 'namedSources',   label: 'Names its sources',          weight: 3.0,
    help: 'Quotes identifiable people or organisations rather than anonymous "sources".' },
  { id: 'directQuotes',   label: 'Uses attributed quotes',     weight: 2.0,
    help: 'Contains direct quotes attributed to someone specific.' },
  { id: 'primaryEvidence',label: 'Points to primary evidence', weight: 2.0,
    help: 'Refers to documents, official statements, studies or data a reader could look up.' },
  { id: 'specificDetail', label: 'Gives concrete detail',      weight: 2.0,
    help: 'Includes specific dates, places and figures instead of vague generalities.' },
  { id: 'measuredClaims', label: 'Claims are measured',        weight: 1.0,
    help: 'Avoids sweeping absolutes that the reporting cannot support.' }
];

const CHECK_IDS = CHECKS.map(c => c.id);

/**
 * Assess how checkable an article is.
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{score:number, level:string, checks:Array, vagueAttributions:Array, summary:string, failed?:boolean}>}
 *          score 0-10 where 10 = fully checkable reporting.
 */
const assessTransparency = async (title, content, language) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);

  const checklist = CHECKS
    .map(c => `- ${c.id}: ${c.help}`)
    .join('\n');


  // The keys are DESCRIBED, not drawn as a template.
  //
  // Under constrained JSON decoding a placeholder schema is itself a valid
  // completion: given the object already written out with every slot a
  // "<placeholder>", the model can close it and stop. Measured on the summary
  // agent, that produced a bare `{}` on every attempt; here it produced JSON
  // with no `techniques` key, which the gateway correctly rejected and the
  // evaluation then had to abort the article over. Asked in words for an
  // object with named keys, the same model answers correctly.
  const prompt = `You are a journalism standards analyst. Judge how VERIFIABLE this news text is — whether a reader could go and check what it says. Judge only what is present in the text, not whether the story sounds true.

${UNTRUSTED_NOTICE}

Text:
${fence(text, { label: 'news text', max: 3000 })}

Assess each check as true or false:
${checklist}

Also list any vague or unattributable phrases the article relies on, such as "experts say", "sources claim", "studies show", "many believe" — quote them EXACTLY as they appear. If there are none, return an empty list.

Note: news APIs often truncate article text. Judge only the portion shown, and do not penalise the article for ending abruptly.

Return a JSON object with these keys:
- "checks": an object whose keys are namedSources, directQuotes, primaryEvidence, specificDetail and measuredClaims, each set to true or false.
- "named_examples": an array of people or organisations the article actually names, empty if it names none.
- "vague_attributions": an array of exact quotes of vague attributions, empty if there are none.
- "summary": one sentence on how checkable this reporting is.` + languageDirective(language);

  try {
    // Temperature 0, as the other writing checks (see clickbaitAgent.js): the sourcing score counts
    // towards a verdict (verdictEngine R7).
    const result = await callNimApiJson(prompt, { maxTokens: 900, temperature: 0, requiredKeys: ['checks'], label: 'transparency' });
    const raw = result.checks && typeof result.checks === 'object' && !Array.isArray(result.checks) ? result.checks : {};
    // Read through asBool, as every other reply is: some models answer "true" as a string, and read as
    // `=== true` every check then failed and the story was scored unsourced, a finding that counts
    // against it.
    const passed = (id) => asBool(raw[id]) === true;

    const checks = CHECKS.map(c => ({
      id: c.id,
      label: c.label,
      help: c.help,
      passed: passed(c.id)
    }));

    const earned = CHECKS.reduce(
      (sum, c) => sum + (passed(c.id) ? c.weight : 0), 0
    );
    const total = CHECKS.reduce((sum, c) => sum + c.weight, 0);
    let score = (earned / total) * 10;

    const vagueAttributions = clipList(result.vague_attributions, 5, 200);

    // Each unattributable appeal costs a little beyond the checklist itself:
    // it is the signature move of fabricated copy.
    score = Math.max(0, score - Math.min(2, vagueAttributions.length * 0.5));
    score = Math.round(score * 10) / 10;

    const passedCount = checks.filter(c => c.passed).length;
    const level = score >= 7.5 ? 'well sourced'
      : score >= 5 ? 'partly sourced'
      : score >= 2.5 ? 'thinly sourced'
      : 'unsourced';

    return {
      score,
      level,
      checks,
      passedCount,
      totalChecks: CHECK_IDS.length,
      namedExamples: clipList(result.named_examples, 4, 120),
      vagueAttributions,
      summary: clip(result.summary, 500),
      method: 'model'
    };
  } catch (err) {
    console.error('Transparency analysis failed, falling back to rules:', err.message);
    return { ...transparencyByRules(title, content, CHECKS), degraded: true };
  }
};

module.exports = { assessTransparency, CHECKS };
