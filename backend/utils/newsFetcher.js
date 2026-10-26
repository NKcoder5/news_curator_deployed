// backend/utils/newsFetcher.js
const axios = require('axios');

require('dotenv').config();

/**
 * How far behind live the news index runs, in hours.
 *
 * The developer plan does not serve today's articles. Measured on 2026-09-28,
 * the freshest item the index would return for any query was 30.5 hours old.
 * A story published inside that window therefore draws no corroboration
 * however many outlets carried it, and silence from the index says nothing
 * whatever about it. Any code that reads an absence of coverage as evidence
 * has to know this number; agents/verdictEngine.js is the one that does.
 *
 * Set NEWS_INDEX_LAG_HOURS to 0 on a plan that serves live articles.
 */
//
// Coverage is now searched in Google News as well (searchGoogleNews below),
// which lists a story within the hour, so the default window is a few hours.
const INDEX_LAG_HOURS = Number.isFinite(Number(process.env.NEWS_INDEX_LAG_HOURS))
  ? Number(process.env.NEWS_INDEX_LAG_HOURS)
  : 3;

/**
 * Turn a NewsAPI failure into something a reader can act on.
 *
 * The free tier allows 100 requests per 24 hours across the whole application —
 * the feed, cross-source verification and fact-check lookups all draw on it. It
 * is a condition that will happen, so it deserves a real message rather than a
 * bare "something went wrong".
 */
// A dropped connection or a failed name lookup is usually gone a second later.
// Measured on 2026-10-10 on the development machine's network: 9 of 16
// requests to Google News and Wikipedia failed outright within a minute.
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED',
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ERR_SOCKET_CONNECTION_TIMEOUT']);
const isNetworkError = (err) => Boolean(err) && !err.response
  && (NETWORK_CODES.has(err.code) || /timeout|socket hang up|network/i.test(String(err.message)));

const withRetry = async (fn, retries = 1, delayMs = 1500) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isNetworkError(err)) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
};

// Search results are kept for ten minutes. A demo repeats the same searches,
// and a repeated search then needs no network at all.
const SEARCH_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map();
const cached = async (key, fn) => {
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.value;
  const value = await fn();
  searchCache.set(key, { at: Date.now(), value });
  if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
  return value;
};

const describeNewsApiError = (err) => {
  const status = err.response?.status;
  const raw = err.response?.data;
  // Over quota the service sometimes answers 429 with JSON and sometimes 5xx
  // with an HTML error page. An HTML body carries nothing worth showing, so
  // only trust a structured message.
  const body = (raw && typeof raw === 'object') ? raw : {};
  const isHtmlBody = typeof raw === 'string' && /<html|<!doctype/i.test(raw);
  const detail = String(body.message || (isHtmlBody ? '' : err.message) || '');

  if (!err.response && isNetworkError(err)) {
    const e = new Error('We could not reach the news services. The internet connection seems to be down or very slow; please check it and try again.');
    e.code = 'NETWORK_UNAVAILABLE';
    e.httpStatus = 503;
    return e;
  }
  if (status === 429 || /too many requests|rate ?limit/i.test(detail)) {
    const e = new Error("Today's news quota is used up. The free news feed allows 100 requests a day; it resets 24 hours after the first one. Articles already analysed still open normally.");
    e.code = 'NEWS_QUOTA_EXHAUSTED';
    e.httpStatus = 429;
    return e;
  }
  if (status === 401 || body.code === 'apiKeyInvalid' || body.code === 'apiKeyMissing') {
    const e = new Error('The news API key is missing or invalid. Set NEWS_API_KEY in backend/.env.');
    e.code = 'NEWS_KEY_INVALID';
    e.httpStatus = 500;
    return e;
  }
  const e = new Error(
    detail ||
    'The news service is not responding. This often means the free daily request limit (100 per 24 hours) has been reached. Articles already analysed still open normally.'
  );
  e.code = 'NEWS_UNAVAILABLE';
  e.httpStatus = 502;
  return e;
};

// The feed is cached per category. Every page view used to call NewsAPI, and in
// development React runs each effect twice, so one visit spent four of the 100
// requests a day; by afternoon the quota was gone and the front page stopped
// loading. Concurrent requests for the same category share one call, and when
// NewsAPI refuses, the last good copy is served, or Google News top stories.
const FEED_TTL_MS = 15 * 60 * 1000;
const feedCache = new Map();   // category -> { at, articles }
const feedInFlight = new Map(); // category -> Promise

