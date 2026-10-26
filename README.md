# 🛡️ AI-Powered News Trust and Credibility Analysis Platform

## 📖 Project Overview

Most fake-news detectors answer one question — "Fake or Real?" — with no reasons and no evidence. The obvious improvement is to score the article on many signals instead of one. We built that, and then found the flaw in it.

**Scoring how an article is written measures the wrong thing.** The calm tone, the plain headline, the named sources, the absence of clickbait — all of it is controlled by whoever wrote the text. A fabricated story composed in ordinary newsroom style scores *well*, and inventing a quote from a named professor actually raises its score. We measured this on our own pipeline: invented articles averaged **7.3/10**, and four of six deceptive items were shown to the reader as credible.

Worse, the old design made this systematic. When no other outlet could be found reporting a story, the cross-source check withdrew and handed its weight to the remaining checks — so the *absence of corroboration increased* the influence of exactly the signals a fabricator controls.

The mistake underneath it is treating this as ordinary classification. In ordinary classification the features come from nature. Here **the adversary writes the features**, and that changes what a feature is worth:

> **An observation the author controls can incriminate an article, but can never exonerate it.**
>
> A crude headline is evidence of fabrication — genuine outlets rarely write that way. A polished headline is *not* evidence of genuineness, because a competent fabricator simply writes a polished headline. Any corpus of crude fakes teaches the opposite, and doesn't contain the counter-examples that would correct it.

So the scoring was rebuilt from scratch. Every observation now contributes a **likelihood ratio measured from labelled data** — not a weight somebody picked — and the output is **P(fake news)**, a probability that means something outside our own code.

| | Old | New |
|---|---|---|
| Weights | `0.15·source + 0.10·headline + …`, chosen by hand | Likelihood ratios estimated from 1,642 labelled articles |
| Output | 6.4 / 10 — a number with no referent | P(fake) = 0.21 — checkable against outcomes |
| Combining | Weighted mean (compensatory) | Additive log-odds in decibans (auditable, they sum) |
| Uninformative check | Still contributed its weight | Ratio = 1 → contributes exactly 0 |
| Unmeasured check | Got an invented weight | Contributes 0, and is named in the report |

Alongside the probability, a deterministic rule set issues a **verdict** — Corroborated, Likely true, Unverified, Commentary, Satire, Likely false, False — with the rule that fired and the grounds. An article nobody else reports cannot be called trustworthy however well it is written.

---

## 🎯 Problem Statement

Existing systems have several limitations:

* They only classify news as Fake or Real, with no reasons and no evidence.
* They do not check whether anyone independent reports the same thing.
* When they do check, they **count articles instead of sources** — eight papers running one Reuters wire look like eight confirmations.
* They have no defined behaviour when a check finds nothing, so "we could not verify this" and "this passed" look identical.
* Their confidence scores are often dishonest — a system may say "90% sure" while being right 60% of the time.
* They assume English, and they assume the input is an article rather than a video, a screenshot or a forwarded message.

---

## 🚀 Our Solution

### The evidence ledger

Every analysis shows its arithmetic. Decibans add up, so you can check the total by hand — which is the entire reason for using them instead of a blended score nobody can reproduce.

```
Before reading the article        -7.53 db   unrated publisher
clickbait        (scored 9.0)         0 db   ← author-controlled: cannot count in its favour
bias             (scored 9.0)         0 db   ← author-controlled
persuasion       (scored 9.5)         0 db   ← author-controlled
transparency                          0 db   ← no likelihood ratio measured yet
Independent corroboration         +1.66 db   nothing found — weak evidence only
                                 ─────────
Total                             -5.87 db   →  P(fake news) = 21%
```

The same article, with two independent outlets corroborating it, comes out at **0.6%**. Identical prose, identical publisher — a **110× swing**, driven entirely by evidence. That is the design working.

Three properties fall out of the arithmetic rather than from special cases in the code:

