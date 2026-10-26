// backend/utils/articleExtractor.js
// Fetch a news article from a user-supplied URL and pull out its title, text
// and publisher, so the trust pipeline can analyze links people receive on
// WhatsApp or social media — not just articles from our own feed.
//
// No HTML-parsing dependency: news articles put their body text in <p> tags,
// so stripping non-content elements and collecting paragraphs is enough.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { safeGet, isBlockedAddress, isRefusal } = require('./safeFetch');

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB is far more than any article page needs
const FETCH_TIMEOUT = 12000;

/**
 * Reject anything that is not a public http(s) address.
 * A user-supplied URL must never be usable to reach internal services.
 */
const assertPublicUrl = async (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    const badUrl = new Error('That does not look like a valid link.');
    // The caller maps this to 400: a malformed link is the request's problem,
    // not a fault on our side, and a 500 tells monitoring the wrong story.
    badUrl.code = 'BAD_URL';
    throw badUrl;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const scheme = new Error('Only web links (http or https) can be checked.');
    scheme.code = 'BAD_URL';
    throw scheme;
  }

  // Every address the name resolves to, not only the first: a name with one
  // public and one private record is a private address half the time. The
  // ranges are utils/safeFetch.js's, which also checks the address actually
  // connected to, on every redirect.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    // A host that does not resolve is not a fault on our side, and it is not
    // a finding about the article either. Reported as 500 it told monitoring
    // the server had broken; the reader now gets 422 and the two things they
    // can do instead.
    const unreachable = new Error('We could not reach that website.');
    unreachable.code = 'FETCH_FAILED';
    throw unreachable;
  });

  if (addresses.length === 0 || addresses.some(a => isBlockedAddress(a.address))) {
    // Refusing to fetch our own network is a guard working, not a crash.
    const priv = new Error('That link points to a private address and cannot be checked.');
    priv.code = 'BAD_URL';
    throw priv;
  }

  return parsed;
};

// Hex references matter: the BBC writes apostrophes as &#x27;, and without
// them every "Bangkok's" reached the reader, and every check, as
// "Bangkok&#x27;s". &amp; goes last so that "&amp;#x27;" decodes once, to
// the literal text "&#x27;", rather than twice.
// A reference past the last code point is dropped: String.fromCodePoint throws on it, and one
// "&#99999999;" on a page used to fail the whole check as a server error.
const codePoint = (n) => (Number.isInteger(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : '');
const decodeEntities = (str) => String(str || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => codePoint(Number(code)))
  .replace(/&amp;/gi, '&');

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

/**
 * A headline without the site name pages add to it ("India win the final | The Hindu").
 *
 * The old pattern cut at any hyphen or dash in the last 40 characters, spaces or not, so hyphenated
 * words lost everything after them: "Tamil Nadu by-election: DMK wins both seats" became "Tamil Nadu
 * by", "WHO declares end of Covid-19 emergency" became "WHO declares end of Covid", and the cut
 * headline was what the claim check read. Now only a segment set off by a spaced dash, or by a pipe,
 * is removed, and a dash only when that segment names the site.
 */
const trimSiteName = (title, siteName = '', hostname = '') => {
  const m = String(title || '').match(/\s+(\||[-–—])\s+([^|\-–—]{2,40})$/) || String(title || '').match(/\s*(\|)\s*([^|]{2,40})$/);
  if (!m) return String(title || '').trim();
  const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const suffix = squash(m[2]);
  const site = squash(siteName);
  const host = squash(String(hostname || '').replace(/^www\./, '').split('.').slice(0, -1).join(''));
  const namesSite = Boolean(suffix) && ((site && (site.includes(suffix) || suffix.includes(site)))
    || (host && (host.includes(suffix) || suffix.includes(host))));
  return m[1] === '|' || namesSite ? String(title).slice(0, m.index).trim() : String(title).trim();
};

const metaContent = (html, patterns) => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1] && match[1].trim()) return decodeEntities(match[1].trim());
  }
  return '';
};

/**
 * Extract the readable article from a news page.
 * @param {string} rawUrl
 * @returns {Promise<{title, content, description, source, url, extractedChars}>}
 */
// Publishers that block automated reading usually block clients that do not
// look like a browser, so the page is requested as one.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9'
};

/**
 * Second route to a page that refused us: a public reader service that fetches
 * the page and returns its text. It gets through some blocks and not others
 * (Reuters shows it a CAPTCHA), so anything that looks like an error page is
 * rejected.
 */
