const test = require('node:test');
const assert = require('node:assert');
const { _gdelt: { gdeltQuery, gdeltDate, fromGdelt } } = require('../utils/newsFetcher');

test('a GDELT query keeps the distinctive words and limits it to Indian outlets', () => {
  assert.strictEqual(gdeltQuery('Coimbatore district police seized drugs, gutkha and weapons in a special drive'),
    'Coimbatore district police seized drugs gutkha sourcecountry:india');
  assert.strictEqual(gdeltQuery('a b'), null, 'too little to search for');
});

test('GDELT articles become ordinary coverage items, in their own language', () => {
  const items = fromGdelt({ articles: [
    { url: 'https://www.dinamalar.com/news/1', title: 'கோவையில் போதைப்பொருள் பறிமுதல்', seendate: '20261009T053000Z', domain: 'www.dinamalar.com', language: 'Tamil' },
    { url: 'https://www.dinamalar.com/news/2', title: 'கோவையில் போதைப்பொருள் பறிமுதல்', seendate: '20261009T053000Z', domain: 'dinamalar.com', language: 'Tamil' },
    { url: 'javascript:alert(1)', title: 'bad', domain: 'x.com' },
    { url: 'https://ownsite.in/a', title: 'From the publisher itself', domain: 'ownsite.in' }
  ] }, 'ownsite.in', 10);
  assert.strictEqual(items.length, 1, 'duplicates, unsafe links and the excluded publisher are dropped');
  assert.deepStrictEqual({ source: items[0].source, publishedAt: items[0].publishedAt, language: items[0].language, via: items[0].via },
    { source: 'dinamalar.com', publishedAt: '2026-10-09T05:30:00Z', language: 'Tamil', via: 'gdelt' });
  assert.strictEqual(gdeltDate('nonsense'), null);
  assert.deepStrictEqual(fromGdelt('Please limit requests to one every 5 seconds'), [], 'an error page is no results');
});
