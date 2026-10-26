// backend/utils/stanceGuards.js
//
// Readings of a headline against a claim that no model is allowed to make, applied wherever our own
// model's readings are used (agents/claimVerificationAgent.js) and in the measurement that decides
// whether they may be used (eval/stanceCandidate.js), so the two never differ.

const { signatureOf, compareSignatures } = require('../services/claimSignature');

/** A headline that only asks ("Will gold hit a record high?") reports nothing. */
const asksOnly = (text) => /\?["'”’)\]]*\s*$/.test(String(text || '').replace(/\s+—\s*$/, '').trim());

// Said before the event: "India set to become first...", "SpaceX to test Starfall...", "...likely to cut".
const FORECAST = /\b(?:set to|poised to|likely to|expected to|plans? to|planning to|aims? to|mulls?|mulling|considering|proposes?|proposed|countdown|preview|will (?:\w+)|might|could|to (?:launch|test|deploy|hold|begin|start|announce|introduce|unveil|release|open|host|meet|visit|sign|resume|join|get|receive|become))\b/i;
// "may" the verb, in lower case only: case-blind, the month in "Polls held in May 2026" read as a forecast.
const MAY = /\bmay\s+(?!\d)\w+/;
const forecasts = (text) => FORECAST.test(String(text || '')) || MAY.test(String(text || ''));

/**
 * The headline reports a plan or a forecast and the claim says the thing happened: it does not confirm
 * it. "Tata Motors will launch the Sierra EV in January" is itself a plan, so a headline about the
 * planned launch still confirms that.
 */
const forecastOnly = (headline, claim) => forecasts(headline) && !forecasts(claim);

/**
 * The claim's own signature rules the headline out (services/claimSignature.js): who beat whom reversed,
 * another figure or date, one of the two negated.
 */
const signatureConflict = (headline, claim) => {
  const cmp = compareSignatures(signatureOf(claim), signatureOf(headline));
  return (cmp.differences || []).some(d => /^(?:roles reversed|figure|date|one says the opposite)/.test(d));
};

// Results of a match or a contest. Measured with every hosted model off (eval/suites/heldout_v2.json):
// "India lost the first T20I against West Indies by eight wickets" was read as confirmed by "Shreyas
// Iyer slams maiden ton to lead India to 8-wicket win", and "India beat West Indies in the second T20I"
// by "Shai Hope's ton helps WI beat IND by 6 wickets". Our model reads a result by its words, not by who
// it went to; this reads who it went to.
const SIDE_ALIASES = {
  IND: 'india', WI: 'west indies', AUS: 'australia', PAK: 'pakistan', ENG: 'england', NZ: 'new zealand',
  SA: 'south africa', SL: 'sri lanka', BAN: 'bangladesh', AFG: 'afghanistan', ZIM: 'zimbabwe', IRE: 'ireland',
  NED: 'netherlands', SCO: 'scotland', NEP: 'nepal', CSK: 'chennai super kings', MI: 'mumbai indians',
  RCB: 'royal challengers bengaluru', KKR: 'kolkata knight riders', SRH: 'sunrisers hyderabad', DC: 'delhi capitals',
  RR: 'rajasthan royals', PBKS: 'punjab kings', LSG: 'lucknow super giants', GT: 'gujarat titans'
};
const NICKNAMES = { windies: 'west indies', proteas: 'south africa', 'men in blue': 'india', 'team india': 'india', 'kiwis': 'new zealand' };
const BEAT = 'beat|beats|defeat|defeats|defeated|crush|crushes|crushed|thrash|thrashes|thrashed|trounce|trounces|trounced|stun|stuns|stunned|edge|edges|edged|down|downs|downed|outclass|outclasses|outclassed|rout|routs|routed|hammer|hammers|hammered|sink|sinks|sank|topple|topples|toppled|overcome|overcomes|overcame|outplay|outplays|outplayed|humble|humbles|humbled|thump|thumps|thumped|demolish|demolishes|demolished|maul|mauls|mauled|overpower|overpowers|overpowered|whitewash|whitewashes|whitewashed|blank|blanks|blanked';
const BEATEN = 'beaten|defeated|crushed|thrashed|trounced|stunned|edged|downed|outclassed|routed|hammered|humbled|thumped|demolished|mauled|overpowered|whitewashed|blanked|toppled|outplayed';
const WIN = 'win|wins|won|clinch|clinches|clinched|seal|seals|sealed|register|registers|registered|record|records|recorded|claim|claims|claimed|bag|bags|bagged|secure|secures|secured';
const LOSE = 'lose|loses|lost|go down|goes down|went down|crash out|crashes out|crashed out|bow out|bows out|bowed out|suffer|suffers|suffered|slump|slumps|slumped';
const LEAD = 'lead|leads|led|power|powers|powered|help|helps|helped|guide|guides|guided|steer|steers|steered|propel|propels|propelled|take|takes|took|carry|carries|carried|drive|drives|drove|fire|fires|fired|inspire|inspires|inspired|script|scripts|scripted|set up|sets up';
const VICTORY = 'win|victory|triumph|thrashing|rout|whitewash';
// Capitalised words that are not a side's name, so "India Crush West Indies By 8 Wickets" ends the
// second side at "By".
const NOT_SIDE = new RegExp(`^(?:by|in|at|on|to|for|with|from|as|after|of|and|the|vs|v|versus|against|over|into|despite|before|highlights|live|score|scorecard|updates|match|report|t20i?|odi|test|final|semi|series|cup|day|night|men|women|${BEAT}|${BEATEN}|${WIN}|${LOSE.replace(/ /g, '|')}|${LEAD.replace(/ /g, '|')}|${VICTORY})$`, 'i');

const sideKey = (raw) => {
  const words = String(raw || '').replace(/['’]s?$/u, '').split(/\s+/).filter(Boolean);
  while (words.length && NOT_SIDE.test(words[words.length - 1])) words.pop();
  while (words.length && NOT_SIDE.test(words[0])) words.shift();
  if (!words.length) return null;
  const joined = words.join(' ');
  if (words.length === 1 && SIDE_ALIASES[joined]) return SIDE_ALIASES[joined];
  const lower = joined.toLowerCase();
  return NICKNAMES[lower] || lower;
};
const SIDE = String.raw`((?:[A-Z][\p{L}.'’-]*)(?:\s+[A-Z][\p{L}.'’-]*){0,3})`;
const OUTCOMES = [
  // "Australia beaten by India", "India were defeated by South Africa"
  [new RegExp(`${SIDE}\\s+(?:(?:were|was|are|is|get|gets|got)\\s+)?(?:${BEATEN})\\s+by\\s+${SIDE}`, 'gu'), (m) => [[m[2], 'won'], [m[1], 'lost']]],
  // "India beat West Indies", "WI beat IND"; not "India crushed by Australia" (above)
  [new RegExp(`${SIDE}\\s+(?:${BEAT})\\s+(?!by\\b)${SIDE}`, 'gu'), (m) => [[m[1], 'won'], [m[2], 'lost']]],
  // "India lost to West Indies", "Pakistan go down against India"
  [new RegExp(`${SIDE}\\s+(?:${LOSE})\\s+(?:(?:a|an|the|heavy|narrow|big|crushing|shock)\\s+)*(?:defeat\\s+|loss\\s+)?(?:to|against)\\s+${SIDE}`, 'giu'), (m) => [[m[2], 'won'], [m[1], 'lost']]],
  // "Shreyas Iyer's ton leads India to 8-wicket win"
  [new RegExp(`(?:${LEAD})\\s+${SIDE}\\s+(?:to|towards|into)\\s+(?:(?:a|an|the|their|its)\\s+)?(?:[\\p{L}\\d-]+\\s+){0,3}?(?:${VICTORY})\\b`, 'giu'), (m) => [[m[1], 'won']]],
  // "India's 8-wicket win over West Indies"
  [new RegExp(`${SIDE}['’]s?\\s+(?:[\\p{L}\\d-]+\\s+){0,3}?(?:${VICTORY})\\s+(?:over|against)\\s+${SIDE}`, 'gu'), (m) => [[m[1], 'won'], [m[2], 'lost']]],
  // "India win by 8 wickets", "India won the first T20I"
  [new RegExp(`${SIDE}\\s+(?:${WIN})\\b(?!\\s+(?:toss|hearts|praise|award))`, 'gu'), (m) => [[m[1], 'won']]],
  // "India lost the first T20I", "Pakistan crash out"
  [new RegExp(`${SIDE}\\s+(?:${LOSE})\\b(?!\\s+(?:the\\s+)?toss)`, 'gu'), (m) => [[m[1], 'lost']]]
];

/** Who won and who lost, by side, in one text: a side said to have done both is left out. */
const resultsOf = (text) => {
  const found = new Map();
  for (const clause of String(text || '').split(/\s*[:;|—–]\s+|\s+-\s+|,\s+/)) {
    for (const [re, read] of OUTCOMES) {
      re.lastIndex = 0;
      for (const m of clause.matchAll(re)) {
        for (const [raw, result] of read(m)) {
          const key = sideKey(raw);
          if (!key) continue;
          found.set(key, found.has(key) && found.get(key) !== result ? 'both' : result);
        }
      }
    }
  }
  for (const [k, v] of found) if (v === 'both') found.delete(k);
  return found;
};

// Which match: "1st T20I", "second ODI", "the final".
const ORDINAL = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth' };
const matchOf = (text) => {
  const t = String(text || '');
  const m = t.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(T20I|T20|ODI|Test)\b/i);
  return m ? `${ORDINAL[m[1].toLowerCase()] || m[1].toLowerCase()} ${m[2].toUpperCase().replace(/^T20$/, 'T20I')}` : null;
};

/**
 * What the results in a headline make of the claim's: 'opposite' (the same match, a side the claim
 * says won is said to have lost, or the reverse), 'reversed' (the opposite, but the match is not
 * shown to be the same one), 'other match' (another numbered match of the series) or null.
 */
const resultConflict = (headline, claim) => {
  const said = resultsOf(claim);
  const reported = resultsOf(headline);
  const a = matchOf(claim);
  const b = matchOf(headline);
  if (a && b && a !== b) return 'other match';
  const reversed = [...said].some(([side, result]) => reported.has(side) && reported.get(side) !== result);
  if (!reversed) return null;
  return a && a === b ? 'opposite' : 'reversed';
};

/** An "agree" by our model that a guard rules out: a forecast, another match, or the claim's own signature. */
const agreeRuledOut = (headline, claim) => forecastOnly(headline, claim) || Boolean(resultConflict(headline, claim)) || signatureConflict(headline, claim);

module.exports = { asksOnly, forecastOnly, signatureConflict, resultsOf, matchOf, resultConflict, agreeRuledOut };
