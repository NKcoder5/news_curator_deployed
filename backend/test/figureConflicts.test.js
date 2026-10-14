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
