// YouTube links that hold nothing to check.
//
// Measured on the live site, 12 Nov 2026: a Short whose captions are only "[Music] foreign [Applause] [Music]"
// and a link to a video that does not exist both answered "Failed to analyse that content.", the message
// for a fault of ours. The server could read neither video (YouTube refuses captions to the hosting
// provider's addresses, and this Short refuses its title too), and the reason, written for the reader, was
// thrown without a code and reported as a server fault. Sound tags in captions also read as names
// ("Music", "Applause") to the checkability gate, so speechless captions were checked as if they said
// something.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spokenText, ingestSocialContent } = require('../utils/socialIngest');

test('caption sound tags are not speech', () => {
  assert.equal(spokenText('[Music] foreign [Applause] [Music]'), '');
  assert.equal(spokenText('♪ ♪ (laughs) [Music]'), '');
  assert.equal(spokenText('[Music] the Taj Mahal is located in Agra [Applause]'), 'the Taj Mahal is located in Agra');
  assert.equal(spokenText('Now, the Press Information Bureau is fact-checking false claims'), 'Now, the Press Information Bureau is fact-checking false claims');
});

test('a YouTube link without a video id is a link we could not read, not a server fault', async () => {
  await assert.rejects(ingestSocialContent({ url: 'https://www.youtube.com/watch' }), (err) => err.code === 'FETCH_FAILED');
});

test('an unreadable video reaches the reader as a 422 with the reason, not as "Failed to analyse"', async () => {
  const ingestPath = require.resolve('../utils/socialIngest');
  const real = require.cache[ingestPath].exports;
  require.cache[ingestPath].exports = {
    ...real,
    ingestSocialContent: async () => {
      throw Object.assign(new Error('We could not read that video. Paste the claim you want checked instead.'), { code: 'FETCH_FAILED' });
    }
  };
  delete require.cache[require.resolve(path.join(__dirname, '..', 'services', 'contentCheck.js'))];
  try {
    const { runContentCheck } = require('../services/contentCheck');
    await assert.rejects(runContentCheck({ url: 'https://www.youtube.com/watch?v=not-a-real-video-id' }), (err) => {
      assert.equal(err.status, 422);
      assert.equal(err.payload.error, 'We could not read that video. Paste the claim you want checked instead.');
      return true;
    });
  } finally {
    require.cache[ingestPath].exports = real;
  }
});
