# Consistency suite (no_memory)

Run 2026-10-13 18:40 UTC, claim memory off. 8 of 12 claims finished (stopped: model quota: two checks in a row failed or fell back from Gemini).

- Same call in all four phrasings: 6/8
- All four phrasings right or acceptable: 0/8
- All four filed under one claim record: memory off
- Phrasings: 1 right, 0 acceptable, 32 missed, 1 wrong of 34
- Seconds per check: median 75.7105, 90th percentile 209.958

| Claim | Expected | Plain | Question | Tamil/Hindi | Forward | Same call | Filed together |
|---|---|---|---|---|---|---|---|
| k-1 Nana Patekar died at his home in Goa. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-2 Navi Pillay won the 2026 Nobel Peace Prize. | REAL | CANNOT VERIFY | REAL | PARTLY FALSE | CANNOT VERIFY | no | – |
| k-3 West Indies beat India by six wickets in the second T20I in Ranchi. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-4 Narendra Modi completed 25 years as head of government. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-5 Vijay launched the Dream Olympics 2036 scheme. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-6 Francis Halzen won the 2026 Nobel Prize in Physics. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-7 The government will ban Instagram in India from 25 August. | FAKE | REFUSED | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | no | – |
| k-8 UNESCO declared Jana Gana Mana the best national anthem in the world. | FAKE | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | – |
| k-9 The 2000 rupee note has a GPS nano chip. | FAKE | CANNOT VERIFY | CANNOT VERIFY |  |  | no | – |
| k-10 The Madras High Court set aside Vijay's election from Perambur. | FAKE |  |  |  |  | no | – |
| k-11 A video shows Army chief Dhiraj Seth asking soldiers to drink cow urine. | FAKE |  |  |  |  | no | – |
| k-12 India won the T20 World Cup today by beating South Africa. | FAKE |  |  |  |  | no | – |
