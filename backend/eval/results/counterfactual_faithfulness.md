# Counterfactual faithfulness of the decision explainer

Run 2026-10-13 03:25 UTC, seed 12. Every statement services/decisionExplainer.js makes was recomputed with this script's own channel removals and hypothetical outlets through replayVerdict.

| Ledgers | Count | Statements checked | Agree | Rate |
|---|---|---|---|---|
| stored | 14 | 200 | 200 | 100.0% |
| scenarios | 380 | 4130 | 4130 | 100.0% |
| random | 2000 | 27942 | 27942 | 100.0% |

| Statement | stored | scenarios | random |
|---|---|---|---|
| verdict | 14/14 | 380/380 | 2000/2000 |
| channels present | 14/14 | 380/380 | 2000/2000 |
| decisive | 44/44 | 395/395 | 5999/5999 |
| from absence | 14/14 | 380/380 | 2000/2000 |
| rests on | 44/44 | 435/435 | 5473/5473 |
| would change | 14/14 | 510/510 | 2235/2235 |
| would change (smallest) | 14/14 | 510/510 | 2235/2235 |
| would change (complete) | 28/28 | 760/760 | 4000/4000 |
| would change (ruling) | 14/14 | 380/380 | 2000/2000 |

Sensitivity (not counted above): the explainer dates its hypothetical outlets at the moment of the check. Dated half an hour earlier instead, a "would change" step reaches a different verdict for 0 stored, 0 scenarios, 0 random ledgers.

## Disagreements: none


## Monotonicity over 20000 random ledgers

| More evidence | Direction | Tried | Made it the wrong way | Rate |
|---|---|---|---|---|
| a fact-checker rates it false | against | 13886 | 0 | 0.0% |
| two more fresh outlets report otherwise | against | 20000 | 12 | 0.1% |
| the encyclopedia contradicts it | against | 17019 | 0 | 0.0% |
| two more fresh outlets confirm it | for | 20000 | 0 | 0.0% |
| a fact-checker rates it true | for | 13886 | 0 | 0.0% |

two more fresh outlets report otherwise:
- 4 × PARTLY FALSE (true-claim-carrying-a-false-one) -> CANNOT VERIFY (fact-checkers-and-reporting-disagree)
- 2 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (rated-true-by-fact-checkers)
- 2 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (confirmed-by-reference)
- 1 × CANNOT VERIFY (only-partly-confirmed) -> REAL (corroborated-by-multiple-independent-sources)
- 1 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (corroborated-by-multiple-independent-sources)
- 1 × PARTLY FALSE (true-claim-carrying-a-false-one) -> CANNOT VERIFY (no-independent-coverage)