- **An uninformative check contributes exactly nothing.** A likelihood ratio of 1 is 0 decibans. Abstention stopped being a code path and became arithmetic.
- **An unmeasured check contributes nothing** — and is named in the report. Transparency has only 18 labelled examples, so it currently scores 0 db and says so, instead of the invented 0.18 weight it used to carry.
- **The four content checks are 1.2 factors, not four.** Measured correlation r = 0.78. The old design counted one piece of evidence four times; their summed weight is now scaled accordingly.

### 🏛️ 1. Source Reputation

Checks the outlet against a curated database of 90 rated sources.

For social content there is a second rule: an account is not a publisher. A known newsroom's own channel inherits that newsroom's record; an anonymous account does **not** inherit the neutral 5/10 that an unrated newspaper gets, because there is no masthead, correction policy or accountability behind it.

### 📰 2. Headline Quality (Clickbait Detection)

Analyzes the headline for clickbait patterns:

* Exaggerated or sensational wording
* Curiosity-gap phrasing ("You won't BELIEVE...")
* Fear-mongering and emotional manipulation

### ⚖️ 3. Bias & Language Analysis

Reads the article content and **highlights the exact sentences** that show:

* Political bias
* One-sided reporting
* Sensationalism and emotional manipulation

Each flagged sentence comes with the reason it was flagged.

### 🔍 4. Source Transparency

Asks a question the other content checks cannot: **could a reader go and verify any of this?**

Runs a five-point journalism checklist — does the article name its sources, use attributed quotes, point to primary evidence, give concrete detail, and keep its claims measured? It also quotes back the unattributable phrases the article leans on, such as *"experts say"* or *"sources close to the investigation"*.

This is the one content check that stays informative for an obscure story that no other outlet has covered.

### 🎭 5. Persuasion Techniques

Goes beyond "this is biased" to name **which rhetorical technique** is being used, quoting the article's own words.

Follows the propaganda-technique literature (SemEval-2020 Task 11): loaded language, appeal to fear, name calling, false dilemma, whataboutism, bandwagon, thought-terminating clichés and more — each with the effect it has on the reader.

### 🔄 6. Cross-Source Verification — counted in *sources*, not articles

Extracts the article's factual claims, searches what other outlets reported, and judges stance over that retrieved coverage only. Then comes the part most systems skip.

**Eight articles are usually not eight confirmations.** Before anything is counted, retrieved coverage is collapsed by three deterministic rules:

| Rule | Example |
|---|---|
| Common ownership | Vox and The Verge → one source. Wired and Ars Technica → one source. NBC and Sky → one source. |
| Agency syndication | Five papers carrying `NEW DELHI (Reuters) –` → one source |
| Near-duplicate headline | Unattributed reprints, matched at 75% token overlap → one source |
| Same state apparatus | RT and Sputnik → one source |

Every merge is shown to the reader with its reason. The ownership model is in [`backend/data/ownership.json`](backend/data/ownership.json) — 70 media groups, hand-curated. **No API supplies this; it is the project's own.**

**The model is also not allowed to decide relevance.** It will happily cite coverage that has nothing to do with the claim — on our adversarial set an invented "secret chemical leak" was reported as *supported* by real articles about an unrelated evacuation. Evidence must now share an **anchor** with the claim (a place, name or number), checked deterministically after the model has spoken. Evidence that fails is discarded and the claim falls back to unverified.

### ⚖️ The verdict

Nine ordered rules over the evidence produce one of seven verdicts. Each states the rule that fired, the grounds, and a confidence derived only from how much independent evidence exists:

| Verdict | When | Score ceiling |
|---|---|---|
| **False** | ≥2 independent sources contradict it | 2.0 |
| **Likely false** | 1 independent contradiction, **or** an uncorroborated high-impact claim with several warning signs | 3.5 |
| **Satire** | The publisher is a satirical outlet | 4.0 |
| **Unverified** | Checkable claims, nothing found either way | 4.9 |
| **Commentary** | No checkable factual claim — it is argument, not reporting | 6.4 |
| **Likely true** | 1 independent source confirms | 8.0 |
| **Corroborated** | ≥2 independent sources confirm | 10 |

One necessary exception, written into the rules: an exclusive from an outlet rated 8.5+ relaxes the unverified ceiling to 6.4. A Reuters scoop nobody has matched yet is not the same object as an anonymous blog's claim — though neither is confirmed.

