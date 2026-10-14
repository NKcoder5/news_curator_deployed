// backend/utils/factCheckDesks.js
//
// Whether a submitted page is a recognised fact-checking desk's own article.
// Such a page quotes a rumour in order to rule on it; agents/verdictEngine.js
// (rule R0a) must not hold the rumour against the page.

// Where the recognised desks publish (IFCN signatories and the fact-check
// sections of major newsrooms): host, and the path a section lives under.
const DESK_PAGES = [
  ['factcheck.org', 'FactCheck.org'], ['snopes.com', 'Snopes'], ['politifact.com', 'PolitiFact'],
  ['fullfact.org', 'Full Fact'], ['leadstories.com', 'Lead Stories'], ['healthfeedback.org', 'Health Feedback'],
  ['science.feedback.org', 'Science Feedback'], ['africacheck.org', 'Africa Check'], ['checkyourfact.com', 'Check Your Fact'],
  ['factcheck.afp.com', 'AFP Fact Check'], ['logicallyfacts.com', 'Logically Facts'], ['altnews.in', 'Alt News'],
  ['boomlive.in', 'BOOM'], ['factly.in', 'Factly'], ['newschecker.in', 'Newschecker'], ['vishvasnews.com', 'Vishvas News'],
  ['newsmeter.in', 'NewsMeter'], ['factcrescendo.com', 'Fact Crescendo'], ['youturn.in', 'YouTurn'], ['dfrac.org', 'DFRAC'],
  ['digiteye.in', 'Digiteye India'], ['thequint.com/news/webqoof', 'The Quint WebQoof'],
  ['indiatoday.in/fact-check', 'India Today Fact Check'], ['newsmobile.in/nm-fact-checker', 'NewsMobile Fact Checker'],
  ['thelogicalindian.com/fact-check', 'The Logical Indian Fact Check'], ['reuters.com/fact-check', 'Reuters Fact Check'],
  ['apnews.com/article/fact-check', 'AP Fact Check'], ['usatoday.com/story/news/factcheck', 'USA Today Fact Check']
];

/** The desk that published a page, when the page is a recognised desk's fact-check; otherwise null. */
const factCheckDeskOf = (url) => {
  let where;
  try {
    const u = new URL(String(url || ''));
    where = u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.toLowerCase();
  } catch (_) { return null; }
  const hit = DESK_PAGES.find(([prefix]) => where === prefix || where.startsWith(prefix.includes('/') ? prefix : `${prefix}/`)
    || (!prefix.includes('/') && where.split('/')[0].endsWith(`.${prefix}`)));
  return hit ? hit[1] : null;
};

// Words that make a sentence deny what it describes: "Walmart Hasn't Adopted
// 'Staggered Shopping'", "Posts falsely suggest that water kills the virus",
// "Viral Social Media Posts Offer False Coronavirus Tips".
const DENIAL = /\b(?:not|no|never|false(?:ly)?|fake|hoax|myth|misleading|wrong(?:ly)?|debunk\w*|untrue|baseless|fabricated|doctored|morphed)\b|n['’]t\b/i;

/** Whether a sentence denies what it describes. */
const denies = (text) => DENIAL.test(String(text || ''));

module.exports = { factCheckDeskOf, denies, DESK_PAGES };
