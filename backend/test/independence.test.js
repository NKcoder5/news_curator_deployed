const test = require('node:test');
const assert = require('node:assert');
const { analyseIndependence, resolveGroup, detectWireCredit } = require('../agents/independence');

const item = (source, title, extra = {}) => ({ source, title, description: '', url: '', reliability: 7, ...extra });

test('two outlets under one owner count as one source', () => {
  const result = analyseIndependence([
    item('The Verge', 'Chip maker announces new processor line'),
    item('Vox', 'A completely different story about housing policy')
  ]);
  assert.strictEqual(result.itemCount, 2);
  assert.strictEqual(result.independentCount, 1, 'Vox Media owns both');
  assert.match(result.clusters[0].label, /Vox Media/);
});

test('genuinely separate owners count separately', () => {
  const result = analyseIndependence([
    item('BBC News', 'Flooding forces evacuations in coastal towns'),
    item('The Guardian', 'Thousands leave homes as water rises overnight'),
    item('NPR', 'Residents describe scramble to higher ground')
  ]);
  assert.strictEqual(result.independentCount, 3);
});

test('wire reprints collapse to the agency that wrote them', () => {
  const result = analyseIndependence([
    { source: 'The Hindu', title: 'NEW DELHI (Reuters) - Cabinet clears spending plan', description: '', reliability: 8 },
    { source: 'Hindustan Times', title: 'Cabinet clears spending plan (Reuters)', description: '', reliability: 7.5 },
    { source: 'Deccan Herald', title: 'Spending plan approved', description: 'Reuters reports the cabinet signed off.', reliability: 7 }
  ]);
  assert.strictEqual(result.independentCount, 1, 'one wire story printed three times is one source');
  assert.match(result.clusters[0].label, /Reuters \(wire\)/);
  assert.strictEqual(result.clusters[0].collapsedFrom, 3);
});

test('near-identical headlines from unrelated outlets collapse', () => {
  const result = analyseIndependence([
    item('Outlet Alpha', 'Health ministry confirms twelve cases of the new variant'),
    item('Outlet Beta', 'Health ministry confirms twelve cases of the new variant')
  ]);
  assert.strictEqual(result.independentCount, 1);
  assert.match(result.mergeNotes.join(' '), /near-identical headlines/);
});

test('state media from one state is one source', () => {
  const result = analyseIndependence([
    item('RT', 'Officials deny involvement in border incident'),
    item('Sputnik', 'Ministry rejects claims about the border')
  ]);
  assert.strictEqual(result.independentCount, 1);
  assert.strictEqual(result.stateOnly, true);
});

test('unknown outlets are not merged with anyone', () => {
  const result = analyseIndependence([
    item('Daily Truth Report', 'Exclusive: minister resigns'),
    item('Patriot News Now', 'Breaking: cabinet in turmoil tonight')
  ]);
  assert.strictEqual(result.independentCount, 2, 'no ownership record is not a reason to merge');
  assert.strictEqual(result.hasHighQualitySource, false, 'reliability 7 is below the 7.5 bar');
});

test('corporate siblings across a split are treated as related', () => {
  const result = analyseIndependence([
    item('The Wall Street Journal', 'Regulator opens inquiry into trading desk'),
    item('Fox News', 'Inquiry opened into bank trading practices')
  ]);
  assert.strictEqual(result.independentCount, 1, 'News Corp and Fox Corp share a controlling owner');
});

test('resolveGroup falls back to the URL when the name is unhelpful', () => {
  const group = resolveGroup('', 'https://www.theguardian.com/world/article');
  assert.strictEqual(group.known, true);
  assert.strictEqual(group.groupName, 'Guardian Media Group');
});

test('detectWireCredit reads the agency out of a standfirst', () => {
  assert.strictEqual(detectWireCredit({ title: 'Markets rally', description: 'MUMBAI (PTI) Stocks closed higher.' }).agency, 'PTI');
  assert.strictEqual(detectWireCredit({ title: 'Markets rally', description: 'Our correspondent reports.' }), null);
});

test('empty evidence yields zero independent sources', () => {
  const result = analyseIndependence([]);
  assert.strictEqual(result.independentCount, 0);
  assert.strictEqual(result.hasHighQualitySource, false);
});

test('wire agency and outlets syndicating it collapse into one source', () => {
  const result = analyseIndependence([
    { source: 'PTI', title: 'Centre announces new healthcare scheme', reliability: 8 },
    { source: 'The Hindu', title: 'New healthcare scheme announced (PTI)', reliability: 8 }
  ]);
  assert.strictEqual(result.independentCount, 1);
  assert.match(result.mergeNotes.join(' '), /syndicated from PTI/);
});

