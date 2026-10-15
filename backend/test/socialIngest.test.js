const test = require('node:test');
const assert = require('node:assert');
const {
  identifyPlatform, extractVideoId, buildProvenance, chooseCaptionTrack, ingestSocialContent,
  SOCIAL_ACCOUNT_BASELINE
} = require('../utils/socialIngest');

test('platform links are recognised', () => {
  assert.strictEqual(identifyPlatform('https://www.youtube.com/watch?v=abc')?.id, 'youtube');
  assert.strictEqual(identifyPlatform('https://youtu.be/abc')?.id, 'youtube');
  assert.strictEqual(identifyPlatform('https://www.instagram.com/p/xyz/')?.id, 'instagram');
  assert.strictEqual(identifyPlatform('https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Freel%2Fxyz%2F')?.id, 'instagram');
  assert.strictEqual(identifyPlatform('https://m.facebook.com/story.php?id=1')?.id, 'facebook');
  assert.strictEqual(identifyPlatform('https://x.com/user/status/1')?.id, 'x');
  assert.strictEqual(identifyPlatform('https://www.bbc.co.uk/news/123'), null, 'a news site is not a platform');
  assert.strictEqual(identifyPlatform('not a url'), null);
});

test('video ids are read from every YouTube link shape', () => {
  assert.strictEqual(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://www.youtube.com/shorts/abc123'), 'abc123');
  assert.strictEqual(extractVideoId('https://www.youtube.com/embed/abc123?start=4'), 'abc123');
  assert.strictEqual(extractVideoId('https://www.youtube.com/live/abc123'), 'abc123');
  assert.strictEqual(extractVideoId('https://www.youtube.com/watch?v=bad!'), null);
  assert.strictEqual(extractVideoId('https://www.youtube.com/'), null);
});

test('an anonymous account does not inherit a publisher\'s neutral rating', () => {
  const provenance = buildProvenance({ platform: { name: 'Instagram' }, accountName: 'real_truth_daily' });
  assert.strictEqual(provenance.knownOutletChannel, false);
  assert.strictEqual(provenance.reliability, SOCIAL_ACCOUNT_BASELINE);
  assert.ok(provenance.reliability < 5, 'must sit below the "unrated outlet" default of 5');
  assert.match(provenance.note, /no editorial record/);
});

// This used to assert that a channel merely NAMED "BBC News" inherited the
// BBC's record. Anyone can name a channel that, so a name now earns nothing:
// the record comes only through a channel address listed as the outlet's own.
test('a known outlet\'s own channel inherits that outlet\'s record', () => {
  const provenance = buildProvenance({
    platform: { name: 'YouTube' },
    accountName: 'Associated Press',
    accountUrl: 'https://www.youtube.com/@AssociatedPress'
  });
  assert.strictEqual(provenance.knownOutletChannel, true);
  assert.strictEqual(provenance.outletName, 'Associated Press');
  assert.ok(provenance.reliability >= 8);
});

test('a channel that only uses a newsroom\'s name inherits nothing', () => {
  const provenance = buildProvenance({
    platform: { name: 'YouTube' },
    accountName: 'BBC News',
    accountUrl: 'https://www.youtube.com/@bbc-news-official-live'
  });
  assert.strictEqual(provenance.knownOutletChannel, false);
  assert.match(provenance.note, /could not be confirmed/);
});

test('a newsroom name typed beside a screenshot inherits nothing', () => {
  const provenance = buildProvenance({ platform: null, accountName: 'BBC News' });
  assert.strictEqual(provenance.knownOutletChannel, false);
  assert.ok(provenance.reliability < 8);
});

test('the caption track chosen is the one in the spoken language', () => {
  const tracks = [
    { languageCode: 'ar', kind: undefined, baseUrl: 'ar' },   // auto-translation, listed first
    { languageCode: 'hy', kind: undefined, baseUrl: 'hy' },
    { languageCode: 'en', kind: 'asr', baseUrl: 'en-asr' },   // marks English as spoken
    { languageCode: 'en', kind: undefined, baseUrl: 'en-manual' }
  ];
  assert.strictEqual(chooseCaptionTrack(tracks).baseUrl, 'en-manual', 'human English over machine Arabic');
});

test('with no human track in the spoken language, the auto transcript is used', () => {
  const tracks = [
    { languageCode: 'es', kind: undefined, baseUrl: 'es-translated' },
    { languageCode: 'ta', kind: 'asr', baseUrl: 'ta-asr' }
  ];
  assert.strictEqual(chooseCaptionTrack(tracks).baseUrl, 'ta-asr', 'the spoken Tamil, not a Spanish translation');
});

test('pasted text becomes an analysable document', async () => {
  const result = await ingestSocialContent({
    text: 'BREAKING: the government has secretly approved a new tax on savings accounts. Share before this gets deleted!',
    account: 'forwarded on WhatsApp'
  });
  assert.strictEqual(result.modality, 'text');
  assert.match(result.title, /BREAKING/);
  assert.strictEqual(result.provenance.reliability, SOCIAL_ACCOUNT_BASELINE);
  assert.match(result.ingestNotes.join(' '), /no publisher page/);
});

test('text read from a screenshot is marked as such', async () => {
  const result = await ingestSocialContent({ imageText: 'Doctors confirm the vaccine causes memory loss in 4 out of 5 patients. The media will not report this.' });
  assert.strictEqual(result.modality, 'image');
  assert.match(result.ingestNotes.join(' '), /read out of an image/);
});

test('an ordinary news URL is left to the article reader', async () => {
  const result = await ingestSocialContent({ url: 'https://www.reuters.com/world/india/some-story' });
  assert.strictEqual(result, null, 'null means "not a social artefact, use the article path"');
});
