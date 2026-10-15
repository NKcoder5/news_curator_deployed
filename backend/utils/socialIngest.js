// backend/utils/socialIngest.js
//
// Turning a social-media artefact into something the trust pipeline can read.
//
// The six factors all consume the same shape — a title, a body of text, and a
// publisher. A news article arrives in that shape already. An Instagram post, a
// WhatsApp forward or a claim spoken in a YouTube video does not: the text may
// be a caption, may be burned into an image, or may only exist as speech. This
// module converts each of those into the canonical shape, and records WHERE it
// came from, which matters as much as what it says.
//
// The provenance record is the part that carries weight. "Published by an
// account we know nothing about" is a different statement from "published by an
// unrated newspaper", and the pipeline should not treat them alike. A channel
// that belongs to a known outlet inherits that outlet's record; an anonymous
// account does not inherit a neutral one.
//
// What this module deliberately does NOT do is pretend to reach platforms that
// block automated reading. Instagram and Facebook serve almost nothing to an
// unauthenticated client. Rather than shipping a scraper that works on the demo
// machine and fails everywhere else, those return a clear instruction to paste
// the caption or upload a screenshot, and the screenshot path is implemented.
const axios = require('axios');
const { assertPublicUrl, FETCH_TIMEOUT } = require('./articleExtractor');
const { safeGet } = require('./safeFetch');
const { getSourceReputation, claimedOutlet } = require('../agents/sourceReputationAgent');

const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'] },
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am', 'l.instagram.com'] },
  { id: 'x', name: 'X (Twitter)', hosts: ['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'] },
  { id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'] },
  { id: 'whatsapp', name: 'WhatsApp', hosts: ['chat.whatsapp.com'] },
  { id: 'telegram', name: 'Telegram', hosts: ['t.me', 'telegram.me'] }
];

/** Which platform, if any, does this URL belong to? */
const identifyPlatform = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    // Instagram share links often use l.instagram.com with the real post
    // nested in the `u` parameter.
    if (host === 'l.instagram.com') {
      const target = parsed.searchParams.get('u') || '';
      if (/^https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\//i.test(target)) {
        return PLATFORMS.find(p => p.id === 'instagram');
      }
    }
    return PLATFORMS.find(p => p.hosts.includes(host)) || null;
  } catch (_) {
    return null;
  }
};

const decodeEntities = (str) => String(str || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&apos;|&#39;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

const extractVideoId = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
    else if (/^\/(?:shorts|embed|live)\/[^/]+/i.test(parsed.pathname)) id = parsed.pathname.split('/')[2];
    else id = parsed.searchParams.get('v');
    return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
  } catch (_) {
    return null;
  }
};

/**
 * Title and channel for a YouTube video, via the public oEmbed endpoint.
 * No API key, no quota.
 */
const fetchYoutubeMetadata = async (rawUrl) => {
  const { data } = await axios.get('https://www.youtube.com/oembed', {
    params: { url: rawUrl, format: 'json' },
    timeout: FETCH_TIMEOUT
  });
  return {
    title: decodeEntities(data.title || ''),
    channel: decodeEntities(data.author_name || ''),
    channelUrl: data.author_url || null
  };
};

/**
 * What was actually said in the video.
 *
 * YouTube publishes caption tracks in the watch page's player payload, so a
 * transcript is readable without an API key. Auto-generated captions count:
 * a claim spoken aloud is a claim, and it is the thing the pipeline needs to
 * check. Returns null rather than throwing when a video has no captions, which
 * is common and is not an error.
 */
const fetchYoutubeTranscript = async (videoId) => {
  const tracks = await fetchCaptionTracks(videoId);
  if (!tracks.length) return null;

  const track = chooseCaptionTrack(tracks);
  if (!track?.baseUrl) return null;

  // The caption address comes from YouTube's reply, not from us, so it is
  // fetched through the same address guard as a reader's link.
  const { data: raw } = await safeGet(track.baseUrl, { timeout: FETCH_TIMEOUT, maxBytes: 5 * 1024 * 1024 });
  const xml = typeof raw === 'string' ? raw : JSON.stringify(raw);

  // Two caption formats are served depending on the endpoint: <text> elements
  // in the legacy format and <p> elements in format 3.
  const matches = [
    ...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g),
    ...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)
  ];
  const lines = matches
    .map(match => decodeEntities(match[1].replace(/<[^>]+>/g, ' ')).trim())
    .filter(Boolean);

  if (lines.length === 0) return null;
  return {
    text: lines.join(' ').replace(/\s+/g, ' ').trim(),
    autoGenerated: track.kind === 'asr',
    language: track.languageCode || null
  };
};

