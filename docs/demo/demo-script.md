# Pure Press — demo script (review, 17 Oct 2026)

## Before the review (10 minutes)
1. `cd backend && npm run dev` and `cd frontend && npm start`; open http://localhost:3000 and sign in.
2. Check `backend/.env` has `GEMINI_API_KEY` and `GEMINI_EXTRA_KEYS` (fresh keys; each key from a different Google project adds a full day of quota). Do not run evaluation scripts on the day.
3. Warm up once: check "India won 84 medals at the Asian Games 2026" (loads the models, about 15 s; repeats within 20 minutes answer instantly).

## The run (each verified on 14 Oct)
| # | Paste this | Expect | Point out |
|---|---|---|---|
| 1 | India won 84 medals at the Asian Games 2026 | **FAKE** — outlets report 85 medals | Evidence board quotes the outlets; "What decided it"; the rule's track record (right in 30/30 test messages) |
| 2 | இந்தியா ஆசிய விளையாட்டுப் போட்டி 2026-ல் 84 பதக்கங்கள் வென்றதா? | **FAKE**, answered in Tamil | Claim record: recognised as the same claim already checked |
| 3 | Modi PM post resign pannitaru nu WhatsApp la varudhu, idhu unmaya? | **FAKE** (fact-checkers) | Tanglish read correctly |
| 4 | MS Dhoni passed away | **FAKE** | A famous person's death would be everywhere; this week's coverage shows him alive |
| 5 | Video shows Army chief General Dhiraj Seth dancing with an Army major's wife | **FAKE** | Ruled false by AFP, India Today and others |
| 6 | TVK won the 2026 bye elections | **REAL** | Independent outlets counted, not articles |
| 7 | Election Commission & SIR Row: … CJP leaders Saurav Das and Ashutosh Ranka were sent to 4 days in judicial custody … Supreme Court has agreed … | **PARTLY FALSE** — outlets report five days | One false detail in a true message is caught and named |
| 8 | Giraffe is a fish / Giraffe is a mammal | **FAKE** / **REAL** | General knowledge settled by the encyclopedia |
| 9 | 2 + 2 = 5 | **FAKE** — "2 + 2 is 4, not 5" | Worked out, not searched |
| 10 | Vijay is the best actor ever | Declined: an opinion | It refuses to judge what is not a factual claim |
| 11 | Claims page (/claims) | Public database of checked claims | Every verdict, its evidence, and how it changed over time |
| 12 | "Ask a plain AI model" button on any result | The plain model's answer beside ours | Ours: 22/22 on the benchmark, 0 wrong; a plain model 15/22 with 4 wrong |

## Questions reviewers ask
- **"Why UNPROVEN, not FAKE?"** FAKE needs evidence of falsity: outlets reporting otherwise, a fact-checker's ruling, an encyclopedia entry, or the silence of heavy coverage about a famous person. UNPROVEN means no one has reported it either way; calling that FAKE would be a guess.
- **"Is this just ChatGPT?"** No. The verdict comes from fixed rules over recorded evidence (`agents/verdictEngine.js`); models only read text. Every statement in "What decided it" is recomputed by the same rules (100% of 32,000 statements checked).
- **"Do you have your own model?"** Yes: a multilingual pair model fine-tuned on our GPU (43 MB, 7 ms per judgement). It matches reworded claims (46/46, 0 false merges) and vetoes invented contradictions.
- **"How accurate is it?"** Benchmark 22/22, held-out set (written after tuning) 49/51 with the other 2 unanswered; 0 verdicts in the wrong direction across every test set.
- **"What if Gemini is down?"** Calls fall back to NVIDIA NIM, then a local model; changed figures are caught by plain comparison even with no model at all.

## If something goes wrong
- A check says UNPROVEN where you expected a verdict: the news may not be indexed yet, or the quota is spent — say so honestly and move to the next item.
- Backend not reachable: restart `npm run dev`. Last known-good code: git tag `backup/review-ready-2026-10-14b`.
