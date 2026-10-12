# System assessment and next-step proposal (internal, 2026-10-12)

Internal engineering note. Not publication material. The project report and NICOM paper
describe the system as it stood on 9 October 2026 and are frozen until development is complete.
Their drafts of the October changes are parked outside the repository and unused.

## 1. Current architecture and data flow (verified in code)

```
input (link | text | screenshot | YouTube)
  -> ingest (article reader with reader-proxy fallback, OCR, captions)
  -> reading step [Gemini]: language, romanised?, speech act, tone, English, ≤3 claims
       (time frame, kind, headline, subjects, search terms); rule-based gate as fallback
  -> in parallel, per message:
       news coverage   Google News RSS (NewsAPI fallback) -> relevance gate (anchors,
                       initials, decimals) -> independence (owners, wire copy, near-dupes,
                       state media) -> stance per headline [Gemini], quote must be in headline
       fact-checkers   ClaimReview index (keyless Explorer) + fact-check headlines
                       -> same-claim match [Gemini]
       this week       7 days of each subject's coverage -> headlines that rule it out [Gemini]
       reference       Wikipedia: premise contradiction / standing-fact confirmation [NIM]
       publisher       identity from web address; 90 curated + 11,520 rated domains; RDAP age
       writing         clickbait, bias, persuasion, transparency [local Llama 3.1 8B]
  -> ledger (per request, in memory) -> probability (likelihood ratios; writing LRs measured
     on ISOT, channel LRs declared) -> 18 ordered deterministic verdict rules
  -> report, streamed channel by channel (NDJSON) -> evidence board in the page
```

Persistence (verified in `backend/models`): users, reading history, activity, interests, and
14-day caches of article reports, summaries and article text keyed by URL.

What is **not** persisted:

- Check Anything results are not stored at all.
- No claim, event or assessment is remembered across requests.
- Nothing is versioned. An article report expires after 14 days, or is overwritten when re-analysed.

## 2. Capabilities and status

| Capability | Status | Evidence |
|---|---|---|
| Multimodal input (link, text, OCR, YouTube) | Working | end-to-end runs, samples 01–20 |
| Reading tone, questions, sarcasm, negation; Tamil, Hindi, Tanglish | Working | robustness suite 53/55, 0 wrong (11 Oct) |
| Independent-source counting | Working, unit-tested | `independence.js` tests |
| Wrong figure, reversed outcome | Working | benchmark, suites |
| Fact-check rulings | Working; depends on an undocumented endpoint | rumour cases |
| Invented events via this week's coverage | Working; rule guarded | suites; declared LR |
| Old news shared as new | Working for "now" claims | old-1, h-23 |
| Several claims; true claim carrying an invented one | Working | multi-1, h-27 (after fix) |
| Satire / opinion / refusal | Working | suites |
| Explanation: rule + evidence + quotes | Working | UI, report JSON |
| Calibrated probability | Writing LRs measured; channel LRs declared | `evidenceWeights.json` |
| Confidence shown in UI | **Heuristic formula, not calibrated** | `verdictEngine.confidenceFor` |
| Memory of claims / events / sources over time | **Missing** | no model exists |
| Re-assessment when evidence changes | **Missing** | |
| Corrections and retractions | **Missing** | no code path |
| Reproducing an old verdict | **Missing** (no stored evidence snapshot or model record) | |
| Claim origin / lineage, circular reporting over time | **Missing** (only same-time clustering) | |
| Misleading framing of true facts | Only via fact-checkers' "misleading" rating | |
| Prompt injection | No explicit defence. 2 of 2 user-text probes resisted, because claims are extracted and the verdict is rule-based. Injection inside retrieved headlines is untested | probe, 12 Oct |
| Evidence read from article bodies | Headlines only, for stance | |

## 3. Strengths

1. **Deterministic verdicts.** Fixed rules sit over an evidence ledger, and the rule that fired is named. Given the same evidence, the verdict is identical.
2. **Corroboration counts sources.** It counts independent sources, not articles: owners, wire copy and reprints are merged.
3. **Evidence is grounded.** Every model judgement must quote text that is then found verbatim (headlines, encyclopedia entries).
4. **Asymmetric scoring.** Author-controlled signals can only lower trust.
5. **Abstention is explicit and typed.** It distinguishes a search that could not run, a story too recent to check, nothing found, and a refusal with its reason.
6. **Measured.** There is an evaluation harness: ISOT, adversarial, robustness, held-out, and a benchmark against a plain model.

## 4. Weaknesses and failure modes

1. **Amnesia.** Every check starts from nothing. As a result:
   - The same rumour costs the full price every time.
   - It can get different answers on different days, because of news drift and model rotation.
   - There is no record of what was concluded, when, or on what evidence.
   - Nothing improves the system over time.
2. **Verdicts are not reproducible later.** The evidence and model versions are not stored.
3. **Confidence is a hand-set formula.** The new channels' likelihood ratios are declared, not measured.
4. **Stance comes from headlines.** Qualifications in the body and misleading framing are missed.
5. **Fragile external dependencies:**
   - an undocumented fact-check endpoint;
   - unofficial Google News RSS;
   - free-tier Gemini quota, 500 a day per model; six models give headroom, but a heavy test day still spends them all.