## 🔎 A note on professional fact-check matching

A seventh factor matched an article's claims against verdicts published by
professional fact-checkers (Snopes, PolitiFact, Full Fact and other IFCN
signatories). **It is implemented and tested, but not part of the running
pipeline.** Both routes to that evidence proved impractical:

| Route | Status |
|---|---|
| Google Fact Check Tools API | Requires a billing-enabled Google Cloud account |
| ClaimReview read from the fact-checker's own page | Works, but the only way to find the right page is the news search — and the free news tier allows **100 requests per 24 hours in total**, a budget the article feed and cross-source verification already depend on |
| Searching the fact-checkers directly | Tested and unusable: Snopes, PolitiFact and Full Fact all render search results in JavaScript, so there is nothing to read from the HTML |

Rather than spend the feed's request budget on a check with thin coverage, the
factor was retired and its weight redistributed across the remaining six. The
score is unaffected: in every cached report the factor had already stood down at
zero weight.

`backend/agents/factCheckAgent.js` and `backend/utils/claimReviewReader.js` are
kept, working and unwired. Both were verified end to end — given a claim Snopes
had rated, the reader retrieved the page, read `"False"` out of its ClaimReview
markup and cited the URL, and a claim on the same topic but a different assertion
was correctly rejected rather than matched. To switch it back on: obtain a Fact
Check Tools key, set `FACTCHECK_API_KEY`, then re-add the import, a weight and the
factor entry in `trustAnalysisAgent.js`.

## 🌍 Any language

Language is identified **locally** — by script and function-word frequency, no model call and no network — across 15 languages and 9 scripts, including Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Urdu, Arabic, Chinese, Japanese, Korean and Russian.

Two things follow:

1. **Analysis happens in the article's own language**, and flagged sentences are quoted back untranslated — otherwise the highlight would point at a sentence the article does not contain.
2. **Claims are searched in the original language *and* in English.** This is what makes verification work outside English at all: an English-only search finds nothing for a Tamil report and concludes, wrongly, that nobody else covers the story. A Tamil claim confirmed by an English outlet is genuinely independent evidence — arguably more so than a same-language reprint.

## 📱 Any input, not just articles

A reader rarely meets a claim as a news article. `POST /api/ai/analyze-content` takes:

| Input | How it is read |
|---|---|
| **YouTube link** | Transcript, via YouTube's own player endpoint — no API key. Picks the caption track in the language actually *spoken*, not one of the machine translations |
| **Screenshot** | OCR (Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Urdu, Arabic, English) |
| **Pasted text** | A forwarded WhatsApp message, a caption |
| **Any article link** | The existing article reader |

Instagram and Facebook serve nothing useful to an unauthenticated client. Rather than ship a scraper that works on the demo machine and nowhere else, those return a clear instruction to paste the text or upload a screenshot — and the screenshot path is implemented.

## 🤖 What the score means

* The **verdict** is the headline answer, with its grounds and the rule that produced it
* A **presentation score** shown separately, so you can see how well it reads versus what supports it
* Per-factor bars, the highlighted sentences, the claims with evidence links
* Every merge in the independence count, with its reason

The score is also **calibrated**: when the system says 70% trust, it is right about 70% of the time.

---

## 📊 Tested Results

### Against the rule it replaces

Likelihood ratios estimated on a training half, every figure from the held-out half (n = 829 ISOT articles):

| | Accuracy | ROC-AUC | ECE when accusing | Precision when accusing |
|---|---|---|---|---|
| Legacy hand-weighted sum | 0.888 | 0.970 | 0.229 | 0.848 |
| **Weight of evidence (shipped)** | **0.954** | 0.957 | **0.127** | **0.975** |

Isotonic calibration takes the content model from **ECE 0.335 → 0.056**.

**The cost, stated plainly.** Turning the one-sided rule off raises AUC from 0.957 to 0.978 — and that gain is a trap. It comes from learning that polished prose indicates a genuine article, which is true on a corpus of crude fakes and false against a competent one. Both numbers are reported (`--no-clamp`); we ship the clamp.

