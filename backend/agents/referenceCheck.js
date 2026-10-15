// backend/agents/referenceCheck.js
//
// Checking an article's PREMISES, as opposed to its events.
//
// Cross-source verification asks whether other newsrooms report the same event.
// That is the right question, and it has a blind spot: a news index only covers
// what was recently published, so a claim resting on a false premise sails
// through it. "Prime Minister Rahul Gandhi announced a new scheme" describes an
// event no outlet reports — which our pipeline correctly calls unconfirmed —
// when the real finding is that the premise is wrong, and a reference work
// settles it in one lookup.
//
// This is the gap. "Cannot verify" is by far our most common outcome, and a
// large share of it is claims about STABLE facts rather than events: who holds
// an office, when an organisation was founded, whether a treatment is approved.
// A news search cannot answer those. Wikipedia can.
//
// The division of labour is deliberate and the two are not merged:
//
//   news search  -> did this EVENT happen?        (independent outlets)
//   this module  -> are the article's PREMISES right?  (a reference work)
//
// Wikipedia is not an independent newsroom and is never counted as one. A
// Wikipedia article agreeing that a minister exists does not corroborate a story
// about what the minister did. It is used only in the direction where it is
// strong: catching a stated fact about a known entity that the reference work
// flatly contradicts.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { fetchWikipediaContent } = require('../utils/wikipedia');
const { findAnchors, STOPWORDS, SENTENCE_OPENERS } = require('./checkability');
const { judgePairs } = require('../services/localNli');

// A contradiction found by a language model stands only if our own pair model
// (services/localNli.js, fine-tuned for exactly this) also reads the quoted
// reference sentence as contradicting what the message states. Measured on
// 13 Oct: three true claims were called FAKE on contradictions a fallback
// model invented ("Nana Patekar died in Goa" against an entry giving his
// death date); our model gives each of them a contradiction probability of
// 0.00-0.01, and the real ones ("Chennai is the capital of Karnataka",
// "Rahul Gandhi is the Prime Minister") 0.86-1.00. Without the model files
// (CI, a fresh clone) the model's opinion is absent and nothing is filtered.
// The bar is low on purpose: at 0.5 it also vetoed real contradictions the
// model reads less surely ("Humans have three hearts" against "the heart is
// divided into four chambers", 0.10), while the invented ones all scored
// 0.015 or less.
const SECOND_OPINION_MIN = 0.05;
const secondOpinion = async (contradictions) => {
  if (!contradictions.length) return { kept: contradictions, overruled: [] };
  const pairs = contradictions.map(c => ({ premise: c.referenceStates || '', hypothesis: c.articleStates || '' }));
  let verdicts = null;
  try { verdicts = await judgePairs(pairs); } catch (_) { verdicts = null; }
  if (!Array.isArray(verdicts) || verdicts.length !== contradictions.length) return { kept: contradictions, overruled: [] };
  const kept = [];
  const overruled = [];
  contradictions.forEach((c, i) => {
    const v = verdicts[i];
    const pCon = v && v.scores ? v.scores.contradiction : null;
    if (pCon === null || pCon >= SECOND_OPINION_MIN || !c.referenceStates || !c.articleStates) kept.push({ ...c, ownModel: pCon });
    else overruled.push({ ...c, ownModel: pCon });
  });
  return { kept, overruled };
};
const { UNTRUSTED_NOTICE, fence, asBool, oneOf, clip } = require('../utils/untrusted');

/** How many entities to look up. Each costs one search plus one extract. */
const MAX_ENTITIES = 2;

// Titles and honorifics attach to names and are not names themselves. Left in,
// "Prime Minister Rahul Gandhi" retrieves the encyclopedia's article on the
// OFFICE of prime minister, which says nothing about the person and wastes the
// lookup. Stripped, the same phrase retrieves the person.
const TITLES = /^(prime |chief |deputy |vice |former |ex[- ])?(minister|president|secretary|justice|governor|mayor|commissioner|director|chairman|chairperson|professor|doctor|dr|mr|mrs|ms|sir|lord|general|colonel|captain|inspector|officer|spokesperson|leader)\b/i;

const PREPOSITIONS = /^(of|in|for|at|to|from|the|a|an)\s+/i;

