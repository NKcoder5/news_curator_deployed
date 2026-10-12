# Counterfactual faithfulness of the decision explainer

Run 2026-10-12 15:44 UTC, seed 12. Every statement services/decisionExplainer.js makes was recomputed with this script's own channel removals and hypothetical outlets through replayVerdict.

| Ledgers | Count | Statements checked | Agree | Rate |
|---|---|---|---|---|
| stored | 14 | 196 | 196 | 100.0% |
| scenarios | 380 | 4042 | 4042 | 100.0% |
| random | 2000 | 27431 | 27431 | 100.0% |

| Statement | stored | scenarios | random |
|---|---|---|---|
| verdict | 14/14 | 380/380 | 2000/2000 |
| channels present | 14/14 | 380/380 | 2000/2000 |
| decisive | 44/44 | 395/395 | 5999/5999 |
| from absence | 14/14 | 380/380 | 2000/2000 |
| rests on | 44/44 | 435/435 | 5458/5458 |
| would change | 12/12 | 466/466 | 1987/1987 |
| would change (smallest) | 12/12 | 466/466 | 1987/1987 |
| would change (complete) | 28/28 | 760/760 | 4000/4000 |
| would change (ruling) | 14/14 | 380/380 | 2000/2000 |

Sensitivity (not counted above): the explainer's hypothetical outlets carry no date. Dated today instead, a "would change" step reaches a different verdict for 1 stored, 24 scenarios, 93 random ledgers. Example (old-news-presented-as-new): REAL with 1 confirming outlets dated today; the explainer does not offer it.

## Disagreements: none


## Monotonicity over 20000 random ledgers

| More evidence | Direction | Tried | Made it the wrong way | Rate |
|---|---|---|---|---|
| a fact-checker rates it false | against | 13886 | 0 | 0.0% |
| two more fresh outlets report otherwise | against | 20000 | 269 | 1.3% |
| the encyclopedia contradicts it | against | 17019 | 0 | 0.0% |
| two more fresh outlets confirm it | for | 20000 | 84 | 0.4% |
| a fact-checker rates it true | for | 13886 | 0 | 0.0% |

two more fresh outlets report otherwise:
- 257 × FAKE (premise-contradicted-by-reference) -> PARTLY FALSE (claims-partly-false)
- 4 × PARTLY FALSE (true-claim-carrying-a-false-one) -> CANNOT VERIFY (fact-checkers-and-reporting-disagree)
- 2 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (rated-true-by-fact-checkers)
- 2 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (confirmed-by-reference)
- 1 × CANNOT VERIFY (only-partly-confirmed) -> REAL (corroborated-by-multiple-independent-sources)
- 1 × PARTLY FALSE (true-claim-carrying-a-false-one) -> REAL (corroborated-by-multiple-independent-sources)

two more fresh outlets confirm it:
- 84 × PARTLY FALSE (claims-partly-false) -> FAKE (premise-contradicted-by-reference)
