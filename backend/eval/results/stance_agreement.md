# Stance: our model against the hosted model

Measured 2026-10-25 on 459 claims, 5226 headlines; 5226 judged by Gemini are compared (other providers are recorded but not used as reference).

## Confusion (rows: Gemini, columns: our model)

| Gemini \ ours | agree | disagree | unrelated | total |
|---|---|---|---|---|
| agree | 725 | 140 | 560 | 1425 |
| disagree | 115 | 390 | 243 | 748 |
| unrelated | 336 | 630 | 2087 | 3053 |

Overall agreement: 3202 / 5226 (61.3%).

## When our model is confident

Coverage is the share of headlines where our top probability is at least the threshold; agreement is measured on those only. Precision for "disagree" matters most: a wrong "disagree" can make a true claim FAKE.

| threshold | coverage | agreement | agree precision | disagree precision |
|---|---|---|---|---|
| 0.5 | 94.7% | 62.1% | 63.4% (1097) | 34.2% (1091) |
| 0.6 | 84.9% | 64.2% | 67.6% (959) | 36% (973) |
| 0.7 | 75.6% | 65.6% | 69.7% (837) | 37.4% (871) |
| 0.8 | 64.8% | 67.2% | 73.5% (699) | 38.9% (743) |
| 0.9 | 52% | 69.4% | 77.9% (548) | 40.9% (591) |
| 0.95 | 41.9% | 71.6% | 82.4% (432) | 43% (467) |
| 0.98 | 30.9% | 73.8% | 83.7% (300) | 46.2% (340) |

Headlines by provider: gemini 5226.