const stripTitle = (name) => {
  let stripped = String(name).trim();
  // Applied repeatedly: "Prime Minister Rahul Gandhi" sheds "Prime Minister"
  // in two passes, not one.
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(TITLES, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  while (PREPOSITIONS.test(stripped)) {
    stripped = stripped.replace(PREPOSITIONS, '').trim();
  }
  return stripped;
};

// Days and months are capitalised and are not subjects to look up.
const CALENDAR = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/i;

/**
 * Which entities are worth the lookup?
 *
 * Ranking by length alone picks the longest name, which is routinely an
 * incidental one — in "Prime Minister Rahul Gandhi announced ... Meera Krishnan
 * attended", it chose Meera Krishnan and dropped the subject of the sentence.
 * What the article is ABOUT is what needs checking, and the headline is the
 * best available statement of that, so a name appearing there outranks
 * everything else; failing that, the earlier a name appears the more central it
 * usually is.
 */
const rankEntities = (names, title = '') => {
  const headline = String(title).toLowerCase();
  const cleaned = [];
  const seen = new Set();

  names.forEach((raw, position) => {
    const name = stripTitle(raw);
    // What remains after the title is removed must still be a name: a phrase
    // that was ONLY a title has nothing to look up.
    if (name.length <= 3 || TITLES.test(name) || CALENDAR.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push({ name, position, inTitle: headline.includes(key) });
  });

  return cleaned
    .sort((a, b) =>
      (b.inTitle - a.inTitle) ||
      (a.position - b.position) ||
      (b.name.length - a.name.length))
    .slice(0, MAX_ENTITIES)
    .map(entry => entry.name);
};

/**
 * Group adjacent capitalised words into one name, so "Rahul Gandhi" is looked
 * up as a person rather than as "Rahul" and "Gandhi" separately.
 */
const groupNames = (text) => {
  // Initials and title abbreviations like "C. Joseph Vijay" or "Dr. Ambedkar"
  // carry periods that must not split sentences or fragment names.
  const protectedText = String(text || '')
    .replace(/\b([A-Z])\.\s+/g, '$1\u2024 ')
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|Gov|Gen|Col|Capt|Lt|Maj|Sgt|St)\.\s+/gi, '$1\u2024 ');

  const grouped = [];
  for (const sentence of protectedText.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    let run = [];
    words.forEach((word, index) => {
      const restored = word.replace(/\u2024/g, '.');
      const clean = restored.replace(/[^\p{L}\p{N}\p{M}.]/gu, '');
      const cleanNoDot = clean.replace(/\./g, '');
      const isInitial = /^[A-Z]\.?$/.test(clean);
      const isCap = /^\p{Lu}/u.test(clean);

      let isName = false;
      if (isInitial && cleanNoDot.length === 1) {
        isName = true;
      } else if (cleanNoDot.length > 2 && isCap) {
        if (index > 0) {
          isName = true;
        } else {
          const lower = cleanNoDot.toLowerCase();
          if (!STOPWORDS.has(lower) && !SENTENCE_OPENERS.has(lower)) {
            isName = true;
          }
        }
      }

      if (isName) {
        run.push(clean.replace(/\.+$/, ''));
      } else {
        if (run.length) grouped.push(run.join(' '));
        run = [];
      }
    });
    if (run.length) grouped.push(run.join(' '));
  }
  return [...new Set(grouped)];
};


/**
 * Does a reference work contradict what this article says about the entities
 * it names?
 *
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{status: string, checked: Array, contradictions: Array, explanation: string}>}
 */