/**
 * Get the video's caption tracks.
 *
 * The obvious route — scraping `captionTracks` out of the watch page — parses
 * fine and is useless: the caption URLs it contains are bound to the requesting
 * browser session, and fetching one from a server returns HTTP 200 with an
 * empty body. That failure is silent, which is the dangerous kind: the pipeline
 * would conclude the video has no captions and check only its title.
 *
 * YouTube's own InnerTube player endpoint returns caption URLs that do work.
 * The watch page remains as a fallback in case that endpoint changes.
 */
const fetchCaptionTracks = async (videoId) => {
  try {
    const { data } = await axios.post(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        videoId,
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 31, hl: 'en', gl: 'US' }
        }
      },
      {
        timeout: FETCH_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 12) gzip'
        }
      }
    );
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length) return tracks;
  } catch (_) { /* fall through to the page scrape */ }

  try {
    const { data: html } = await axios.get(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      timeout: FETCH_TIMEOUT,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const match = html.match(/"captionTracks":(\[.*?\])/);
    return match ? JSON.parse(match[1]) : [];
  } catch (_) {
    return [];
  }
};

/**
 * Which caption track carries what was actually said?
 *
 * A popular video carries dozens of tracks, most of them machine translations
 * of the original. Taking the first would analyse an automatic Arabic
 * translation of an English video — the words would not be the speaker's, and
 * every quoted span in the report would be wrong. The auto-generated (ASR)
 * track is the reliable marker of the spoken language, so it is used to
 * identify that language, and a human-written track in the same language is
 * preferred over it when one exists.
 */
const chooseCaptionTrack = (tracks) => {
  const asr = tracks.find(t => t.kind === 'asr');
  const spokenLanguage = asr?.languageCode;

  if (spokenLanguage) {
    const manualInSpokenLanguage = tracks.find(t => t.kind !== 'asr' && t.languageCode === spokenLanguage);
    if (manualInSpokenLanguage) return manualInSpokenLanguage;
    return asr;
  }
  return tracks.find(t => t.kind !== 'asr' && t.languageCode === 'en') || tracks[0];
};

/** Open Graph tags, which most platforms still serve to unauthenticated clients. */
const fetchOpenGraph = async (rawUrl) => {
  // A post link redirects (t.me, fb.watch) and every hop is a reader's
  // address, so it goes through the address guard (utils/safeFetch.js).
  const { data } = await safeGet(rawUrl, {
    timeout: FETCH_TIMEOUT,
    maxBytes: 2 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrustAnalysis/1.0)' }
  });
  const html = String(data || '');
  const meta = (property) => {
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i');
    const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, 'i');
    const match = html.match(pattern) || html.match(reversed);
    return match ? decodeEntities(match[1]) : null;
  };
  return {
    title: meta('og:title') || meta('twitter:title'),
    description: meta('og:description') || meta('twitter:description'),
    image: meta('og:image'),
    siteName: meta('og:site_name')
  };
};

/**
 * Build the provenance record for a social account.
 *
 * The important case is the one in the middle: a channel that belongs to a
 * newsroom we hold a record for. "BBC News on YouTube" should inherit the BBC's
 * record; "@truth_warrior_2024" should inherit nothing. Treating both as an
 * unrated neutral 5/10 — which is what a plain outlet lookup does — flatters the
 * second one considerably.
 */
const SOCIAL_ACCOUNT_BASELINE = 4;

const buildProvenance = ({ platform, accountName, accountUrl, postUrl }) => {
  const outlet = accountName ? getSourceReputation(accountName, accountUrl || postUrl) : { matched: false };

  if (outlet.matched) {
    return {
      platform: platform?.name || 'the web',
      account: accountName,
      accountUrl: accountUrl || null,
      knownOutletChannel: true,
      outletName: outlet.matchedName,
      reliability: outlet.score,
      note: `This is the ${platform?.name || 'social'} channel of ${outlet.matchedName}, which we hold a reliability record for.`
    };
  }

  // A newsroom's name on a channel or beside a screenshot is only a claim. It
  // earns the outlet's record through a listed channel address, never through
  // the name — so "BBC News" typed next to a screenshot, or a YouTube channel
  // that merely calls itself "Associated Press", is told so plainly.
  const claimed = accountName ? claimedOutlet(accountName) : null;
  let note = 'We could not establish who posted this.';
  if (claimed) {
    note = `Given as ${claimed.name}, but that name could not be confirmed from where this came from, so ${claimed.name}'s record is not applied. Anyone can put a newsroom's name on an account or a screenshot.`;
  } else if (accountName) {
    note = `Posted by ${accountName}, an account with no editorial record we can check. An account is not a publisher: there is no correction policy, no masthead and no accountability we can point you to.`;
  }

  return {
    platform: platform?.name || 'the web',
    account: accountName || null,
    accountUrl: accountUrl || null,
    knownOutletChannel: false,
    outletName: null,
    reliability: SOCIAL_ACCOUNT_BASELINE,
    note
  };
};

