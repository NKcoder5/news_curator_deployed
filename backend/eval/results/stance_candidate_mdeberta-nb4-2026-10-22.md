# Stance candidate: mdeberta-nb4-2026-10-22

Measured 2026-10-22 by eval/stanceCandidate.js on `ml\artifacts\mdeberta-nb4`.

## 1. Gold probe (labelled by hand)

| pairs | right |
|---|---:|
| all 50 | 44 (88.0%) |
| patterns not in training: 41 | 35 (85.4%) |
| patterns synthesised for training: 9 | 9 (100.0%) |
| Tamil and Hindi claims: 6 | 6 |

## 2. Held-out stance pairs (Gemini as reference)

782 pairs from 67 claims never trained on; agreement with Gemini 80.9%.

| stance | threshold | sure readings | precision | 95% lower bound | of Gemini's caught |
|---|---:|---:|---:|---:|---:|
| agree | off | – | – | below 93% at every threshold | – |
| disagree | off | – | – | below 93% at every threshold | – |
| unrelated | 0.995 | 415 | 89.6% | 86.3% | 79.8% |

Targets (lower bound): agree 0.93, disagree 0.93, unrelated 0.85; at least 20 readings.
With these thresholds the model is sure of 53.1% of headlines; every headline of 1 of 67 claims (no hosted call).

## 3. Probe with these thresholds

Sure readings: 13 of 50; sure and wrong: **0**.

| id | kind | gold | ours (p) | sure | claim / headline |
|---|---|---|---|---|---|
| sp-04 | attribution | unrelated | agree (1.00) | no | TVK will win 150 seats in the Tamil Nadu election. / TVK will sweep with 150 seats, claims Vijay |
| sp-14 | bound | agree | disagree (1.00) | no | Nearly 90 people were injured in the stampede. / Stampede at temple fair leaves 87 injured |
| sp-26 | negation | unrelated | disagree (0.61) | no | Walmart has not adopted a staggered shopping schedule based on age. / Coronavirus fact check: Has Walmart adopted staggered shopping days ba |
| sp-34 | time | unrelated | agree (1.00) | no | The elephant that fell into the well in Coimbatore was rescued. / Rescue operations under way for elephant that fell into well in Coimba |
| sp-39 | sibling | unrelated | disagree (0.96) | no | The Supreme Court stayed the Waqf Act. / Supreme Court to hear pleas against Waqf Act next week |
| sp-42 | partial | unrelated | agree (0.73) | no | India won 85 medals at the Asian Games and the RBI cut the repo rate b / Asian Games 2026: India finish fourth with 85 medals |

\* a pattern synthesised for training.

## 4. Cost on this CPU

Model file 106.0 MB (GitHub refuses files over 100 MB). Memory added once loaded: about 314 MB.
Latency with 2 threads: one pair 97 ms, a batch of 16 658 ms.
