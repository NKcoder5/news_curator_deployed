# Selective accuracy and calibration

Generated 2026-10-12 15:46 UTC from robustness_final.json (55), robustness_heldout_final.json (27), checkAnything_benchmark.json (22).
Coverage: of the cases that deserved a verdict, how many got one. Accuracy when answered: of the verdicts given, how many were right or acceptable. Wrong direction: REAL for something false, or FAKE / PARTLY FALSE for something true. Intervals are 95% Wilson.

| Group | Cases | Coverage | Accuracy when answered | Wrong direction | Abstentions that were due |
|---|---|---|---|---|---|
| tuned | 55 | 49/50 = 98% (90%–100%) | 49/49 = 100% (93%–100%) | 0/49 = 0% (0%–7%) | 5/6 = 83% (44%–97%) |
| held-out | 49 | 44/47 = 94% (83%–98%) | 43/44 = 98% (88%–100%) | 0/44 = 0% (0%–8%) | 3/5 = 60% (23%–88%) |
| heldout | 27 | 23/25 = 92% (75%–98%) | 22/23 = 96% (79%–99%) | 0/23 = 0% (0%–14%) | 3/4 = 75% (30%–95%) |
| benchmark | 22 | 21/22 = 96% (78%–99%) | 21/21 = 100% (85%–100%) | 0/21 = 0% (0%–16%) | 0/1 = 0% (0%–79%) |

## Precision of each call

| Group | REAL | FAKE | PARTLY FALSE | MISLEADING | CANNOT VERIFY | REFUSED |
|---|---|---|---|---|---|---|
| tuned | 24/24 = 100% (86%–100%) | 24/24 = 100% (86%–100%) | 1/1 = 100% (21%–100%) | – | 0/1 = 0% (0%–79%) | 5/5 = 100% (57%–100%) |
| held-out | 22/22 = 100% (85%–100%) | 20/20 = 100% (84%–100%) | 1/2 = 50% (10%–91%) | – | 2/4 = 50% (15%–85%) | 1/1 = 100% (21%–100%) |
| heldout | 13/13 = 100% (77%–100%) | 8/8 = 100% (68%–100%) | 1/2 = 50% (10%–91%) | – | 2/3 = 67% (21%–94%) | 1/1 = 100% (21%–100%) |
| benchmark | 9/9 = 100% (70%–100%) | 12/12 = 100% (76%–100%) | – | – | 0/1 = 0% (0%–79%) | – |

## Stated confidence against observed accuracy

held-out: 21 verdicts with a recorded confidence, expected calibration error 0.144.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.0-0.6 | 1 | 0.55 | 100% |
| 0.6-0.7 | 2 | 0.6 | 100% |
| 0.7-0.8 | 3 | 0.77 | 100% |
| 0.8-0.9 | 1 | 0.84 | 100% |
| 0.9-1.0 | 14 | 0.934 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.91) 100% right; top 75% (confidence ≥ 0.77) 100% right; top 100% (confidence ≥ 0.55) 100% right.

benchmark: 21 verdicts with a recorded confidence, expected calibration error 0.144.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.0-0.6 | 1 | 0.55 | 100% |
| 0.6-0.7 | 2 | 0.6 | 100% |
| 0.7-0.8 | 3 | 0.77 | 100% |
| 0.8-0.9 | 1 | 0.84 | 100% |
| 0.9-1.0 | 14 | 0.934 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.91) 100% right; top 75% (confidence ≥ 0.77) 100% right; top 100% (confidence ≥ 0.55) 100% right.

