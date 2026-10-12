# Robustness suite (heldout_final)

Run 2026-10-12 08:02 UTC. 24/27 right, 1 acceptable, 1 missed (no verdict where one was due), 1 wrong (a verdict the wrong way).

| Category | Cases | Right | Acceptable | Missed | Wrong |
|---|---|---|---|---|---|
| plain | 4 | 4 | 0 | 0 | 0 |
| reversed outcome | 2 | 2 | 0 | 0 | 0 |
| Tamil | 1 | 1 | 0 | 0 | 0 |
| question | 1 | 1 | 0 | 0 | 0 |
| Hinglish | 1 | 1 | 0 | 0 | 0 |
| wrong figure | 1 | 1 | 0 | 0 | 0 |
| local news | 2 | 1 | 0 | 1 | 0 |
| emotional forward | 1 | 0 | 1 | 0 | 0 |
| Tanglish question | 1 | 1 | 0 | 0 | 0 |
| exaggeration | 1 | 1 | 0 | 0 | 0 |
| Hindi | 2 | 2 | 0 | 0 | 0 |
| sarcasm about a true event | 1 | 1 | 0 | 0 | 0 |
| stable fact or myth | 4 | 4 | 0 | 0 | 0 |
| old news recirculated | 1 | 0 | 0 | 0 | 1 |
| unverifiable local | 1 | 1 | 0 | 0 | 0 |
| vague or unfalsifiable | 1 | 1 | 0 | 0 | 0 |
| mixed language | 1 | 1 | 0 | 0 | 0 |
| true claim with an invented one | 1 | 1 | 0 | 0 | 0 |

| Id | Input | Expected | Got | Decided by |
|---|---|---|---|---|
| h-1 | RBI removed Paytm Payments Bank from its list of scheduled banks | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-2 | RBI added Paytm Payments Bank back to its list of scheduled banks this week | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-3 | பேடிஎம் பேமென்ட்ஸ் வங்கியை ரிசர்வ் வங்கி தனது பட்டியலில் இருந்து நீக்கியது | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-4 | Is Jio Platforms planning an IPO this month? | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-5 | Jio Platforms has called off its IPO | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-6 | Income tax officials searched the Mumbai offices of Prime Focus | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-7 | Prime Focus ke Mumbai office par income tax ka raid hua | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-8 | Prime Focus shares jumped 20% after the income tax raids | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-9 | Coimbatore district police seized drugs, gutkha and weapons in a special drive | REAL | CANNOT VERIFY | no-independent-coverage |
| h-10 | Villagers in rural Madurai went without power for 18 hours | REAL | REAL | corroborated-by-one-independent-source |
| h-11 | ⚠️⚠️ Madurai will have NO electricity for one full week from tomorrow!!! Forward to everyo | FAKE | CANNOT VERIFY | no-independent-coverage |
| h-12 | Harmanpreet Kaur has stepped down as India captain | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-13 | Harmanpreet innum India captain ah continue panraanga la? | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-14 | Delhi Police detained Dhruv Rathee ahead of the CJP protest | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-15 | Dhruv Rathee was arrested and sent to jail for 14 days | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-16 | प्रधानमंत्री मोदी ने चेन्नई में 13,000 करोड़ रुपये की परियोजनाओं की शुरुआत की | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-17 | भारत ने एशियाई खेल 2026 में 100 से ज्यादा पदक जीते | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| h-18 | Oh wow, RBI actually raised the repo rate? Who could have seen that coming 🙄 | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-19 | The 2026 Asian Games were held in Chennai | FAKE | FAKE | contradicted-by-one-independent-source |
| h-20 | The 2026 Asian Games were held in Aichi-Nagoya, Japan | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-21 | Drinking cow urine cures cancer | FAKE | FAKE | rated-false-by-fact-checkers |
| h-22 | Chennai is the capital of Tamil Nadu | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-23 | Chandrayaan-3 lands on the Moon today, India becomes first country to reach the south pole | FAKE | PARTLY FALSE | claims-partly-false |
| h-24 | A new bakery opened on Gandhi Road in Erode yesterday | CANNOT VERIFY | CANNOT VERIFY | no-independent-coverage |
| h-25 | Big changes are coming for all bank customers, be careful | REFUSED | REFUSED |  |
| h-26 | TVK Dharapuram bypoll la win pannanga, and RBI repo rate 5.5% aachu | REAL | REAL | corroborated-by-multiple-independent-sources |
| h-27 | PM Modi launched ₹13,000 crore projects in Chennai and also announced free petrol for all  | PARTLY FALSE | PARTLY FALSE | true-claim-carrying-a-false-one |
