# Selective accuracy and calibration

Generated 2026-10-14 06:26 UTC from robustness_final.json (55), robustness_heldout_final.json (27), checkAnything_benchmark.json (22), robustness_heldout_v2.json (51), consistency_with_memory.json (48).
Coverage: of the cases that deserved a verdict, how many got one. Accuracy when answered: of the verdicts given, how many were right or acceptable. Wrong direction: REAL for something false, or FAKE / PARTLY FALSE for something true. Intervals are 95% Wilson.

| Group | Cases | Coverage | Accuracy when answered | Wrong direction | Abstentions that were due |
|---|---|---|---|---|---|
| tuned | 55 | 49/50 = 98% (90%–100%) | 49/49 = 100% (93%–100%) | 0/49 = 0% (0%–7%) | 5/6 = 83% (44%–97%) |
| held-out | 100 | 88/95 = 93% (86%–96%) | 87/88 = 99% (94%–100%) | 0/88 = 0% (0%–4%) | 6/12 = 50% (25%–75%) |
| heldout | 27 | 23/25 = 92% (75%–98%) | 22/23 = 96% (79%–99%) | 0/23 = 0% (0%–14%) | 3/4 = 75% (30%–95%) |
| benchmark | 22 | 21/22 = 96% (78%–99%) | 21/21 = 100% (85%–100%) | 0/21 = 0% (0%–16%) | 0/1 = 0% (0%–79%) |
| heldout_v2 | 51 | 44/48 = 92% (80%–97%) | 44/44 = 100% (92%–100%) | 0/44 = 0% (0%–8%) | 3/7 = 43% (16%–75%) |
| consistency (memory on) | 48 | 46/48 = 96% (86%–99%) | 46/46 = 100% (92%–100%) | 0/46 = 0% (0%–8%) | 0/2 = 0% (0%–66%) |

## Precision of each call

| Group | REAL | FAKE | PARTLY FALSE | MISLEADING | CANNOT VERIFY | REFUSED |
|---|---|---|---|---|---|---|
| tuned | 24/24 = 100% (86%–100%) | 24/24 = 100% (86%–100%) | 1/1 = 100% (21%–100%) | – | 0/1 = 0% (0%–79%) | 5/5 = 100% (57%–100%) |
| held-out | 37/37 = 100% (91%–100%) | 47/47 = 100% (92%–100%) | 3/4 = 75% (30%–95%) | – | 2/7 = 29% (8%–64%) | 4/5 = 80% (38%–96%) |
| heldout | 13/13 = 100% (77%–100%) | 8/8 = 100% (68%–100%) | 1/2 = 50% (10%–91%) | – | 2/3 = 67% (21%–94%) | 1/1 = 100% (21%–100%) |
| benchmark | 9/9 = 100% (70%–100%) | 12/12 = 100% (76%–100%) | – | – | 0/1 = 0% (0%–79%) | – |
| heldout_v2 | 15/15 = 100% (80%–100%) | 27/27 = 100% (88%–100%) | 2/2 = 100% (34%–100%) | – | 0/3 = 0% (0%–56%) | 3/4 = 75% (30%–95%) |
| consistency (memory on) | 23/23 = 100% (86%–100%) | 23/23 = 100% (86%–100%) | – | – | 0/1 = 0% (0%–79%) | 0/1 = 0% (0%–79%) |

## Stated confidence against observed accuracy

held-out: 65 verdicts with a recorded confidence, expected calibration error 0.163.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.0-0.6 | 3 | 0.56 | 100% |
| 0.6-0.7 | 4 | 0.622 | 100% |
| 0.7-0.8 | 17 | 0.738 | 100% |
| 0.8-0.9 | 8 | 0.85 | 100% |
| 0.9-1.0 | 33 | 0.936 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.9) 100% right; top 75% (confidence ≥ 0.75) 100% right; top 100% (confidence ≥ 0.55) 100% right.

benchmark: 21 verdicts with a recorded confidence, expected calibration error 0.159.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.0-0.6 | 1 | 0.55 | 100% |
| 0.6-0.7 | 2 | 0.6 | 100% |
| 0.7-0.8 | 4 | 0.773 | 100% |
| 0.8-0.9 | 3 | 0.84 | 100% |
| 0.9-1.0 | 11 | 0.936 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.9) 100% right; top 75% (confidence ≥ 0.77) 100% right; top 100% (confidence ≥ 0.55) 100% right.

heldout_v2: 44 verdicts with a recorded confidence, expected calibration error 0.165.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.0-0.6 | 2 | 0.565 | 100% |
| 0.6-0.7 | 2 | 0.645 | 100% |
| 0.7-0.8 | 13 | 0.728 | 100% |
| 0.8-0.9 | 5 | 0.856 | 100% |
| 0.9-1.0 | 22 | 0.936 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.9) 100% right; top 75% (confidence ≥ 0.72) 100% right; top 100% (confidence ≥ 0.55) 100% right.

consistency (memory on): 46 verdicts with a recorded confidence, expected calibration error 0.099.

| Confidence | Verdicts | Mean confidence | Right |
|---|---|---|---|
| 0.7-0.8 | 6 | 0.713 | 100% |
| 0.8-0.9 | 6 | 0.853 | 100% |
| 0.9-1.0 | 34 | 0.942 | 100% |

Answering only the most confident: top 25% (confidence ≥ 0.95) 100% right; top 50% (confidence ≥ 0.95) 100% right; top 75% (confidence ≥ 0.89) 100% right; top 100% (confidence ≥ 0.7) 100% right.

