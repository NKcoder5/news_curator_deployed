# Stance: our model against the hosted model

Measured 2026-10-20 on 339 claims, 3830 headlines; 3830 judged by Gemini are compared (other providers are recorded but not used as reference).

## Confusion (rows: Gemini, columns: our model)

| Gemini \ ours | agree | disagree | unrelated | total |
|---|---|---|---|---|
| agree | 488 | 94 | 413 | 995 |
| disagree | 65 | 271 | 191 | 527 |
| unrelated | 256 | 486 | 1566 | 2308 |

Overall agreement: 2325 / 3830 (60.7%).

## When our model is confident

Coverage is the share of headlines where our top probability is at least the threshold; agreement is measured on those only. Precision for "disagree" matters most: a wrong "disagree" can make a true claim FAKE.

| threshold | coverage | agreement | agree precision | disagree precision |
|---|---|---|---|---|
| 0.5 | 95.1% | 61.4% | 61.9% (756) | 32.4% (803) |
| 0.6 | 85.5% | 63.2% | 65.6% (669) | 34.2% (710) |
| 0.7 | 76.6% | 64.4% | 67.3% (597) | 36.1% (634) |
| 0.8 | 65.6% | 66% | 71.6% (503) | 37.8% (539) |
| 0.9 | 52.5% | 68.2% | 76.1% (389) | 40.7% (432) |
| 0.95 | 42.8% | 70.3% | 79.9% (313) | 43.2% (340) |
| 0.98 | 32.2% | 72.5% | 79.5% (220) | 46.2% (253) |

Headlines by provider: gemini 3830.
