# Consistency suite (with_memory)

Run 2026-10-13 17:35 UTC, claim memory on (database news_curator_eval). 12 of 12 claims finished.

- Same call in all four phrasings: 3/12
- All four phrasings right or acceptable: 1/12
- All four filed under one claim record: 4/12
- Phrasings: 12 right, 3 acceptable, 32 missed, 1 wrong of 48
- Seconds per check: median 36.123000000000005, 90th percentile 171.4

| Claim | Expected | Plain | Question | Tamil/Hindi | Forward | Same call | Filed together |
|---|---|---|---|---|---|---|---|
| k-1 Nana Patekar died at his home in Goa. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | yes |
| k-2 Navi Pillay won the 2026 Nobel Peace Prize. | REAL | CANNOT VERIFY | CANNOT VERIFY | PARTLY FALSE | CANNOT VERIFY | no | yes |
| k-3 West Indies beat India by six wickets in the second T20I in Ranchi. | REAL | CANNOT VERIFY | REAL | REAL | CANNOT VERIFY | no | no (3 records, 1 unfiled) |
| k-4 Narendra Modi completed 25 years as head of government. | REAL | CANNOT VERIFY | CANNOT VERIFY | REAL | CANNOT VERIFY | no | yes |
| k-5 Vijay launched the Dream Olympics 2036 scheme. | REAL | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | no | no (2 records, 1 unfiled) |
| k-6 Francis Halzen won the 2026 Nobel Prize in Physics. | REAL | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | no (1 records, 3 unfiled) |
| k-7 The government will ban Instagram in India from 25 August. | FAKE | REFUSED | FAKE | FAKE | CANNOT VERIFY | no | no (2 records, 1 unfiled) |
| k-8 UNESCO declared Jana Gana Mana the best national anthem in the world. | FAKE | CANNOT VERIFY | FAKE | CANNOT VERIFY | CANNOT VERIFY | no | no (2 records) |
| k-9 The 2000 rupee note has a GPS nano chip. | FAKE | FAKE | CANNOT VERIFY | CANNOT VERIFY | FAKE | no | no (2 records) |
| k-10 The Madras High Court set aside Vijay's election from Perambur. | FAKE | FAKE | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | no | no (2 records, 1 unfiled) |
| k-11 A video shows Army chief Dhiraj Seth asking soldiers to drink cow urine. | FAKE | FAKE | FAKE | CANNOT VERIFY | CANNOT VERIFY | no | no (4 records) |
| k-12 India won the T20 World Cup today by beating South Africa. | FAKE | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | CANNOT VERIFY | yes | yes |
