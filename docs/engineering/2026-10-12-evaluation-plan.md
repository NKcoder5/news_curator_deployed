# Evaluation plan, 12 October 2026

The numbers quoted so far (robustness 52/55, held-out 24/27, benchmark 21/22,
no wrong-direction verdict) come partly from suites that were used to tune the
system while it was being built. This note describes the evaluation added on
12 October to give a reviewer numbers they can trust: what each measurement
is, what it would and would not show, how to run it, and what has been run so
far.

All commands are run from `backend/`. Results land in `backend/eval/results/`
(git-ignored; commit them with `git add -f`).

## What has been measured already (no model quota needed)

| Measurement | Result |
|---|---|
| Claim matching, held-out pairs, signatures only | 33/46 exact; same 4/14, variant 9/12, different 20/20, decoys 18/18; **0 false merges, 3 variants merged** |
| Claim matching, held-out pairs, model on the 8 ambiguous pairs | 36/46 exact; same 7/14; 0 false merges, 3 variants merged |
| (for comparison) the tuning pairs, signatures only | 33/34 exact; same 10/11 |
| Decision-explainer faithfulness | 31,669 statements on 2,394 ledgers (14 stored, 380 scenario, 2,000 random): **all agree** |
| Monotonicity, 20,000 random ledgers | a fact-checker's "false", an encyclopedia contradiction, a "true" ruling: never the wrong way; more outlets against: 269 wrong-way (1.3%); more outlets for: 84 (0.4%) |
| Calibration of existing runs | held-out pooled: coverage 44/47 (83–98%), accuracy when answered 43/44 (88–100%), wrong direction 0/44 (0–8%) |
| Smoke runs (4 live checks) | see "Findings from the smoke runs" |

## The measurements

### 1. Held-out suite v2 (`eval/suites/heldout_v2.json`, 51 cases)

**What it is.** Messages written on 12 October after every change to the
system, on topics no earlier suite touches: events of 4–10 October with wide
national coverage (Nana Patekar's death, the 2026 Nobel prizes, the India–West
Indies T20Is, Modi's 25 years as head of government, the Dream Olympics 2036
scheme, the Perambur election petition, Vettri Payanam), the same events with
a figure, date or result changed, seven pieces of old news presented as today
(2019–2025; two with fresh anniversary coverage), invented events,
fact-checked viral rumours (Alt News, BOOM, The Quint, CyberPeace, PIB via
News On AIR), evergreen myths, Tamil, Hindi and Tanglish, questions, sarcasm,
pure opinions and two-claim messages. Every label carries the URLs it rests
on and the date it was labelled.

**Scoring.** right / safe (an answer listed as acceptable) / missed (an
abstention where a verdict was due) / wrong (a verdict the wrong way).
CANNOT VERIFY is accepted only for invented events, where absence of
reporting is not proof; never for a changed figure, a reversed result, old
news or a fact-checked rumour, where the evidence to say FAKE exists. Pure
opinions are expected to be refused (the reading step finds no claim and the
service answers 422, scored REFUSED); NOT A FACTUAL CLAIM is also accepted.

**What it shows.** How the whole Check Anything path does on messages it was
never tuned on, by kind of message.
**What it does not show.** A population rate: 51 hand-picked cases, chosen to
cover kinds of message rather than in the proportions people send them, give
intervals of roughly ±10–15 points. The labels are for this week; the "now"
claims become old news after three weeks, so the suite must be run in the
next few days or its time-dependent cases relabelled. Only what Google News
and NewsAPI index can be confirmed.

**Run.** `node eval/robustnessSuite.js --suite heldout_v2 --out heldout_v2 --resume`

### 2. Consistency and the memory ablation (`eval/suites/consistency.json`)

**What it is.** 12 claims, each written four ways: a plain English statement,
an English question, Tamil or Hindi, and a Tanglish WhatsApp-style forward.
`eval/consistencySuite.js` reports, per claim, whether all four phrasings got
the same call, whether all four were right, and (with the claim memory on)
whether all four were filed under one claim record; plus latency (median and
90th percentile).

**The ablation.** The suite runs twice, each in its own process so the
half-hour in-process judgement cache is not shared: with the memory (connected
to a separate evaluation database, `news_curator_eval`, never the live one;
what it stores is deleted at the end of a complete run, `--keep` to inspect)
and with `--no-memory` (never connects; `recordCheck` stores nothing).

**What it shows.** Whether the answer depends on how the claim is phrased, and
whether the memory recognises one claim across languages and phrasings (which
is what its history, re-checks and "checked before" depend on).
**What it does not show.** The memory does not feed into the verdict today
(it is written after the verdict), so the with/without comparison of calls
measures run-to-run variation, and the latency difference is the cost of
recording. If a later change lets the memory answer from a recent verdict, the
same ablation measures that. 48 phrasings of 12 claims are 12 independent
units, not 48.

**Run.** `node eval/consistencySuite.js --resume` and
`node eval/consistencySuite.js --no-memory --resume`

