// backend/services/ruleReliability.js
//
// The measured record of the rule that reached a verdict, for the page to
// show in place of a hand-set confidence. The record is counted from labelled
// test messages by eval/ruleReliability.js into data/ruleReliability.json;
// regenerate it after each evaluation run.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'ruleReliability.json');
let table = null;

const load = () => {
  if (table === null) {
    try {
      table = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (_) {
      table = { rules: {} };
    }
  }
  return table;
};

/**
 * @param {string} rule - the verdict engine's rule id
 * @returns {{rule, n, right, wrong, missed, rate, low, high, abstains, heldOut, measuredAt}|null}
 *   null when no labelled test message has ended at this rule
 */
const trackRecordFor = (rule) => {
  const entry = rule ? load().rules[rule] : null;
  if (!entry) return null;
  const { n, right, wrong, missed, rate, low, high, abstains, heldOut } = entry;
  return { rule, n, right, wrong, missed, rate, low, high, abstains, heldOut, measuredAt: load().generatedAt || null };
};

module.exports = { trackRecordFor };
