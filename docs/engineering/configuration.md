# Configuration

Every environment variable the code reads, what it does, whether it is needed, and
what stops working without it. Compiled by reading each `process.env` use in
`backend/` and `frontend/src/`; the copyable versions are `backend/.env.example`,
`frontend/.env.example` and the root `.env.example` (Docker Compose only).

## How values reach the code

| Where it runs | Where the values come from |
|---|---|
| Backend on a laptop | `backend/.env`, loaded by `dotenv` from the **current directory**, so start the server from `backend/` (`npm start`, `npm run dev`). A variable already set in the environment is not overridden by the file. |
| Frontend on a laptop | `frontend/.env.local` (or `.env`). Create React App reads `REACT_APP_*` when it **builds**; restart `npm start` after a change. |
| Docker Compose | The API reads `backend/.env`; Compose then overrides `MONGO_URI`, `PORT` and `CORS_ORIGINS` (see below). Compose's own `${...}` values come from a root `.env`. |
| Render | The dashboard, seeded from `render.yaml`. Variables marked `sync: false` there are asked for when the blueprint is created. |
| Tests / CI | None. The suites need no `.env`, database, key or network. |

### Two traps

- **Blank is not unset.** `RECHECK_DAILY_CAP=` is read as `0` and switches
  re-checks off; `NEWS_INDEX_LAG_HOURS=` is read as `0` and tells the verdict
  engine the news index is live; a placeholder `GEMINI_API_KEY=your-key` counts as
  a configured key, so the gateway tries it, fails, and only then moves on. The
  example files therefore comment out every optional line. Leave a variable
  commented out unless you mean to set it.
- **`REACT_APP_API_URL` has two shapes.** `frontend/src/services/api.js` (and the
  Check Anything page, which reads `api.defaults.baseURL`) expects the address
  **with** `/api`; `ArticlePage`, `LoginPage` and `SignupPage` expect the bare
  server address, and append `/api/...` themselves. Setting it correctly for one
  group breaks the other. Until the app reads one shared value, leave it unset:
  the app then uses `http://localhost:5000` locally and
  `https://news-curator-deployed.onrender.com` on any `*.onrender.com` host.

## Backend

### Required

