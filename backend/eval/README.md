# Evaluation framework

Measures the trust-analysis pipeline on labeled fake/real news datasets, and
produces the numbers the paper needs: accuracy, macro-F1, ROC-AUC, an ablation
table, and calibration (ECE).

## Dataset format

A CSV with a header row and columns `title,text,label` (label: `1` = real,
`0` = fake). Place files under `eval/data/`.

Recommended: the ISOT Fake News dataset (~44k articles). Two known pitfalls
this harness handles automatically:

- **Source leak:** all ISOT real articles come from Reuters, so the source
  name gives the label away. The runner hides the source from the pipeline
  by default (`--show-source` to disable).
- **Agency-prefix leak:** real articles begin with `CITY (Reuters) -`. The
  runner strips agency prefixes before analysis.

## Running

```bash
cd backend
# Main result (content factors; verification off for historical articles)
node eval/runEval.js --data eval/data/isot.csv --config full --sample 100

# Ablations
node eval/runEval.js --data eval/data/isot.csv --config no-bias --sample 100
node eval/runEval.js --data eval/data/isot.csv --config no-clickbait --sample 100

# Baseline: the original single-prompt credibility agent
node eval/runEval.js --data eval/data/isot.csv --config baseline --sample 100

# Metrics + ablation table
node eval/report.js
```

Runs are resumable — re-running the same command skips finished articles.
Sampling is stratified (half real / half fake) and seeded, so every config
evaluates the identical article set.

The decision threshold is tuned on one half of the results and metrics are
reported on the other half (no test-set leakage).

## Why verification is off for dataset runs

Cross-source verification searches *live* news coverage. Historical dataset
articles (ISOT is 2016-2017) have no live coverage to corroborate, so the
factor would always return "unverified" and its weight is redistributed —
identical to production behavior. Report verification quality separately
with a small live-news study (`--config full+verify` on current articles).

## Cost / time

Each article uses 2 LLM calls (clickbait + bias); the baseline uses 1.
At the default 30 requests/min budget, 100 articles ≈ 8-10 minutes per config.

## Check Anything against a plain language model

`eval/benchmarkCheckAnything.js` puts 22 claims about October 2026, each
labelled from published reporting, to two systems:

- **Plain model:** the same hosted model the pipeline uses (Gemini
  flash-lite), asked zero-shot with today's date and nothing to read.
- **Check Anything:** the full path, which is ingest, the input gate, the four
  evidence channels (news reporting, fact-checkers, this week's coverage of the
  subject, reference facts) and the verdict rules.

The claims cover the ways a false claim differs from a true one: a wrong
figure, a reversed outcome, a viral rumour fact-checkers have ruled on, an
invented event about a heavily covered subject, and a false premise. True
reporting from the same week, national and local, is included.

```bash
cd backend
node eval/benchmarkCheckAnything.js            # both systems, ~9 minutes
node eval/benchmarkCheckAnything.js --gap 10   # more spacing if the model is rate limited
```

Results go to `eval/results/checkAnything_benchmark.{json,md}`. The claims
concern current events, so the labels hold for the weeks after they were
written. To re-run later, refresh the claims from that week's news.
