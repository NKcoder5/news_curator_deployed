# Stance candidate: shipped

Measured 2026-10-20 by eval/stanceCandidate.js on `backend\models\minilm-l12-onnx-int8`.

## 1. Gold probe (labelled by hand)

| pairs | right |
|---|---:|
| all 50 | 34 (68.0%) |
| patterns not in training: 41 | 29 (70.7%) |
| patterns synthesised for training: 9 | 5 (55.6%) |
| Tamil and Hindi claims: 6 | 6 |

## 2. Held-out stance pairs (Gemini as reference)

782 pairs from 67 claims never trained on; agreement with Gemini 58.4%.

| stance | threshold | sure readings | precision | 95% lower bound | of Gemini's caught |
|---|---:|---:|---:|---:|---:|
| agree | off | – | – | below 93% at every threshold | – |
| disagree | off | – | – | below 93% at every threshold | – |
| unrelated | off | – | – | below 85% at every threshold | – |

Targets (lower bound): agree 0.93, disagree 0.93, unrelated 0.85; at least 20 readings.
With these thresholds the model is sure of 0.0% of headlines; every headline of 0 of 67 claims (no hosted call).

## 3. Probe with these thresholds

Sure readings: 0 of 50; sure and wrong: **0**.

| id | kind | gold | ours (p) | sure | claim / headline |
|---|---|---|---|---|---|
| sp-01* | attribution | unrelated | agree (1.00) | no | Drinking cow urine cures cancer. / Cow dung, urine can cure cancer: BJP MP |
| sp-02* | attribution | unrelated | agree (1.00) | no | Hot lemon water kills the coronavirus. / Viral post claims hot lemon water kills coronavirus |
| sp-11* | bound | agree | disagree (1.00) | no | India crossed 80 medals at the Asian Games 2026. / Asian Games 2026: India signs off with 85 medals |
| sp-13 | bound | agree | disagree (0.99) | no | Over 50 people were killed in the Odisha train accident. / Odisha train accident: death toll rises to 61 |
| sp-14 | bound | agree | disagree (0.97) | no | Nearly 90 people were injured in the stampede. / Stampede at temple fair leaves 87 injured |
| sp-16 | interim | unrelated | disagree (1.00) | no | India won 84 medals at the Asian Games 2026. / Asian Games Day 9: India's medal tally crosses 50 |
| sp-18 | units | agree | disagree (0.66) | no | The scheme will benefit 1 lakh farmers. / New scheme to help 100,000 farmers, says minister |
| sp-22 | other-entity | unrelated | disagree (1.00) | no | Hyundai recalled 20,000 cars over an airbag fault. / Kia recalls 20,000 cars in India over airbag defect |
| sp-23 | other-entity | unrelated | disagree (0.90) | no | Chennai recorded 30 cm of rain in 24 hours. / Puducherry records 30 cm rainfall in a day |
| sp-24* | negation | unrelated | disagree (0.98) | no | PM Modi has not resigned. / PM Modi warns against forces dividing society on Vijayadashami |
| sp-26 | negation | unrelated | disagree (0.54) | no | Walmart has not adopted a staggered shopping schedule based on age. / Coronavirus fact check: Has Walmart adopted staggered shopping days ba |
| sp-31 | paraphrase | agree | disagree (0.97) | no | UAE lost to Namibia in the T20 World Cup qualifier. / Namibia beat UAE to keep T20 World Cup hopes alive |
| sp-34 | time | unrelated | agree (1.00) | no | The elephant that fell into the well in Coimbatore was rescued. / Rescue operations under way for elephant that fell into well in Coimba |
| sp-35 | time | agree | unrelated (0.82) | no | The elephant that fell into the well in Coimbatore was rescued. / Elephant pulled out of well in Coimbatore after 12-hour operation |
| sp-39 | sibling | unrelated | disagree (1.00) | no | The Supreme Court stayed the Waqf Act. / Supreme Court to hear pleas against Waqf Act next week |
| sp-43 | speculation | unrelated | agree (1.00) | no | Elon Musk bought Reliance Jio. / Could Elon Musk buy Reliance Jio? Analysts weigh in |

\* a pattern synthesised for training.

## 4. Cost on this CPU

Model file 40.2 MB (GitHub refuses files over 100 MB). Memory added once loaded: about 157 MB.
Latency with 2 threads: one pair 20 ms, a batch of 16 323 ms.