// The feed's categories, which are NewsAPI's. GET /api/news is public, and the category used to go from the
// query string into the NewsAPI address by string pasting and into this cache as a key: every made-up
// category missed the cache and spent one of the day's 100 requests, the cache grew without bound, and
// "&" in the value added parameters to the request. Anything else is refused.
const FEED_CATEGORIES = new Set(['general', 'business', 'entertainment', 'health', 'science', 'sports', 'technology']);
const unknownCategory = (category) => Object.assign(
  new Error(`There is no "${String(category).slice(0, 40)}" news section. Choose one of: ${[...FEED_CATEGORIES].join(', ')}.`),
  { code: 'UNKNOWN_CATEGORY', httpStatus: 400 }
);

const GOOGLE_TOPICS = {
  business: 'BUSINESS', technology: 'TECHNOLOGY', entertainment: 'ENTERTAINMENT',
  sports: 'SPORTS', science: 'SCIENCE', health: 'HEALTH'
};

const googleTopStories = async (category) => {
  const topic = GOOGLE_TOPICS[category];
  const url = topic
    ? `https://news.google.com/rss/headlines/section/topic/${topic}?${GOOGLE_EDITIONS.en}`
    : `https://news.google.com/rss?${GOOGLE_EDITIONS.en}`;
  const { data } = await axios.get(url, { timeout: 8000, responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const items = [];
  for (const block of String(data || '').match(/<item>[\s\S]*?<\/item>/g) || []) {
    const field = (tag) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const source = decodeXml(field('source')).trim();
    let title = decodeXml(field('title')).trim();
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const link = decodeXml(field('link')).trim();
    if (!title || !link || !source || NOT_AN_OUTLET.test(source)) continue;
    const published = new Date(field('pubDate'));
    items.push({
      title, description: '', content: '', url: link, urlToImage: null, source: { name: source },
      publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString()
    });
    if (items.length >= 30) break;
  }
  return items;
};

const fetchTopNews = async (category = 'general') => {
  if (!FEED_CATEGORIES.has(category)) throw unknownCategory(category);
  const cached = feedCache.get(category);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.articles;
  if (feedInFlight.has(category)) return feedInFlight.get(category);

  const request = fetchTopNewsFromApi(category)
    .then(articles => {
      feedCache.set(category, { at: Date.now(), articles });
      return articles;
    })
    .catch(async (err) => {
      if (cached) {
        console.warn(`News feed (${category}): NewsAPI refused (${err.code}); serving the copy from ${new Date(cached.at).toLocaleTimeString()}.`);
        return cached.articles;
      }
      try {
        const google = await googleTopStories(category);
        if (google.length) {
          console.warn(`News feed (${category}): NewsAPI refused (${err.code}); serving Google News top stories.`);
          feedCache.set(category, { at: Date.now() - FEED_TTL_MS + 5 * 60 * 1000, articles: google });
          return google;
        }
      } catch (googleErr) {
        console.error('Google News feed fallback failed:', googleErr.message);
      }
      throw err;
    })
    .finally(() => feedInFlight.delete(category));
  feedInFlight.set(category, request);
  return request;
};

const fetchTopNewsFromApi = async (category = 'general') => {
  let response;
  try {
    // Without a timeout a stalled request held the front page until the
    // socket gave up; a refusal now falls back to the cached copy or Google.
    response = await axios.get('https://newsapi.org/v2/top-headlines', {
      params: { category, language: 'en', pageSize: 30, apiKey: process.env.NEWS_API_KEY },
      timeout: 10000
    });
  } catch (err) {
    throw describeNewsApiError(err);
  }

  // The service keeps withdrawn stories in its results as placeholders titled
  // "[Removed]" pointing at removed.com. Shown, they are blank cards that open
  // an analysis of nothing.
  const usable = (response.data.articles || []).filter(article =>
    article && article.title && article.url
    && article.title !== '[Removed]' && !/removed\.com/i.test(article.url));

  return usable.map(article => ({
    title: article.title,
    description: article.description,
    content: article.content,
    url: article.url,
    urlToImage: article.urlToImage,
    source: { name: article.source.name },
    publishedAt: article.publishedAt
  }));
};

/**
 * Raised when the coverage search could not be carried out at all.
 *
 * The distinction this class exists to preserve: "no other outlet reports
 * this" is a finding about the story, while "the index could not be reached"
 * is an absence of knowledge. Collapsing the second into the first let an
 * outage be reported to the reader as evidence about an article.
 */
class SearchUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SearchUnavailableError';
    this.searchUnavailable = true;
  }
}

