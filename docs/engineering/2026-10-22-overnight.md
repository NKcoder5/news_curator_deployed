# Overnight, 21–22 October 2026

Nineteen commits on `main`, local only: nothing pushed or deployed, and the report and paper untouched,
until the team agrees. Backend tests 433/433, frontend 42/42, production build compiles.

## Faults found and fixed (each was live in the product)

| # | What happened | Found by | Now |
|---|---|---|---|
| 1 | The encyclopedia check was cut off at 15 s, started only after the message was read: "Giraffe is a fish" and "Mount Everest is in Africa" came back UNPROVEN | reviewer probe, then timing the check alone (9 s) | the reference and fact-check channels wait as long as the news search; both FAKE, quoting the entry |
| 2 | In a message naming someone *and* stating a general fact, the general fact was never looked up ("Chennai is the capital of Tamil Nadu and the giraffe is a fish" → only partly confirmed) | reviewer probe | subjects the early check missed are looked up and merged: PARTLY FALSE |
| 3 | The figure check, which overrules the stance step, ruled true bound claims false ("India *crossed* 80 medals" vs 85) | probing the deterministic layer | a figure's wording sets its range; ranges that overlap do not conflict |
| 4 | Rounded figures ruled false ("Rs 5 crore" vs "Rs 5.2 crore") | same | figures compared at the precision they are written in; counts and codes stay exact |
| 5 | A margin compared with a total (held-out v2-40, true, came back FAKE: "chased 250 runs" vs "won by 14 runs") | regression run | a margin is compared only with a margin |
| 6 | Claims about what a video or picture shows were called REAL on reports of the event | ruling suite, channel off: 6 of 10 wrong answers | UNPROVEN with the reason, unless a fact-checker ruled on the media (rule R4m) |
| 7 | "Government is giving free laptops to all students, register at the link" was refused as naming no one | reviewer probe | public institutions are actors; private persons ("my neighbour Ramesh") are not; "my uncle says X" is checked |
| 8 | Two regular expressions began with a backspace character instead of `\b` (one since 14 Oct: the guard that keeps a title addressed to a model from becoming a claim) | inspecting a failing pattern, then scanning all source | repaired; no control characters left |
| 9 | Claim memory stored the submitted page's full URL | review of the stored record | a one-way print of the address and the outlet's host only |
| 10 | Same input, different verdict an hour later (3 of 4 wrong answers in the regression were this) | re-running the wrong cases | judgements on identical evidence are stored for a day |
| 11 | The suite runner sent links as text, so link cases were refused by the runner, not the system | reviewer probe | links are checked as links |

## New

- **Reader's record** on the dashboard: what the checks found about the stories a reader opened, week by
  week and by outlet; checked at 375 px.
- **Outlet record**: `GET /api/claims/outlets/:host` and a line under a checked link. Informational,
  never fed into a verdict.
- **Ruling suite**: 320 claims labelled by 29 fact-checking desks' published rulings (`eval/suites/rulings.json`),
  with `FACT_CHECK_CHANNEL=off|strict` so the desks' own rulings cannot inflate the score.
- **Stance tooling**: a gold probe of 50 hand-labelled pairs, and `eval/stanceCandidate.js`, which sets each
  stance's threshold where the lower end of its 95% Wilson interval reaches the target, or switches it off.

## Measured

- **Regression before the fixes**: benchmark 20/22 (both misses right on a re-run), held-out v2 46/51 (2 wrong:
  one fixed as #5, one right on a re-run), reviewer probe 37/44 with none wrong (misses fixed as #1, #2, #7, #11).
- **Ruling suite, 60-case sample, fact-check channel off**: 25 right, 9 safe, 16 missed, 10 wrong; six of the
  ten are fixed by #6. The other four: a misattributed quote, two news-like claims the desks dispute, and a
  "before and after" comparison image.
- **Our own stance model**: shipped 58.8% agreement with Gemini; MiniLM retrained 75.6% (not adopted: its
  confident mistakes are systematic); mDeBERTa trained cleanly (development pairs 91.2%, our stance pairs
  79.4%), but the ONNX export failed on Colab and the weights were lost with the session. The notebook now
  checks the export on the base model first and saves the trained model to Google Drive.

## Needs a decision

1. Push and deploy (both remotes), and two Render dashboard settings: the static site's rule must be
   **Rewrite**, not Redirect; and the API service's latest deploy log should be checked.
2. Re-run the Colab notebook for mDeBERTa (about 2½ hours; nothing lost if a later step fails).
3. Measurements after all fixes are running now; see `eval/results/*_after_fixes.*`.
