// backend/services/arithmetic.js
//
// "2 + 2 = 5" is a claim with an answer no outlet or encyclopedia needs to
// give: it is worked out. It used to be refused as too short to check, which
// is the worst reply to a statement that is plainly false. A message that is
// nothing but an equation of numbers is evaluated here — with a small parser,
// never eval — and answered REAL or FAKE with the working shown. Anything else
// returns null and goes through the ordinary check.
const { VERDICT_CLASSES } = require('../agents/verdictEngine');

const EQUATION = /^[\s\d.,+\-*/×÷x()^=]+$/i;

/** Parse and evaluate one side: numbers, + - * / ^, unary minus, brackets. */
const evaluate = (expr) => {
  const src = expr.replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  const number = () => {
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error('number expected');
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = () => {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    let v;
    if (peek() === '(') { i++; v = sum(); if (peek() !== ')') throw new Error(') expected'); i++; } else v = number();
    if (peek() === '^') { i++; v = Math.pow(v, factor()); }
    return v;
  };
  const product = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      if (op === '/' && r === 0) throw new Error('division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const value = sum();
  if (i !== src.length) throw new Error('unexpected input');
  return value;
};

const show = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));

/**
 * @param {string} text - the reader's message
 * @returns {Object|null} a complete report when the message is an equation, else null
 */
const arithmeticReport = (text) => {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  if (!t || !EQUATION.test(t) || (t.match(/=/g) || []).length !== 1 || !/[+\-*/×÷x^]/i.test(t.split('=')[0])) return null;
  const [lhs, rhs] = t.split('=');
  let left;
  let right;
  try { left = evaluate(lhs); right = evaluate(rhs); } catch (_) { return null; }
  const correct = Math.abs(left - right) < 1e-9 * Math.max(1, Math.abs(left));
  const spec = VERDICT_CLASSES[correct ? 'corroborated' : 'false'];
  const oneLine = correct
    ? `Correct: ${lhs.trim()} is ${show(left)}.`
    : `False: ${lhs.trim()} is ${show(left)}, not ${rhs.trim()}.`;
  const decision = {
    verdict: correct ? 'corroborated' : 'false', call: spec.call, oneLine, label: spec.label,
    rule: 'arithmetic', grounds: [`Worked out: ${lhs.trim()} = ${show(left)}.`], confidence: 1, ceiling: spec.ceiling
  };
  return {
    call: spec.call, oneLine, verdict: spec.label, verdictLevel: spec.level, verdictClass: decision.verdict,
    advice: correct ? 'This is arithmetic, and it is correct.' : 'This is arithmetic, and it is wrong.',
    decision, factors: [], evidence: {}, quality: null, evidenceLedger: [], probabilityPercent: correct ? 0 : 100,
    understanding: { language: 'en', languageName: 'English', romanized: false, speechAct: 'assertion', tone: ['neutral'], english: t,
      claims: [{ claim: t, time: 'timeless', kind: 'standing_fact', checkable: true }] },
    explanation: null, trackRecord: null, memory: null, cached: false
  };
};

module.exports = { arithmeticReport, evaluate };
