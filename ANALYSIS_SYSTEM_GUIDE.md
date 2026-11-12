# Pure Press Analysis System — Simple Study Guide

This guide explains what happens when a reader checks a news article, pasted
message, social-media link, video, or screenshot.

## 1. The simple idea

Pure Press does not ask one AI model:

> "Is this fake?"

Instead, it follows this sequence:

1. Read and normalize the submitted content.
2. Check whether it contains a factual claim that can be checked.
3. Understand the claim and identify important names, dates, places, and numbers.
4. Search independent news and reference sources.
5. Check fact-checking databases and current coverage.
6. Check the source, writing style, bias, transparency, and possible contradictions.
7. Remove irrelevant, duplicate, and copied reporting.
8. Apply deterministic verdict rules to the collected evidence.
9. Show the verdict together with the evidence and explanation.

The AI helps read and classify information. The final verdict is controlled by
the evidence and rule engine rather than blindly copying one model's answer.

## 2. What happens on each page?

### Check Anything page

The reader can submit exactly one of:

- Text: a forwarded message, claim, or social caption.
- Link: a news article, social post, or YouTube video.
- Screenshot: an image containing a claim.

The backend then:

```text
Input
  -> validate one input
  -> read text / article / transcript / OCR
  -> check whether it is a factual claim
  -> understand the claim
  -> collect evidence
  -> remove irrelevant or duplicate sources
  -> calculate the verdict
  -> save claim history
  -> return the detailed report
```

The main route is:

```text
POST /api/ai/analyze-content
POST /api/ai/analyze-content/stream
```

The streamed route sends progress events while the analysis is running.

### News article page

When a reader opens a news card, the page starts:

- A summary request.
- The same evidence-first analysis used by Check Anything.

The article page analyzes the visible headline as the main claim. This keeps
the result consistent with pasting that same headline into Check Anything.

The article analysis uses:

```text
POST /api/ai/analyze-content/stream
```

### Compare page

The reader provides an article or search topic. Pure Press gathers coverage
from other outlets and compares:

- Which outlets report the event.
- Whether the headlines describe the same event.
- Whether the sources are independent or repeating one wire story.

Route:

```text
POST /api/ai/compare-coverage
```

### News home page

The news page:

1. Loads the selected category.
2. Uses personalized news for logged-in readers when available.
3. Falls back to the regular category feed if personalization fails.
4. Loads trust badges for visible articles from cached analysis records.

Routes:

```text
GET /api/news?category=science
GET /api/news/personalized
POST /api/ai/trust-badges
```

### Claims database

Completed checks can be stored as claim records. The claims page shows:

- Previous verdicts.
- Source changes.
- Whether a later check changed the result.
- The public evidence record for a claim.

Only claims a check has settled are published: the verdict must be Real, Fake,
Partly false or Misleading, and it must rest on at least one piece of evidence a
reader can open (`backend/services/registryPolicy.js`). A claim nothing could
confirm or refute ("Unproven") is still stored and re-checked after 6, 24 and 72
hours, and appears in the database once a check settles it.

Why: sign-up needs no verified email, so publishing every check would let anyone
put an unproven allegation about a named person on a public Pure Press page. A
fact-checker publishes what it found, not what it was asked. The check page links
a claim's public page only when one exists.

Routes:

```text
GET /api/claims
GET /api/claims/:id
GET /api/claims/trending
GET /api/claims/changes
GET /api/claims/stats
```

## 3. The claimability gate

Before expensive analysis, the system asks:

> Is this actually a checkable factual claim?

Examples that can usually be checked:

- "India introduced a new tax in 2026."
- "Scientists detected a new planet."
- "Person X won the election."

Examples that should not receive a fake verdict:

- "Wake up, they are hiding the truth."
- "This is disgusting."
- "What do you think about this?"
- A message that is too short or too vague.

The gate is deterministic and does not require an AI call. It looks for useful
specificity such as:

- Names and organizations.
- Places.
- Numbers and dates.
- A clear factual statement.

The implementation is in
[backend/agents/checkability.js](backend/agents/checkability.js).

If the input is not checkable, the system returns an explanation and tells the
reader what information is missing instead of inventing REAL or FAKE.

## 4. The AI models and providers

The project uses a provider gateway. It can try configured providers in the
configured order and fall back when one provider is unavailable.

### Google Gemini

Configured with:

```text
GEMINI_API_KEY
GEMINI_API_KEYS
GEMINI_MODEL_NAME
```

The project can rotate through multiple Gemini models and keys to handle
quotas. The exact active model is controlled by environment configuration.

### NVIDIA NIM

Configured with:

```text
NIM_API_KEY
NIM_MODEL_NAME
```

The example configuration uses:

```text
nvidia/nemotron-3-super-120b-a12b
```

### Ollama

Configured with:

```text
OLLAMA_HOST
OLLAMA_MODEL
```

The example local model is:

```text
llama3.1:8b
```

Ollama is useful for local or self-hosted analysis when a local model server is
available.

### Important model note

The active production model is not hard-coded in the frontend. It depends on
the backend environment variables. To see what a deployment is configured to
use, inspect its environment configuration, not the React code.

The gateway records provider/model calls in the analysis context so claim
history can show how a result was produced.

## 5. What each AI-assisted stage does

### Input understanding

Reads pasted or OCR text and identifies:

- Language.
- Whether the text is a statement, question, opinion, or exhortation.
- The factual claims inside the message.
- An English interpretation when the original language is different.

### Claim verification

Searches news coverage and asks models whether a headline reports the same
event, contradicts it, or is only about the same general topic.

Model results are not accepted without deterministic relevance checks. This
prevents a headline about the same person or subject from being incorrectly
treated as proof of a different claim.

