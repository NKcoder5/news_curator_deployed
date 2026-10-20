# Our own pair model for the stance step: measured, not adopted (21 Oct 2026)

**Question.** Can our own 118M-parameter multilingual pair model take the headline-stance step (does this
headline agree with the claim, disagree with it, or say nothing about it?) from the hosted model, so that a
spent Gemini quota does not turn answerable checks into UNPROVEN?

**Data.** 3,830 headline–claim pairs over 339 claims, every headline the verifier's stance step showed Gemini,
with Gemini's answer (995 agree, 527 disagree, 2,308 unrelated): `stance_pairs.jsonl`, from
`eval/stanceAgreement.js` over the reviewer probe, robustness and older held-out suites and 225 claims from
Google News India on 20 Oct 2026 (65 of them one-detail-changed copies, `eval/stanceClaims.js`). Split by
claim: 67 claims (782 pairs) held out. The benchmark and held-out v2 were kept out entirely.

**Training.** `ml/colab/train_pair_model.ipynb` on a Colab T4: the shipped model's recipe (multilingual
MiniLMv2-L12 from its MNLI/XNLI checkpoint, 2 epochs, lr 3e-5, 194,333 pairs: the public sets it learned from
plus our pairs ×3), 32.5 minutes, exported int8 with a pruned vocabulary (42 MB).

## Results on the held-out pairs (Gemini as reference)

| | shipped model | retrained |
|---|---:|---:|
| agreement with Gemini | 58.8% | 75.6% |
| true claims read as contradicted (false-contradiction) | 17.8% | 9.8% |
| read as agreeing when Gemini did not (false-entailment) | 10.3% | 4.9% |

Precision of the retrained model's readings by its confidence:

| its reading | at 0.5 | at 0.9 | at 0.97 | at 0.99 |
|---|---:|---:|---:|---:|
| agree | 84% | 88% | 88% | 87% |
| disagree | 42% | 52% | 55% | 57% |
| unrelated | 80% | 84% | 88% | 89% |

On the general sets it is level with the shipped model (MNLI, FEVER, FNC-1, XNLI Hindi, IndicXNLI Tamil and
Hindi, blind pairs within ±3 points); on unseen encyclopedia-style synthetic pairs its false-contradiction rate
rose from 1% to 7%, which is the kind of pair the premise-check veto reads.

## Why it is not used

Precision does not rise with confidence: its sure mistakes are systematic, not noise. Read by hand, the
confident errors on held-out claims are cases Gemini gets right:

- a bound read as a different figure: "India crossed 80 medals" against "India signs off with 85 medals" (disagree);
- a negated claim against an unrelated headline about the same person: "PM Modi has not resigned" (disagree);
- speculation and a contrary outcome read as the fact: "RBI raised the repo rate to 5.50%" against "Repo rate may rise" and "The RBI has maintained..." (agree);
- another company: "Qualcomm to cut jobs" against "Monday.com cuts hundreds of jobs" (agree);
- an attribution read as the fact: "Drinking cow urine cures cancer" against "Cow dung, urine can cure cancer: BJP MP" (agree).

Each of these would turn a check the system now answers safely (UNPROVEN when the hosted model is unavailable)
into a wrong verdict. `STANCE_MODEL` stays `off`; the shipped model keeps its present uses (premise veto,
claim matching, cross-script relevance), where it was measured. The candidate is kept, untracked, in
`ml/artifacts/candidate-2026-10-21`.

Reproduce: `LOCAL_NLI_MODEL_DIR=<candidate> node <thresholds script>` over `stance_pairs.jsonl` with the
held-out claim list rebuilt by `build_data.py`'s split (seed 7, first fifth of the sorted, shuffled claim ids).