It also costs calibration on the *exonerating* side, which is why overall ECE is 0.285 in the shipped configuration: the system refuses to become confident that a well-written article is genuine. Every residual error points toward **more** suspicion — it never overstates confidence in an article's favour.

### The adversarial benchmark — the one that matters

ISOT cannot test the defect described at the top of this file. Its fake articles are mostly *badly written*, so anything that scores style performs well on it while staying wide open to a competent fabrication. So we wrote the hard case: invented articles in plain newsroom register, with named sources, no clickbait and no persuasion techniques.

Each item is scored twice from **identical factor outputs** — once under the old additive rule with abstention redistribution, once under the current rule:

| Measure | Old rule | Current |
|---|---|---|
| Deceptive items presented as credible (≥5.5) | 4 / 6 | **0 / 6** |
| Verdict matched expectation | — | **6 / 6** |
| Genuine articles wrongly condemned | — | **0 / 2** |
| Mean *presentation* score of the fabrications | **7.3 / 10** | unchanged — that is the point |

That last row is the finding. The fabrications still read as trustworthy and always will. What changed is that reading well no longer decides the answer.

```bash
node eval/estimateWeights.js             # measure the likelihood ratios from labelled data
node eval/validateScoring.js             # held-out comparison against the old rule
node eval/validateScoring.js --no-clamp  # the adversarial-asymmetry ablation
node eval/adversarialBench.js --no-model # well-written fabrications, deterministic path
```

### The older ISOT result

On 300 ISOT articles with source identity hidden so the benchmark's Reuters label-leak cannot help:

| Approach | Accuracy |
|----------|----------|
| Asking the AI model directly (single prompt) | 82.0% |
| Multi-factor pipeline (same model) | **94.7%** |

> These figures come from a four-factor configuration on a model the provider has since withdrawn. They are kept as the measurement that motivated the architecture, not as a claim about today's build. A re-run is outstanding.

### The tests

```bash
npm test     # 103 tests, no API keys required
```

The whole suite, the weight estimation, the held-out validation and both benchmarks run with **every key removed**. That is deliberate: it makes "the contribution is not the API" a checkable claim rather than a sentence in a report.

### Analysis latency

Measured end to end on the same articles, cold (no cache):

| stage | cold analysis |
|---|---|
| original (NIM, 2 slots, serial verification) | ~63s, occasionally 116s |
| after switching the provider to Gemini | 34-49s |
| after sizing the gate to the provider | 16.6s |
| after verifying claims in parallel and overlapping claim extraction | **11-19s** |

A cached report is served in about **5 ms**, and `npm run prewarm` pays the cold
cost in advance for a whole category.

### Watching the report being built

The analysis is also available as a stream, and the article page uses it. Rather
than holding a spinner until all six checks finish, the page ticks each one off
as the server reports it:

```
+0.0s  Who published it                 (no model call — instant)
+1.9s  Is the writing fair?
+2.8s  Can you check it yourself?
+3.5s  Is the headline honest?
+8.4s  Is it using persuasion tricks?
+10.1s Do other outlets agree?          -> full report
```

`POST /api/ai/trust-analysis/stream` answers with newline-delimited JSON — one
line per completed check, then the assembled report. NDJSON rather than
Server-Sent Events because the article body has to be POSTed and the browser's
`EventSource` is GET-only. If the stream is unavailable the client falls back to
the ordinary `POST /api/ai/trust-analysis`, which is unchanged.

Remaining variance is not in this code: news retrieval and the hosted model queue
both fluctuate, and a single article's coverage search has been seen to take 40s
on its own.

> **Note:** these figures were measured on `meta/llama-3.1-8b-instruct`, which the provider has since retired, and before the transparency and persuasion checkers were added. A re-run on the current model and pipeline is pending; treat the numbers above as the last fully reproducible measurement rather than a claim about today's build.

---

## ✨ Platform Features

* 📰 Daily news feed with category browsing
* 🛡️ One-click **"Analyze Trustworthiness"** report for any article
* ✍️ AI-generated short and detailed summaries
* 🧠 News-literacy quizzes generated from article content
* 👤 User accounts, reading history, and activity tracking

---

