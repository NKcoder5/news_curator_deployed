# Pure Press Demo Inputs

Use these in the **Check Anything** page.

## Before the demo

1. Wake the API about five minutes before: open https://news-curator-deployed.onrender.com/ready and wait for
   `"status":"READY"` with `"database":"connected"`. The free instance sleeps after 15 idle minutes, takes about a
   minute to wake, and reports "not connected" for a little while longer as MongoDB connects.
2. Open the web app (https://news-curator-deployed-1.onrender.com/) and sign in. Refresh and direct links to inner
   pages (/check, /claims/&lt;id&gt;) work: the static site rewrites them to the app (fixed on Render, 8 Nov).
3. Run every case below once, so the verdicts are cached and the demo answers instantly. Each reader may run 20
   checks per 10 minutes.

Every case below was run on the live site on 8 and 12 Nov 2026; "Live result" is what it returned. Verdicts depend
on the evidence found on the day, so run step 3 again before a demo.

## Text — Expected REAL

```text
The Taj Mahal is located in Agra, India.
```

Live result: **REAL** — confirmed by 9–11 independent outlets. Has a public claim page.

```text
Water freezes at 0 degrees Celsius under normal atmospheric pressure.
```

Live result: **REAL** — the encyclopedia entry on Celsius confirms it.

## Text — Expected FAKE

```text
The Taj Mahal is located in Chennai, India.
```

Live result: **FAKE** — the encyclopedia entry on the Taj Mahal contradicts it. Its claim record shows the Agra
claim as a variant ("Differs: name: chennai vs agra"): a good moment to show the claim memory.

```text
The Sun is a planet made entirely of ice.
```

Live result: **FAKE** — the encyclopedia entry on the Sun contradicts it.

## Text — Expected CANNOT VERIFY

```text
On 16 October 2026, the town of Silverbrook opened the world's first solar-powered public library that operates entirely underwater.
```

Live result: **UNPROVEN (CANNOT VERIFY)** — no outlet reports it. No public claim page is shown: unsettled claims
are not published, only kept and re-checked.

## Text — Not a checkable claim

```text
Please share this message with everyone immediately.
```

Live result: **NOTHING TO CHECK** — "only a request to share information and does not make any factual claims."

## Text — Clickbait and manipulation

```text
SHOCKING!!! Every honest citizen MUST share this unbelievable secret before the government deletes it forever!!!
```

Live result: **NOTHING TO CHECK** — "no specific factual claims, only vague alarmist rhetoric urging the reader to
share an unspecified secret."

## Link — Reference article

```text
https://en.wikipedia.org/wiki/Taj_Mahal
```

Live result: **REAL** — confirmed by 7 independent outlets. (Britannica, the previous link here, blocks the
server: "britannica.com does not allow its pages to be read automatically…")

## Link — Invalid URL handling

```text
https://example.com/this-article-does-not-exist
```

Live result: **NOTHING TO CHECK** — "This does not name anyone, anywhere or any figure…"

## YouTube — News clip on a viral claim (best headline demo)

PIB warns that a viral WhatsApp message about ATM closures is fake.

```text
https://www.youtube.com/watch?v=90QqHDkn_tw
```

Live result: **REAL** — "The Press Information Bureau has warned the public against fake claims of ATM closures",
checked and rated true by WION (fact-checkers' rulings). Has a public claim page.

The same video as a short link shows the claim memory recognising it:

```text
https://youtu.be/90QqHDkn_tw
```

Live result: **REAL**, "Checked 2 times … the same as now".

Note: YouTube refuses captions to the hosting provider's servers, so on the live site a video is usually judged
from its title. From a laptop the full transcript is read (7,382 characters for this video).

## YouTube — Descriptive video

UNESCO/NHK "World Heritage Wonders – Taj Mahal".

```text
https://www.youtube.com/watch?v=8SWRHOSz-bo
```

```text
https://www.youtube.com/embed/8SWRHOSz-bo
```

Live result: **NOT A FACTUAL CLAIM** — "argues a position rather than reporting events". The narration is
descriptive, so this shows the gate rather than a verdict.

## YouTube — Video without captions

```text
https://www.youtube.com/watch?v=KnRukQ-rUSo
```

Live result: **NOT A FACTUAL CLAIM** — only the title ("Taj Mahal Agra India … Unesco World Heritage Site [2018]")
can be read, and it asserts nothing.

## YouTube — Short with music only, and an invalid video

```text
https://www.youtube.com/shorts/YWVoJpU-zos
```

```text
https://www.youtube.com/watch?v=not-a-real-video-id
```

Live result: **NOTHING TO CHECK** — "We could not read that video. Paste the claim you want checked instead."
(Before commit `ef556d0`, deployed 12 Nov, both showed "Failed to analyse that content.")

## Instagram, X/Twitter, TikTok, Facebook — Public post

These platforms require a sign-in for automated readers. Expected for any post link (Facebook confirmed live with
https://www.facebook.com/PIBIndia/): "… does not let us read that post without signing in. Paste the text of the
post, or upload a screenshot of it, and we will check that instead." Then upload a screenshot of the post.

```text
https://www.instagram.com/p/POST_ID/
```

```text
https://x.com/account/status/POST_ID
```

```text
https://www.tiktok.com/@account/video/VIDEO_ID
```

```text
https://www.facebook.com/PIBIndia/
```

## Image — Expected REAL

Upload `demo-assets/image-real-taj-mahal-agra.png` using **Upload a screenshot**: a forwarded chat message
reading "The Taj Mahal is located in Agra, India."

Live result: **REAL** — 9 independent outlets; recognised as the same claim as the typed version.

## Image — Expected FAKE

Upload `demo-assets/image-fake-taj-mahal-chennai.png`: the same message, saying Chennai.

Live result: **FAKE** — 4 independent outlets report otherwise; filed under its own claim, not the Agra one.

## Image — Clickbait text

Upload `demo-assets/image-clickbait-water-eyesight.png`: "BREAKING!!! Scientists confirm that drinking one glass of
ordinary water gives every person perfect eyesight forever. SHARE NOW!!!"

Live result: **UNPROVEN (CANNOT VERIFY)** — the claim is read correctly, but no outlet reports or refutes it, so
the honest answer is "nothing supports it", not FAKE. Point to the writing warnings in the report.

## Image — Small newspaper text

Upload a clear screenshot or newspaper clipping with a visible headline.

## Rerun test

1. Run any text test above.
2. Click **Rerun analysis**.

## Article consistency test

1. Open any article from the News page.
2. Copy its headline.
3. Paste the headline into **Check Anything**.
4. Compare both analysis results.
