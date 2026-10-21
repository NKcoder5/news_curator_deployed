// backend/utils/stanceGuards.js
//
// Readings of a headline against a claim that no model is allowed to make, applied wherever our own
// model's readings are used (agents/claimVerificationAgent.js) and in the measurement that decides
// whether they may be used (eval/stanceCandidate.js), so the two never differ.

/** A headline that only asks ("Will gold hit a record high?") reports nothing. */
const asksOnly = (text) => /\?["'”’)\]]*\s*$/.test(String(text || '').replace(/\s+—\s*$/, '').trim());

// Said before the event: "India set to become first...", "SpaceX to test Starfall...", "...likely to cut".
const FORECAST = /\b(?:set to|poised to|likely to|expected to|plans? to|planning to|aims? to|mulls?|mulling|considering|proposes?|proposed|countdown|preview|will (?:\w+)|may (?:\w+)|might|could|to (?:launch|test|deploy|hold|begin|start|announce|introduce|unveil|release|open|host|meet|visit|sign|resume|join|get|receive|become))\b/i;

/**
 * The headline reports a plan or a forecast and the claim says the thing happened: it does not confirm
 * it. "Tata Motors will launch the Sierra EV in January" is itself a plan, so a headline about the
 * planned launch still confirms that.
 */
const forecastOnly = (headline, claim) => FORECAST.test(String(headline || '')) && !FORECAST.test(String(claim || ''));

module.exports = { asksOnly, forecastOnly };
