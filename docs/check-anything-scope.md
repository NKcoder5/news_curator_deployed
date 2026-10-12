# Check Anything: scope, evidence, dependencies and limits

This document records what the Check Anything page accepts, what it answers,
how those answers are reached and measured, which outside services it
depends on, and what it cannot do. It is the contract the evaluation suites
test against.

## 1. What it accepts

| Input | How it is read |
|---|---|
| Pasted text: a forwarded message, a caption, a typed claim | As written |
| A news article link | The article text, through the reader fallback when a site blocks automated reading |
| A YouTube link | The transcript, since the claim is in the speech |
| A screenshot of a post or message | Text read out by OCR; chat timestamps and "Forwarded" labels are removed |

Messages of any length, in any tone, and in these languages:

- **Tested in the suites:** English, Tamil, Hindi, and Tamil or Hindi typed in English letters (Tanglish, Hinglish).
- **Handled but not separately tested:** other Indian languages. Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi and Urdu are recognised by script, and the input-understanding step translates them.

## 2. How a message is read

Before any evidence is gathered, one input-understanding step (a hosted
language model at temperature 0) works out what the message asserts:

- the language, and whether it is typed in English letters;
- the kind of message: a statement, a question, something passed on ("I
  heard…"), sarcasm, an opinion, a call to action, a forecast, or a mix;
- its tone (alarmist, emotional, celebratory, sarcastic, urgent);
- up to three claims, each written as a neutral English sentence with its
  time frame (now, past, standing, future), its kind (event, figure, quote,
  standing fact), a headline, its subjects and search terms.

How each kind of message is handled:

| Kind of message | What is checked |
|---|---|
| Question ("Did India win 84 medals?") | The claim asked about, with a direct answer ("No — this is false") |
| Passed on ("I heard Modi resigned") | The claim passed on |
| Sarcasm ("Oh sure, and Musk bought Jio too") | The claim being mocked |
| Negation ("TVK did not lose") | The claim exactly as stated, negation kept |
| Opinion with a fact inside it | The fact only |
| Pure opinion, forecast, call to action, vague text | Refused, with the reason and what is missing |
| A scheduled action stated as settled ("power cut from tomorrow") | The claim that it was announced |

If this step fails, the earlier rule-based gate and claim extractor decide,
so the page still works, less well.

## 3. What it answers

| Answer | When |
|---|---|
| **REAL** | Independent outlets confirm it, a fact-checking desk rated it true, or a reference work states a standing fact |
| **FAKE** | Outlets report otherwise, fact-checkers rated it false, this week's news rules it out, a premise is contradicted by a reference work, or it is old news shared as new |
| **PARTLY FALSE** | One claim in the message is confirmed and another contradicted, or a true claim carries one this week's news rules out |
| **CANNOT VERIFY** | Nothing bears on it either way, or only part of the message is confirmed |
| **Refused** | Nothing in it can be checked; the reason is given |
| **SATIRE** | It comes from a satirical publisher |

Every answer names the rule that decided it and the evidence that rule acted
on. The verdict comes from fixed rules over that evidence, never from a
model's opinion of the claim.

## 4. Where the evidence comes from

| Channel | Source | What it settles |
|---|---|---|
| News reporting | Google News (live, Indian edition), with NewsAPI as fallback; headlines judged one by one, with independent outlets counted as one source per owner or wire story | Did this event happen, with these figures? |
| Fact-checkers | Google's ClaimReview index (Fact Check Explorer), and Google News fact-check headlines | Has a professional desk already ruled on this exact claim? |
| This week's news on the subject | Google News, last seven days, for each subject of the claim | Does current coverage only make sense if the claim is false? Is a story that would dominate the week missing? |
| Reference facts | Wikipedia | Is a stated premise about a named person or body wrong, or is a standing fact right? |
| Writing checks | Language model, with measured likelihood ratios (ISOT) | How the text is written; can lower trust, never raise it |

## 5. How it is measured

| Evaluation | Cases | Result |
|---|---|---|
| Robustness suite: questions, hedges, forwards, sarcasm, negation, opinion, several claims, units, typos, Tamil, Tanglish, Hindi, old news, standing facts, quotes, local news, predictions, vague text, long text, links | 55 | Before the input-understanding step: 37 right, 15 wrong. After: 53 right, 2 acceptable refusals, 0 wrong |
| Held-out suite: new topics and phrasings, written after tuning and run once before any change | 27 | 24 right on first sight; the three misses were then fixed (see the latest re-run in `backend/eval/results/`) |
| Against a plain language model: the same Gemini model asked zero-shot with no evidence | 22 | Plain model 13 right, calling 5 of 9 true stories fake; Check Anything 22 right |
| Writing checks on the ISOT corpus | see `docs/measurements.md` | |

Run them with:

```bash
cd backend
node eval/robustnessSuite.js --out latest
node eval/robustnessSuite.js --suite heldout --out heldout
node eval/benchmarkCheckAnything.js
```

The claims concern October 2026 news. Their labels hold for the following
weeks; to re-run later, refresh the claims from that week's news.

## 6. What it depends on, and what happens when each fails

| Dependency | If it fails |
|---|---|
| Google News RSS | NewsAPI is tried; if both fail, the answer says the search could not run (never "no coverage") |
| Fact Check Explorer | The official Fact Check API is used if `FACT_CHECK_API_KEY` is set; Google News fact-check headlines still run |
| Hosted language model (Gemini) | Six Gemini models are tried in turn, each with its own daily quota; a model whose quota is spent is skipped until it resets (12:30 IST); then NVIDIA NIM; then the local model (Ollama) |
| Local model (Ollama) | The writing checks fall back to word-pattern checks and say so |
| Wikipedia | The reference channel reports that it could not run |

The free Gemini quota is per Google Cloud project. Extra keys from other
projects add a full day's quota each:

```
GEMINI_API_KEY=first-key
GEMINI_EXTRA_KEYS=second-key,third-key
```

A check uses about five hosted-model calls. Judgements made at temperature 0
are remembered for 30 minutes, so repeating a check costs nothing.

### Why it depends on outside sources at all

A classifier trained on a labelled corpus runs on its own, but what it learns
is how fake articles are *written*. It cannot know whether India won 84 or 85
medals at the 2026 Asian Games, because that fact is not in the text. The
writing checks here are such a classifier, measured on ISOT, and by design
they can only lower trust. Settling whether an event happened needs evidence
from outside the message. That is true of every fact-checker, human or
machine, and it is why the dependencies above each have a fallback rather
than being removed.

### Why published systems look complete

Research systems are evaluated on closed tasks:

- **FEVER:** claims against a 2017 Wikipedia dump.
- **LIAR:** PolitiFact statements.
- **AVeriTeC:** claims paired with a fixed evidence set.
- **DEFAME:** reports results on such benchmarks.

Fixing the inputs and the evidence is what makes a result reportable.
Check Anything works on open input against live evidence, so the evaluation
here fixes the input contract (section 1) and measures against it (section 5).

## 7. What it cannot do

- **Events from the last hour or so,** before outlets have published: these are not yet covered, and the answer says so.
- **Purely local events with no online coverage:** answered CANNOT VERIFY.
- **Voice notes and audio:** not read.
- **Edited or AI-generated images and video:** not analysed directly. A viral deepfake is still caught when fact-checkers have ruled on it, as with the Army chief video.
- **Paywalled pages:** only the headline is read, and the page says so.
- **Languages beyond those in section 1:** best effort.
- **On a day the hosted-model quota is spent:** answers come from the slower fallback models, at 60 to 110 seconds a check instead of about 10.
