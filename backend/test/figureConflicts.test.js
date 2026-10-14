const test = require('node:test');
const assert = require('node:assert');
const { __test: { figureConflicts } } = require('../agents/claimVerificationAgent');

const item = (source, title) => ({ source, title, url: `https://${source.replace(/\s/g, '')}.test/`, publishedAt: '2026-10-14T05:00:00Z' });
const claim = 'CJP leaders Saurav Das and Ashutosh Ranka were sent to 4 days in judicial custody following demonstrations at Jantar Mantar.';

test('headlines about the same people giving a different figure contradict the claim, without any model', () => {
  const against = figureConflicts(claim, [
    item('NDTV', 'Saurav Das, Ashutosh Ranka Sent To Judicial Custody For 5 Days'),
    item('LawBeat', 'CJP Leaders Saurav Das, Ashutosh Ranka Sent To 5-Day Judicial Custody In Jantar Mantar Trespass Case'),
    item('Live Law', 'Delhi Court Remands CJP Leaders Saurav Das, Ashutosh Ranka To Five Days Judicial Custody'),
    item('Telangana Today', 'Jantar Mantar case: CJP leaders Saurav Das, Ashutosh Ranka sent to judicial custody')
  ]);
  assert.deepStrictEqual(against.map(a => [a.source, a.reported]), [['NDTV', '5 Days'], ['LawBeat', '5-Day'], ['Live Law', '5 Days']]);
});

test('no conflict when an outlet states the claim\'s own figure, when only one outlet differs, or when the people differ', () => {
  assert.strictEqual(figureConflicts(claim, [
    item('NDTV', 'Saurav Das, Ashutosh Ranka Sent To Judicial Custody For 5 Days'),
    item('LawBeat', 'Saurav Das, Ashutosh Ranka sent to 4 days judicial custody'),
    item('Live Law', 'Saurav Das, Ashutosh Ranka remanded to five days custody')
  ]), null);
  assert.strictEqual(figureConflicts(claim, [item('NDTV', 'Saurav Das, Ashutosh Ranka Sent To Judicial Custody For 5 Days')]), null);
  assert.strictEqual(figureConflicts(claim, [
    item('A', 'Two others sent to 5 days judicial custody in Mumbai'),
    item('B', 'Accused remanded to 5 days custody in Pune case')
  ]), null);
});

test('a code is matched by the word beside it: "code 7400" against headlines reading "Code 7500"', () => {
  const air = 'Air India flight AI-2030 from Frankfurt to Delhi was diverted to Jaipur after the pilot squawked code 7400.';
  const against = figureConflicts(air, [
    item('Livemint', "Why was Air India's Frankfurt-Delhi flight diverted to Jaipur? All about 'Squawk Code 7500'"),
    item('Hindustan Times', 'Hijack scare on Air India flight: Code 7500 and the protocols it sets in motion'),
    item('The Times of India', "Hijack code 7500 appeared, pilots said all normal: The mystery behind Air India's Frankfurt-Delhi flight"),
    item('Gulf Business', 'Air India Frankfurt-Delhi flight diverted to Jaipur after hijack alert')
  ]);
  assert.deepStrictEqual(against.map(a => a.source), ['Livemint', 'Hindustan Times', 'The Times of India']);
  assert.strictEqual(figureConflicts(air.replace('7400', '7500'), [
    item('Livemint', "Air India Frankfurt-Delhi flight diverted to Jaipur: Squawk Code 7500"),
    item('Hindustan Times', 'Air India Jaipur diversion: Code 7500 explained')
  ]), null, 'the true code is never contradicted');
});
