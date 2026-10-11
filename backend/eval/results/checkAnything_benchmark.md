# Check Anything vs a plain language model

Run 2026-10-11 15:50 UTC on 22 claims labelled from published reporting.
Plain model: gemini-3.1-flash-lite, zero-shot, temperature 0, asked with today's date and nothing to read.

- Plain model: 13/22 right, 4 abstained, 5 wrong
- Check Anything: 22/22 right, 0 abstained, 0 wrong (median 11.9 s per claim)

| Kind | Claim | Truth | Plain model | Check Anything | Decided by |
|---|---|---|---|---|---|
| figure | India’s 84-Medal Campaign at Asian Games 2026 | FAKE | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| figure | India won 90 medals at the Asian Games 2026 | FAKE | CANNOT VERIFY | FAKE | contradicted-by-multiple-independent-sources |
| true | India’s 85-Medal Campaign at Asian Games 2026 | REAL | FAKE | REAL | corroborated-by-multiple-independent-sources |
| outcome | TVK lost the 2026 bye elections | FAKE | CANNOT VERIFY | FAKE | contradicted-by-multiple-independent-sources |
| true | TVK won the 2026 bye elections | REAL | CANNOT VERIFY | REAL | corroborated-by-multiple-independent-sources |
| outcome | RBI cut the repo rate by 50 basis points this week | FAKE | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| true | RBI raised the repo rate by 25 basis points to 5.50% | REAL | FAKE | REAL | corroborated-by-multiple-independent-sources |
| rumour | All Saturdays have been declared bank holidays for public sector banks from November 2026, says government gazette | FAKE | FAKE | FAKE | rated-false-by-fact-checkers |
| rumour | Video shows Army chief General Dhiraj Seth dancing with an Army major’s wife | FAKE | FAKE | FAKE | rated-false-by-fact-checkers |
| rumour | RBI bans 500 rupee notes from November 2026 | FAKE | ERROR | FAKE | rated-false-by-fact-checkers |
| invented | PM Modi resigned as Prime Minister today | FAKE | FAKE | FAKE | rated-false-by-fact-checkers |
| invented | Income tax has been abolished in India from 2026 | FAKE | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| invented | Reliance Jio has been bought by Elon Musk this week | FAKE | FAKE | FAKE | contradicted-by-current-coverage |
| invented | Sundar Pichai resigned as Google CEO this week | FAKE | FAKE | FAKE | premise-contradicted-by-reference |
| premise | Rahul Gandhi is the Prime Minister of India | FAKE | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| premise | Chennai is the capital of Karnataka | FAKE | FAKE | FAKE | contradicted-by-one-independent-source |
| true | PM Modi launched projects worth Rs 13,000 crore in Chennai | REAL | FAKE | REAL | corroborated-by-multiple-independent-sources |
| true | Income Tax Department launched the Kar Saathi website to simplify tax filing | REAL | FAKE | REAL | corroborated-by-multiple-independent-sources |
| true | Virat Kohli denied claims that he took Rs 5 crore to visit Premanand Maharaj’s ashram | REAL | REAL | REAL | corroborated-by-multiple-independent-sources |
| true | Vijay urged the Centre to release Rs 5,110 crore pending Samagra Shiksha funds | REAL | REAL | REAL | corroborated-by-multiple-independent-sources |
| true | Madurai Corporation launches complete street policy | REAL | FAKE | REAL | corroborated-by-one-independent-source |
| true | Couple booked for cheating a pawnbroker of Rs 76 lakh in Coimbatore | REAL | REAL | REAL | corroborated-by-one-independent-source |