const checkPremises = async (title, content, subjects = []) => {
  const text = `${title}. ${content || ''}`;
  const anchors = findAnchors(text);
  // A general fact has no proper name ("Giraffe is a fish", "The sun rises in
  // the west"); the subject the message-reading step found is looked up.
  const given = [...new Set((subjects || []).map(s => String(s || '').trim()).filter(s => s.length > 1))].slice(0, 2);
  if (anchors.names.length === 0 && !given.length) {
    return { status: 'no-entities', checked: [], contradictions: [], explanation: 'This article names no person or organisation to look up.' };
  }

  // Both: "Chennai is the capital of Tamil Nadu and the giraffe is a fish"
  // names Chennai in capitals, and the giraffe was never looked up.
  const named = anchors.names.length ? rankEntities(groupNames(text), title) : [];
  const seen = new Set(named.map(e => String(e).toLowerCase()));
  const entities = [...named, ...given.filter(g => !seen.has(g.toLowerCase()))].slice(0, 3);
  if (entities.length === 0) {
    return { status: 'no-entities', checked: [], contradictions: [], explanation: 'This article names no person or organisation to look up.' };
  }

  try {
    const lookups = await Promise.all(entities.map(async (entity) => {
      // A lookup that could not run is marked, not silently emptied: the
      // reference work having no entry for someone is a fact about the
      // reference work, while being unable to ask it is a fact about us.
      let articles;
      try {
        articles = await fetchWikipediaContent(entity, 1);
      } catch (err) {
        return { entity, lookupFailed: true };
      }
      if (!articles.length || !articles[0].content) return null;
      return { entity, reference: articles[0] };
    }));

    const found = lookups.filter(l => l && l.reference);
    if (found.length === 0) {
      // Every lookup failing means the reference work was unreachable, not
      // that none of these names has an entry.
      if (lookups.every(l => l && l.lookupFailed)) {
        return {
          status: 'error',
          checked: [],
          contradictions: [],
          explanation: 'The reference work could not be reached, so the article’s premises were not tested.'
        };
      }
      return { status: 'not-found', checked: [], contradictions: [], explanation: 'No reference entry was found for the names in this article.' };
    }

    const results = await Promise.all(found.map(async ({ entity, reference }) => {
      const judgement = await judgeAgainstReference(title, content, entity, reference);
      return { entity, reference: { title: reference.title, url: reference.url }, ...judgement };
    }));

    const { kept: contradictions, overruled } = await secondOpinion(results.filter(r => r.contradicts));
    const confirmations = results.filter(r => r.supports && !r.contradicts)
      .map(r => ({ entity: r.entity, reference: r.reference, referenceStates: r.referenceSupports }));
    const failures = results.filter(r => r.failed);

    // A judgement that could not run is not a judgement that found nothing.
    // Treating the two alike would report "we checked this subject and it was
    // consistent" about a lookup that never completed — the same error this
    // project removes everywhere else, and the reason the identical article can
    // come back contradicted on one run and unverified on the next when the
    // model provider is rate-limiting.
    if (failures.length === results.length) {
      return {
        status: 'error',
        checked: results,
        contradictions: [],
        explanation: 'The reference check could not be completed, so the article’s premises were not tested.'
      };
    }

    return {
      status: contradictions.length ? 'contradicted' : 'consistent',
      checked: results,
      contradictions,
      confirmations,
      // Contradictions our own model did not see in the quoted sentence; shown
      // for transparency, never counted.
      overruled: overruled.map(c => ({ entity: c.entity, articleStates: c.articleStates, referenceStates: c.referenceStates, ownModel: c.ownModel })),
      partialFailure: failures.length > 0,
      explanation: contradictions.length
        ? `A reference entry contradicts what this article states about ${contradictions.map(c => c.entity).join(' and ')}.`
        : `Checked ${results.length - failures.length} named ${results.length - failures.length === 1 ? 'subject' : 'subjects'} against reference entries and found nothing contradicted`
          + (failures.length ? `; ${failures.length} could not be checked.` : '.')
    };
  } catch (err) {
    // Consistent with the rest of the pipeline: a check that could not run
    // contributes nothing, and says so, rather than guessing.
    return { status: 'error', checked: [], contradictions: [], explanation: 'The reference check could not run.' };
  }
};

/**
 * Ask the model one narrow question over retrieved text.
 *
 * The framing matters. A reference entry will be silent about almost everything
 * an article says — it is an encyclopaedia, not a newswire — and silence must
 * not read as disagreement. Only a DIRECT conflict counts, and the model has to
 * quote the reference text that conflicts, so the claim can be checked rather
 * than taken on trust.
 */