6. **Evaluation sets are small and self-authored.** About 104 labelled current-news cases, from one month.
7. **Latency varies.** 8–15 s per check on 11 Oct; 30–55 s per check during today's evaluation run. The cause is not yet established; contention on the local model is suspected.

## 5. Context limitations specifically

- **Context is assembled per request.** It comes from live search and the past seven days of subject coverage, and is then discarded.
- **No "known at time T" versus "known now".** It cannot tell a claim that was unverifiable yesterday and confirmed today from one that was always confirmed.
- **No cross-check memory.** It cannot recognise a recycled rumour, a translated repeat, or a figure that mutates as a claim spreads, unless a fact-checker happens to have indexed it.
- **Context isolation is lexical** (shared anchors). This is good against keyword contamination, but it cannot link paraphrases across languages without the reading step.

## 6. Differentiation opportunities (summary)

The single-shot decision is now strong. What is missing is a durable, evidence-linked record of
claims and verdicts over time. Section 7 of the chat proposal sets out the candidates, the
recommendation and the plan.

## 7. Architectural constraints

- Persistence is MongoDB, and is sufficient.
- No background job runner exists; one is needed for re-assessment.
- The hosted-model quota limits how many re-checks can run per day.
- The deterministic engine (`buildEvidenceLedger` + `decideVerdict`) is a pure function of its inputs. That is the property that makes replay and counterfactual attribution cheap and faithful.

## 8. Publication discrepancies recorded (do not act until development is complete)

- **Report and paper predate 11 October.** They describe NewsAPI as primary, a gate that refuses questions, four channels, ten verdict rules and nine local tasks.
- **Live system today:**
  - Google News first;
  - the reading step;
  - fact-check and this-week channels;
  - eighteen rules;
  - eight local tasks and six Gemini judgements;
  - 211 + 16 tests.
- **Draft text, figures and deck for those changes are parked.** They are in the earlier session scratchpad, in `drafts_oct12/`, and are not used.

---

# Proposal (awaiting approval; nothing below is implemented)

## Candidate trump cards

### C1. Claim Record: a versioned, evidence-linked memory of claims

- **Problem.** Verdicts are ephemeral. The system cannot do any of these:
  - say it has seen a claim before, or what it concluded then;
  - notice that a rumour came back in Tamil, or with 84 instead of 85;
  - revisit a CANNOT VERIFY once outlets publish;
  - reproduce an old verdict.
- **Why conventional systems struggle.**
  - Classifiers and LLM fact-checkers are stateless by design.
  - Fact-check databases store human rulings, not a machine's evidence-linked assessments with history.
  - Re-assessment needs a deterministic decision layer, or the history is noise.
- **How it works:**
  - `Claim`: canonical English text, a signature (entities, numbers with units, predicate terms, polarity), subjects, language variants, first and last seen, and the current assessment.
  - `Assessment`: append-only. Verdict, rule, evidence snapshot (source, url, title, quoted words, date, stance), channel statuses, model per judgement, config hash, and `supersedes`.
  - Variant links: same subject and predicate with a different figure, negation or date record the difference.
  - Retrieval: candidates by anchor overlap (indexed entities and numbers), then deterministic comparison, with a model call only when ambiguous.
  - Isolation reuses the relevance gate's rule: a shared anchor is required.
- **Reuses.** The reading step's English claims and signatures, the ledger, the verdict engine and MongoDB.
- **New.** Two collections, a matcher, a change-reason differ (old snapshot against new), and a re-assessment job.
- **Limits.**
  - Matching errors: a false merge is worse than a miss, so the matcher must be conservative.
  - Storage and privacy of user messages.
  - Little accumulated data by review day.
- **Evidence it works.**
  - Paraphrase and language consistency rises.
  - Matching precision and recall, and the false-merge rate.
  - Replay reproduces stored verdicts 100%.
  - Re-assessment changes the right verdicts and leaves settled ones alone.
- **Cost.** About 2 to 3 days of work. Running cost falls, because repeat checks reuse records.
- **Replicability.** The code is easy to copy; the accumulated records and measured reliability are not.

### C2. Decisive-evidence attribution: "what decided this, and what would change it"

- **Problem.** An explanation from an LLM is a story, not a trace.
- **How it works.** The verdict engine is a pure function, so we re-run it with each evidence cluster or channel removed and mark what flips the verdict as *decisive*. From the rule table we also state the smallest evidence that would change the verdict, for example: "one independent outlet reporting it would make this REAL; a fact-check ruling would make it FAKE."
- **Difference.** The explanation is faithful by construction, which LLM-written rationales are not.
- **Cost.** About half a day; no model calls.
- **Limits.** It is faithful to the rules, not to the world; the rules can still be wrong.
- **Evidence.** A faithfulness test (removing a decisive item flips the verdict, removing any other does not), plus a qualitative user check.

### C3. Measured rule reliability in place of hand-set confidence