### 3. Claim matching on held-out pairs (`eval/suites/claim_matching_heldout.json`)

**What it is.** 46 labelled pairs (14 same, 12 variant, 20 different of which
18 are decoys sharing names or figures) on new topics.
**What it shows.** False merges (two different claims filed as one) and
variants merged as the same claim, the two errors that would attach one
claim's verdict to another; and how often a repeat is recognised.
**What it does not show.** Pairs are clean English sentences; the live path
compares the reading step's output, so its errors compound with these.
**Run.** `node eval/claimMatching.js --suite claim_matching_heldout` and, with
the model on the ambiguous pairs only, add `--with-model --max-model-calls 15`.

### 4. Counterfactual faithfulness (`eval/counterfactualFaithfulness.js`)

**What it is.** Every statement the decision explainer makes — which channels
were decisive, which the verdict rests on, whether it stands on absence, and
the smallest evidence that would change it (each step reproduced, the
smallest, none missing) — recomputed with this script's own channel removals
and its own hypothetical outlets through `replayVerdict`, on all stored
assessments (read only), 380 suite-like scenario ledgers and 2,000 seeded
random ones. Then a monotonicity sweep over 20,000 random ledgers, kept to
combinations the pipeline can produce.
**What it shows.** That the explanation describes the engine (it does, on
every statement checked), and where the engine's rule order lets more
evidence move a verdict the wrong way.
**What it does not show.** Whether the evidence fed to the engine was read
correctly (that is what the live suites measure). The explainer's hypothetical
outlets are undated; dated today they would turn 118 old-news ledgers REAL,
which the explainer cannot say.
**Run.** `node eval/counterfactualFaithfulness.js [--seed 12] [--random 2000] [--grid 20000]`
(deterministic, ~10 s, no model calls).

### 5. Coverage, selective accuracy and calibration (`eval/calibrationReport.js`)

**What it is.** From the labelled results files: coverage (of cases that
deserved a verdict, how many got one), accuracy when answered, the
wrong-direction rate (REAL for something false, FAKE or PARTLY FALSE for
something true), and each call's precision, all with 95% Wilson intervals,
separately for the tuned suite, the pooled held-out runs and each suite.
Where the verdict's stated confidence was recorded, it is set against
observed accuracy.
**What it does not show.** A calibrated probability: the engine's confidence
is set per rule by hand, and on the runs so far every held-out verdict with a
confidence was right, so there is nothing yet to rank.
**Run.** `node eval/calibrationReport.js`

### 6. The rule record (`eval/ruleReliability.js`)

Regenerates `data/ruleReliability.json`, which the page shows beside each
verdict, now including held-out v2 and leaving out cases answered by fallback
models.

### 7. Suite validation (`test/evalSuites.test.js`, part of `npm test`)

Schema, unique ids, no message in two suites, a source URL and labelling date
behind every non-refusal label in new suites.

## Running the live part (after the 07:00 UTC quota reset)

```bash
cd backend
node eval/runDay5.js --dry-run      # the plan
node eval/runDay5.js                # everything; resumable
```

Order: claim matching with the model (8 calls), held-out v2 (51 checks),
consistency with memory (48), without memory (48), then the rule record, the
calibration report and `eval/results/day5_summary.{json,md}`. At most 147 live
checks, each about 8–10 model calls (4 of them Gemini on the smoke runs).

Each case is written as it finishes. A case whose Gemini-led judgement was
answered by another provider is marked degraded; two such cases (or errors) in
a row stop the suite with exit code 75, and the runner stops and summarises.
Running it again keeps finished cases and re-runs only degraded or failed
ones. `--budget N` caps one invocation's live checks; `--gap` and
`--step-gap` set the spacing. Then commit the results with `git add -f`.

## Findings from the smoke runs (4 live checks)

- v2-1, "Veteran actor Nana Patekar died in Goa at the age of 75": REAL,
  corroborated by 11 outlets.
- "Actor Nana Patekar has died at his home in Goa": **FAKE**, by
  `premise-contradicted-by-reference`, quoting the encyclopedia entry that
  gives his date of death. The premise check misread a confirmation as a
  contradiction, and that rule is tried before corroboration, so it
  overruled 11 confirming outlets.
- "Is it true that Nana Patekar passed away?": CANNOT VERIFY by
  `fact-checkers-and-reporting-disagree` — a fact-checker's "false" (an older
  death hoax) matched to this week's real death.
- The same plain sentence in a fresh process without the memory: CANNOT
  VERIFY, not FAKE. The same input does not give the same call from run to
  run.
- The statement and the question were filed under two different claim
  records ("has died at his home in Goa" against "passed away"), as the
  held-out matching numbers predict.

## Known limits

- Labels are by one person from published reporting; a second labeller has
  not checked them.
- The suites are small. Every rate should be read with its interval.
- `data/ruleReliability.json` counts one message twice ("Chennai is the
  capital of Karnataka" is in both the benchmark and the robustness suite),
  found by the suite-validation test.