## 🛠️ Technology Stack

### 🎨 Frontend

* React.js

### ⚙️ Backend

* Node.js + Express.js

### 🧠 AI / NLP

* Language model through a provider-agnostic gateway — **NVIDIA NIM** or **Google Gemini**, switchable with one setting, with automatic failover between them

---

## 🔀 Switching the language model provider

NVIDIA NIM is free and needs no billing account, which is why the project was
built on it. It has since become heavily congested: the *same* call has been
measured at 2 seconds and at 62 seconds, and `503 model busy` is routine. That
queueing — not the pipeline — is the dominant cost of an analysis.

So the gateway is provider-agnostic. One line in `backend/.env` decides the order:

```bash
LLM_PROVIDER=gemini,nim   # Gemini leads, NIM catches its failures
LLM_PROVIDER=nim          # NVIDIA NIM only (the code default)
LLM_PROVIDER=nim,gemini   # NIM leads, Gemini catches its failures
LLM_PROVIDER=ollama       # a model on this machine — no key, no quota, no vendor
```

For a Gemini-free setup, do not set `LLM_PROVIDER`. Configure both local
Ollama and NIM instead:

```bash
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
NIM_API_KEY=your-nvidia-nim-key
```

The measured task routing then uses Ollama for writing and claim extraction,
and NIM for premise checking, where the shipped local model is not yet
reliable enough. If NIM is unavailable, premise checking falls back to the
local model and the report remains conservative about unsupported claims.

### Running with no third-party model at all

Both hosted providers have already failed this project: a model was withdrawn
mid-development and every analysis started returning HTTP 410, and the free tiers
rate-limit under ordinary demo load. Neither was a defect in the pipeline and
neither was fixable from inside it.

Ollama removes the dependency — a model served over plain HTTP from this machine,
with no key, no quota, and no vendor able to retire anything:

```bash
# once
ollama pull llama3.1:8b

# in backend/.env
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
LLM_PROVIDER=ollama
```

Nothing else changes. No agent knows which provider answered — that is what the
gateway is for. The provider is opt-in: without `OLLAMA_HOST` set it reports
itself unconfigured and is left out of the chain, so a machine not running Ollama
never waits on a connection that cannot succeed.

**What the model is still needed for, and what it is not.** Every decision in the
system — independence counting, the verdict rules, the likelihood ratios, the
calibration, the input gate, language detection — is deterministic local code and
calls no model at all. The model is confined to reading: extracting claims,
judging whether retrieved coverage supports them, and scoring the four writing
checks. Each of those has a deterministic fallback, so the pipeline degrades
rather than stopping when no model is reachable.

The first *configured* provider leads; the rest are automatic failover. A
provider with no API key is skipped rather than failing the request, so an
unavailable provider never takes the system down.

Measured head-to-head on three real pipeline tasks, three runs each:

| | NVIDIA NIM (`nemotron-3-super-120b`) | Google Gemini (`gemini-3.1-flash-lite`) |
|---|---|---|
| bias check | 3/3 valid, 6.2s | 3/3 valid, **3.8s** |
| summary | 2/3 valid, 3.5s | **3/3 valid**, **1.6s** |
| persuasion techniques | **1/3 valid**, 10.5s | **3/3 valid**, **4.6s** |
| best-case total | 20.1s | **10.0s** |

Gemini is roughly twice as fast and returned usable output on every run, where
NIM's persuasion check succeeded only once in three — which is what had been
triggering the rule-based fallbacks. Both providers are kept: NIM remains the
more available option and is one setting away.

Keys live in `backend/.env` as `NIM_API_KEY` and `GEMINI_API_KEY`; the model per
provider can be overridden with `NIM_MODEL_NAME` / `GEMINI_MODEL_NAME`.

### How many calls run at once

The gateway caps concurrent model calls, and the right cap turned out to be a
property of the provider rather than a constant. Six identical calls, all valid:

| calls in parallel | NVIDIA NIM | Google Gemini |
|---|---|---|
| 2 | baseline | 37.5s |
| 3 | — | **7.9s** |
| 6 | *slower* than 2 | 9.1s |