/**
 * Search all indexed articles for coverage of a topic/claim (NewsAPI "everything" endpoint).
 * Used by cross-source verification to find how OTHER outlets report the same story.
 * @param {string} query - Search keywords
 * @param {string} [excludeSourceName] - Source name to filter out (the article's own outlet)
 * @param {number} [pageSize=10] - Max results
 * @returns {Promise<Array<{title: string, description: string, url: string, source: string, publishedAt: string}>>}
 */
const searchNewsCoverage = async (query, excludeSourceName = '', pageSize = 10, language = 'en') => {
  const apiKey = process.env.NEWS_API_KEY;
  const url = 'https://newsapi.org/v2/everything';

  try {
    const response = await cached(`newsapi|${language}|${pageSize}|${query}`, () => withRetry(() => axios.get(url, {
      timeout: 10000,
      params: {
        q: query,
        language,
        sortBy: 'relevancy',
        pageSize,
        apiKey
      }
    })));

    const exclude = String(excludeSourceName || '').toLowerCase();
    return (response.data.articles || [])
      .filter(a => a.title && a.source && String(a.source.name).toLowerCase() !== exclude)
      .map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt
      }));
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    console.error('News coverage search failed:', message);

    // A query NewsAPI rejects as malformed is a fact about that query: the
    // remaining, broader attempts are still worth making, and an empty result
    // is the honest answer for this one.
    if (status === 400) return [];

    // Everything else - quota, rate limiting, an outage, a dropped connection -
    // means the search did not happen. Returning [] here would tell the caller
    // that no outlet covers the story, which is a finding we did not make.
    // The caller has to be able to tell the difference.
    //
    // The reader-facing wording comes from describeNewsApiError, so a used-up
    // quota reads the same on the Compare page as it does on the feed.
    const described = describeNewsApiError(error);
    const unavailable = new SearchUnavailableError(described.message || message);
    unavailable.code = described.code;
    unavailable.httpStatus = described.httpStatus;
    throw unavailable;
  }
};

// Google News editions to search, by article language. Indian editions are
// used because that is where this application's readers and outlets are; the
// English one still returns international coverage.
const GOOGLE_EDITIONS = {
  en: 'hl=en-IN&gl=IN&ceid=IN:en',
  ta: 'hl=ta&gl=IN&ceid=IN:ta',
  hi: 'hl=hi&gl=IN&ceid=IN:hi',
  te: 'hl=te&gl=IN&ceid=IN:te',
  kn: 'hl=kn&gl=IN&ceid=IN:kn',
  ml: 'hl=ml&gl=IN&ceid=IN:ml',
  mr: 'hl=mr&gl=IN&ceid=IN:mr',
  bn: 'hl=bn&gl=IN&ceid=IN:bn'
};

// Results from social platforms are posts, not reporting by an outlet.
const NOT_AN_OUTLET = /^(instagram|facebook|x|twitter|threads|reddit|linkedin|quora|pinterest|tiktok|sharechat|youtube)$/i;

const decodeXml = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
// String.fromCodePoint throws past the last code point; such a reference is dropped instead.
function codePoint(n) { return Number.isInteger(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : ''; }

/**
 * Search Google News for coverage of a claim.
 *
 * NewsAPI's free plan runs about a day behind, keeps only the last month and
 * carries few Indian regional outlets. Google News lists a story within the
 * hour and covers The Hindu, Times of India, NDTV and regional papers, so a
 * Tamil Nadu by-election result is found the day it is declared. It needs no
 * key and has no daily quota. Only headlines, outlets and dates are used.
 */
// Google News refuses the deployed server's address (26 Oct: 503 in about 6.6 s, every time) while it
// answers the laptop, and six places search it: the claim, its figures, this week's coverage of the subject,
// fact-check headlines, a blocked page's headline, the coverage comparison. A refusal now answers from
// Bing News instead, and Google is left alone for ten minutes, so a check does not wait 6 s on each call
// to be refused again. Google's "when:7d" becomes a date filter on Bing's results.
const GOOGLE_REST_MS = 10 * 60 * 1000;
let googleRestingUntil = 0;
const fromBingInstead = async (query, excludeSourceName, pageSize, cause) => {
  const when = String(query).match(/\s+when:(\d+)([dh])\b/i);
  const plain = String(query).replace(/\s+when:\d+[dh]\b/gi, '').trim();
  try {
    const items = await searchBingNews(plain, excludeSourceName, when ? pageSize * 2 : pageSize, { strict: true });
    const since = when ? Date.now() - Number(when[1]) * (when[2].toLowerCase() === 'h' ? 3600000 : 86400000) : null;
    return (since ? items.filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= since) : items).slice(0, pageSize);
  } catch (_) {
    const unavailable = new SearchUnavailableError(`Google News search could not run: ${cause.message}`);
    if (isNetworkError(cause)) unavailable.code = 'NETWORK_UNAVAILABLE';
    throw unavailable;
  }
};