/**
 * Normalise any supported input into the shape the trust pipeline consumes.
 *
 * @param {Object} input
 * @param {string} [input.url]       - a link to an article, video or post
 * @param {string} [input.text]      - pasted text (a forwarded message, a caption)
 * @param {string} [input.imageText] - text already read out of an image by OCR
 * @param {string} [input.account]   - who posted it, when the caller knows
 * @returns {Promise<{title, content, source, url, modality, provenance, ingestNotes}>}
 */
const ingestSocialContent = async ({ url, text, imageText, account }) => {
  const ingestNotes = [];

  // 1. Plain text: a forwarded message, a pasted caption, a transcript.
  if (!url && (text || imageText)) {
    const body = String(imageText || text).trim();
    const firstLine = body.split(/[.\n!?]/)[0].trim();
    return {
      title: firstLine.slice(0, 140) || 'Pasted message',
      content: body,
      source: account || 'Pasted text',
      url: null,
      modality: imageText ? 'image' : 'text',
      provenance: buildProvenance({ platform: null, accountName: account }),
      ingestNotes: imageText
        ? ['The text was read out of an image, so wording may contain recognition errors.']
        : ['This was pasted in, so there is no publisher page to check.']
    };
  }

  await assertPublicUrl(url);
  const platform = identifyPlatform(url);

  // 2. YouTube: the claim is in the speech, so the transcript is the article.
  if (platform?.id === 'youtube') {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('That YouTube link does not contain a video id.');

    const [metadata, transcript] = await Promise.all([
      fetchYoutubeMetadata(url).catch(() => null),
      fetchYoutubeTranscript(videoId).catch(() => null)
    ]);

    if (!transcript && !metadata) {
      throw new Error('We could not read that video. Paste the claim you want checked instead.');
    }
    if (!transcript) {
      ingestNotes.push('This video has no captions, so only its public title could be checked. Paste the spoken claim or upload a transcript for a fuller check.');
    } else if (transcript.autoGenerated) {
      ingestNotes.push('The transcript is auto-generated by YouTube, so some words may be wrong.');
    }

    return {
      title: metadata?.title || 'YouTube video',
      content: transcript?.text || metadata?.title || '',
      source: metadata?.channel || 'YouTube',
      url,
      modality: 'video',
      provenance: buildProvenance({
        platform,
        accountName: metadata?.channel,
        accountUrl: metadata?.channelUrl,
        postUrl: url
      }),
      ingestNotes
    };
  }

  // 3. Other platforms: read what they serve to a crawler.
  if (platform) {
    const og = await fetchOpenGraph(url).catch(() => null);
    const body = [og?.title, og?.description].filter(Boolean).join('. ').trim();

    if (!body || body.length < 40) {
      const error = new Error(
        `${platform.name} does not let us read that post without signing in. Paste the text of the post, or upload a screenshot of it, and we will check that instead.`
      );
      error.code = 'PLATFORM_UNREADABLE';
      error.platform = platform.id;
      throw error;
    }

    ingestNotes.push(`Read from the post's public preview, which is usually the caption only — not any text inside the image or video.`);

    return {
      title: og.title || `${platform.name} post`,
      content: body,
      source: og.siteName || platform.name,
      url,
      modality: 'social-post',
      provenance: buildProvenance({ platform, accountName: og.siteName, postUrl: url }),
      ingestNotes
    };
  }

  // 4. Not a platform we recognise — the caller should use the article reader.
  return null;
};

module.exports = {
  ingestSocialContent,
  identifyPlatform,
  buildProvenance,
  fetchYoutubeTranscript,
  chooseCaptionTrack,
  extractVideoId,
  SOCIAL_ACCOUNT_BASELINE,
  PLATFORMS
};
