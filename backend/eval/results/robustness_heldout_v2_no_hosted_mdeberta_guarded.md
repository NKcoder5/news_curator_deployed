# Robustness suite (heldout_v2_no_hosted_mdeberta_guarded)

Suite heldout_v2. Run 2026-10-21 19:08 UTC. 19/51 right, 5 acceptable, 24 missed (no verdict where one was due), 3 wrong (a verdict the wrong way).

| Category | Cases | Right | Acceptable | Missed | Wrong |
|---|---|---|---|---|---|
| true current event | 9 | 8 | 0 | 1 | 0 |
| changed figure | 3 | 2 | 0 | 1 | 0 |
| reversed outcome | 3 | 0 | 0 | 1 | 2 |
| changed detail | 1 | 0 | 0 | 1 | 0 |
| changed date | 1 | 0 | 0 | 1 | 0 |
| old news as today | 7 | 4 | 0 | 3 | 0 |
| invented event | 4 | 0 | 4 | 0 | 0 |
| viral rumour (fact-checked) | 5 | 2 | 0 | 3 | 0 |
| evergreen myth (fact-checked) | 2 | 1 | 0 | 1 | 0 |
| Tamil | 2 | 0 | 0 | 2 | 0 |
| Hindi | 2 | 1 | 0 | 1 | 0 |
| Tanglish | 2 | 0 | 0 | 2 | 0 |
| question | 2 | 0 | 0 | 2 | 0 |
| sarcasm | 2 | 0 | 1 | 1 | 0 |
| opinion | 3 | 0 | 0 | 3 | 0 |
| two claims | 3 | 1 | 0 | 1 | 1 |

