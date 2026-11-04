"""Text of the NICOM 2027 full paper, written to follow the conventions of a Kongu paper that passed
Turnitin review (numbered citations, run-in headings, 'Fig. N.' captions under figures, 'Table N.'
captions above tables). Every number comes from docs/measurements.md, backend/data/taskRouting.json or
the end-to-end run of 4 October 2026. Citations are written [@key] and numbered by first appearance.
Inline markup: <i>, <b>, <sub>, <sup>, <tt>."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, 'figs')
EVAL = os.path.join(HERE, '..', '..', '..', 'backend', 'eval', 'results')


def _eval(*names):
    for name in names:
        path = os.path.join(EVAL, name)
        if os.path.exists(path):
            return json.load(open(path, encoding='utf-8'))
    return None


_ABSTAIN = {'CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR'}


def _tally(rows):
    t = {'n': len(rows), 'right': 0, 'safe': 0, 'missed': 0, 'wrong': 0}
    for r in rows:
        if r['call'] == r['expected']:
            t['right'] += 1
        elif r['call'] in (r.get('alsoAcceptable') or []):
            t['safe'] += 1
        elif r['call'] in _ABSTAIN:
            t['missed'] += 1
        else:
            t['wrong'] += 1
    return t


_RB = _eval('robustness_before.json')
_RA = _eval('robustness_final.json', 'robustness_after.json')
_HF = _eval('robustness_heldout.json')
_HA = _eval('robustness_heldout_final.json')
_BENCH = _eval('checkAnything_benchmark_final.json', 'checkAnything_benchmark.json')
RB, RA, HF = _tally(_RB['rows']), _tally(_RA['rows']), _tally(_HF['rows'])
HA = _tally(_HA['rows']) if _HA else None
BN = _BENCH['summary']['claims']
BP = _BENCH['summary']['plain']['right']
BO = _BENCH['summary']['ours']['right']
BT = sum(1 for r in _BENCH['rows'] if r['truth'])
BTF = sum(1 for r in _BENCH['rows'] if r['truth'] and r['plain']['call'] == 'FAKE')

# Fact-checked rulings: the suite, the development run on the final code, and every sealed run as logged.
_RULINGS = json.load(open(os.path.join(EVAL, '..', 'suites', 'rulings.json'), encoding='utf-8'))['cases']
RUL_N = len(_RULINGS)
RUL_DESKS = len({c['ruling']['publisher'] for c in _RULINGS})
RUL_BY = {k: sum(1 for c in _RULINGS if c['category'] == k) for k in ('rated false', 'rated misleading', 'rated true')}
_SEALED_LOG = [json.loads(line) for line in open(os.path.join(EVAL, 'sealed_runs.jsonl'), encoding='utf-8') if line.strip()]
_SEALED = {r['release']: r for r in _SEALED_LOG if r.get('complete')}
S1 = _SEALED['sealed_rc1']['overall']
S2 = _SEALED['sealed_rc2']['overall']
S2_CAT = _SEALED['sealed_rc2']['byCategory']
S2_MEDIAN = _SEALED['sealed_rc2']['medianSeconds']
RUL_DEV = _eval('robustness_rulings_dev_rc2.json')['summary']['overall']
RUL_GEMINI = _eval('robustness_rulings_others_gemini_2026-10-25_fixed.json')['summary']['overall']
RUL_NO_GEMINI = _eval('robustness_rulings_others_no_gemini_ollama_nim.json')['summary']['overall']


def rulings_rows():
    row = lambda name, t: [name, str(t['n']), str(t['right']), str(t['safe']), str(t['missed']), str(t['wrong'])]
    return [row('Development 1–120, final code', RUL_DEV),
            row('Sealed 121–320, first candidate', S1),
            row('Sealed 121–320, final code', S2),
            row('Final, sealed: rated false', S2_CAT['rated false']),
            row('Final, sealed: rated misleading', S2_CAT['rated misleading']),
            row('Final, sealed: rated true', S2_CAT['rated true'])]

_GROUPS = [
    ('Plain claims, numbers, typos', ['plain', 'numbers and units', 'typos and lower case']),
    ('Questions, passed-on claims', ['question', 'hedged']),
    ('Forwards, sarcasm', ['emotional forward', 'sarcasm']),
    ('Negation, opinion', ['negation', 'opinion with fact']),
    ('Several claims', ['several claims']),
    ('Tamil, Tanglish, Hindi', ['Tamil', 'Tanglish', 'Hindi']),
    ('Old news, standing facts', ['old news recirculated', 'historical fact', 'stable fact or myth']),
    ('Quotes, local, rumours, links', ['quote', 'local news', 'viral rumour', 'link', 'long text']),
    ('Forecasts, vague text', ['prediction', 'vague or unfalsifiable']),
]


def robust_rows():
    out = []
    for label, cats in _GROUPS:
        b = _tally([r for r in _RB['rows'] if r['category'] in cats])
        a = _tally([r for r in _RA['rows'] if r['category'] in cats])
        out.append([label, str(b['n']), f"{b['right']} / {b['missed']} / {b['wrong']}", f"{a['right']} / {a['missed']} / {a['wrong']}"])
    out.append(['Total', str(RB['n']), f"{RB['right']} / {RB['missed']} / {RB['wrong']}", f"{RA['right']} / {RA['missed']} / {RA['wrong']}"])
    return out


def plain_rows():
    names = [('figure', 'Wrong figure'), ('outcome', 'Reversed outcome'), ('rumour', 'Viral rumour'),
             ('invented', 'Invented event'), ('premise', 'False premise'), ('true', 'True report')]
    out = []
    for kind, name in names:
        rows = [r for r in _BENCH['rows'] if r['kind'] == kind]
        ok = lambda who: sum(1 for r in rows if r[who]['call'] == ('REAL' if r['truth'] else 'FAKE'))
        out.append([name, str(len(rows)), str(ok('plain')), str(ok('ours'))])
    out.append(['Total', str(BN), str(BP), str(BO)])
    return out

TITLE = 'Evidence-Based Fake News Detection with Calibrated Scoring'
BASE_PAPER = 'DEFAME'
AUTHORS = 'Mugilan K S, Nandha Kumar S, Nandhini A, and Kannukkiniyal M'
AFFILIATION = ('Department of Computer Science and Engineering, Kongu Engineering College, Perundurai, '
               'Erode 638060, Tamil Nadu, India')
EMAILS = ['kannukkiniyal.cse@kongu.edu', '{mugilanks.23cse, nandhakumars.23cse, nandhinia.23cse}@kongu.edu']

ABSTRACT = (
    'Most automated fake news detectors score an article on how it is written, and all of that is chosen by '
    'the author, so a fabricated story in a calm newsroom style can score as well as a genuine report. We built '
    'a checking system that weighs evidence outside the author’s control instead. It accepts links, pasted '
    'text, screenshots and videos, reads what each message asserts in English, Tamil or Hindi, whether stated, '
    'asked or passed on, and refuses input with no checkable claim. Each claim is checked '
    'against independent news coverage, counting outlets rather than articles, against rulings already '
    'published by fact-checkers, against the current week’s coverage of its subject, and against an '
    'encyclopedia for false premises, and the publisher is identified from its web address. Writing signals '
    'become likelihood ratios estimated from labelled articles and added as log-odds, but may only count '
    'against a story. The output is a calibrated probability and a verdict with its evidence, or an '
    'abstention. On 120 held-out ISOT articles the system matched a hand-weighted baseline to within one '
    'article and lowered calibration error on its accusations from 0.267 to 0.152, and on six careful '
    'fabrications the baseline rated four credible and ours none. On ' + str(BN) + ' claims about the current '
    'month it answered ' + str(BO) + ' correctly, '
    'against ' + str(BP) + ' for the same language model asked without evidence. On ' + str(S2['n']) + ' claims '
    'ruled on by fact-checkers and sealed before development, it gave the fact-checker’s or an acceptable verdict '
    'for ' + str(S2['right'] + S2['safe']) + ' and a wrong verdict for ' + str(S2['wrong']) + '.'
)
KEYWORDS = ('Fake news detection, Evidence-based verification, Independent corroboration, Likelihood ratio, '
            'Calibration, Abstention.')


def e2e_rows():
    cv = 'CANNOT VERIFY'
    return [
        ['1', 'Pasted text', 'REAL', 'REAL', '5 independent outlets', '100\u00a0s'],
        ['2', 'News link', 'REAL', 'REAL', '3 independent outlets', '33\u00a0s'],
        ['3', 'Screenshot', 'REAL', 'REAL', '5 independent outlets', '112\u00a0s'],
        ['4', 'Tamil text', 'REAL', 'REAL', '4 independent outlets', '30\u00a0s'],
        ['5', 'YouTube video', 'REAL or ' + cv, cv, 'No coverage found', '55\u00a0s'],
        ['6', 'Pasted text', 'FAKE', 'FAKE', 'Premise contradicted', '22\u00a0s'],
        ['7', 'Screenshot', 'FAKE', 'FAKE', 'Premise contradicted', '30\u00a0s'],
        ['8', 'Pasted text', cv, cv, 'No coverage found', '25\u00a0s'],
        ['9', 'Pasted text', cv, cv, 'No coverage found', '28\u00a0s'],
        ['10', 'Pasted text', 'Refused', 'Refused', 'A question', '<\u00a01\u00a0s'],
        ['11', 'Screenshot', 'Refused', 'Refused', 'A call to action', '<\u00a01\u00a0s'],
        ['12', 'News link', 'Refused', 'Refused', 'Site blocks reading', '<\u00a01\u00a0s'],
    ]


def body():
    B = []
    add = B.append

    # ================================================================== 1
    add(('h1', '1', 'Introduction'))
    add(('p', 'In its <i>Global Risks Report 2026</i>, the World Economic Forum ranked misinformation and '
         'disinformation as the second most severe global risk over the next two years, just behind geoeconomic '
         'confrontation [@WEF]. Language models now make convincing fakes cheap to '
         'produce [@Chen]. Most people meet them as a forwarded message, a screenshot or a link, with no easy way to '
         'check where they came from.'))
    add(('p', 'Automated detectors are supposed to help with that. Most of them treat the problem as text '
         'classification: a model reads the article and labels it fake or real from its wording. Scores on '
         'public datasets are high. On the ISOT corpus, accuracies above 99% are common, but an audit by Verma '
         '[@Verma] traced much of that to the way the corpus was put together. There is a simpler problem too. '
         'A style-based detector rewards features that the writer controls. Anyone fabricating a story can keep '
         'the headline calm, quote named officials and avoid loaded words. Chen and Shu [@Chen] found that '
         'misinformation rewritten by a language model is harder for both people and detectors to catch than the '
         'human-written version with the same meaning.'))
    add(('p', 'We saw this in our own project. Our first design added up six checks with hand-picked weights. '
         'When we tested it with stories we had invented and written in plain newsroom style, they averaged 7.3 '
         'out of 10, and four of the six deceptive items came out as credible. Each check was doing its job. The '
         'sum was the problem, because good writing could make up for missing evidence.'))
    add(('p', 'This paper describes what we built instead. One rule drives it: anything the author controls may '
         'count against a story but never in its favour. Support has to come from outside, from independent '
         'outlets reporting the same event, from reference entries on the people named, and from the '
         'publisher’s record, which we take from the web address. Each observation contributes a likelihood '
         'ratio estimated from labelled articles. The system reports a probability, a verdict and the rule that '
         'produced the verdict, and when a check cannot run it says so instead of treating the gap as evidence.'))
    add(('p', 'Our base paper is DEFAME [@DEFAME], a fact-checking system published at ICML 2025 that plans web '
         'searches, gathers text and image evidence and writes a justified verdict. We keep its evidence-first '
         'approach and add four things a public tool needs: limits on what each kind of evidence may prove, a '
         'count of independent sources, a check on who published the page, and defined behaviour when a check '
         'fails. We also measured which language-model tasks can run on a local model, and nine of ten can.'))
    add(('p', 'Section 2 reviews related work. Section 3 describes the system and the evaluation. Section 4 '
         'reports the results, Sect. 5 discusses them, and Sect. 6 concludes.'))

    # ================================================================== 2
    add(('h1', '2', 'Related Work'))
    add(('p', 'Content-based detectors classify the article text. Amri et al. [@ExFake] built ExFake, which '
         'combines the article with its social context and outside evidence to explain each decision. Its '
         'strongest signals, such as who shares a post, only arrive after a story has spread, and an article '
         'that has just been forwarded to someone has none. Da San Martino et al. [@DaSan] defined a '
         'span-level taxonomy of persuasion techniques for SemEval-2020, which we use for one of our writing '
         'checks.'))
    add(('p', 'Large language models have been tried both as detectors and as helpers. Hu et al. [@Hu] found that '
         'GPT-3.5 used directly did worse than a fine-tuned small model, but its written rationales helped the '
         'small model when given as extra input. Wang et al. [@Wang] had a language model argue both sides of a '
         'claim from collections of raw reports and then pick the better-supported explanation. Both still judge '
         'the content or rely on many reports per claim.'))
    add(('p', 'Evidence-based fact-checking tests claims against outside sources. Guo et al. [@GuoZ] describe the whole pipeline, from claim '
         'detection through evidence retrieval and verdict prediction to justification, and point out that most '
         'systems assumed the evidence was already at hand. AVeriTeC [@AVeriTeC] pairs real-world claims with '
         'evidence from the open web.'))
    add(('p', 'DEFAME [@DEFAME] is the closest system to ours. It runs in six stages (plan, execute, summarise, '
         'develop the fact-check, predict, justify), uses web search, image search, reverse image search and a '
         'geolocation tool, and returns supported, refuted, misleading or not enough information. If the '
         'evidence is insufficient, it goes back to planning, up to three times. With GPT-4o it reported 70.5% '
         'accuracy on AVeriTeC, 59.2% on MOCHEG, 83.9% on the true/false split of VERITE and 69.7% on '
         'ClaimReview2024+, at about 13 US cents and four minutes per claim. Its authors note that it does not '
         'weigh source credibility and relies on the search engine’s own trustworthiness checks. It also '
         'gives a label without a probability.'))
    add(('p', 'Source ratings are another way in. Lin et al. [@Lin] found that six professional rating sets for news sites agree '
         'closely, and they six professional rating sets into one score for 11,520 news domains. A rating only helps if '
         'the outlet is identified correctly. A system that trusts the name printed on a page will give a '
         'copycat site the original’s record.'))
    add(('p', 'Calibration and abstention come from machine learning more broadly. Minderer et al. [@Minderer] found '
         'that calibration varies a lot from one model family to another, so a stated confidence has to be '
         'measured before it can be read as a probability. Silva Filho et al. [@SilvaFilho] surveyed how to '
         'measure and repair calibration, including isotonic regression. Hendrickx et al. [@Hendrickx] surveyed '
         'models that may decline to answer and how such refusals should be judged. Table 1 groups the cited work.'))
    add(('table', '1', 'Families of related work and how this paper relates to them.',
         ['Family', 'Studies', 'Evidence and output', 'Relation to this work'],
         [['Content classifiers', '[@ExFake; @DaSan; @Verma]', 'Article text, social context; a label',
           'Writing signals kept, but one-sided'],
          ['LLM-assisted detection', '[@Hu; @Wang]', 'Text, rationales, raw reports; label and explanation',
           'Model used only for narrow tasks'],
          ['Evidence-based fact-checking', '[@GuoZ; @AVeriTeC; @DEFAME]',
           'Wikipedia or web evidence; verdict and justification', 'Base approach; we add independence and '
           'identity checks'],
          ['Source ratings', '[@Lin]', 'Ratings of outlets or domains',
           'Used after the publisher is identified by address'],
          ['Calibration and abstention', '[@Minderer; @SilvaFilho; @Hendrickx]',
           'Probabilities, reject option', 'Calibrated probability; defined abstention']],
         [1.45, 1.35, 1.75, 1.72], ['left', 'left', 'left', 'left']))

    # ================================================================== 3
    add(('h1', '3', 'System and Method'))
    add(('h2', '3.1', 'Task'))
    add(('p', 'The input is anything a reader might want checked: a link to an article, pasted text, a screenshot '
         'or a video link. The output is one of six verdicts (REAL, FAKE, PARTLY FALSE, CANNOT VERIFY, NOT A '
         'FACTUAL CLAIM or SATIRE), a probability that the story is fabricated, and the evidence behind the verdict. Input with '
         'nothing checkable in it is refused with a short reason. We work with claims, not whole articles, '
         'because one story can mix true and false statements and because claims are what other outlets '
         'report. Fig. 1 shows the principle behind the scoring and Fig. 2 the pipeline.'))
    add(('figure', '1', os.path.join(FIG, 'fig1_framework.png'), 5.3,
         'The scoring principle. Observations the author controls can only count against a story; evidence '
         'from outside the author’s control can count either way.'))
    add(('h2', '3.2', 'Reading the Input'))
    add(('p', 'A link is read from the publisher’s page. A news API returns only about 200 characters of an '
         'article, while the page gives 2,000 to 6,000. Page extraction took several fixes. BBC pages had 76 '
         'opening <tt><p></tt> tags and only 37 closing ones, and our first extractor read the site menu as the '
         'first paragraph of the story. Extraction is now limited to the article body, and the text is used only '
         'if at least half of the headline’s distinctive words appear in it. Screenshots are read with '
         'Tesseract OCR and videos through their caption tracks. Text in Tamil, Hindi and Kannada is detected, '
         'and its claims are searched in the original language and in English, since a story reported in Tamil '
         'is often reported in English as well.'))
    add(('p', 'A pasted message or a screenshot is then read for what it asserts. People rarely paste a tidy '
         'claim: they ask (‘is it true that RBI banned 500 rupee notes?’), pass something on (‘I heard Modi '
         'resigned’), forward warnings in capitals, mock a claim sarcastically, or write in Tamil typed in '
         'English letters. One hosted-model call at temperature zero returns the language, the kind of message, '
         'its tone, an English rendering and up to three claims, each a neutral English sentence with its time '
         'frame, kind, subjects and search terms. A question is checked as the claim it asks about and answered '
         'directly, a hedge as the claim passed on, and sarcasm as the claim being mocked; negation is kept as '
         'stated, and a fact that an opinion merely takes for granted is not listed. Input with no checkable '
         'claim, such as a pure opinion, a forecast or a call to action, is refused with the reason.'))
    add(('p', 'Before this step existed, a rule-based check alone decided what could be checked, and it looked '
         'for capitalised names. It refused every question, and refused Tamil and Hindi text as naming no one, '
         'since those scripts have no capitals. It remains as the fallback when the reading step cannot run, so '
         'the page loses precision rather than failing.'))
    add(('figure', '2', os.path.join(FIG, 'fig2_pipeline.png'), 5.0,
         'Processing pipeline, from the reader’s input to the report.'))
    add(('h2', '3.3', 'Evidence from Outside the Article'))
    add(('run', 'Corroboration.', 'For an article, a language model pulls up to two checkable claims out of the '
         'text, each with three or four search keywords; for a message, the claims come from the reading step. '
         'Each claim is searched live in Google News, as a sentence, as a headline and by keyword, with NewsAPI as '
         'a fallback and the article’s own outlet left out. When a claim states a figure, the competing figures '
         'reported in headlines are searched too, so ‘84 medals’ meets the reports of 85. A second model call '
         'reads each headline and decides whether it concerns the same event, whether both could be true, and '
         'whether it supports or contradicts the claim, quoting the words that state the reported fact. The results are then reduced to the '
         'sources behind them: outlets with a common owner count once, copies of one wire-agency story count '
         'once, and near-duplicate reprints are merged. A relevance gate drops coverage that shares no anchor '
         'with the claim. We made the gate stricter after one of our invented test stories, about a chemical '
         'leak and written without a single proper noun, was ‘confirmed’ by a real chemical-leak '
         'report from Ohio that happened to share four ordinary words with it. A claim that names nothing can no '
         'longer be corroborated.'))
    add(('p', 'A search can fail for reasons that have nothing to do with the story: a rate limit, a timeout, a '
         'reply that cannot be parsed. Our first version treated all of these as ‘no coverage’ and '
         'told readers that no other outlet was reporting a wire story that five major outlets were carrying at '
         'the time. Each search now records whether it ran. A failed search is reported as unavailable and adds '
         'nothing to the probability. Our first index, NewsAPI’s free plan, ran a day behind live publishing: '
         'on 28 September 2026 the newest article it returned for any query was 30.5 hours old. Google News is '
         'searched first now, and only a story less than three hours old is reported as too recent to '
         'corroborate.'))
    add(('run', 'Premise check.', 'A story built on a false premise describes something nobody reports, so a '
         'news search finds nothing and cannot say the premise is wrong. The system looks up the people and '
         'organisations a story names in Wikipedia and asks a model whether the story conflicts with the entry. '
         'A conflict counts only if the model quotes the entry and the quote is found in it, if the entry is '
         'about the same person, if the two statements cannot both be true, and if the story makes the claim '
         'itself instead of quoting someone else. Each condition came from a real error. One of our genuine test '
         'articles quoted a council official called Meera Krishnan and was flagged because the Wikipedia entry '
         'under that name is about an actress. An Associated Press video was flagged in one of eight runs because '
         'a woman interviewed in it said the Pope’s ancestors came from the region, which the check set '
         'against his birthplace in Chicago. The reference work may also confirm a standing fact, such as a '
         'state’s capital, in a quoted sentence, but never an event of the day.'))
    add(('run', 'Fact-checker rulings.', 'Viral rumours are rarely reported as news, so the news search can only '
         'fail to find them. Desks such as AFP, PTI, India Today, The Quint, BOOM and Factly publish their rulings '
         'with ClaimReview markup that Google indexes. We search that index with short phrasings, since it '
         'matches every word, and Google News for fact-check headlines. A ruling on a similar but different '
         'claim must not count, so a model is shown every candidate and asked whether it examined the same '
         'assertion and what its finding makes of the user’s text: a ruling that rated ‘the video is genuine’ '
         'false makes ‘the video is fake’ true. A matched false ruling decides the verdict, with each desk, '
         'rating, date and link shown.'))
    add(('run', 'Current coverage.', 'An invented event about a heavily covered subject leaves a trace in the rest '
         'of the week’s news. On the day a message said the Prime Minister had resigned, outlets reported him '
         'launching projects in Chennai. We read the last seven days of Google News coverage for each subject of '
         'the claim, and a model marks headlines that could not be true if the claim were, quoting the words that '
         'show it. Two independent outlets of this kind make a claim probably false. A weaker form applies only to '
         'an event that would have dominated a subject covered every day and is absent from at least twelve '
         'headlines from five outlets. Both apply only when the news search found the event neither reported nor '
         'contradicted.'))
    add(('run', 'Publisher identity.', 'The publisher is decided from the web address, not from the name the page '
         'gives itself. An outlet’s record applies only on a domain it publishes from or on a platform '
         'channel listed as its own. Ratings come first from our list of 90 outlets, which includes Indian '
         'publishers missing from the published sets, and otherwise from the ratings of Lin et al. [@Lin] for '
         '11,520 domains. On the 81 outlets in both, the two agree well (Pearson <i>r</i> = 0.848, Spearman '
         '<i>ρ</i> = 0.765), and a least-squares fit over those 81 (reliability = 0.38 + 8.95 × score) '
         'maps the published 0–1 score onto our 0–10 scale. A page that uses a known outlet’s name '
         'from an address the outlet does not use gets no record and is flagged as impersonation. For unrated '
         'sites the system reads the domain’s registration date from RDAP. A domain under 90 days old counts '
         'as a warning sign, while an old domain earns nothing, because old domains can be bought.'))
    add(('h2', '3.4', 'Writing Checks'))
    add(('p', 'Four checks look at how the story is written: clickbait in the headline, slanted or one-sided '
         'language, persuasion techniques from the SemEval-2020 taxonomy [@DaSan], and transparency, a five-point '
         'checklist covering named sources, attributed quotes, links to primary evidence, concrete detail and '
         'measured claims. Each check has to quote the words it is reacting to, so its output can be compared '
         'with the text. The reader sees all four. How much they may affect the result is set by the scoring '
         'rule in Sect. 3.5.'))
    add(('h2', '3.5', 'Scoring'))
    add(('p', 'Each observation <i>o</i> is turned into a likelihood ratio and expressed in decibans:'))
    add(('eq', r'\Lambda(o) = \frac{P(o \mid \mathrm{fabricated})}{P(o \mid \mathrm{genuine})}, \qquad '
               r'W(o) = 10\,\log_{10} \Lambda(o)', '1'))
    add(('p_cont', 'The ratios are estimated from labelled articles by putting each observation into bands and '
         'counting, with a Jeffreys prior. Each estimate is shrunk to the conservative end of its 95% '
         'interval, so a band with only a few articles behind it contributes nothing. The log-odds of '
         'fabrication are then a sum:'))
    add(('eq', r'\mathrm{logit}\, P(\mathrm{fabricated} \mid O) = \mathrm{logit}\, \pi + \sum_{o \in O} W(o)', '2'))
    add(('p_cont', 'where <i>π</i> is a prior set by the publisher’s record. We use 0.02 for an outlet '
         'with a strong record, 0.06 for an ordinary one, 0.15 for an unrated outlet, 0.25 for a poor record or '
         'an impersonating page and 0.35 for a social-media post. These values are our own choice, not '
         'measurements, and every report says so.'))
    add(('p', 'Observations are split into <i>O</i><sub>A</sub>, which the author controls, and '
         '<i>O</i><sub>I</sub>, which the author does not. For <i>o</i> ∈ <i>O</i><sub>A</sub> only the part '
         'that counts against the story is kept:'))
    add(('eq', r'W^{\dagger}(o) = \max\left(0, W(o)\right), \qquad o \in O_{A}', '3'))
    add(('p_cont', 'On a corpus of crude fakes, fluent writing really does predict a genuine article, and an '
         'unconstrained model learns to reward it. A careful fabricator writes fluently on purpose, so that '
         'lesson fails when it matters most. A side effect of Eq. (3) is that a check that tells us nothing, with '
         'a ratio of one, adds exactly zero, and so does a band that has never been measured. The report names '
         'such checks instead of giving them a made-up weight.'))
    add(('p', 'The four writing checks read the same prose and are correlated. Their mean pairwise correlation '
         '<i>r̄</i> was 0.55, and headline quality and slant correlated at 0.93. With <i>k</i> checks and equal '
         'correlation, the effective number of independent checks is'))
    add(('eq', r'n_{\mathrm{eff}} = \frac{k}{1 + (k - 1)\,\bar{r}}', '4'))
    add(('p_cont', 'which is 1.52 for our four, so their total weight is multiplied by <i>n</i><sub>eff</sub>/'
         '<i>k</i> = 0.379 and capped at 8 decibans. Finally, the summed log-odds are calibrated with isotonic '
         'regression [@SilvaFilho] on held-out data. When we first fitted the map, it quietly put back the weight '
         'Eq. (3) had removed, because it was fitted on ISOT, where clean style does go with genuine articles. '
         'The clamp is now applied again after calibration, and a regression test checks it.'))
    add(('h2', '3.6', 'Verdict Rules'))
    add(('p', 'The probability and the verdict answer different questions. The probability is graded belief. The '
         'verdict says what has been established. It comes from an ordered list of rules (Table 2), the first '
         'rule that matches decides, and its name is shown to the reader. The two can disagree, and that is '
         'deliberate. An uncorroborated story may get a low probability simply because most stories are genuine, '
         'but nothing about it has been confirmed, so it stays CANNOT VERIFY.'))
    add(('table', '2', 'Verdict rules in order of precedence. Input that fails the admissibility check is '
         'refused before these rules are reached.',
         ['Order', 'Condition', 'Verdict shown'],
         [['1', 'The publisher is a known satirical outlet', 'SATIRE'],
          ['2', 'Fact-checkers rated this same claim false or misleading', 'FAKE'],
          ['3', 'One claim is confirmed and another contradicted', 'PARTLY FALSE'],
          ['4', 'Two or more independent outlets contradict a claim', 'FAKE (false)'],
          ['5', 'One independent outlet contradicts a claim', 'FAKE (probably false)'],
          ['6', 'A reference entry contradicts the story’s premise', 'FAKE (probably false)'],
          ['7', 'Fact-checkers rated the claim true', 'REAL (probably true)'],
          ['8', 'The story is too recent, or verification could not run', 'CANNOT VERIFY'],
          ['9', 'No checkable claim is left', 'NOT A FACTUAL CLAIM'],
          ['10', 'A claim made as new is confirmed only by coverage weeks old', 'FAKE (old news)'],
          ['11', 'A confirmed claim carries one that nothing reports', 'PARTLY FALSE or CANNOT VERIFY'],
          ['12', 'Two or more independent outlets support the claims', 'REAL (confirmed)'],
          ['13', 'One independent outlet supports the claims', 'REAL (probably true)'],
          ['14', 'A reference entry states a standing fact', 'REAL (probably true)'],
          ['15', 'The week’s coverage of the subject rules the claim out', 'FAKE (probably false)'],
          ['16', 'A dominant event is absent from heavy coverage', 'FAKE (probably false)'],
          ['17', 'A high-impact claim is uncorroborated and shows three or more risk signals',
           'FAKE (probably false)'],
          ['18', 'None of the above', 'CANNOT VERIFY']],
         [0.55, 3.6, 2.12], ['center', 'left', 'left']))
    add(('h2', '3.7', 'Model Routing'))
    add(('p', 'Every language-model call goes through one gateway with three providers: a local Llama 3.1 8B model '
         'served by Ollama, NVIDIA NIM and Google Gemini. We chose the provider for each task by measurement. A '
         'task goes to the local model only if at least 80% of its local replies are valid, at least 80% are '
         'correct where the answer is known, and its scores stay within 2 points of the hosted reference on the '
         '0–10 scale. The gateway retries congested providers and moves on when a model is withdrawn. That '
         'happened to us once: NVIDIA retired <tt>meta/llama-3.1-8b-instruct</tt>, the model we had used in '
         'Phase I, on 26 August 2026, and every analysis began failing with HTTP 410. If no provider answers, '
         'each writing check falls back to word lists and surface patterns, and the report marks it as '
         'degraded.'))
    add(('p', 'Six judgements were later moved to Gemini by hand, each after a live failure that the fixed-input '
         'benchmark could not see: the local model read ‘TVK sweeps both seats’ as agreeing with ‘TVK lost’, and '
         'translated the Tamil தவெக (TVK) as DMK. Gemini’s free tier gives each model a daily quota, 500 requests '
         'for Flash-Lite, so the gateway tries six models in turn and skips one whose quota is spent until it '
         'resets, instead of retrying it, which had once stretched a check to 170 seconds. Judgements made at '
         'temperature zero are kept for thirty minutes, so a repeated check makes no model call. The premise check, '
         'which the local model failed, and the matching of a new claim against earlier checks are routed the same '
         'way. Our deployed server, a free instance with 512 MB of memory and no GPU, cannot run the local model, '
         'so there the measured tasks start at NIM.'))
    add(('p', 'The application is built with MongoDB, Express, React and Node.js. Reports are cached by article '
         'address for 14 days, each evidence channel streams its finding to the reader as it lands, and the code '
         'has 519 backend and 42 frontend tests that run without network access or API keys, rerun from a clean '
         'copy of the code on every change.'))
    add(('h2', '3.8', 'Evaluation'))
    add(('p', 'We used five test sets and one benchmark of the model providers.'))
    add(('run', 'Held-out ISOT articles.', 'After length filtering, ISOT has 21,379 genuine and 21,915 '
         'fake articles. We used the 239 articles whose writing checks had all come from the language model '
         'and not from the fallback analysers. A hash of the article ID split them into 119 for estimating the '
         'ratios and 120 for testing. All of ISOT’s genuine articles come from Reuters, so we hid the source '
         'and stripped agency prefixes such as ‘WASHINGTON (Reuters)’, which would otherwise give the '
         'label away. Historical articles have no live coverage, so corroboration plays no part here, and this '
         'test covers only the writing half of the model. We had planned to use 300 articles but stopped at 239 '
         'when both hosted providers went down during the run, one with HTTP 503 errors and the other out of '
         'quota. The baseline is our earlier hand-weighted sum applied to the same check outputs. We report '
         'accuracy with 95% Wilson intervals, ROC-AUC, the Brier score and the expected calibration error (ECE) '
         'over ten bins. We also compute ECE and precision over accusations alone, meaning the predictions that '
         'put the probability of fabrication above 0.5.'))
    add(('run', 'Adversarial set.', 'ISOT’s fakes are crude, so it cannot show whether good writing still '
         'buys trust. We wrote ten items: five fabrications in plain newsroom style with named sources and no '
         'clickbait, one high-impact fabrication with manipulation signals, two genuine reports, one satirical '
         'piece and one opinion column. Each item was scored under both rules from the same check outputs, using '
         'the rule-based analysers so that the run can be repeated without network access.'))
    add(('run', 'End-to-end cases.', 'Twelve cases went through the running application on 4 October 2026: '
         'pasted text, Tamil text, news links, screenshots and a YouTube video, with every verdict '
         'represented.'))
    add(('run', 'Messages as people write them.', 'A robustness suite of ' + str(RA['n']) + ' messages, each '
         'labelled by hand from October 2026 reporting, covers questions, hedges, forwards in capitals, sarcasm, '
         'negation, opinion around a fact, several claims at once, units and typos, Tamil, Tanglish and Hindi, '
         'old news, standing facts, quotes, local news, forecasts and vague text. A held-out set of ' + str(HF['n']) +
         ' cases on new topics was written after development and run once before any change against it. We '
         'count an answer as expected, acceptable (a listed abstention), missed (an abstention where a verdict '
         'was due) or wrong (a verdict the wrong way).'))
    add(('run', 'Plain-model benchmark.', str(BN) + ' claims about October 2026, from wrong figures to true '
         'reports, were put both to the full system and to Gemini 3.1 Flash-Lite asked zero-shot with the date '
         'and nothing to read.'))
    add(('run', 'Fact-checked rulings.', 'The sets above were written by us. This one takes its claims from '
         'others: ' + str(RUL_N) + ' claims on which ' + str(RUL_DESKS) + ' fact-checking desks, among them FACTLY, '
         'NewsMobile, AFP Fact Check, The Quint, BOOM and Full Fact, published rulings in the Google fact-check '
         'index between October 2024 and October 2026. The label is the desk’s rating: ' + str(RUL_BY['rated false']) +
         ' false, ' + str(RUL_BY['rated misleading']) + ' misleading and ' + str(RUL_BY['rated true']) + ' true. A '
         'false rating expects FAKE and accepts PARTLY FALSE or MISLEADING; a misleading rating expects MISLEADING and '
         'accepts the other two; a true rating expects REAL. The desk’s own ruling is hidden during a run, so the '
         'system may use only other desks’ rulings on the same claim. We split the set once, before seeing any '
         'result: rulings 1–120 for development, where we read failures and corrected the system, and rulings '
         '121–320 sealed, run whole once per release candidate, reported as totals only and logged with the code '
         'version whether or not the run completed.'))
    add(('run', 'Lookalike publishers.', 'We checked five lookalikes of the BBC, Reuters and the Associated Press, '
         'and ran a made-up income-tax story live on one of them.'))
    add(('run', 'Providers.', 'Each of ten model tasks ran three times per provider on a Windows 11 laptop with an '
         'NVIDIA RTX 5050 (8 GB). Each run was pinned to one provider, so that a failure could not fall through '
         'to another provider and be counted as a success. The hosted models were Nemotron 3 Super 120B on NIM '
         'and Gemini 3.1 Flash-Lite.'))

    # ================================================================== 4
    add(('h1', '4', 'Results'))
    add(('h2', '4.1', 'Held-Out ISOT Articles'))
    add(('p', 'Table 3 and Fig. 3 compare the two rules on the 120 test articles. The proposed rule got 114 right '
         '(95.0%, 95% interval 89.5–97.7%) and the baseline 115 (95.8%, 90.6–98.2%), so accuracy is the '
         'same to within one article. The difference is in calibration on accusations. ECE there fell from 0.267 '
         'to 0.152, which is 43% lower, and precision on accusations stayed at 0.967. When the system says a '
         'story is probably fabricated, the probability it gives is closer to how often that is true.'))
    add(('table', '3', 'Held-out comparison of the two scoring rules (120 ISOT articles; lower is better for ECE '
         'and Brier).',
         ['Rule', 'Accuracy', 'ROC-AUC', 'ECE', 'ECE (accusing)', 'Precision (accusing)', 'Brier'],
         [['Hand-weighted baseline', '0.958', '0.978', '0.237', '0.267', '0.968', '0.101'],
          ['Proposed, as deployed', '0.950', '0.951', '0.246', '0.152', '0.967', '0.117']],
         [1.6, 0.82, 0.76, 0.6, 0.82, 0.92, 0.6], ['left', 'center', 'center', 'center', 'center', 'center',
                                                    'center']))
    add(('p', 'The proposed rule ranks a little worse (ROC-AUC 0.951 against 0.978), and its overall ECE (0.246 '
         'against 0.237) and Brier score (0.117 against 0.101) are slightly higher. Both follow from Eq. (3). On '
         'ISOT the only evidence that could clear an article is its style, which the rule will not use, so '
         'genuine articles stay near the prior. The 59 test articles in the lowest band were given about 0.41 '
         'and turned out to be fabricated 7% of the time. In normal use, corroboration and the publisher’s '
         'record do that job, and neither is available on a historical corpus with the sources hidden. Turning '
         'the clamp off raised ROC-AUC to 0.983 and ECE on accusations to 0.191. We kept the clamp.'))
    add(('figure', '3', os.path.join(FIG, 'fig3_heldout.png'), 5.6,
         'Held-out metrics for the baseline and the proposed rule: (a) higher is better; (b) lower is better.'))
    add(('h2', '4.2', 'Adversarial Set'))
    add(('p', 'The baseline rated four of the six deceptive items as credible. The proposed rule rated none of '
         'them as credible, matched the expected verdict on all six and did not condemn either genuine report '
         '(Table 4). The fabrications still score well for writing, 7.3 out of 10 on average under the baseline. '
         'They just no longer pass on that alone.'))
    add(('table', '4', 'Adversarial set, scored under both rules from the same outputs of the rule-based analysers. '
         'The baseline gives a score, not a verdict.',
         ['Measure', 'Baseline', 'Proposed'],
         [['Deceptive items rated credible', '4 of 6', '0 of 6'],
          ['Verdicts matching expectation', '–', '6 of 6'],
          ['Genuine reports wrongly condemned', '–', '0 of 2'],
          ['Mean writing score of the fabrications', '7.3 of 10', '–']],
         [3.4, 1.3, 1.3], ['left', 'center', 'center']))
    add(('h2', '4.3', 'End-to-End Cases'))
    add(('p', 'Table 5 lists the twelve cases. The four genuine news reports were confirmed by three to five '
         'independent outlets each, whether they came in as pasted text, a link, a screenshot or Tamil text. The '
         'story calling Rahul Gandhi ‘Prime Minister’ was marked FAKE by the premise check, as text and '
         'as a screenshot. Fig. 4 shows what the reader sees, including the line from his Wikipedia entry. The '
         'two invented stories came back CANNOT VERIFY, and the three inputs with nothing to check were refused. '
         'The Associated Press video, a genuine report whose transcript is mostly an interview in French, came '
         'back CANNOT VERIFY because no matching coverage was found on that run. It was not called false. '
         'Analyses took 22 to 112 seconds, and refusals were immediate.'))
    add(('p', 'The run also hit a real failure. Partway through the first attempt the laptop lost its internet '
         'connection, so every news and reference lookup failed. All of the affected cases came back CANNOT '
         'VERIFY under the rule ‘verification unavailable’, with the message ‘We could not complete '
         'the search, so nothing has been checked’. None was called false. We re-ran those cases when the '
         'connection came back, and Table 5 shows the re-run.'))
    add(('table', '5', 'End-to-end cases run on 4 October 2026.',
         ['No.', 'Input', 'Expected', 'Result', 'Rule that decided it', 'Time'],
         e2e_rows(),
         [0.4, 1.1, 1.4, 1.35, 1.5, 0.52], ['center', 'left', 'center', 'center', 'left', 'center']))
    add(('figure', '4', os.path.join(FIG, 'fig4_report.png'), 5.1,
         'The report shown for a story built on a false premise (case 6 in Table 5).'))
    add(('h2', '4.4', 'Lookalike Publishers'))
    add(('p', 'Table 6 shows the five lookalikes. When the outlet was taken from the name on the page, every one '
         'of them inherited the real outlet’s rating. The made-up income-tax story on '
         '<tt>bbc-breaking-news.xyz</tt>, which calls itself BBC News, was then treated as an exclusive from a '
         'strong outlet and given a 2% probability of fabrication. With the publisher taken from the address, '
         'the same story starts from the poor-record prior, gets 33%, and the reader is told the page is posing '
         'as the BBC. The real BBC article in our test set is still confirmed.'))
    add(('table', '6', 'Lookalike publishers identified by page name and by web address.',
         ['Address', 'By page name', 'By web address'],
         [['bbc-breaking-news.xyz, calling itself “BBC News”', 'BBC News, 9/10',
           'No rating; impersonation flagged'],
          ['bbc-world.com', 'BBC News, 9/10', 'No rating'],
          ['bbc.news-today.com', 'BBC News, 9/10', 'No rating'],
          ['reuters-updates.info, calling itself “Reuters”', 'Reuters, 9.5/10',
           'No rating; impersonation flagged'],
          ['YouTube channel named “Associated Press”, not AP’s own', 'AP, 9.5/10', 'No rating']],
         [2.9, 1.45, 1.92], ['left', 'center', 'center']))
    add(('h2', '4.5', 'Model Routing and Response Time'))
    add(('p', 'Fig. 5 shows the median time per call. The local model was faster on every task, by 1.7 to 15.5 '
         'times compared with the faster hosted provider. It was also more reliable at claim extraction, where '
         'hosted replies were valid in 67% and 33% of runs and local replies in all of them.'))
    add(('figure', '5', os.path.join(FIG, 'fig5_latency.png'), 5.2,
         'Median time per call by task and provider (log scale). The premise check (*) is routed to NIM, because '
         'the local model missed the known contradiction in all three runs.'))
    add(('p', 'The exception was the premise check. Asked whether ‘Prime Minister Rahul Gandhi’ '
         'conflicts with his Wikipedia entry, the local model returned clean JSON in 2.4 seconds saying there was '
         'no conflict, in all three runs. Both hosted models found the conflict and quoted the sentence that '
         'settles it. An earlier version of this benchmark only checked whether replies parsed, and by that '
         'measure the local model won this task too, so routing on it would have quietly switched off the '
         'premise check. A task with a known answer now has to get it right before it is moved. In the end nine of '
         'ten tasks run locally, at no cost per call. In use, the first check reaches the reader 1.47 seconds '
         'after an article is opened, and a cached report comes back in 2.7–3.4 milliseconds.'))
    add(('h2', '4.6', 'Messages as People Write Them'))
    add(('p', 'Table 7 gives the robustness suite before and after the reading step. Before it, ' + str(RB['right']) +
         ' answers were expected, ' + str(RB['missed']) + ' missed and ' + str(RB['wrong']) + ' wrong; every failure '
         'came from rules alone deciding what a message said. After it, ' + str(RA['right']) + ' were expected, ' +
         str(RA['missed']) + ' missed and ' + str(RA['wrong']) + ' wrong. The suite was used during development, so '
         'the held-out set is the fairer figure: ' + str(HF['right']) + ' of ' + str(HF['n']) + ' expected at first '
         'sight. Its worst miss was a true claim carrying an invented one, ‘Modi launched ₹13,000 crore projects in '
         'Chennai and also announced free petrol for all college students’, returned as REAL on its first half; '
         'rule 11 of Table 2 was added in response.' +
         ((' After the fixes, ' + str(HA['right']) + ' of ' + str(HA['n']) + ' were expected and ' + str(HA['wrong']) +
           ' wrong.') if HA else '')))
    add(('table', '7', 'Robustness suite before and after reading the message (expected / missed / wrong).',
         ['Kind of message', 'Cases', 'Before', 'After'],
         robust_rows(),
         [2.6, 0.8, 1.45, 1.45], ['left', 'center', 'center', 'center']))
    add(('h2', '4.7', 'Against a Plain Language Model'))
    add(('p', 'Table 8 gives the benchmark. The plain model answered ' + str(BP) + ' of ' + str(BN) + ' correctly and '
         'the system ' + str(BO) + '. The plain model called ' + str(BTF) + ' of the ' + str(BT) + ' true reports '
         'fake, among them the Reserve Bank’s rate rise and India’s 85-medal total, so its ‘fake’ on a false claim '
         'is a habit rather than a finding, and it cites nothing a reader can check.'))
    add(('table', '8', 'Correct answers on current claims, by kind of claim.',
         ['Kind of claim', 'Claims', 'Plain model', 'Our system'],
         plain_rows(),
         [2.6, 0.9, 1.4, 1.4], ['left', 'center', 'center', 'center']))
    add(('h2', '4.8', 'Fact-Checked Rulings'))
    add(('p', 'Table 9 gives the rulings set. The first release candidate gave the desk’s verdict for ' + str(S1['right']) +
         ' of the ' + str(S1['n']) + ' sealed rulings, an acceptable verdict for ' + str(S1['safe']) + ', no verdict for ' +
         str(S1['missed']) + ' and a wrong verdict for ' + str(S1['wrong']) + '. Its wrong calls on claims rated true led to '
         'one more round of corrections, made on the development rulings and on a second development pool of 160 '
         'rulings from outside India, never on sealed cases. In that round we found that our reader of desk ratings had '
         'taken ratings written as sentences, such as ‘That’s not correct’, as true; a script that reads the ratings '
         'alone, without the system’s answers, corrected four sealed labels from true to false. The first candidate’s '
         'totals stand as recorded, on the old labels, and cannot be rescored because a sealed run keeps totals only, so '
         'part of the later fall in wrong verdicts may be due to the labels rather than the code. The final code gave ' +
         str(S2['right']) + ', ' + str(S2['safe']) + ', ' + str(S2['missed']) + ' and ' + str(S2['wrong']) + ', at a '
         'median of ' + f'{S2_MEDIAN:.1f}' + ' seconds a claim; a first attempt at that run stopped after 31 rulings when '
         'the free model quota ran out, and is logged as incomplete. Claims rated true are the weak point, with ' +
         str(S2_CAT['rated true']['right']) + ' of ' + str(S2_CAT['rated true']['n']) + ' confirmed: in development, such '
         'failures came from events too thinly reported for two independent outlets, rankings that no headline states, and '
         'counts accumulated over different dates. The result also leans on the hosted model. On rulings 1–60, with '
         'Gemini the system gave ' + str(RUL_GEMINI['right']) + ', ' + str(RUL_GEMINI['safe']) + ', ' +
         str(RUL_GEMINI['missed']) + ' and ' + str(RUL_GEMINI['wrong']) + '; without it, on NIM and the local model, ' +
         str(RUL_NO_GEMINI['right']) + ', ' + str(RUL_NO_GEMINI['safe']) + ', ' + str(RUL_NO_GEMINI['missed']) + ' and ' +
         str(RUL_NO_GEMINI['wrong']) + ', no more wrong calls but many more claims left without a verdict.'))
    add(('table', '9', 'Fact-checked rulings: desk’s verdict / acceptable / no verdict / wrong.',
         ['Rulings and code', 'Claims', 'Desk’s', 'Accept.', 'None', 'Wrong'],
         rulings_rows(),
         [2.65, 0.75, 0.75, 0.75, 0.65, 0.72], ['left'] + ['center'] * 5))
    add(('h2', '4.9', 'Comparison with Published Results'))
    add(('p', 'Table 10 puts our numbers next to DEFAME’s and next to the ISOT shortcut reported by Verma '
         '[@Verma], who found that a classifier given only the subject field of each article, with the text '
         'thrown away, reaches F1 = 1.000. The rows use different data, labels and tasks, so this is not a '
         'controlled comparison, and we did not run DEFAME on our cases. The table shows where each number comes '
         'from, and that a perfect ISOT score is possible without reading a single article.'))
    add(('table', '10', 'Reported results of related work and of our two rules; data and tasks differ between rows.',
         ['Study', 'Data', 'Task', 'Reported result'],
         [['DEFAME, GPT-4o [@DEFAME]', 'AVeriTeC', 'Real-world claims, web evidence', 'Acc. 70.5%'],
          ['DEFAME, GPT-4o [@DEFAME]', 'VERITE', 'Image and text claims, true vs false', 'Acc. 83.9%'],
          ['DEFAME, GPT-4o [@DEFAME]', 'ClaimReview2024+', 'Claims after the model’s cut-off', 'Acc. 69.7%'],
          ['Subject field only [@Verma]', 'ISOT', 'Fake vs real, no article text', 'F1 1.000'],
          ['Our baseline', 'ISOT, 120 held out', 'Fake vs real, source hidden', 'Acc. 95.8%'],
          ['Our proposed rule', 'ISOT, 120 held out', 'Fake vs real, source hidden',
           'Acc. 95.0%, accusing ECE 0.152'],
          ['Our proposed rule', 'Adversarial set', 'Six careful fabrications', '0 of 6 rated credible'],
          ['Our system', 'Plain-model benchmark', 'Claims from October 2026', f'{BO} of {BN} correct'],
          ['Gemini, no evidence', 'Plain-model benchmark', 'Claims from October 2026', f'{BP} of {BN} correct'],
          ['Our system', f'Fact-checked rulings, {S2["n"]} sealed', 'Claims ruled on by desks',
           f'{S2["right"] + S2["safe"]} desk’s or acceptable, {S2["wrong"]} wrong']],
         [1.7, 1.5, 1.67, 1.4], ['left', 'left', 'left', 'left']))

    # ================================================================== 5
    add(('h1', '5', 'Discussion'))
    add(('h2', '5.1', 'What the ISOT Score Shows'))
    add(('p', 'ISOT accuracy says little on its own. Verma [@Verma] showed how much of it comes from the corpus, '
         'and our held-out set is small: the 95% intervals of the two rules overlap almost completely. What our '
         'ISOT test does show is that the one-sided rule costs very little accuracy on ordinary data while making '
         'accusations better calibrated. The adversarial set is the test that matters for this design, and there '
         'the gap between the rules is clear, four credible against none.'))
    add(('h2', '5.2', 'Why the Rule Costs Ranking'))
    add(('p', 'The drop of 0.032 in ROC-AUC against the unclamped model is the price of Eq. (3). Without the clamp '
         'the model learns from ISOT that tidy writing means a genuine story, which is true of that corpus and '
         'false against a careful writer. We would rather give up a little ranking on old data than reward the '
         'one thing a fabricator can always supply. On ISOT the largest calibration gap is also on the cautious '
         'side, with the lowest band stated at 0.41 and observed at 0.07. Genuine stories are meant to be cleared '
         'by corroboration and the publisher’s record, which ISOT cannot test.'))
    add(('h2', '5.3', 'Use in Practice'))
    add(('p', 'For a platform or a messaging service, a verdict that comes with its reason, and a willingness to '
         'say CANNOT VERIFY, is more useful than a confident score. For newsrooms and other organisations whose '
         'name carries weight, such as banks and government departments, reading identity from the address '
         'stops copycat sites from borrowing their record. For regulators, every verdict can be traced to a '
         'rule, the outlets involved and quoted text, so it can be checked and appealed, and opinion pieces are '
         'refused instead of judged. Messages in Tamil and Hindi, or typed in English letters, are read as '
         'readily as English, and the one-line reason is given back in the reader’s script. Where a machine with a '
         'GPU is available, running eight of sixteen model tasks locally also removes per-call charges for those tasks '
         'and keeps the article text on that machine, which matters for low-budget public deployments in India. In this way the work supports SDG 16, target 16.10, on public access to '
         'information.'))
    add(('h2', '5.4', 'Threats to Validity'))
    add(('p', 'The likelihood ratios come from 239 articles, so some bands are too thin to estimate and a '
         'one-article difference in accuracy means nothing. Each result comes from a single run. The adversarial '
         'set is small and we wrote it ourselves, so it shows that the rule behaves as designed, not how often it '
         'works in the wild. It was scored with the rule-based analysers, and a full live run is still to be '
         'done. The publisher priors and the corroboration, ruling and coverage ratios are set by hand. The '
         'robustness, held-out and benchmark sets were written by us from one month’s news, and their labels '
         'hold only while that news is current. The rulings set is labelled by the desks, but only ' +
         str(RUL_BY['rated true']) + ' of its ' + str(RUL_N) + ' claims are rated true, too few to measure that class '
         'closely, and its labels pass through our reader of the ratings, which once misread four. Verdicts depend on Google News, the fact-check index, Wikipedia '
         'and a hosted model whose free daily quota, once spent, leaves slower fallback models at 60 to 110 '
         'seconds a check. Stance is judged from headlines, not full articles. Manipulated images and synthetic '
         'video are not analysed directly, though a viral fake video is still caught when fact-checkers have '
         'ruled on it.'))

    # ================================================================== 6
    add(('para', 'Since the first submission the system keeps every check as a replayable record, shows what decided each verdict by recomputing it with evidence removed (all 32,272 explanatory statements confirmed; no case in 20,000 random evidence combinations where added counter-evidence softened a verdict), reports each rule\'s measured record instead of a set confidence, and uses its own fine-tuned 43 MB multilingual pair model for claim matching and as a veto on invented contradictions. Changed figures and codes in true stories are caught by comparison against headlines and article snippets. On the final code the benchmark was answered correctly in 22 of 22 cases and a second held-out suite of 51 messages in 49, with none wrong; a plain language model scored 15 of 22 with 4 wrong.'))
    add(('h1', '6', 'Conclusion'))
    add(('p', 'We built a fake news checker that weighs evidence by who controls it. Writing signals can only '
         'count against a story, and support has to come from independent outlets, reference entries and a '
         'publisher identified by its web address. Every weight is a likelihood ratio estimated from data, and '
         'the weights add up to a calibrated probability. On 120 held-out ISOT articles the system matched a '
         'hand-weighted baseline’s accuracy to within one article and cut calibration error on its '
         'accusations by 43%. It rated none of six carefully written fabrications as credible, against four for '
         'the baseline, and gave an acceptable verdict in all twelve end-to-end cases. Read for what they assert, '
         'messages in three languages and every tone we tried gave ' + str(RA['right']) + ' expected answers in ' +
         str(RA['n']) + ' with ' + str(RA['wrong']) + ' wrong, and on current claims the system answered ' + str(BO) +
         ' of ' + str(BN) + ' correctly against ' + str(BP) + ' for a language model without evidence. On ' + str(S2['n']) +
         ' claims ruled on by fact-checkers and sealed before development, it gave the desk’s or an acceptable verdict for ' +
         str(S2['right'] + S2['safe']) + ', no verdict for ' + str(S2['missed']) + ' and a wrong verdict for ' +
         str(S2['wrong']) + '. Next, we will work on the claims it leaves without a verdict and on true claims, which '
         'need evidence from the body of an article rather than its headline, grow the estimation corpus so that the '
         'priors can be measured, collect ratings for regional Indian outlets, run the judgements on our own models, '
         'and add image forensics as one more observation.'))
    return place(B, MOVES)


# Figures are inline, so one that does not fit at the foot of a page would leave a gap. Each is moved
# to follow the next stretch of text instead, the way a typeset paper floats them.
MOVES = [
    (('figure', '1'), 'A link is read from the publisher'),
    (('figure', '2'), ('run', 'Corroboration.')),
    (('table', '5'), 'Table 6 shows the five lookalikes'),
    (('figure', '4'), ('table', '5')),
    (('table', '6'), ('figure', '4')),
]


def place(blocks, moves):
    def find(anchor):
        for k, b in enumerate(blocks):
            if isinstance(anchor, tuple) and b[0] == anchor[0] and b[1] == anchor[1]:
                return k
            if isinstance(anchor, str) and b[0] in ('p', 'p_cont') and b[1].startswith(anchor):
                return k
        raise KeyError(anchor)
    for item, anchor in moves:
        blk = blocks.pop(find(item))
        blocks.insert(find(anchor) + 1, blk)
    return blocks


REFERENCES = {
    'DEFAME': 'Braun, T., Rothermel, M., Rohrbach, M., Rohrbach, A.: DEFAME: dynamic evidence-based fact-checking '
              'with multimodal experts. In: Proceedings of the 42nd International Conference on Machine Learning. '
              'PMLR, vol. 267 (2025). https://arxiv.org/abs/2412.10510',
    'WEF': 'World Economic Forum: Global Risks Report 2026. World Economic Forum, Geneva (2026). '
           'https://www.weforum.org/publications/global-risks-report-2026/',
    'Chen': 'Chen, C., Shu, K.: Can LLM-generated misinformation be detected? In: Proceedings of the Twelfth '
            'International Conference on Learning Representations (ICLR) (2024). https://arxiv.org/abs/2309.13788',
    'Verma': 'Verma, Y.: What does 99% accuracy measure? A reproducible audit of shortcut learning in a widely '
             'used fake news corpus. arXiv preprint arXiv:2609.25006 (2026). https://arxiv.org/abs/2609.25006',
    'ExFake': 'Amri, S., Mputu Boleilanga, H.-C., Aïmeur, E.: ExFake: towards an explainable fake news detection '
              'based on content and social context information. arXiv preprint arXiv:2311.10784 (2023). '
              'https://arxiv.org/abs/2311.10784',
    'DaSan': 'Da San Martino, G., Barrón-Cedeño, A., Wachsmuth, H., Petrov, R., Nakov, P.: SemEval-2020 '
             'Task 11: detection of propaganda techniques in news articles. In: Proceedings of the Fourteenth '
             'Workshop on Semantic Evaluation, pp. 1377–1414 (2020). '
             'https://doi.org/10.18653/v1/2020.semeval-1.186',
    'Hu': 'Hu, B., Sheng, Q., Cao, J., Shi, Y., Li, Y., Wang, D., Qi, P.: Bad actor, good advisor: exploring the role '
          'of large language models in fake news detection. In: Proceedings of the AAAI Conference on Artificial '
          'Intelligence, vol. 38(20), pp. 22105–22113 (2024). https://doi.org/10.1609/aaai.v38i20.30214',
    'Wang': 'Wang, B., Ma, J., Lin, H., Yang, Z., Yang, R., Tian, Y., Chang, Y.: Explainable fake news detection '
            'with large language model via defense among competing wisdom. In: Proceedings of the ACM Web '
            'Conference 2024, pp. 2452–2463 (2024). https://doi.org/10.1145/3589334.3645471',
    'GuoZ': 'Guo, Z., Schlichtkrull, M., Vlachos, A.: A survey on automated fact-checking. Transactions of the '
            'Association for Computational Linguistics <b>10</b>, 178–206 (2022). '
            'https://doi.org/10.1162/tacl_a_00454',
    'AVeriTeC': 'Schlichtkrull, M., Guo, Z., Vlachos, A.: AVeriTeC: a dataset for real-world claim verification '
                'with evidence from the web. In: Advances in Neural Information Processing Systems, vol. 36, '
                'Datasets and Benchmarks Track (2023). https://arxiv.org/abs/2305.13117',
    'Lin': 'Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D.G., Pennycook, G.: High level of '
           'correspondence across different news domain quality rating sets. PNAS Nexus <b>2</b>(9), pgad286 (2023). '
           'https://doi.org/10.1093/pnasnexus/pgad286',
    'Minderer': 'Minderer, M., Djolonga, J., Romijnders, R., Hubis, F., Zhai, X., Houlsby, N., Tran, D., Lucic, M.: '
                'Revisiting the calibration of modern neural networks. In: Advances in Neural Information '
                'Processing Systems, vol. 34 (2021). https://arxiv.org/abs/2106.07998',
    'SilvaFilho': 'Silva Filho, T., Song, H., Perello-Nieto, M., Santos-Rodriguez, R., Kull, M., Flach, P.: '
                  'Classifier calibration: a survey on how to assess and improve predicted class probabilities. '
                  'Machine Learning <b>112</b>(9), 3211–3260 (2023). https://doi.org/10.1007/s10994-023-06336-7',
    'Hendrickx': 'Hendrickx, K., Perini, L., Van der Plas, D., Meert, W., Davis, J.: Machine learning with a reject '
                 'option: a survey. Machine Learning <b>113</b>, 3073–3110 (2024). https://arxiv.org/abs/2107.11277',
}


# Counts of zero read badly as numerals ("0 wrong verdicts"); they are put in words.
_ZERO = [(' and 0 wrong verdicts', ' and no wrong verdicts'), (' a wrong verdict for 0,', ' no wrong verdict,'),
         (' 0 missed and 0 wrong', ' none missed and none wrong'), (', 0 missed and ', ', none missed and '),
         (' and 0 wrong.', ' and none wrong.'), (' with 0 wrong verdicts', ' with no wrong verdicts'),
         (' with 0 wrong.', ' with none wrong.'), (' and 0 were wrong', ' and none were wrong'),
         (' 0 missed', ' none missed'), (' with 0 wrong', ' with none wrong')]


def tidy(text):
    if not isinstance(text, str):
        return text
    for a, b in _ZERO:
        text = text.replace(a, b)
    return text

ABSTRACT = tidy(ABSTRACT)

_body = body


def body():
    return [tuple(tidy(x) for x in block) for block in _body()]
