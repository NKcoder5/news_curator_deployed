# Stance candidate: mdeberta-local-2026-10-22

Measured 2026-10-21 by eval/stanceCandidate.js on `ml\artifacts\mdeberta-onnx-int8`.

## 1. Gold probe (labelled by hand)

| pairs | right |
|---|---:|
| all 50 | 30 (60.0%) |
| patterns not in training: 41 | 22 (53.7%) |
| patterns synthesised for training: 9 | 8 (88.9%) |
| Tamil and Hindi claims: 6 | 1 |

## 2. Held-out stance pairs (Gemini as reference)

782 pairs from 67 claims never trained on; agreement with Gemini 62.5%.

| stance | threshold | sure readings | precision | 95% lower bound | of Gemini's caught |
|---|---:|---:|---:|---:|---:|
| agree | off | – | – | below 93% at every threshold | – |
| disagree | off | – | – | below 93% at every threshold | – |
| unrelated | off | – | – | below 85% at every threshold | – |

Targets (lower bound): agree 0.93, disagree 0.93, unrelated 0.85; at least 20 readings.
With these thresholds the model is sure of 0.0% of headlines; every headline of 0 of 67 claims (no hosted call).

## 3. Probe with these thresholds

Sure readings: 0 of 50; sure and wrong: **0**.

| id | kind | gold | ours (p) | sure | claim / headline |
|---|---|---|---|---|---|
| sp-10 | forecast | agree | unrelated (1.00) | no | Tata Motors will launch the Sierra EV in January. / Tata Sierra EV launch set for January, company confirms |
| sp-11* | bound | agree | unrelated (0.95) | no | India crossed 80 medals at the Asian Games 2026. / Asian Games 2026: India signs off with 85 medals |
| sp-13 | bound | agree | unrelated (1.00) | no | Over 50 people were killed in the Odisha train accident. / Odisha train accident: death toll rises to 61 |
| sp-14 | bound | agree | unrelated (1.00) | no | Nearly 90 people were injured in the stampede. / Stampede at temple fair leaves 87 injured |
| sp-15 | figure | disagree | unrelated (0.95) | no | India won 84 medals at the Asian Games 2026. / Asian Games 2026: India signs off with 85 medals |
| sp-18 | units | agree | unrelated (1.00) | no | The scheme will benefit 1 lakh farmers. / New scheme to help 100,000 farmers, says minister |
| sp-19 | code | disagree | unrelated (0.90) | no | The Air India flight squawked code 7400 before the emergency landing. / Air India flight squawked 7500, the hijack code, before landing in Del |
| sp-20 | days | disagree | unrelated (0.98) | no | The accused was sent to 4 days of judicial custody. / Court sends accused to five-day judicial custody |
| sp-27 | negation | agree | unrelated (0.98) | no | The government has not banned 500 rupee notes. / No plan to withdraw Rs 500 notes, says Finance Ministry |
| sp-30 | reversal | disagree | unrelated (1.00) | no | The Punjab anti-drug activist was saved by the police. / Punjab anti-drug activist murdered; police search for attackers |
| sp-31 | paraphrase | agree | unrelated (0.99) | no | UAE lost to Namibia in the T20 World Cup qualifier. / Namibia beat UAE to keep T20 World Cup hopes alive |
| sp-32 | paraphrase | agree | unrelated (0.99) | no | Nana Patekar died in Goa. / Veteran actor Nana Patekar passes away in Goa at 75 |
| sp-35 | time | agree | unrelated (1.00) | no | The elephant that fell into the well in Coimbatore was rescued. / Elephant pulled out of well in Coimbatore after 12-hour operation |
| sp-37 | debunk | disagree | unrelated (0.62) | no | Every Saturday has been declared a bank holiday. / Fact check: Viral gazette declaring all Saturdays bank holidays is fak |
| sp-41 | same-event | agree | unrelated (0.96) | no | Heavy rain lashed Chennai on Monday. / Chennai rains: schools shut as heavy downpour lashes city on Monday |
| sp-45 | multilingual | agree | unrelated (0.91) | no | भारत ने एशियाई खेल 2026 में 85 पदक जीते। / Asian Games 2026: India signs off with 85 medals |
| sp-46 | multilingual | disagree | unrelated (0.68) | no | आरबीआई ने रेपो रेट 25 बेसिस पॉइंट बढ़ा दिया। / RBI keeps repo rate unchanged at 5.5% |
| sp-47 | multilingual | disagree | unrelated (1.00) | no | இந்தியா ஆசிய விளையாட்டுப் போட்டியில் 90 பதக்கங்களை வென்றது. / Asian Games 2026: India signs off with 85 medals |
| sp-48 | multilingual | agree | unrelated (1.00) | no | சென்னையில் கனமழை காரணமாக பள்ளிகளுக்கு விடுமுறை அறிவிக்கப்பட்டது. / Chennai rains: schools shut as heavy downpour lashes city |
| sp-49 | multilingual | disagree | unrelated (0.98) | no | தவெக ஈரோடு கிழக்கு இடைத்தேர்தலில் தோற்றது. / TVK wins Erode East by-poll by 12,000 votes |

\* a pattern synthesised for training.

## 4. Cost on this CPU

Model file 135.2 MB (GitHub refuses files over 100 MB). Memory added once loaded: about 372 MB.
Latency with 2 threads: one pair 16 ms, a batch of 16 292 ms.
