# Check Anything vs a plain language model

Run 2026-10-14 09:41 UTC on 22 claims labelled from published reporting.
Plain model: gemini-3.1-flash-lite, zero-shot, temperature 0, asked with today's date and nothing to read.

- Plain model: 0/22 right, 22 abstained, 0 wrong
- Check Anything: 22/22 right, 0 abstained, 0 wrong (median 8.9 s per claim)

| Kind | Claim | Truth | Plain model | Check Anything | Decided by |
|---|---|---|---|---|---|
| figure | India’s 84-Medal Campaign at Asian Games 2026 | FAKE | ERROR | FAKE | contradicted-by-multiple-independent-sources |
| figure | India won 90 medals at the Asian Games 2026 | FAKE | ERROR | FAKE | contradicted-by-multiple-independent-sources |
| true | India’s 85-Medal Campaign at Asian Games 2026 | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| outcome | TVK lost the 2026 bye elections | FAKE | ERROR | FAKE | contradicted-by-multiple-independent-sources |
| true | TVK won the 2026 bye elections | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| outcome | RBI cut the repo rate by 50 basis points this week | FAKE | ERROR | FAKE | contradicted-by-multiple-independent-sources |
| true | RBI raised the repo rate by 25 basis points to 5.50% | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| rumour | All Saturdays have been declared bank holidays for public sector banks from November 2026, says government gazette | FAKE | ERROR | FAKE | rated-false-by-fact-checkers |
| rumour | Video shows Army chief General Dhiraj Seth dancing with an Army major’s wife | FAKE | ERROR | FAKE | rated-false-by-fact-checkers |
| rumour | RBI bans 500 rupee notes from November 2026 | FAKE | ERROR | FAKE | rated-false-by-fact-checkers |
| invented | PM Modi resigned as Prime Minister today | FAKE | ERROR | FAKE | rated-false-by-fact-checkers |
| invented | Income tax has been abolished in India from 2026 | FAKE | ERROR | FAKE | contradicted-by-current-coverage |
| invented | Reliance Jio has been bought by Elon Musk this week | FAKE | ERROR | FAKE | contradicted-by-multiple-independent-sources |
| invented | Sundar Pichai resigned as Google CEO this week | FAKE | ERROR | FAKE | contradicted-by-current-coverage |
| premise | Rahul Gandhi is the Prime Minister of India | FAKE | ERROR | FAKE | contradicted-by-current-coverage |
| premise | Chennai is the capital of Karnataka | FAKE | ERROR | FAKE | premise-contradicted-by-reference |
| true | PM Modi launched projects worth Rs 13,000 crore in Chennai | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| true | Income Tax Department launched the Kar Saathi website to simplify tax filing | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| true | Virat Kohli denied claims that he took Rs 5 crore to visit Premanand Maharaj’s ashram | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| true | Vijay urged the Centre to release Rs 5,110 crore pending Samagra Shiksha funds | REAL | ERROR | REAL | corroborated-by-multiple-independent-sources |
| true | Madurai Corporation launches complete street policy | REAL | ERROR | REAL | corroborated-by-one-independent-source |
| true | Couple booked for cheating a pawnbroker of Rs 76 lakh in Coimbatore | REAL | ERROR | REAL | corroborated-by-one-independent-source |