| Id | Input | Expected | Got | Decided by |
|---|---|---|---|---|
| v2-1 | Veteran actor Nana Patekar died in Goa at the age of 75 | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-2 | South African jurist Navi Pillay has won the 2026 Nobel Peace Prize | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-3 | Francis Halzen won the 2026 Nobel Prize in Physics for his work on the IceCube neutrino ob | REAL | CANNOT VERIFY | no-independent-coverage |
| v2-4 | Shreyas Iyer hit his maiden T20I century as India beat West Indies by eight wickets in Luc | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-5 | West Indies beat India by six wickets in the second T20I in Ranchi | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-6 | The Union Cabinet passed a resolution congratulating PM Modi on completing 25 years as hea | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-7 | Tamil Nadu Chief Minister Vijay launched the Dream Olympics 2036 scheme in Chennai | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-8 | The Madras High Court has reserved orders on Chief Minister Vijay's plea to dismiss the el | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-9 | ISRO successfully launched the EOS-05 satellite on the GSLV-F17 rocket | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-10 | Nana Patekar died at the age of 82 | FAKE | REFUSED |  |
| v2-11 | India lost the first T20I against West Indies in Lucknow by eight wickets | FAKE | REAL | corroborated-by-multiple-independent-sources |
| v2-12 | India beat West Indies in the second T20I at Ranchi | FAKE | REAL | corroborated-by-multiple-independent-sources |
| v2-13 | PM Modi has completed 30 years as head of government | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| v2-14 | Francis Halzen won the 2026 Nobel Prize in Chemistry | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-15 | Under the Dream Olympics scheme Tamil Nadu will give Rs 50 crore to every athlete from the | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| v2-16 | ISRO's GSLV-F17 mission carrying the EOS-05 satellite failed | FAKE | CANNOT VERIFY | verification-unavailable |
| v2-17 | Navi Pillay won the Nobel Peace Prize in 2025 | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-18 | BREAKING: India beat South Africa in the final to win the T20 World Cup today! | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-19 | PM Modi inaugurates the Ram temple in Ayodhya today | FAKE | FAKE | old-news-presented-as-new |
| v2-20 | Article 370 has been scrapped today and Jammu and Kashmir loses its special status | FAKE | FAKE | old-news-presented-as-new |
| v2-21 | Ratan Tata passed away today at the age of 86 | FAKE | FAKE | old-news-presented-as-new |
| v2-22 | आज पुलवामा में आतंकी हमले में सीआरपीएफ के 40 जवान शहीद हो गए | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-23 | கரூரில் விஜய் பிரச்சாரக் கூட்டத்தில் ஏற்பட்ட கூட்ட நெரிசலில் இன்று 41 பேர் உயிரிழந்தனர் | FAKE | CANNOT VERIFY | verification-unavailable |
| v2-24 | Neeraj Chopra wins India's first Olympic gold in athletics today with a javelin throw of 8 | FAKE | FAKE | old-news-presented-as-new |
| v2-25 | The Madras High Court has set aside Chief Minister Vijay's election from Perambur | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-26 | Gaganyaan carried three Indian astronauts into space this week | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-27 | Tamil Nadu has withdrawn free bus travel for women from this month | FAKE | CANNOT VERIFY | one-source-read-by-own-model |
| v2-28 | The Union Cabinet passed a resolution asking PM Modi to step down | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-29 | Video shows Army chief General Dhiraj Seth urging soldiers to drink cow urine | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-30 | Delhi Police DCP Sumit Jha resigned in protest against the action on student protesters, v | FAKE | FAKE | contradicted-by-one-independent-source |
| v2-31 | Instagram will be banned in India from the night of 25 August, says the government | FAKE | FAKE | uncorroborated-high-impact-with-risk-signals |
| v2-32 | Video shows S Jaishankar asking the US to hand over the Cockroach Janta Party founder to I | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-33 | Video shows Bangladeshi infiltrators hoisting Bangladesh flags in Virar, Maharashtra | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-34 | UNESCO has declared Jana Gana Mana the best national anthem in the world | FAKE | FAKE | rated-false-by-fact-checkers |
| v2-35 | The new 2000 rupee note has a GPS nano chip that lets the government track it | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-36 | முதலமைச்சர் விஜய் 'ட்ரீம் ஒலிம்பிக்ஸ் 2036' திட்டத்தை சென்னையில் தொடங்கி வைத்தார் | REAL | CANNOT VERIFY | no-independent-coverage |
| v2-37 | நடிகர் நானா படேகர் கோவாவில் காலமானார் | REAL | CANNOT VERIFY | no-independent-coverage |
| v2-38 | नाना पाटेकर का 75 वर्ष की आयु में गोवा में निधन | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-39 | सरकार 25 अगस्त से भारत में इंस्टाग्राम पर प्रतिबंध लगाने जा रही है | FAKE | CANNOT VERIFY | one-source-read-by-own-model |
| v2-40 | Ranchi T20 la West Indies 250 runs chase panni India va tholaichitaanga | REAL | CANNOT VERIFY | one-source-read-by-own-model |
| v2-41 | Oct 2 la irundhu ladies ku express bus layum free nu CM Vijay start pannitaaru | REAL | CANNOT VERIFY | no-independent-coverage |
| v2-42 | Did Karl Deisseroth share the 2026 Nobel Prize in Medicine? | REAL | REFUSED |  |
| v2-43 | Has Vijay resigned as Tamil Nadu Chief Minister? | FAKE | REFUSED |  |
| v2-44 | Oh sure, Shreyas Iyer can't play T20 cricket — he only hit a maiden hundred against West I | REAL | CANNOT VERIFY | verification-unavailable |
| v2-45 | Yeah right, and the Madras High Court has already thrown Vijay out of office 😂 | FAKE | CANNOT VERIFY | no-independent-coverage |
| v2-46 | Shreyas Iyer is the best T20 captain India has ever had | REFUSED | CANNOT VERIFY | no-independent-coverage |
| v2-47 | Free bus travel for women is the best thing any Tamil Nadu government has ever done | REFUSED | CANNOT VERIFY | no-independent-coverage |
| v2-48 | Nana Patekar dhaan Bollywood la best actor, no doubt | REFUSED | CANNOT VERIFY | no-independent-coverage |
| v2-49 | Nana Patekar died in Goa, and Navi Pillay won the Nobel Peace Prize | REAL | REAL | corroborated-by-multiple-independent-sources |
| v2-50 | Francis Halzen won the Nobel Prize in Physics and India beat West Indies in the Ranchi T20 | PARTLY FALSE | CANNOT VERIFY | no-independent-coverage |
| v2-51 | CM Vijay launched the Dream Olympics 2036 scheme and the Madras High Court set aside his P | PARTLY FALSE | REAL | corroborated-by-multiple-independent-sources |
