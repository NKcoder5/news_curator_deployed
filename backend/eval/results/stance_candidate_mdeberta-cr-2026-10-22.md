# Stance candidate: mdeberta-cr-2026-10-22

Measured 2026-10-22 by eval/stanceCandidate.js on `ml\artifacts\mdeberta-cr-nb4`.

## 1. Gold probe (labelled by hand)

| pairs | right |
|---|---:|
| all 50 | 44 (88.0%) |
| patterns not in training: 41 | 35 (85.4%) |
| patterns synthesised for training: 9 | 9 (100.0%) |
| Tamil and Hindi claims: 6 | 5 |

## 2. Held-out stance pairs (Gemini, corrected by hand where disputed as reference)

782 pairs from 67 claims never trained on; agreement with Gemini 81.1%; with the reference corrected on 14 pairs judged by hand (stance_adjudication_2026-10-22.json), 82.1%.

| stance | threshold | sure readings | precision | 95% lower bound | of Gemini's caught |
|---|---:|---:|---:|---:|---:|
| agree | off | – | – | below 93% at every threshold | – |
| disagree | off | – | – | below 93% at every threshold | – |
| unrelated | 0.998 | 438 | 88.4% | 85.0% | 83.9% |

Targets (lower bound): agree 0.93, disagree 0.93, unrelated 0.85; at least 20 readings.
With these thresholds the model is sure of 56.0% of headlines; every headline of 5 of 67 claims (no hosted call).

## 3. Probe with these thresholds

Sure readings: 13 of 50; sure and wrong: **0**.

| id | kind | gold | ours (p) | sure | claim / headline |
|---|---|---|---|---|---|
| sp-04 | attribution | unrelated | agree (1.00) | no | TVK will win 150 seats in the Tamil Nadu election. / TVK will sweep with 150 seats, claims Vijay |
| sp-14 | bound | agree | disagree (1.00) | no | Nearly 90 people were injured in the stampede. / Stampede at temple fair leaves 87 injured |
| sp-27 | negation | agree | unrelated (1.00) | no | The government has not banned 500 rupee notes. / No plan to withdraw Rs 500 notes, says Finance Ministry |
| sp-34 | time | unrelated | agree (1.00) | no | The elephant that fell into the well in Coimbatore was rescued. / Rescue operations under way for elephant that fell into well in Coimba |
| sp-42 | partial | unrelated | agree (1.00) | no | India won 85 medals at the Asian Games and the RBI cut the repo rate b / Asian Games 2026: India finish fourth with 85 medals |
| sp-48 | multilingual | agree | disagree (0.96) | no | சென்னையில் கனமழை காரணமாக பள்ளிகளுக்கு விடுமுறை அறிவிக்கப்பட்டது. / Chennai rains: schools shut as heavy downpour lashes city |

\* a pattern synthesised for training.

## 4. Cost on this CPU

Model file 239.9 MB (GitHub refuses files over 100 MB). Memory added once loaded: about 648 MB.
Latency with 2 threads: one pair 99 ms, a batch of 16 667 ms.