const judgeAgainstReference = async (title, content, name, reference) => {
  // The subject is a run of capitalised words from the article (groupNames
  // keeps letters and digits only), so it carries no punctuation or role
  // label; it is still the article's wording, so it is kept short.
  const entity = String(name).slice(0, 80);
  const prompt = `You are checking whether an encyclopedia entry CONTRADICTS a news article's stated facts about one subject.

${UNTRUSTED_NOTICE}

Subject: ${entity}

Encyclopedia entry:
${fence(reference.content, { label: 'encyclopedia entry', max: 1200 })}

News article:
${fence(`Title: ${title}\nText: ${String(content || '').slice(0, 900)}`, { label: 'article', max: 1300 })}

First decide whether the entry is even about the same ${entity} the article means. Names are shared: a local council officer, a cricketer and an actress can carry the same name, and an entry about one of them says nothing about another. If the entry describes a person or thing in a plainly different walk of life from the one the article describes, they are different subjects and there is no contradiction.

The encyclopedia will not mention most of what the article says. That is normal and is NOT a contradiction. Answer "contradicts": true ONLY when the entry is about the SAME subject AND states something that directly conflicts with a fact the article asserts about ${entity} — for example a different office holder, a different date, a different organisation, a different place ("The Taj Mahal is in Chennai" against an entry placing it in Agra), or a different kind of thing ("Giraffe is a fish" against an entry calling giraffes mammals). The "article" may be a single sentence stating a general fact; judge that sentence the same way.

Return a JSON object with these keys:
- "same_subject": true when the entry is about the same ${entity} the article means, false when it is a different person or thing that happens to share the name.
- "contradicts": true or false.
- "both_can_be_true": true when the article's statement and the entry could both be true of the same ${entity} at once, false only when accepting one means rejecting the other. Being born in one place and having ancestors from another can both be true; holding an office and never having held it cannot.
- "asserted_by": "article" when the article states the fact in its own voice, "quoted" when it is only something a person interviewed or quoted in the article says.
- "article_states": what the article says about ${entity}, in one short sentence.
- "reference_states": the conflicting sentence copied exactly from the encyclopedia entry, or an empty string when there is no conflict.
- "supports": true when the entry is about the same ${entity} and directly states the same fact the article asserts about it (the same office, capital, date, title or result), false otherwise. Mentioning the subject is not support; stating the fact is.
- "reference_supports": the sentence that states it, copied exactly from the entry, or an empty string.`;

  try {
    // The hosted model this task is routed to reasons in prose before it
    // answers — about 2,000 characters on this prompt, measured — and at 450
    // tokens three replies in four were cut off before the JSON began. The
    // judgement then counted as failed, the headline subject went unchecked,
    // and a false premise the channel exists to catch got through on one run
    // in five. The budget has to cover the reasoning, not just the answer.
    const result = await callNimApiJson(prompt, { maxTokens: 1400, requiredKeys: ['contradicts', 'both_can_be_true'], label: 'premise check' });

    // A name is not an identity.
    //
    // The adversarial set contains a genuine article quoting a council
    // transport secretary named Meera Krishnan. The lookup resolved that to the
    // encyclopedia entry for Meera Krishnan the actress, and the judge duly
    // reported a contradiction: the article calls her a transport secretary,
    // the entry calls her an actress. Both statements are true about different
    // people, and the system condemned a genuine article on the strength of a
    // shared name. Refusing to accuse when the subjects differ is the whole
    // point of the asymmetry this project rests on, so a contradiction is only
    // admitted once the model has confirmed it is talking about one person.
    //
    // Every field below is read strictly: Boolean("false") is true, so a reply
    // saying "contradicts": "false" beside a quoted sentence used to count as
    // a contradiction.
    const sameSubject = asBool(result?.same_subject);
    const contradicts = asBool(result?.contradicts) === true;
    const bothCanBeTrue = asBool(result?.both_can_be_true);
    const assertedBy = oneOf(result?.asserted_by, ['article', 'quoted'], null);
    const articleStates = clip(result?.article_states, 300);
    if (sameSubject === false) {
      return { contradicts: false, differentSubject: true,
        article_states: articleStates,
        reference_states: '' };
    }

    // Difference is not contradiction, and a quotation is not the report.
    //
    // Measured on a genuine Associated Press video of the Pope's mass at
    // Lourdes: a woman interviewed in French says the Pope is "our compatriot,
    // since his ancestors come from" the region. In one run of eight the judge
    // set that against "Born in Chicago" in his entry and reported a
    // contradiction, and the report was called FAKE. Ancestry in France and
    // birth in Chicago are both true, and a bystander's remark is not something
    // the report asserts. An accusation now needs statements that cannot both
    // hold, made in the article's own voice.
    // Support needs the same grounding as contradiction: the sentence quoted
    // must actually be in the entry.
    const supportQuote = clip(result?.reference_supports, 600);
    const supportGrounded = asBool(result?.supports) === true && supportQuote.length > 10
      && String(reference.content).toLowerCase().includes(supportQuote.slice(0, 40).toLowerCase());
    if (result && (bothCanBeTrue !== false || assertedBy === 'quoted')) {
      return { contradicts: false, supports: supportGrounded && !contradicts, referenceSupports: supportGrounded ? supportQuote : '',
        compatible: bothCanBeTrue !== false,
        quotedOnly: assertedBy === 'quoted',
        articleStates, referenceStates: '' };
    }

    const referenceStates = clip(result.reference_states, 600);

    // The model must ground a contradiction in the reference text. An assertion
    // with no quotation behind it, or a quotation that is not actually in the
    // entry, is discarded — the same rule the news evidence is held to.
    const quoted = referenceStates.length > 10
      && String(reference.content).toLowerCase().includes(referenceStates.slice(0, 40).toLowerCase());

    return {
      contradicts: contradicts && quoted,
      articleStates,
      referenceStates: quoted ? referenceStates : '',
      ungrounded: contradicts && !quoted
    };
  } catch (_) {
    return { contradicts: false, articleStates: '', referenceStates: '', failed: true };
  }
};

module.exports = { checkPremises, groupNames, rankEntities, MAX_ENTITIES };
