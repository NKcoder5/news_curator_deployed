# Robustness suite (after)

Run 2026-10-11 16:58 UTC. 53/55 right, 2 safe abstentions, 0 wrong.

| Category | Cases | Right | Safe | Wrong |
|---|---|---|---|---|
| plain | 2 | 2 | 0 | 0 |
| question | 4 | 4 | 0 | 0 |
| hedged | 3 | 3 | 0 | 0 |
| emotional forward | 3 | 3 | 0 | 0 |
| sarcasm | 1 | 1 | 0 | 0 |
| negation | 3 | 3 | 0 | 0 |
| opinion with fact | 2 | 1 | 1 | 0 |
| several claims | 2 | 2 | 0 | 0 |
| numbers and units | 3 | 3 | 0 | 0 |
| typos and lower case | 2 | 2 | 0 | 0 |
| Tamil | 7 | 7 | 0 | 0 |
| Tanglish | 3 | 3 | 0 | 0 |
| Hindi | 3 | 3 | 0 | 0 |
| old news recirculated | 1 | 1 | 0 | 0 |
| historical fact | 1 | 1 | 0 | 0 |
| stable fact or myth | 5 | 5 | 0 | 0 |
| quote | 1 | 1 | 0 | 0 |
| local news | 2 | 2 | 0 | 0 |
| viral rumour | 1 | 1 | 0 | 0 |
| prediction | 1 | 0 | 1 | 0 |
| vague or unfalsifiable | 2 | 2 | 0 | 0 |
| long text | 2 | 2 | 0 | 0 |
| link | 1 | 1 | 0 | 0 |

