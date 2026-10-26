const test = require('node:test');
const assert = require('node:assert/strict');
const { TECHNIQUES } = require('../agents/manipulationAgent');
const { manipulationByRules } = require('../agents/heuristics');

test('manipulationByRules detects loaded language and fear appeal', () => {
  const result = manipulationByRules(
    'SHOCKING: Corrupt officials exposed in massive scam',
    'Wake up before it is too late! Experts say disaster is imminent.'
  );
  assert.equal(typeof result.score, 'number');
  assert.ok(result.techniques.length >= 2);
  const techNames = result.techniques.map(t => t.technique);
  assert.ok(techNames.includes('loaded language'));
  assert.ok(techNames.includes('appeal to fear'));
});

test('manipulationByRules handles duplicate title/content gracefully', () => {
  const result = manipulationByRules(
    'Plain factual report on Tuesday meeting',
    'Plain factual report on Tuesday meeting'
  );
  assert.equal(result.score, 10);
  assert.equal(result.techniques.length, 0);
  assert.equal(result.intensity, 'none');
});

test('manipulationAgent exports valid TECHNIQUES catalog', () => {
  assert.ok(TECHNIQUES['loaded language']);
  assert.ok(TECHNIQUES['appeal to fear']);
  assert.ok(TECHNIQUES['name calling']);
  assert.ok(TECHNIQUES['exaggeration']);
});
