# Own hardware: Pure Press with no bills and no outside AI (26 October 2026)

Development note. The report, paper and deck are frozen and are not changed by this work.

## Why

Nothing in Pure Press is billed: Render's free web service, MongoDB Atlas M0, Google News RSS, Google's
Fact Check Tools API, Wikipedia, Gemini's and NVIDIA NIM's free tiers. What the verdicts depend on is not a
bill but other companies' free tiers, and those change: on rulings 1-60 the deployed setup (Gemini reading)
gets 27 right, every setup without Gemini 11-17. Checked on 26 October:

- Hugging Face now needs a paid plan for any Space that runs code, so our larger pair model cannot be served
  there for free.
- Cerebras' free tier now needs a payment method. Groq is still free without a card, but small (about 200k
  tokens a day per model): a backup at most.
- Render's free instance has 512 MB and a tenth of a CPU. It runs the rules and the 42 MB pair model; it
  cannot run a language model, and even mDeBERTa would be slow there.

The only compute the team fully owns is the laptop: an RTX 5050 (8 GB) that already runs Ollama. So the
reading moves there when it is on, and the free tiers stay as backup.

## What was built

| Piece | Where | What it does |
|---|---|---|
| `HOSTED_AI=off` | `utils/llmProviders.js` | Gemini and NIM are left out even with their keys set: no outside AI at all. |
| The laptop as model host | `scripts/ownModelServer.js` (`npm run own-model-server`) | A proxy on 127.0.0.1:8787 that admits only this session's token and only Ollama's generate, chat, tags and version endpoints for one model; a Cloudflare quick tunnel (no account); a check-in to the deployed API every minute. |
| The check-in | `POST /api/internal/model-host`, `services/modelHost.js` | Internal key only. Accepts an https origin on `OWN_MODEL_HOSTS` (default `trycloudflare.com`). The laptop counts as gone 3 minutes after its last check-in; a call that finds it gone (Cloudflare 530, 502, 504, 401, a lost connection) leaves it alone for 2 minutes. `/ready` shows `checks.ownHardware`, never the address or the token. |
| Where the laptop sits | `resolveProviderChain` | Right after Gemini on every task, so switching it on does not change the measured order of the others; first when Gemini is off or out of quota. |
| Thinking off | Ollama provider | Qwen3 / DeepSeek-R1 / Magistral models are sent `think: false`. |
| One GPU, one queue | `utils/nvidiaNimApi.js` | Queued calls go in priority order: reading the message, then evidence judgements, then the writing checks; one slot is kept free of the writing checks. |
| Deadline | `services/contentCheck.js` | The evidence channels get 30 s instead of 15 s (the news search 90 s instead of 45 s) when only own hardware reads. |
| Read by | `readBy` in the Check Anything response, `VerdictHeader.js` | Under the verdict: which models read the message, and "no outside AI" when none was Gemini or NIM. |

Tested end to end on 26 October against a local server with `HOSTED_AI=off`: a check answered through a
real tunnel in 45 s; with the laptop killed mid-session, the next check finished in 10 s (decided by the
figures, with no model). Two faults found and fixed on the way: a quick tunnel sometimes dies seconds after
printing its address, and Windows remembers a "no such name" answer for a new tunnel probed too early (probed
after 20 s it answered first time).

## Measured (rulings 1-60, `FACT_CHECK_CHANNEL=others`: each case's own ruling hidden)

| Setup | Right | Safe | Missed | Wrong |
|---|---|---|---|---|
| Gemini reading (as deployed, 25 Oct) | 27 | 10 | 21 | 2 |
| Ollama llama3.1:8b + NIM (25 Oct) | 15 | 6 | 37 | 2 |
| NIM alone, Nemotron 3 Super (25 Oct) | 14 | 7 | 38 | 1 |
| Our own pair model only, no language model (25 Oct) | 11 | 6 | 43 | 0 |
| **Laptop, llama3.1:8b alone (26 Oct)** | 16 | 11 | 27 | 6 |
| **Laptop, Qwen3.5 9B alone, before the queue fix (26 Oct, 5 cases)** | 1 | 1 | 3 | 0 |
| **Laptop, Qwen3.5 9B alone, with the queue fix (26 Oct)** | 24 | 10 | 26 | 0 |

Gate for calling the laptop a primary reader: no more wrong than Gemini (2 or fewer), at least 20 right, and
a median check time of 60 s or less.

Qwen3.5 9B passes on accuracy (24 right, none wrong; Gemini 27 right, 2 wrong) and misses on time: median 78 s,
90th percentile 102 s, against Gemini's 20 s. About 13% of the model sits on the CPU (6.2 GB on an 8 GB card
that Windows also uses), which slows every answer. Of its 26 misses, 10 are "no independent coverage", 5 the
search not finishing in time, 4 fact-checkers and reporting disagreeing, 4 media not confirmed by reports.

llama3.1:8b fails it on wrong answers. Four of its six are one mistake: a headline about the same subject
read as confirming the claim ("Fiji HIV cases surge" for a claim that the surge is caused by vaccination).

## Running it

On the laptop, with Ollama running and the model pulled (`ollama pull qwen3.5:9b`):

```
cd backend
npm run own-model-server
```

`backend/.env` on the laptop needs `OWN_MODEL_API_KEY` set to the deployed server's `INTERNAL_API_KEY`. Keep the
laptop awake and on mains power. Ctrl+C signs off. For a check with no outside AI at all on a local server,
set `HOSTED_AI=off` and `OLLAMA_HOST=http://localhost:11434`.