- **Problem.** "Confidence 95%" is a formula, not a measurement.
- **How it works.**
  - For each rule, count how often it fired on labelled cases and how often it was right: 104 current-news cases, plus the adversarial and end-to-end sets.
  - Show "this rule was right in 31 of 33 labelled cases (95% interval …)", with the label sample size stated.
  - The counts grow as Claim Record outcomes are resolved: CANNOT VERIFY later settled, human review.
- **Limits.** Small n gives wide intervals, which must be shown honestly.
- **Evidence.** Brier score and ECE against the heuristic, on held-out labels.

### C4. Claim lineage and mutation (an extension of C1)

- **Earliest appearance.** Google News results are sorted by date.
- **Mutation history.** "First reported as 85 medals; this version says 84."
- **Circular reporting over time.** Outlets citing one another.
- **Status.** Valuable but heavier; the "mutation" part comes almost free with C1 variants.

### C5. Adversarial hardening (necessary, not a trump card)

- An injection red-team suite: instructions inside messages, and inside simulated retrieved headlines.
- Explicit delimiting of untrusted text in every prompt.
- Today, 2 of 2 user-text probes were resisted; retrieved-text injection is untested.

### Considered and not recommended now

- **Temporal knowledge graph of all news.** Entity and event resolution at scale cannot be built or evaluated in a week.
- **Adding more agents, models or RAG.** Generic, and not measurably better.
- **Training our own classifier.** Style learning is exactly what the one-sided rule guards against.
- **Autonomous self-learning.** Uncontrolled behaviour change.

## Strategies compared

| | S1 Strengthen | S2 Evidence-record layer (recommended) | S3 Event-graph redesign |
|---|---|---|---|
| What | Full-text stance, measure declared LRs, injection hardening, bigger suites | C1 + C2 + C3 (+ C4 mutation, C5 hardening) on the current engine | Continuous ingestion into a temporal event/entity graph; claims checked against it |
| Capability gain | Moderate accuracy gain | Consistency, reproducibility, re-assessment, honest confidence, recycled-claim detection | Potentially largest; unproven |
| Difficulty / time | Low–medium, 3–4 days | Medium, 5–6 days | High, weeks to months |
| Risk | Low | Medium (matching errors, privacy) | High (resolution quality, evaluation) |
| Differentiation | Low | High, and grows with use | High if it works |
| Fit with current code | Full | Full: the engine is already a pure function | Partial rewrite |

**Recommendation: S2,** with C5 hardening and the full-text read of decisive evidence taken from S1.

## Architecture (S2)

- **Read path.** The reading step produces claims and signatures. Look up each one in the Claim Record:
  - same claim, assessed recently: show the history, run a fresh check, and diff against the last assessment;
  - variant: show the difference ("checked on 12 Oct as 85; this says 84");
  - new: create the record.
- **Write path.** Every Check Anything assessment is appended with:
  - its evidence snapshot;
  - model and config versions;
  - a message hash (raw text stored only if approved).
- **Re-assessment.** A job re-runs CANNOT VERIFY, too-recent and high-traffic claims at about 6 h, 24 h and 72 h, within a daily quota cap. It appends a new assessment with a computed change reason, never overwrites, and records "known at T".
- **Explanation.** Decisive evidence by counterfactual re-run; "what would change it" from the rules; confidence from the rule-reliability table.
- **Context isolation.** A match requires shared anchors (entities or figures) and the same subject; a shared topic is not enough.
- **Security.** All untrusted text is delimited in prompts, and the red-team suite runs in the evaluation.

## Validation plan

1. **Paraphrase and language consistency.** K claims × M phrasings (English, Tamil, Hindi, Tanglish, question, hedge). Measure verdict agreement before and after.
2. **Claim matching.** Labelled pairs (same / variant / different, with same-keyword decoys). Measure precision, recall and the false-merge rate.
3. **Mutation detection.** Pairs with a changed figure, a flipped negation or a shifted date. Measure the detection rate.
4. **Re-assessment.** Replay claims that were unresolved at time T. Count correct changes, and flip-flops on settled claims, which should be 0.
5. **Reproducibility.** Replay stored snapshots through the engine and check the verdict is identical, 100% required.
6. **Counterfactual faithfulness.** Automated test: removing a decisive item flips the verdict, removing any other does not.
7. **Calibration.** Rule-reliability confidence against the heuristic: Brier score and ECE on held-out labels, with interval widths reported.
8. **Ablation.** A stream of 50 messages with repeats and variants, with and without the Record. Measure accuracy, consistency, model calls and latency.
9. **Injection red-team.** User-text and retrieved-text cases; the verdict must be unchanged.

## Roadmap

| Day | Milestone | Essential? |
|---|---|---|
| 1 | Claim Record schema + write path + replay test | Essential |
| 2 | Matcher, "checked before", variants/mutation, matching test set | Essential |
| 3 | Decisive evidence + "what would change it"; rule-reliability confidence | Essential |
| 4 | Re-assessment job (quota-capped) + verdict timeline with change reasons | Essential (minimal) |
| 5 | Evaluations 1–9; injection hardening | Essential |
| 6 | Fixes, demo preparation | Essential |
| later | Lineage (earliest appearance), full-text stance, provenance graph view | Optional |