| Id | Input | Expected | Got | Decided by |
|---|---|---|---|---|
| base-1 | India won 84 medals at the Asian Games 2026 | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| base-2 | RBI raised the repo rate by 25 basis points to 5.50% in October 2026 | REAL | REAL | corroborated-by-multiple-independent-sources |
| q-1 | Is it true that RBI has banned 500 rupee notes? | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| q-2 | Did TVK win the Dharapuram and Madurantakam bypolls? | REAL | REAL | corroborated-by-multiple-independent-sources |
| q-3 | Did India win 84 medals at the Asian Games 2026? | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| q-4 | Is the government planning to change the tax rules next year? | REFUSED | REFUSED |  |
| hedge-1 | I heard that PM Modi resigned today. Is that correct? | FAKE | FAKE | rated-false-by-fact-checkers |
| hedge-2 | My friend says the RBI raised the repo rate to 5.5% this month | REAL | REAL | corroborated-by-multiple-independent-sources |
| hedge-3 | Apparently income tax has been abolished in India from this year | FAKE | FAKE | contradicted-by-one-independent-source |
| tone-1 | 🚨🚨 BREAKING!!! MODI JI RESIGNED AS PM TODAY!!! SHARE BEFORE THEY DELETE IT 🙏🙏 | FAKE | FAKE | rated-false-by-fact-checkers |
| tone-2 | Forwarded as received: Government gazette declares ALL Saturdays as bank holidays from Nov | FAKE | FAKE | rated-false-by-fact-checkers |
| tone-3 | PROUD MOMENT 🇮🇳🇮🇳 India finishes Asian Games 2026 with 85 medals!!! Jai Hind | REAL | REAL | corroborated-by-multiple-independent-sources |
| sarcasm-1 | Oh sure, and Elon Musk bought Reliance Jio this week too 🙄 | FAKE | FAKE | contradicted-by-current-coverage |
| neg-1 | TVK did not lose the 2026 bypolls | REAL | REAL | corroborated-by-multiple-independent-sources |
| neg-2 | PM Modi has not resigned | REAL | REAL | rated-true-by-fact-checkers |
| neg-3 | The RBI did not change the repo rate in October 2026 | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| opinion-1 | Vijay's TVK is unstoppable — it won both the Dharapuram and Madurantakam bypolls | REAL | REAL | corroborated-by-multiple-independent-sources |
| opinion-2 | Vijay is the best Chief Minister Tamil Nadu has ever had | NOT A FACTUAL CLAIM | REFUSED |  |
| multi-1 | India won 85 medals at the Asian Games 2026, and the RBI cut the repo rate by 50 basis poi | PARTLY FALSE | PARTLY FALSE | claims-partly-false |
| multi-2 | The RBI raised the repo rate to 5.50% and India won 85 medals at the Asian Games 2026 | REAL | REAL | corroborated-by-multiple-independent-sources |
| unit-1 | RBI hiked the repo rate by a quarter percentage point to 5.5% | REAL | REAL | corroborated-by-multiple-independent-sources |
| unit-2 | India won more than 100 medals at the Asian Games 2026 | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| unit-3 | India crossed 80 medals at the Asian Games 2026 | REAL | REAL | corroborated-by-multiple-independent-sources |
| typo-1 | rbi incresed repo rate to 5.5 percent | REAL | REAL | corroborated-by-multiple-independent-sources |
| typo-2 | indai won 84 medels in asian games 2026 | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| ta-1 | இந்தியா ஆசிய விளையாட்டுப் போட்டி 2026-ல் 84 பதக்கங்கள் வென்றது | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| ta-2 | ஆசிய விளையாட்டுப் போட்டி 2026-ல் இந்தியா 85 பதக்கங்கள் வென்றது | REAL | REAL | corroborated-by-multiple-independent-sources |
| ta-3 | பிரதமர் மோடி இன்று பதவியை ராஜினாமா செய்தார் | FAKE | FAKE | rated-false-by-fact-checkers |
| ta-4 | சென்னையில் பிரதமர் மோடி ரூ.13,000 கோடி மதிப்பிலான திட்டங்களை தொடங்கி வைத்தார் | REAL | REAL | corroborated-by-multiple-independent-sources |
| ta-5 | இடைத்தேர்தல்: தாராபுரம், மதுராந்தகம் தொகுதிகளில் தவெக வெற்றி | REAL | REAL | corroborated-by-multiple-independent-sources |
| ta-6 | இடைத்தேர்தலில் தவெக இரண்டு தொகுதிகளிலும் தோல்வி அடைந்தது | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| ta-7 | நவம்பர் முதல் அனைத்து சனிக்கிழமைகளும் வங்கி விடுமுறை என மத்திய அரசு அறிவிப்பு | FAKE | FAKE | rated-false-by-fact-checkers |
| tl-1 | Modi PM post resign pannitaru nu WhatsApp la varudhu, idhu unmaya? | FAKE | FAKE | rated-false-by-fact-checkers |
| tl-2 | TVK Dharapuram, Madurantakam rendu bypoll layum jeichiduchu | REAL | REAL | corroborated-by-multiple-independent-sources |
| tl-3 | India Asian Games 2026 la 84 medal vaangiruku | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| hi-1 | प्रधानमंत्री मोदी ने आज इस्तीफा दे दिया | FAKE | FAKE | rated-false-by-fact-checkers |
| hi-2 | आरबीआई ने रेपो रेट 25 बेसिस पॉइंट बढ़ाकर 5.50% कर दिया | REAL | REAL | corroborated-by-multiple-independent-sources |
| hi-3 | आरबीआई ने 500 रुपये के नोट बंद कर दिए | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| old-1 | PM Modi announces that 500 and 1000 rupee notes will be invalid from midnight tonight | FAKE | FAKE | old-news-presented-as-new |
| old-2 | India won the Cricket World Cup in 2011 | REAL | REAL | corroborated-by-multiple-independent-sources |
| fact-1 | Bengaluru is the capital of Karnataka | REAL | REAL | corroborated-by-one-independent-source |
| fact-2 | Chennai is the capital of Karnataka | FAKE | FAKE | premise-contradicted-by-reference |
| fact-3 | 5G towers spread coronavirus | FAKE | FAKE | rated-false-by-fact-checkers |
| fact-4 | The Great Wall of China is visible from space with the naked eye | FAKE | FAKE | contradicted-by-multiple-independent-sources |
| fact-5 | Narendra Modi is the Prime Minister of India | REAL | REAL | confirmed-by-reference |
| quote-1 | Rahul Gandhi said 'Not the India we want' while attacking PM Modi and Amit Shah over the D | REAL | REAL | corroborated-by-one-independent-source |
| local-1 | A female elephant stuck in mud at Gunderipallam dam near Erode was rescued | REAL | REAL | corroborated-by-one-independent-source |
| local-2 | Coimbatore police sealed 61 shops and arrested 40 people in a crackdown on banned tobacco | REAL | REAL | corroborated-by-one-independent-source |
| rumour-1 | Video shows Army chief General Dhiraj Seth dancing with an Army major's wife | FAKE | FAKE | rated-false-by-fact-checkers |
| future-1 | RBI will cut the repo rate in December 2026 | NOT A FACTUAL CLAIM | REFUSED |  |
| vague-1 | They are hiding the truth from all of us, wake up | REFUSED | REFUSED |  |
| vague-2 | Something big is going to happen soon | REFUSED | REFUSED |  |
| long-1 | The Reserve Bank of India on Wednesday raised its key repo rate by 25 basis points to 5.50 | REAL | REAL | corroborated-by-multiple-independent-sources |
| long-2 | Chennai, Oct 10: The Tamil Nadu government has announced that all government schools in th | FAKE | FAKE | uncorroborated-high-impact-with-risk-signals |
| url-1 | https://www.bbc.com/sport/cricket/articles/cx30epm27g71o | REAL | REAL | corroborated-by-multiple-independent-sources |