NIM degrades when pushed, so it is held at two. Gemini does not, and a cap of two
was throttling the pipeline nearly fivefold. The limit is therefore read from
whichever provider leads, and can be overridden with `LLM_MAX_CONCURRENT`.

> Both vendors keep retired models in their public model lists — NIM's
> `llama-3.1-8b-instruct` and Gemini's `2.5-flash` names both answer a catalogue
> request and then return 404 on a real one. The gateway treats 404/410 as
> "retired" and moves to the next model automatically.
* Custom multi-factor analysis pipeline
* Rule-based fallback analysers, so an outage degrades the report instead of faking one

---

## 🧯 What happens when the AI model is unavailable

A hosted model can be retired, rate-limited or simply overloaded. The system is
built so that none of those silently corrupts a trust report.

* **Model retired (404/410)** → the next model in the fallback chain is adopted
  permanently for that process.
* **Model busy (503) or rate-limited (429)** → the same model is retried with
  backoff before any fallback is considered, so one busy moment does not demote
  a healthy fast model to a slower backup.
* **Model unreachable entirely** → the four content checks — headline honesty,
  fairness, persuasion technique and transparency — fall back to deterministic
  word-pattern and lexicon analysis. These catch less than the model does and
  the report says so, both on the summary and on each affected factor.
* **No corroborating coverage found** → the verdict becomes **Unverified** and
  the score is **capped at 4.9**. Its weight is *not* handed to the other checks.
  That redistribution was the original defect: it meant an absence of evidence
  increased the influence of the signals a fabricator controls.
* **The verification check could not run at all** (no model, no news quota) →
  also **Unverified**, with the reason stated. An unrun check must never be
  mistaken for "there was nothing to check" — that misreading would reclassify
  every article as commentary, which carries a far higher ceiling.

The one thing the system never does is invent a neutral score for a check that
did not run. With no model at all, a fabricated article still scores **2.3/10 —
"Be skeptical"**, and no article can be reported as trustworthy, because with the
model unreachable nothing has been verified.

### Making the demo fast

The first analysis of an article costs one round trip per factor, which on the
free tier under load has been measured at up to four minutes. Every report is
cached by article URL for fourteen days, so that cost is paid once. To pay it in
advance, before a demo or presentation:

```bash
npm run prewarm                                  # default categories
npm run prewarm -- business technology --limit 5 # named categories
```

Cached articles then open in about 20 ms. The script skips anything already
cached and is safe to re-run after an interruption. Reports carry a schema
version, so after a pipeline change old cached reports are re-analysed rather
than served.

### 🗄️ Database

* MongoDB

### 📡 News Data

* NewsAPI

---

## 🔮 Future Scope

* 🧪 **Synthetic-media forensics** as a seventh factor. Deliberately out of scope today — it is a separate research problem, and claiming it without doing it properly would be worse than not claiming it. The architecture already admits a new factor with a weight and an abstention rule.
* 🗂️ **Self-extending ownership model.** The 70-group media-ownership file is hand-curated. Unlisted outlets are never merged, which under-counts dependence rather than inventing independence — the safe direction, but a gap.
* 🏅 **Reader trust dashboard** — the trust level of what you have been reading over time. Per-article verdicts are already stored; this needs only the visualisation.

---

## 📌 What this project actually is

Strip away the borrowed parts — the language model, the news API — and ask what remains. That is the honest test of a project like this, and it is the one the code is arranged to pass:

* the **evidence model** — likelihood ratios measured from labelled articles, accumulated as additive decibans, with author-controlled observations admitted one-sidedly
* the **calibration** that turns a ranking into a probability you can check against outcomes
* the **ownership and syndication model** that turns retrieved articles into independent sources
* the **relevance gate** that stops the model citing coverage unrelated to the claim
* the **verdict rules**, deterministic and stated, that decide what the system concludes
* the **language identifier**, local and model-free

None of that comes from an API. The language model extracts claims and judges stance over retrieved text — it is a sensor, not the judge. `npm test` proves it: 78 tests, every key removed.

The single sentence version, if you only remember one thing:

> **A detector facing an adversary who writes its inputs must weigh those inputs in one direction only.**