const searchGoogleNews = async (query, excludeSourceName = '', pageSize = 10, language = 'en') => {
  if (Date.now() < googleRestingUntil) {
    return fromBingInstead(query, excludeSourceName, pageSize, new Error('Google News refused this server a few minutes ago'));
  }
  const edition = GOOGLE_EDITIONS[language] || GOOGLE_EDITIONS.en;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${edition}`;
  let xml;
  try {
    xml = await cached(`google|${url}`, () => withRetry(async () => {
      const response = await axios.get(url, {
        timeout: 8000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'en-IN,en;q=0.9' }
      });
      return String(response.data || '');
    }));
  } catch (error) {
    // Refused (an HTTP error) rather than unreachable: Google is left alone for a while.
    if (error.response) googleRestingUntil = Date.now() + GOOGLE_REST_MS;
    return fromBingInstead(query, excludeSourceName, pageSize, error);
  }

  const exclude = String(excludeSourceName || '').toLowerCase();
  const items = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const field = (tag) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const source = decodeXml(field('source')).trim();
    const sourceUrl = (block.match(/<source url="([^"]+)"/) || [])[1] || '';
    let title = decodeXml(field('title')).trim();
    // Google appends " - Outlet" to every headline.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const link = decodeXml(field('link')).trim();
    if (!title || !link || !source || NOT_AN_OUTLET.test(source)) continue;
    if (source.toLowerCase() === exclude) continue;
    const published = new Date(field('pubDate'));
    items.push({
      title,
      description: '',
      url: link,
      source,
      publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      sourceUrl,
      via: 'google-news'
    });
    if (items.length >= pageSize) break;
  }
  return items;
};

// Bing News RSS: free, keyless, and each result carries a snippet of the
// article's own text — where the details a headline leaves out are written.
// "Sent to judicial custody" is the headline; "remanded to five days'
// judicial custody" is the snippet. A reader who changes one detail of a real
// story ("4 days", "code 7400") is caught on the snippet when no headline
// states the detail. Used for claims that carry a figure or a code.
const bingField = (block, tag) => ((block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
// It is also the first stand-in when Google News refuses the server (agents/claimVerificationAgent.js):
// `strict` then lets a failure through as SearchUnavailableError instead of "nothing found".
const searchBingNews = async (query, excludeSourceName = '', pageSize = 10, { strict = false } = {}) => {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`;
  let xml;
  try {
    xml = await cached(`bing|${url}`, async () => {
      const response = await axios.get(url, { timeout: 8000, responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      return String(response.data || '');
    });
  } catch (error) {
    if (strict) throw new SearchUnavailableError(`Bing News search could not run: ${error.message}`);
    return [];
  }
  const exclude = String(excludeSourceName || '').toLowerCase();
  const items = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const clean = (t) => decodeXml(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const title = clean(bingField(block, 'title'));
    const description = clean(bingField(block, 'description')).slice(0, 400);
    const link = decodeXml(bingField(block, 'link')).trim();
    const real = (() => { try { return new URL(link).searchParams.get('url') || link; } catch (_) { return link; } })();
    let source = clean(bingField(block, 'News:Source'));
    if (!source) { try { source = new URL(real).hostname.replace(/^www\./, ''); } catch (_) { source = ''; } }
    if (!title || !/^https?:\/\//.test(real) || !source || source.toLowerCase() === exclude || NOT_AN_OUTLET.test(source)) continue;
    const published = new Date(bingField(block, 'pubDate'));
    items.push({ title, description, url: real, source, publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(), sourceUrl: '', via: 'bing-news' });
    if (items.length >= pageSize) break;
  }
  return items;
};

// GDELT: a free, keyless index of the world's news in 65 languages, each
// article machine-translated into English, so one English query also finds a
// story only the Tamil, Telugu or Hindi press carried. It reaches regional
// outlets without anyone keeping a list of them — the coverage grows as the
// press does. Used only as a fallback for local stories (agents/
// claimVerificationAgent.js), limited to Indian outlets and its three-month
// window. Its errors, rate limits included, come back as plain text; any of
// them means "nothing found here", never a failed check.
const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

const gdeltQuery = (text, worldwide = false) => {
  const words = String(text || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w.length >= 3).slice(0, 6);
  if (words.length < 2) return null;
  return worldwide ? words.join(' ') : `${words.join(' ')} sourcecountry:india`;
};

const gdeltDate = (value) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
};

const fromGdelt = (json, excludeSourceName = '', pageSize = 10) => {
  const exclude = String(excludeSourceName || '').toLowerCase();
  const seen = new Set();
  const items = [];
  for (const a of (json && Array.isArray(json.articles) ? json.articles : [])) {
    const title = String(a.title || '').replace(/\s+/g, ' ').trim();
    const url = String(a.url || '').trim();
    const source = String(a.domain || '').replace(/^www\./, '').trim();
    if (!title || !/^https?:\/\//.test(url) || !source || source.toLowerCase() === exclude || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    items.push({ title, description: '', url, source, publishedAt: gdeltDate(a.seendate), sourceUrl: `https://${source}`, language: a.language || null, via: 'gdelt' });
    if (items.length >= pageSize) break;
  }
  return items;
};

// GDELT refuses a client that asks more than once every five seconds, so
// every request from this process waits its turn, six seconds apart; a turn
// further off than that is skipped rather than holding a reader's check.
const GDELT_GAP_MS = 6000;
let gdeltTurn = Promise.resolve();
let gdeltLastAt = 0;
const gdeltSlot = (fn) => {
  const run = gdeltTurn.then(async () => {
    const wait = gdeltLastAt + GDELT_GAP_MS - Date.now();
    if (wait > GDELT_GAP_MS) return [];
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    gdeltLastAt = Date.now();
    return fn();
  });
  gdeltTurn = run.catch(() => []);
  return run;
};

// `worldwide` drops the India-only filter and `strict` lets a failure through as SearchUnavailableError:
// both for GDELT standing in for Google News, where an error has to stay an error, not "nothing found".
const searchGdelt = async (query, excludeSourceName = '', pageSize = 10, { worldwide = false, strict = false } = {}) => {
  const q = gdeltQuery(query, worldwide);
  if (!q) return [];
  const url = `${GDELT_URL}?query=${encodeURIComponent(q)}&mode=artlist&format=json&sort=hybridrel&timespan=3months&maxrecords=${Math.min(50, pageSize * 3)}`;
  try {
    const json = await cached(`gdelt|${url}`, () => gdeltSlot(async () => {
      const response = await axios.get(url, { timeout: 8000, responseType: 'text' });
      return JSON.parse(String(response.data || '{}'));
    }));
    return fromGdelt(json, excludeSourceName, pageSize);
  } catch (error) {
    if (strict) throw new SearchUnavailableError(`GDELT search could not run: ${error.message}`);
    return [];
  }
};

/* ---------------------------------------------------------------------------
   Can this server reach its news sources?

   Google News answers the laptop and refused the deployed server: on 26 Oct, on
   Render, the news feed's fallback to Google failed in under six seconds and every
   claim search came back "other outlets could not be searched". Nothing showed it
   until a reader's check failed. /ready now says which sources answer from where
   the server runs, probed at most every ten minutes.
--------------------------------------------------------------------------- */
const PROBE_TTL_MS = 10 * 60 * 1000;
let probe = null;
const tryOne = async (fn) => {
  const started = Date.now();
  try {
    const items = await fn();
    return { ok: true, items: items.length, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error.response?.status || error.code || error.message).slice(0, 80), ms: Date.now() - started };
  }
};
const probeNewsSources = () => {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.result;
  // Google is asked directly here, not through searchGoogleNews and its Bing stand-in: this reports
  // whether Google itself answers.
  const googleDirect = async () => {
    const r = await axios.get('https://news.google.com/rss/search?q=India&hl=en-IN&gl=IN&ceid=IN:en', { timeout: 8000, responseType: 'text' });
    return String(r.data || '').match(/<item>/g) || [];
  };
  const result = Promise.all([
    tryOne(googleDirect),
    tryOne(() => searchBingNews('India news today', '', 5, { strict: true })),
    tryOne(() => searchGdelt('India election commission', '', 5, { worldwide: true, strict: true }))
  ]).then(([google, bing, gdelt]) => ({ at: new Date().toISOString(), googleNews: google, bingNews: bing, gdelt }));
  probe = { at: Date.now(), result };
  return result;
};

/**
 * NewsAPI search, progressively broadening the query until enough outlets
 * are found. NewsAPI requires EVERY term in `q` to match, so a long keyword
 * list (6+ words) usually returns nothing — dropping the least distinctive
 * trailing terms recovers real coverage.
 */
const searchNewsApiBroadening = async (query, excludeSourceName = '', pageSize = 10, minOutlets = 2, language = 'en') => {
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { articles: [], query: '' };

  // Try the full phrase first, then progressively shorter prefixes (4, 3, 2 terms).
  const attempts = [];
  for (const len of [terms.length, 4, 3, 2]) {
    if (len > 0 && len <= terms.length) {
      const attempt = terms.slice(0, len).join(' ');
      if (!attempts.includes(attempt)) attempts.push(attempt);
    }
  }

  let best = { articles: [], query: attempts[0] };
  for (const attempt of attempts) {
    const articles = await searchNewsCoverage(attempt, excludeSourceName, pageSize, language);
    const outletCount = new Set(articles.map(a => String(a.source).toLowerCase())).size;
    if (articles.length > best.articles.length) best = { articles, query: attempt };
    if (outletCount >= minOutlets) return { articles, query: attempt };
  }
  return best;
};

const outletsIn = (articles) => new Set(articles.map(a => String(a.source).toLowerCase())).size;

/**
 * Search coverage of a claim in Google News first, then NewsAPI when Google
 * found too few outlets. Google answers live and without a quota, so the
 * daily NewsAPI allowance is spent only when it can still add something.
 * The search counts as "could not run" only when every source failed.
 * @param {string} query - Search keywords, most distinctive first
 * @param {string} [excludeSourceName] - Source to filter out (the article's own outlet)
 * @param {number} [pageSize=10] - Max results
 * @param {number} [minOutlets=2] - Enough distinct outlets to stop searching
 * @returns {Promise<{articles: Array, query: string}>}
 */
const searchCoverageBroadening = async (query, excludeSourceName = '', pageSize = 10, minOutlets = 2, language = 'en') => {
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { articles: [], query: '' };
  const full = terms.join(' ');

  let google = [];
  let googleFailed = false;
  try {
    google = await searchGoogleNews(full, excludeSourceName, pageSize, language);
    if (outletsIn(google) < minOutlets && terms.length > 3) {
      const shorter = await searchGoogleNews(terms.slice(0, 3).join(' '), excludeSourceName, pageSize, language);
      if (outletsIn(shorter) > outletsIn(google)) google = shorter;
    }
  } catch (err) {
    googleFailed = true;
    console.error(err.message);
  }
  if (outletsIn(google) >= minOutlets) return { articles: google, query: full };

  let newsApi = { articles: [], query: full };
  try {
    newsApi = await searchNewsApiBroadening(query, excludeSourceName, pageSize, minOutlets, language);
  } catch (err) {
    if (googleFailed) throw err;
    console.error('NewsAPI search skipped:', err.message);
  }
  const seen = new Set();
  const merged = [...google, ...newsApi.articles].filter(a => {
    const key = a.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { articles: merged.slice(0, pageSize), query: newsApi.articles.length ? newsApi.query : full };
};

module.exports = {
  INDEX_LAG_HOURS, FEED_CATEGORIES, fetchTopNews, searchNewsCoverage, searchGoogleNews, searchCoverageBroadening, SearchUnavailableError,
  cached, withRetry, isNetworkError,
  searchGdelt,
  searchBingNews,
  probeNewsSources,
  _gdelt: { gdeltQuery, gdeltDate, fromGdelt }
};