| Variable | Default | What it does | Without it |
|---|---|---|---|
| `MONGO_URI` | none | MongoDB connection string for accounts, reading history, the report and summary caches and the claim memory. | The server exits at start-up (`utils/db.js`). |
| `JWT_SECRET` | none | Signs and verifies 24-hour sign-in tokens. Use a long random value (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and keep it stable: changing it signs every reader out. | The server starts, but sign-up and sign-in fail with a 500 and every protected route answers 401. That includes all of `/api/ai`, unless `INTERNAL_API_KEY` is used. |

### Server

| Variable | Default | What it does | Without it |
|---|---|---|---|
| `PORT` | `5000` | Port the API listens on. Render and most hosts set it themselves. | Uses 5000. |
| `CORS_ORIGINS` | none | Comma-separated browser origins allowed to call the API, added to the built-in `http://localhost:3000` and `https://news-curator-deployed.onrender.com`. | A web app served from any other address (another port, a custom domain, the Compose stack on a different port) is refused by the browser on every call. |

### Language models

At least one of Gemini, NVIDIA NIM or Ollama is needed for a full check. Gemini
is optional. Providers are tried in the order set by `data/taskRouting.json`
(measured per task), or by `LLM_PROVIDER` if that is set; any other configured
provider is a failover. For a Gemini-free setup, leave `LLM_PROVIDER` unset:
Ollama leads the writing and extraction tasks, while NIM leads premise checks
because the shipped local model is not reliable enough for that task.

| Variable | Default | What it does | Without it |
|---|---|---|---|
| `GEMINI_API_KEY` | none | Switches Gemini on. The gateway rotates across six Gemini models, each with its own free-tier daily quota, and skips a model whose quota is spent. | Gemini is left out of the chain. |
| `GEMINI_EXTRA_KEYS` | none | More Gemini keys, comma-separated or across numbered variables (`GEMINI_EXTRA_KEYS2`, `GEMINI_EXTRA_KEYS3`, etc.), from other Google Cloud projects. Each adds a full day of quota per model. Only used when `GEMINI_API_KEY` is also set. | One key's quota only. |
| `GEMINI_MODEL_NAME` | `gemini-3.1-flash-lite` | Replaces the first model in the Gemini rotation. | Default first model. |
| `NIM_API_KEY` | none | Switches NVIDIA NIM on. | NIM is left out of the chain. |
| `NIM_MODEL_NAME` | `nvidia/nemotron-3-ultra-550b-a55b` | Replaces the first model in the NIM rotation. `NIM_MODEL_ONLY=1` keeps to this model alone (for measuring one model). | Default first model. |
| `HOSTED_AI` | none | `off` leaves Gemini and NIM out even when their keys are set, so every reading is done on the team's own hardware (Ollama) and by our pair model. | Hosted providers are used when their keys are set. |
| `OLLAMA_HOST` | none | Address of an Ollama server, e.g. `http://localhost:11434`. Setting it switches the local provider on; the writing checks are routed to it first. It wins over a laptop check-in. | The laptop's check-in, if any; otherwise no local model, and nothing waits on a connection that cannot succeed. |
| `OLLAMA_TOKEN` | none | Sent as `Authorization: Bearer` to `OLLAMA_HOST`, for an Ollama behind the token proxy. | No token sent. |
| `OLLAMA_MODEL` | `llama3.1:8b` | First model tried on Ollama (then `mistral:7b`, `phi3:mini`); a checked-in laptop's own model comes before it. Models whose name matches `qwen3`, `deepseek-r1` or `magistral` are asked not to think. | Default. |
| `OLLAMA_MAX_CONCURRENT` | `2` | Calls in flight to Ollama. | Default. |
| `OWN_MODEL_HOSTS` | `trycloudflare.com` | Hosts a laptop check-in (`POST /api/internal/model-host`) may name, comma-separated. | Quick tunnels only. |

**The laptop as the model server** (`npm run own-model-server` in `backend/`, on
the laptop). It starts a token proxy in front of Ollama on `127.0.0.1:8787`, a
Cloudflare quick tunnel (`cloudflared`, no account; found on `PATH`, in
`%LOCALAPPDATA%\cloudflared` or at `CLOUDFLARED`), and checks in with the deployed
API every minute. It reads `OWN_MODEL_API_URL` (default the Render URL),
`OWN_MODEL_API_KEY` (the deployed server's `INTERNAL_API_KEY`; the local
`INTERNAL_API_KEY` is used when unset) and `OWN_MODEL` (default `qwen3.5:9b`) from
`backend/.env`. The deployed server uses the laptop while check-ins arrive, leaves
it alone for two minutes when a call finds it gone, and counts it as gone three
minutes after the last check-in. `GET /ready` shows `checks.ownHardware`.
| `LLM_PROVIDER` | none | Forces the provider order, e.g. `gemini,nim,ollama`. When set it overrides the routing table. | Routing table order. |
| `LLM_MAX_CONCURRENT` (alias `NIM_MAX_CONCURRENT`) | per provider: Gemini 6, NIM 2, Ollama 2 | Calls allowed in flight per provider. | Default. |

**With no provider configured** the system still answers, with less: the four
writing checks fall back to word-pattern matching and are listed in the report's
`degradedFactors`; message understanding (language, speech act, claims) is
skipped and the regular-expression gate decides what is checkable; stance
judgement against news headlines cannot run, so a claim comes back
`verification-unavailable` (CANNOT VERIFY, never FAKE); summaries and the
plain-model comparison fail or report `ERROR`.

### News and evidence

| Variable | Default | What it does | Without it |
|---|---|---|---|
| `NEWS_API_KEY` | none | NewsAPI key. Powers the home feed and is the second place coverage is searched, after Google News. The free plan allows 100 requests a day for the whole application. | The home feed falls back to Google News top stories (cached 15 minutes). Coverage search relies on Google News alone, which needs no key but finds fewer regional and older reports. `NEWS_KEY_INVALID` is returned only when nothing else can serve the request. |
| `NEWS_INDEX_LAG_HOURS` | `3` | How far behind real time the news index is assumed to run. A story newer than this gets `too-recent-to-corroborate` instead of "no outlet reports it". `0` on a plan that serves live articles. | Default. |
| `FACT_CHECK_API_KEY` | none | Google Fact Check Tools API key (needs a billing-enabled project; a Gemini key is rejected). | The same ClaimReview index is read through its public endpoint, which needs no key. |

Needing no key at all: Google News RSS, Wikipedia (premise check), RDAP (domain
age), YouTube captions, `r.jina.ai` (article reading fallback).

### Claim memory

| Variable | Default | What it does | Without it |
|---|---|---|---|
| `RECHECK_ENABLED` | `true` | Claims that came back CANNOT VERIFY are checked again after 6, 24 and 72 hours. `false` switches the scheduler off. | Scheduler on. |
| `RECHECK_DAILY_CAP` | `40` | Most re-checks started in any 24 hours, counted from stored assessments so a restart cannot reset it. Each spends model calls. | 40 a day. |

### Evaluation scripts only (`backend/eval`, not read by the server)

| Variable | Default | What it does |
|---|---|---|
| `INTERNAL_API_KEY` | none | Presented by the scripts in the `x-internal-key` header instead of a login. **Read by the server too** (`middleware/apiAccess.js`): when unset, that route into `/api/ai` is closed and only a login works. Do not set it on a deployment you do not run evaluations against. |
| `EVAL_RPM` | `30` | Requests per minute the evaluation runner makes. |
| `MATRIX_BASE` | `http://localhost:5000` | Backend the matrix check calls. |
| `MATRIX_ARTICLE`, `MATRIX_VIDEO` | none; a sample video | Link used for the article and video rows of the matrix check. |
| `MONGODB_URI` | none | Accepted instead of `MONGO_URI` by `scripts/prewarmTrustCache.js` and `eval/replayRecords.js`. |

### Tests and CI

| Variable | What it does |
|---|---|
| `CI_OFFLINE` | `1` makes `npm run test:ci` refuse every connection to another machine (`backend/test/support/offline.js`). Set by the CI workflow. `npm test` ignores it. |

## Frontend

| Variable | Default | What it does |
|---|---|---|
| `REACT_APP_API_URL` | none | Where the API lives; read at build time. See the trap above: leave unset. |
| `NODE_ENV` | set by Create React App | `development` turns on API error logging in the console. Not for you to set. |

## Docker Compose (root `.env`, all optional)

| Variable | Default | What it does |
|---|---|---|
| `FRONTEND_PORT` | `8080` | Host port of the web app. |
| `BACKEND_PORT` | `5000` | Host port of the API. The web app looks for the API at `localhost:5000`, so changing this needs `REACT_APP_API_URL`, with the trap above. |
| `CORS_ORIGINS` | `http://localhost:8080` | Passed to the API as its allowed origin. Set it to the web app's address if you change `FRONTEND_PORT`. Overrides `CORS_ORIGINS` in `backend/.env`. |
| `REACT_APP_API_URL` | empty | Build argument for the web image. |

Compose gives the API its own Mongo (`mongodb://mongo:27017/news_curator`,
volume `mongo-data`) whatever `MONGO_URI` says in `backend/.env`, so a throwaway
stack never writes into the database you develop against. Remove that override
in `docker-compose.yml` if you want the stack to use Atlas.

## Render

`render.yaml` sets `NODE_VERSION=24` on both services, `CORS_ORIGINS` to the web
app's address on the API, generates `JWT_SECRET` once, and asks for `MONGO_URI`,
`GEMINI_API_KEY`, `GEMINI_EXTRA_KEYS`, `NIM_API_KEY`, `NEWS_API_KEY` and
`INTERNAL_API_KEY` (leave the last three blank if unused). It does not set
`REACT_APP_API_URL` on purpose. The free web service sleeps after fifteen idle
minutes; the first request after that takes about a minute.