const readThroughReader = async (url, timeout = 7000) => {
  try {
    const { data } = await axios.get(`https://r.jina.ai/${url}`, {
      timeout, responseType: 'text', maxContentLength: MAX_BYTES, headers: { Accept: 'text/plain' }
    });
    const text = String(data || '');
    if (/Warning: Target URL returned error|CAPTCHA|Request blocked|Access Denied|403 ERROR/i.test(text.slice(0, 1500))) return null;
    const title = (text.match(/^Title:\s*(.+)$/m) || [])[1] || '';
    const published = (text.match(/^Published Time:\s*(.+)$/m) || [])[1] || '';
    const markdown = text.split(/^Markdown Content:\s*$/m)[1] || '';
    const paragraphs = markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // links keep their text
      .split(/\n\s*\n/)
      .map(p => p.replace(/[#*_>`|]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(p => p.length >= 60 && /[.!?]/.test(p));
    const content = paragraphs.join('\n\n').slice(0, 6000);
    if (!title || content.length < 200) return null;
    return { title: title.trim(), content, publishedAt: published.trim() || null };
  } catch {
    return null;
  }
};

/**
 * Last route: the headline. A blocked page's address usually spells out its
 * headline ("/india-cuts-fuel-prices-2026-10-09/"), and Google News lists the
 * real headline and date. A headline is enough to check what a story claims,
 * which is better than refusing the link outright.
 */
const headlineFromAddress = async (parsed) => {
  const segments = parsed.pathname.split('/').map(s => decodeURIComponent(s)
    .replace(/\.(html?|cms|php|aspx?)$/i, '')
    .replace(/-?\d{4}-\d{2}-\d{2}-?/g, '-'));
  const slug = segments
    .filter(s => (s.match(/-/g) || []).length >= 2)
    .sort((a, b) => b.length - a.length)[0];
  if (!slug) return null;
  const words = slug.split('-')
    .filter(w => w && !/^\d{5,}$/.test(w) && !/^[a-z0-9]{12,}$/i.test(w));
  if (words.length < 4) return null;
  const guess = words.join(' ');
  // Required lazily: newsFetcher does not depend on this file, and loading it
  // here at the top would make the two modules harder to test separately.
  const { searchGoogleNews } = require('./newsFetcher');
  try {
    const found = await searchGoogleNews(guess, '', 10);
    const wanted = new Set(words.map(w => w.toLowerCase()));
    // Only a headline from the same website counts: a similar headline from
    // another outlet is a different article, and crediting it to this link
    // would put words in the publisher's mouth.
    const site = parsed.hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
    let best = null;
    for (const item of found) {
      let itemSite = '';
      try { itemSite = new URL(item.sourceUrl).hostname.replace(/^www\./, '').split('.').slice(-2).join('.'); } catch { /* none */ }
      if (itemSite !== site) continue;
      const have = item.title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
      const overlap = have.filter(w => wanted.has(w)).length / wanted.size;
      if (overlap >= 0.6 && (!best || overlap > best.overlap)) best = { ...item, overlap };
    }
    if (best) return { title: best.title, source: best.source, publishedAt: best.publishedAt };
  } catch { /* fall through to the address itself */ }
  return { title: guess.charAt(0).toUpperCase() + guess.slice(1), source: null, publishedAt: null };
};

/**
 * @param {string} rawUrl
 * @param {{headlineFallback?: boolean, readerTimeout?: number}} [options] - the
 *        article page already holds the feed's snippet, so it skips the
 *        headline fallback and waits less for the reader service.
 */
const extractArticle = async (rawUrl, { headlineFallback = true, readerTimeout = 7000 } = {}) => {
  const parsed = await assertPublicUrl(rawUrl);

  let html;
  try {
    const response = await safeGet(parsed.href, {
      timeout: FETCH_TIMEOUT,
      maxBytes: MAX_BYTES,
      maxRedirects: 3,
      responseType: 'text',
      headers: BROWSER_HEADERS
    });
    html = String(response.data || '');
  } catch (err) {
    // The guard refusing a redirect into a private network is an answer, not
    // a page that failed to load: no fallback is tried on its behalf.
    if (isRefusal(err)) {
      const refused = new Error(err.message);
      refused.code = 'BAD_URL';
      throw refused;
    }
    const hostname = parsed.hostname.replace(/^www\./, '');
    // Both fallbacks start at once; the reader's text is preferred when it works.
    const headlinePromise = headlineFallback ? headlineFromAddress(parsed).catch(() => null) : Promise.resolve(null);
    const viaReader = await readThroughReader(parsed.href, readerTimeout);
    if (viaReader) {
      return {
        title: viaReader.title,
        content: viaReader.content,
        description: viaReader.content.slice(0, 300),
        source: { name: hostname },
        url: parsed.href,
        urlToImage: null,
        publishedAt: viaReader.publishedAt || new Date().toISOString(),
        publishedAtKnown: Boolean(viaReader.publishedAt),
        extractedChars: viaReader.content.length,
        readVia: 'reader'
      };
    }
    const headline = await headlinePromise;
    if (headline) {
      return {
        title: headline.title,
        content: headline.title,
        description: headline.title,
        source: { name: headline.source || hostname },
        url: parsed.href,
        urlToImage: null,
        publishedAt: headline.publishedAt || new Date().toISOString(),
        publishedAtKnown: Boolean(headline.publishedAt),
        extractedChars: headline.title.length,
        readVia: 'headline',
        readNote: `${hostname} does not allow its pages to be read automatically, so only the headline was checked.`
      };
    }
    // Many publishers block non-browser traffic outright. That is not the
    // reader's mistake, so say so plainly and let the caller still report
    // what it knows about the publisher.
    const blocked = new Error(
      `${hostname} does not allow its pages to be read automatically, so we cannot check this article's contents. Paste the article text or a screenshot instead.`
    );
    blocked.code = 'FETCH_BLOCKED';
    blocked.hostname = parsed.hostname;
    blocked.url = parsed.href;
    throw blocked;
  }

  if (!/<html|<body|<p[\s>]/i.test(html)) {
    const notArticle = new Error('That link does not appear to be a news article page.');
    notArticle.code = 'FETCH_FAILED';
    throw notArticle;
  }

  // Remove everything that is not article prose before collecting paragraphs.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ');

  // Scope to the page's own article container when it declares one.
  //
  // News templates ship unbalanced markup as a matter of course: the BBC
  // article page measured here has 76 <p> opens against 37 </p> closes. The
  // paragraph regex below is non-greedy, so a stray unclosed <p> up in the
  // site chrome runs on to the first real </p> and returns one "paragraph"
  // holding the whole navigation, the headline, the byline and the lede —
  // "Home News Sport Business Technology … Five men have been arrested". That
  // text is then what every content factor scores and what claim extraction
  // reads. Restricting the search to <article> or <main> costs nothing on
  // pages that have neither.
  const container = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const scoped = container && container[1].length > 500 ? container[1] : cleaned;

  // A paragraph may not span another paragraph tag. With the plain non-greedy
  // form, an unclosed <p> still absorbs whatever sits between it and the next
  // </p> — on the same BBC page that meant the share widget and byline were
  // glued to the front of the lede. Refusing to cross a <p> boundary leaves
  // the paragraph count unchanged and starts the text at the first real
  // sentence.
  const paragraphs = [...scoped.matchAll(/<p[^>]*>((?:(?!<\/?p[\s>])[\s\S])*?)<\/p>/gi)]
    .map(m => stripTags(m[1]))
    // Drop boilerplate lines: cookie notices, share prompts, bylines.
    .filter(text => text.length >= 60 && /[.!?]/.test(text));

  const content = paragraphs.join('\n\n').slice(0, 6000);

  const siteName = metaContent(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
  ]);

  const title = trimSiteName(metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  ]), siteName, parsed.hostname);

  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ]);

  const image = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ]);

  const publishedAt = metaContent(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ]);

  if (!title) {
    const noTitle = new Error('We could not read a headline from that page.');
    noTitle.code = 'FETCH_FAILED';
    throw noTitle;
  }
  // Fall back to the page description when paragraph extraction finds little
  // (common on sites that render the body with JavaScript).
  const bodyText = content.length >= 200 ? content : description;
  if (!bodyText || bodyText.length < 80) {
    const tooLittle = new Error('We could not read enough of that article to check it. Try opening the link and pasting a different one.');
    tooLittle.code = 'FETCH_FAILED';
    throw tooLittle;
  }

  return {
    title,
    content: bodyText,
    description: description || bodyText.slice(0, 300),
    source: { name: siteName || parsed.hostname.replace(/^www\./, '') },
    url: parsed.href,
    urlToImage: image || null,
    publishedAt: publishedAt || new Date().toISOString(),
    // Whether that date came from the page or is just "now". A guessed date
    // must not be allowed to stand in for a real one when the freshness of
    // the article decides whether an absence of coverage means anything.
    publishedAtKnown: Boolean(publishedAt),
    extractedChars: bodyText.length
  };
};

// assertPublicUrl is exported so anything else that fetches a third-party page
// (the fact-check reader, for one) reuses this guard rather than growing its
// own copy that could drift out of step.
module.exports = { extractArticle, assertPublicUrl, decodeEntities, MAX_BYTES, FETCH_TIMEOUT, __test: { decodeEntities, trimSiteName } };