### Bias and writing analysis

Separate checks inspect:

- Clickbait and sensational wording.
- Persuasive or manipulative techniques.
- Transparency and sourcing.
- Possible bias.
- Writing quality.

These checks describe warning signs. They do not prove that an article is
false.

### Reference checking

Named people, organizations, places, and subjects can be checked against
reference material such as Wikipedia. Reference material helps verify basic
facts but is not counted as an independent news outlet.

## 6. Evidence sources

Depending on the claim and availability, the backend can use:

- Google News searches and RSS results.
- NewsAPI.
- Fact-checking indexes and Google Fact Check Tools when configured.
- Wikipedia/reference content.
- Publisher article pages.
- `r.jina.ai` as a fallback article reader.
- YouTube metadata and captions.
- OCR through Tesseract.js for screenshots.
- The internal source reputation and ownership databases.

Evidence is filtered before it affects the verdict.

## 7. How duplicate and copied news is handled

Five websites repeating one wire story should not count as five independent
confirmations.

The system checks for:

- Same or near-identical headlines.
- Wire-service and syndication relationships.
- Shared ownership.
- Duplicate article text.
- Source domain and account identity.

The final report separates:

- Number of articles found.
- Number of independent outlets.

The independent-outlet count is the important number for the verdict.

## 8. Relevance protection

A source is not evidence merely because it shares a topic word.

For example:

```text
Claim: A specific planet was discovered at a particular distance.
Headline: Scientists study the atmosphere of another planet.
```

The second headline may be related but does not automatically confirm the
first claim.

The relevance layer checks:

- Shared distinctive terms.
- Names, places, and organizations.
- Numbers and dates.
- Event identity.
- Whether the source supports or contradicts the exact claim.

This logic is mainly in:

- `backend/agents/evidenceRelevance.js`
- `backend/agents/currentCoverage.js`
- `backend/agents/claimVerificationAgent.js`

## 9. Verdicts

The system can return verdicts such as:

- **REAL**: enough independent evidence supports the claim.
- **FAKE**: reliable evidence contradicts it or a key premise is false.
- **PARTLY FALSE / MISLEADING**: some important part is wrong or lacks the
  necessary context.
- **UNPROVEN / CANNOT VERIFY**: the evidence is not enough to support or
  contradict the claim.

Important distinction:

```text
UNPROVEN does not mean FALSE.
```

It means the current evidence did not reach a reliable conclusion.

The verdict engine is deterministic and uses the evidence ledger, source
independence, fact-check results, current coverage, premise checks, and
unread/degraded channel information.

Main implementation:

```text
backend/agents/verdictEngine.js
backend/agents/trustAnalysisAgent.js
```

## 10. Screenshot and image analysis

The screenshot path is:

```text
image file
  -> browser validates file type and size
  -> browser previews the image
  -> small images are enlarged and mildly contrast-enhanced
  -> image is sent as a safe encoded image
  -> backend validates the image signature
  -> backend reads the picture's size from its header and refuses more than
     20 megapixels, before anything is decoded
  -> Tesseract.js reads the text
  -> OCR text enters the normal claim pipeline
```

The system reports OCR confidence. If confidence is low, the report warns the
reader to check the transcription before trusting the verdict.

Screenshots work better when:

- Text is large and sharp.
- The image is not heavily compressed.
- The page is cropped around the claim.
- The screenshot is not tilted or blurred.
- The text has strong contrast.

OCR still has limits with decorative fonts, tiny multi-column newspapers,
curved text, handwriting, and screenshots containing several languages.

## 11. Social-media and video limitations

### Instagram, Facebook, X, TikTok

The backend can read public metadata and captions when the platform exposes
them. It cannot reliably access private posts, login-only content, or text
burned into a video/image through a URL alone.

For those cases, use:

- A screenshot.
- The copied caption.
- A pasted transcript.

### YouTube

The system tries to read:

1. Human captions in the spoken language.
2. Auto-generated captions.
3. The public video title if no captions are available.

If only the title is available, the report explicitly says that the spoken
content was not checked.

## 12. Caching and reruns

Normal reader checks can be cached briefly to avoid repeating identical
expensive work.

The user-facing **Run analysis again** action sends a rerun flag. That bypasses
the recent result cache and the stored article report cache, so the evidence
search runs again.

This is useful because news coverage changes over time.

## 13. Security and validation

The backend protects analysis routes with:

- Authentication or the configured internal evaluation key.
- Request body size limits.
- Rate limits.
- Helmet security headers.
- CORS restrictions.
- NoSQL/operator-key protection.
- Public URL and private-network checks.
- Image signature validation.
- A pixel budget for screenshots (20 megapixels, read from the image header).
  The OCR engine decodes every pixel before reading, so a tiny, highly
  compressed PNG declaring a huge picture used to exhaust the server's memory:
  a 165 kB file reached 519 MB, past Render's 512 MB limit.
- Exactly-one-input validation for Check Anything.
- Shared caches that only share what the server read itself: a summary or trust
  report built from text a caller sent is shown only to callers who send the
  same text, never to every reader of that article.

Do not commit real API keys or database credentials. Use
`backend/.env.example` as the configuration reference.

## 14. Simple review explanation

For a project review, you can say:

> Pure Press uses a hybrid analysis system. Deterministic code first checks
> whether the input is a real factual claim. AI models then help understand
> the language, extract claims, classify evidence, and inspect writing style.
> The system searches news, fact-checking, reference, article, video, and OCR
> sources. Duplicate and irrelevant reporting is removed. Finally, a
> deterministic evidence-based rule engine produces REAL, FAKE, PARTLY FALSE,
> or CANNOT VERIFY and shows the evidence behind the decision.

