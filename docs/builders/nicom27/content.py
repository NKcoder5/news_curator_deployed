"""Text of the NICOM 2027 full paper (30th NICOM, IMNU, Nirma University), written to the conference rules:
5,000 words in all, APA references without numbers. Result numbers are read from backend/eval; the ISOT,
adversarial and benchmark figures are the measured values recorded in docs/measurements.md.
Inline markup: <i>, <b>."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, 'figs')
EVAL = os.path.join(HERE, '..', '..', '..', 'backend', 'eval', 'results')
SUITES = os.path.join(HERE, '..', '..', '..', 'backend', 'eval', 'suites')


def _json(path):
    return json.load(open(path, encoding='utf-8'))


_RULINGS = _json(os.path.join(SUITES, 'rulings.json'))['cases']
RUL_N = len(_RULINGS)
RUL_DESKS = len({c['ruling']['publisher'] for c in _RULINGS})
RUL_BY = {k: sum(1 for c in _RULINGS if c['category'] == k) for k in ('rated false', 'rated misleading', 'rated true')}
_LOG = [json.loads(line) for line in open(os.path.join(EVAL, 'sealed_runs.jsonl'), encoding='utf-8') if line.strip()]
_SEALED = {r['release']: r for r in _LOG if r.get('complete')}
S1 = _SEALED['sealed_rc1']['overall']
S2 = _SEALED['sealed_rc2']['overall']
S2_CAT = _SEALED['sealed_rc2']['byCategory']
S2_MEDIAN = _SEALED['sealed_rc2']['medianSeconds']
DEV = _json(os.path.join(EVAL, 'robustness_rulings_dev_rc2.json'))['summary']['overall']
GEM = _json(os.path.join(EVAL, 'robustness_rulings_others_gemini_2026-10-25_fixed.json'))['summary']['overall']
NO_GEM = _json(os.path.join(EVAL, 'robustness_rulings_others_no_gemini_ollama_nim.json'))['summary']['overall']
CM = _json(os.path.join(EVAL, 'claim_matching_heldout_with_model.json'))['summary']
_CF = _json(os.path.join(EVAL, 'counterfactual_faithfulness.json'))
assert not _CF['disagreements'] and all(p['broken'] == 0 for p in _CF['monotonicity']['perturbations'])
CF_STORED = _CF['sets']['stored']['ledgers']
CF_STATEMENTS = sum(s['statements'] for s in _CF['sets'].values())
CF_GRID = _CF['monotonicity']['grid']
_BENCH = _json(os.path.join(EVAL, 'checkAnything_benchmark_final.json'))
BN, BP, BO = _BENCH['summary']['claims'], _BENCH['summary']['plain']['right'], _BENCH['summary']['ours']['right']
BT = sum(1 for r in _BENCH['rows'] if r['truth'])
BTF = sum(1 for r in _BENCH['rows'] if r['truth'] and r['plain']['call'] == 'FAKE')
GOOD = S2['right'] + S2['safe']
FALSE_CAUGHT = S2_CAT['rated false']['right'] + S2_CAT['rated false']['safe']

TITLE = 'Evidence-Based Fake News Detection with Calibrated Scoring'
HEADER = 'NICOM 2027, IMNU, Nirma University'
_ORG = ('Department of Computer Science and Engineering, Kongu Engineering College', 'Perundurai, Erode, Tamil Nadu')
_STUDENT = 'Undergraduate Student, B.E. Computer Science and Engineering'
AUTHORS = [
    ('Mugilan K S', _STUDENT, *_ORG, 'mugilanks.23cse@kongu.edu'),
    ('Nandha Kumar S', _STUDENT, *_ORG, 'nandhakumars.23cse@kongu.edu'),
    ('Nandhini A', _STUDENT, *_ORG, 'nandhinia.23cse@kongu.edu'),
    ('Kannukkiniyal M (Corresponding Author)', 'Assistant Professor', *_ORG, 'kannukkiniyal.cse@kongu.edu'),
]

ABSTRACT = (
    'Most automated fake news detectors judge an article by the way it is written, yet writing style is the one '
    'thing a fabricator fully controls. This paper presents a checking system that weighs evidence the author '
    'cannot control. A reader submits a link, pasted text, a screenshot or a video; the system works out what the '
    'message asserts, in English, Tamil or Hindi, and checks each claim against independent news coverage, '
    'rulings published by fact-checkers, the current week’s reporting on its subject and encyclopedia entries for '
    'false premises. Writing signals are converted into likelihood ratios estimated from labelled data, but they '
    'are allowed to count only against a story. A fixed, ordered set of rules then gives a verdict, names the rule '
    'that decided it, and abstains when the evidence is insufficient. On 120 held-out ISOT articles the system '
    'matched a hand-weighted baseline within one article while reducing calibration error on its accusations from '
    '0.267 to 0.152, and it rated none of six carefully written fabrications as credible, against four for the '
    f'baseline. On {S2["n"]} claims ruled on by professional fact-checkers, sealed before development and never '
    f'tuned on, it gave the fact-checker’s verdict or an acceptable one for {GOOD}, withheld a verdict for '
    f'{S2["missed"]} and erred on {S2["wrong"]}. For platforms and newsrooms, an auditable verdict that can say '
    '“cannot verify” proves more useful than a confident score.'
)
KEYWORDS = 'Fake news detection; Evidence-based verification; Calibration; Abstention; Fact-checking'


def body():
    B = []
    h = lambda num, text: B.append(('h', num, text))
    sh = lambda num, text: B.append(('sh', num, text))
    p = lambda text: B.append(('p', text))

    # ------------------------------------------------------------------ 1
    h('1', 'Introduction')
    p('Misinformation now ranks among the most serious short-term risks facing societies; the World Economic Forum '
      '(2026) placed misinformation and disinformation second among global risks over a two-year horizon. For '
      'organisations the problem is concrete. A fabricated circular on a bank’s letterhead, a forged government '
      'notice or a cloned news site can travel through messaging groups faster than any correction, and the cost of '
      'a wrong response falls on the organisation whose name was borrowed.')
    p('Automated detection has largely been treated as text classification: a model reads an article and labels it '
      'fake or real from its wording. Reported scores on public datasets are high, but much of that accuracy comes '
      'from properties of the corpus rather than from the truth of the stories. Verma (2026) showed that on the '
      'widely used ISOT corpus a classifier given only the subject field of each article, with the text discarded, '
      'reaches an F1 score of 1.000. Large language models sharpen the weakness. Chen and Shu (2024) found that '
      'misinformation written by such models is harder for people and detectors to spot than human-written '
      'misinformation with the same meaning, because the surface cues that classifiers rely on are exactly what a '
      'fluent model produces on request.')
    p('We start from a different premise: a piece of evidence should count in favour of a story only if its author '
      'could not have produced it. Clean prose, a neutral tone and quoted sources cost a careful fabricator nothing, '
      'so their absence may raise suspicion but their presence should never establish credibility. Independent '
      'reporting, a fact-checker’s ruling, an encyclopedia entry and the publisher’s verifiable identity lie outside '
      'the author’s reach, and they may count in either direction (Figure 1).')
    B.append(('fig', '1', os.path.join(FIG, 'fig1_framework.png'), 4.7,
              'Evidence the author controls counts only against a story; evidence outside it counts either way'))
    p('The resulting system is built on the MERN stack and deployed as a public web application. It makes three '
      'contributions. First, it applies this one-sided rule inside a weight-of-evidence model whose weights are '
      'likelihood ratios estimated from data and calibrated against held-out outcomes. Second, it separates a check '
      'that found nothing from one that could not run, and abstains rather than guess when the evidence is '
      'insufficient. Third, it is evaluated on claims chosen by others: rulings published by ' + str(RUL_DESKS) +
      ' professional fact-checking desks, with the test portion sealed before development began.')

    # ------------------------------------------------------------------ 2
    h('2', 'Related Work')
    p('Braun et al. (2025) present DEFAME, the system closest to ours and the base for this work. DEFAME plans a '
      'fact-check in six stages, calls web search, image search, reverse image search and geolocation tools, and '
      'returns a verdict with a written justification. It reports accuracies of 70.5% on AVeriTeC, 83.9% on VERITE '
      'and 69.7% on ClaimReview2024+, a set of claims made after its model’s training cut-off. Three of its '
      'documented limits shaped our design. It relies on the search engine’s own trustworthiness signals rather than '
      'weighing sources, it returns a categorical verdict without a probability, and it depends on GPT-4o at about '
      'four minutes and USD 0.13 per claim. Our system weighs sources explicitly, attaches a calibrated probability '
      'to every verdict and runs on free model tiers, with a median of ' + f'{S2_MEDIAN:.1f}' + ' seconds per claim '
      'on our sealed test.')
    p('Several recent systems use language models as advisers rather than judges. Hu et al. (2024) found that a '
      'large model reasoning about an article detects fake news less accurately than a small fine-tuned classifier, '
      'but that its rationales improve the classifier when supplied as features. Wang et al. (2024) draw competing '
      'evidence for and against a claim, have a language model explain each side, and decide between them in a '
      'separate inference step. Both remain anchored to the text of the article. Work on automated fact-checking '
      '(Guo et al., 2022) and the AVeriTeC benchmark (Schlichtkrull et al., 2023) instead place retrieved evidence at '
      'the centre, which is the position we take, and we follow AVeriTeC in allowing a “not enough evidence” '
      'outcome.')
    p('Two further strands inform the scoring. Source reputation can be measured: Lin et al. (2023) showed that '
      'independent sets of news-domain quality ratings agree closely, which justifies using published ratings as a '
      'prior. Calibration and abstention come from machine learning more broadly. Minderer et al. (2021) found that '
      'calibration differs markedly between model families, so a stated confidence must be measured before it is '
      'trusted; Silva Filho et al. (2023) survey the methods for correcting it, and Hendrickx et al. (2024) review '
      'classifiers that may decline to predict. The persuasion-technique taxonomy of Da San Martino et al. (2020) '
      'supplies the vocabulary for one of our writing checks.')

    # ------------------------------------------------------------------ 3
    h('3', 'Proposed System')
    sh('3.1', 'Reading the Message')
    p('A reader may submit an article link, pasted text, a screenshot or a video link (Figure 2). Links are read '
      'from the publisher’s page, screenshots through optical character recognition and videos through their '
      'caption tracks. People rarely paste a tidy claim: they ask whether something is true, pass on what they '
      'heard, forward warnings in capitals, mock a claim, or write Tamil in English letters. A single model call at '
      'temperature zero therefore reads the message first. It returns the language, the kind of message and its '
      'tone, and up to three claims, each rewritten as a neutral English sentence with its time frame and search '
      'terms. A question is checked as the claim it asks about, a hedge as the claim passed on, and sarcasm as the '
      'claim being mocked. Input with nothing checkable in it, such as an opinion, a forecast or a call to action, '
      'is refused with the reason. Before this step existed, pattern rules alone decided what could be checked. '
      'They looked for capitalised names, and so refused every question and every message in Tamil or Hindi.')
    B.append(('fig', '2', os.path.join(FIG, 'fig2_pipeline.png'), 5.2, 'Processing pipeline of the proposed system'))
    sh('3.2', 'Evidence Channels')
    p('Each claim is checked through five channels that run in parallel.')
    p('<b>News coverage.</b> The claim is searched in Google News as a sentence, as a headline and by keyword. A '
      'second model call reads each headline and decides whether it concerns the same event and whether it supports '
      'or contradicts the claim, quoting the words that state the reported fact. The results are then reduced to '
      'the sources behind them: outlets under one owner count once, and copies of a single wire-agency story count '
      'once.')
    p('<b>Fact-checker rulings.</b> Viral rumours are seldom reported as news, so a news search can only fail to '
      'find them. Fact-checking desks publish their rulings with ClaimReview markup, which Google indexes. Each '
      'candidate ruling is shown to a model that must decide whether it examined the same assertion, so a ruling on '
      'a similar but different claim does not count.')
    p('<b>This week’s coverage.</b> An invented event about a heavily covered subject leaves a trace in the rest of '
      'the week’s news. On the day a message claimed that the Prime Minister had resigned, outlets were reporting '
      'him opening projects in Chennai. Headlines from the past seven days that could not be true if the claim were '
      'are marked, with the words that show it.')
    p('<b>Encyclopedia entries.</b> A story built on a false premise describes something no outlet reports. The '
      'people and organisations it names are looked up in Wikipedia, and a conflict counts only if the model quotes '
      'the entry and the quotation is actually found in it.')
    p('<b>Publisher and writing.</b> The publisher is identified from the web address rather than the name on the '
      'page, so a page calling itself “BBC News” at bbc-breaking-news.xyz does not inherit the BBC’s record. Four '
      'writing checks look for clickbait, slant, persuasion techniques and missing attribution, and each must quote '
      'the words it reacts to.')
    p('Every channel records whether it actually ran. A search that failed because of a rate limit or a timeout '
      'is reported as unavailable and adds nothing, so an outage is never presented to the reader as an absence of '
      'coverage. Our first version made exactly that mistake, telling readers that no outlet carried a wire story '
      'that five major outlets were reporting at the time.')
    sh('3.3', 'Weight of Evidence')
    p('Each observation <i>o</i> is converted into a likelihood ratio and expressed in decibans (Equation 1). The '
      'ratios are estimated from labelled articles by grouping observations into bands and counting, with a Jeffreys '
      'prior, and each estimate is shrunk to the conservative end of its 95% interval, so a band with few articles '
      'behind it contributes nothing. The log-odds that a story is fabricated are the prior log-odds plus the sum of '
      'the weights (Equation 2). The prior <i>π</i> is set by the publisher’s record, from 0.02 for an outlet with a '
      'strong record to 0.35 for a social-media post; these priors are our own choice rather than measurements, and '
      'every report says so.')
    B.append(('eq', 'W(<i>o</i>) = 10 log<sub>10</sub> [ P(<i>o</i> | fabricated) / P(<i>o</i> | genuine) ]', '1'))
    B.append(('eq', 'logit P(fabricated | <i>O</i>) = logit <i>π</i> + Σ<sub><i>o</i> ∈ <i>O</i></sub> W(<i>o</i>)', '2'))
    B.append(('eq', 'W<sup>†</sup>(<i>o</i>) = max(0, W(<i>o</i>)),  for every <i>o</i> the author controls', '3'))
    p('For observations the author controls, only the part that counts against the story is kept (Equation 3). On '
      'a corpus of crude fakes, fluent writing does predict a genuine article, and an unconstrained model learns to '
      'reward it; a careful fabricator writes fluently on purpose, so that lesson fails exactly when it matters. The '
      'four writing checks read the same prose and are correlated, with a mean pairwise correlation of 0.55, so '
      'their combined weight is scaled by the effective number of independent checks, 1.52 of 4, and capped at 8 '
      'decibans. The summed log-odds are finally calibrated with isotonic regression on held-out data. The clamp of '
      'Equation 3 is applied again after calibration, because the first fitted map had quietly restored the weight '
      'the clamp removes.')
    sh('3.4', 'Verdict Rules and Abstention')
    p('The probability and the verdict answer different questions: the probability is a graded belief, while the '
      'verdict states what has been established. The verdict comes from an ordered list of eighteen rules over the '
      'evidence; the first rule that applies decides, and its name and its record on labelled messages are shown to '
      'the reader. A fact-checker’s ruling of false on the same claim, or two independent outlets contradicting it, '
      'makes a story FAKE. A confirmed claim carrying a contradicted one is PARTLY FALSE, two independent outlets '
      'confirming every claim make it REAL, and a claim presented as new but confirmed only by coverage weeks old is '
      'old news. When nothing settles the claim, the verdict is CANNOT VERIFY even if the probability is low, '
      'because most stories are genuine and a low prior is not a confirmation. Since the rules are fixed, the system '
      'can also say what would change a verdict. It reruns them with each line of evidence removed or with '
      'hypothetical evidence added, and reports the smallest change that alters the outcome.')
    sh('3.5', 'Implementation')
    p('The application uses MongoDB, Express, React and Node.js. Every model call passes through one gateway that '
      'routes each task to the provider that measured best on it: Google Gemini for the judgements, NVIDIA NIM as '
      'the fallback, and a local Llama 3.1 8B model for eight writing and search tasks where a GPU is available. A '
      'multilingual MiniLM pair model of 118 million parameters, fine-tuned by the authors and exported as a 42 MB '
      'quantised file, matches claims to fact-checks and to earlier checks, and vetoes contradictions that a '
      'fallback model reports but the encyclopedia entry does not state. Every check is stored with the exact inputs '
      'the rules read, so any verdict can be reproduced from its record, and the backend has 519 automated tests '
      'that run without network access.')

    # ------------------------------------------------------------------ 4
    h('4', 'Evaluation Design')
    p('<b>Held-out ISOT articles.</b> After length filtering, ISOT holds 21,379 genuine and 21,915 fabricated '
      'articles. We used 239 articles whose writing checks had all come from the language model, split by a hash of '
      'the article identifier into 119 for estimating the ratios and 120 for testing. Sources were hidden and agency '
      'prefixes removed, since every genuine ISOT article comes from Reuters. Historical articles have no live '
      'coverage, so this test measures only the writing half of the model. The baseline is our earlier '
      'hand-weighted sum applied to the same check outputs.')
    p('<b>Adversarial set.</b> Ten items written by the authors: five fabrications in plain newsroom style with '
      'named sources and no clickbait, one high-impact fabrication with manipulation signals, two genuine reports, a '
      'satirical piece and an opinion column.')
    p(f'<b>Plain-model benchmark.</b> {BN} claims about October 2026, from wrong figures to true reports, were put '
      'both to the full system and to the same hosted model, Gemini 3.1 Flash-Lite, asked with the date and nothing '
      'else to read.')
    p(f'<b>Fact-checked rulings.</b> {RUL_N} claims on which {RUL_DESKS} fact-checking desks, among them FACTLY, '
      'NewsMobile, AFP Fact Check, The Quint, BOOM and Full Fact, published rulings between October 2024 and October '
      f'2026; {RUL_BY["rated false"]} were rated false, {RUL_BY["rated misleading"]} misleading and '
      f'{RUL_BY["rated true"]} true. A false rating expects FAKE and accepts PARTLY FALSE or MISLEADING, a '
      'misleading rating expects MISLEADING and accepts the other two, and a true rating expects REAL. The '
      'labelling desk’s own ruling is hidden during a run. The set was split once, before any result was seen: '
      'rulings 1–120 for development, and rulings 121–320 sealed, run whole once per release candidate, reported '
      'only as totals and never inspected.')

    # ------------------------------------------------------------------ 5
    h('5', 'Results')
    sh('5.1', 'Held-Out Articles and Adversarial Items')
    p('Table 1 compares the two scoring rules on the 120 held-out articles. Accuracy is the same within one '
      'article: 114 correct for the proposed rule (95.0%, 95% interval 89.5–97.7%) and 115 for the baseline (95.8%, '
      '90.6–98.2%). The difference lies in the accusations. Expected calibration error (ECE) on stories called '
      'fabricated fell from 0.267 to 0.152, a reduction of 43%, with precision unchanged at about 0.97. The proposed '
      'rule ranks slightly worse, with an ROC-AUC of 0.951 against 0.978, which is the cost of Equation 3: on ISOT '
      'the only evidence that could clear an article is its style, and the rule refuses to use it. Removing the '
      'clamp raised ROC-AUC to 0.983 but also raised the ECE on accusations to 0.191, so we kept the clamp. On the '
      'adversarial set the baseline rated four of the six deceptive items as credible; the proposed rule rated none '
      'as credible and condemned neither genuine report.')
    B.append(('table', '1', 'Held-out comparison of the two scoring rules (120 ISOT articles)',
              ['Rule', 'Accuracy', 'ROC-AUC', 'ECE', 'ECE on accusations', 'Precision on accusations', 'Brier'],
              [['Hand-weighted baseline', '0.958', '0.978', '0.237', '0.267', '0.968', '0.101'],
               ['Proposed rule', '0.950', '0.951', '0.246', '0.152', '0.967', '0.117']],
              [5.2, 2.1, 2.1, 1.7, 2.6, 2.9, 1.6]))
    sh('5.2', 'Current Claims Against a Plain Language Model')
    p(f'On the {BN} current claims the system answered all {BO} correctly and the plain model {BP}. The plain model’s '
      f'correct answers are weaker than they appear: it called {BTF} of the {BT} true reports fake, among them the '
      'Reserve Bank’s rate rise and India’s 85-medal total at the Asian Games, so its “fake” on a false claim '
      'reflects a habit rather than a finding, and it cites nothing a reader could check.')
    sh('5.3', 'Fact-Checked Rulings')
    p(f'Table 2 gives the results. The first release candidate gave the desk’s verdict for {S1["right"]} of the '
      f'{S1["n"]} sealed rulings, an acceptable verdict for {S1["safe"]}, no verdict for {S1["missed"]} and a wrong '
      f'one for {S1["wrong"]}. Its wrong calls on claims rated true prompted one further round of corrections, made '
      'only on development rulings and on a second development pool of 160 rulings from outside India. In that '
      'round we found that our reader of desk ratings had taken ratings written as sentences, such as “That’s not '
      'correct”, as true; a script that reads only the ratings, without the system’s answers, corrected four sealed '
      'labels from true to false. The first candidate’s totals stand on the old labels and cannot be rescored, since '
      'a sealed run keeps totals only, so part of the later fall in wrong verdicts may be due to the labels rather '
      f'than the code. The final code gave the desk’s verdict for {S2["right"]}, an acceptable one for {S2["safe"]}, '
      f'none for {S2["missed"]} and a wrong one for {S2["wrong"]}, at a median of {S2_MEDIAN:.1f} seconds per claim.')
    B.append(('table', '2', 'Outcomes on claims ruled on by fact-checkers',
              ['Rulings and code', 'Claims', 'Desk’s verdict', 'Acceptable', 'No verdict', 'Wrong'],
              [['Development 1–120, final code', *[str(DEV[k]) for k in ('n', 'right', 'safe', 'missed', 'wrong')]],
               ['Sealed 121–320, first candidate', *[str(S1[k]) for k in ('n', 'right', 'safe', 'missed', 'wrong')]],
               ['Sealed 121–320, final code', *[str(S2[k]) for k in ('n', 'right', 'safe', 'missed', 'wrong')]],
               *[[f'   of which rated {name}', *[str(S2_CAT['rated ' + name][k]) for k in ('n', 'right', 'safe', 'missed', 'wrong')]]
                 for name in ('false', 'misleading', 'true')]],
              [6.4, 1.6, 2.2, 2.0, 1.9, 1.6]))
    p('The system fails far more often by withholding a verdict than by giving a wrong one. Of '
      f'{S2_CAT["rated false"]["n"]} claims rated false, {FALSE_CAUGHT} were called fake, partly false or misleading '
      f'and {S2_CAT["rated false"]["wrong"]} were called real. Claims rated true are the weak point, with '
      f'{S2_CAT["rated true"]["right"]} of {S2_CAT["rated true"]["n"]} confirmed. In development such failures came '
      'from events reported by too few outlets, rankings that no headline states, and counts accumulated over '
      'different dates. The result also depends on the hosted model: on rulings 1–60, switching Gemini off raised '
      f'the number of claims left without a verdict from {GEM["missed"]} to {NO_GEM["missed"]}, while wrong verdicts '
      f'stayed at {NO_GEM["wrong"]}.')
    sh('5.4', 'Explanations and Claim Memory')
    p('Because rules decide the verdict, every explanation can be tested. A separate script recomputed each '
      f'statement the explainer makes on {CF_STORED} stored checks, 380 scenario ledgers and 2,000 random ones, and '
      f'all {CF_STATEMENTS:,} statements agreed. Across {CF_GRID:,} further random ledgers, adding a fact-checker’s '
      'false rating, an encyclopedia contradiction or two more contradicting outlets never made a verdict milder, '
      f'and adding confirming evidence never made it harsher. On {CM["pairs"]} held-out claim pairs the claim memory '
      f'filed {CM["exact"]} correctly and merged no two different claims.')

    # ------------------------------------------------------------------ 6
    h('6', 'Discussion')
    sh('6.1', 'Implications for Practice')
    p('For platforms and messaging services, a verdict that comes with its reason and a willingness to say “cannot '
      'verify” is more useful than a confident score. An unexplained label invites distrust the first time it is '
      'wrong, whereas a verdict traced to named outlets and a stated rule can be checked and appealed. For '
      'organisations whose name carries weight, such as banks, government departments and newsrooms, reading '
      'identity from the web address stops lookalike sites from borrowing their record. In our tests five '
      'lookalikes of the BBC, Reuters and the Associated Press each inherited the real outlet’s rating when the '
      'publisher was taken from the page, and none did when it was taken from the address. For regulators, every '
      'verdict can be traced to a rule, the outlets involved and the quoted text. The system reads Tamil and Hindi as '
      'readily as English, which matters where misinformation travels in regional languages, and it runs on free '
      'model tiers. In this way the work supports Sustainable Development Goal 16, target 16.10, on public access to '
      'information.')
    sh('6.2', 'Limitations')
    p('The likelihood ratios come from 239 articles, so some bands are too thin to estimate, and the publisher priors '
      'are set by hand. The adversarial set and the plain-model benchmark are small and were written by the authors. '
      f'The rulings set is labelled by the desks, but only {RUL_BY["rated true"]} of its {RUL_N} claims are rated true, '
      'too few to measure that class closely. Verdicts depend on Google News, the fact-check index, Wikipedia and a '
      'hosted model whose free daily quota, once spent, leaves slower and more cautious fallbacks. Stance is judged '
      'from headlines rather than full articles, which is the main reason true claims go unconfirmed. Manipulated '
      'images and synthetic video are not analysed directly. Finally, we did not run DEFAME on our data, so the '
      'comparison in Section 2 is one of design, not a benchmark result.')

    # ------------------------------------------------------------------ 7
    h('7', 'Conclusion')
    p('We built and deployed a fake news checker that weighs evidence by who controls it. Writing signals may count '
      'only against a story, while support must come from independent outlets, fact-checkers, reference entries and '
      'a publisher identified by its address. Every weight is a likelihood ratio estimated from data, and the '
      'combined score is calibrated. On held-out ISOT articles the system matched a hand-weighted baseline’s '
      'accuracy while cutting calibration error on its accusations by 43%, and it rated none of six careful '
      f'fabrications as credible. On {S2["n"]} sealed claims ruled on by professional fact-checkers it gave the '
      f'desk’s or an acceptable verdict for {GOOD} and a wrong verdict for {S2["wrong"]}. Future work will address '
      'the claims it leaves unanswered, true ones especially, by reading article bodies rather than headlines; it '
      'will also enlarge the estimation corpus so that the priors can be measured, and move the remaining judgements '
      'onto models the authors run themselves.')
    return B


# APA 7th edition, alphabetical, no numbering, as the conference requires.
REFERENCES = [
    'Braun, T., Rothermel, M., Rohrbach, M., & Rohrbach, A. (2025). DEFAME: Dynamic evidence-based fact-checking '
    'with multimodal experts. In <i>Proceedings of the 42nd International Conference on Machine Learning</i> '
    '(Vol. 267). PMLR. https://arxiv.org/abs/2412.10510',
    'Chen, C., & Shu, K. (2024). Can LLM-generated misinformation be detected? In <i>Proceedings of the Twelfth '
    'International Conference on Learning Representations</i>. https://arxiv.org/abs/2309.13788',
    'Da San Martino, G., Barrón-Cedeño, A., Wachsmuth, H., Petrov, R., & Nakov, P. (2020). SemEval-2020 Task 11: '
    'Detection of propaganda techniques in news articles. In <i>Proceedings of the Fourteenth Workshop on Semantic '
    'Evaluation</i> (pp. 1377–1414). https://doi.org/10.18653/v1/2020.semeval-1.186',
    'Guo, Z., Schlichtkrull, M., & Vlachos, A. (2022). A survey on automated fact-checking. <i>Transactions of the '
    'Association for Computational Linguistics, 10</i>, 178–206. https://doi.org/10.1162/tacl_a_00454',
    'Hendrickx, K., Perini, L., Van der Plas, D., Meert, W., & Davis, J. (2024). Machine learning with a reject '
    'option: A survey. <i>Machine Learning, 113</i>, 3073–3110. https://arxiv.org/abs/2107.11277',
    'Hu, B., Sheng, Q., Cao, J., Shi, Y., Li, Y., Wang, D., & Qi, P. (2024). Bad actor, good advisor: Exploring the '
    'role of large language models in fake news detection. <i>Proceedings of the AAAI Conference on Artificial '
    'Intelligence, 38</i>(20), 22105–22113. https://doi.org/10.1609/aaai.v38i20.30214',
    'Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D. G., & Pennycook, G. (2023). High level of '
    'correspondence across different news domain quality rating sets. <i>PNAS Nexus, 2</i>(9), pgad286. '
    'https://doi.org/10.1093/pnasnexus/pgad286',
    'Minderer, M., Djolonga, J., Romijnders, R., Hubis, F., Zhai, X., Houlsby, N., Tran, D., & Lucic, M. (2021). '
    'Revisiting the calibration of modern neural networks. In <i>Advances in Neural Information Processing '
    'Systems</i> (Vol. 34). https://arxiv.org/abs/2106.07998',
    'Schlichtkrull, M., Guo, Z., & Vlachos, A. (2023). AVeriTeC: A dataset for real-world claim verification with '
    'evidence from the web. In <i>Advances in Neural Information Processing Systems</i> (Vol. 36, Datasets and '
    'Benchmarks Track). https://arxiv.org/abs/2305.13117',
    'Silva Filho, T., Song, H., Perello-Nieto, M., Santos-Rodriguez, R., Kull, M., & Flach, P. (2023). Classifier '
    'calibration: A survey on how to assess and improve predicted class probabilities. <i>Machine Learning, '
    '112</i>(9), 3211–3260. https://doi.org/10.1007/s10994-023-06336-7',
    'Verma, Y. (2026). <i>What does 99% accuracy measure? A reproducible audit of shortcut learning in a widely used '
    'fake news corpus</i> (arXiv:2609.25006). arXiv. https://arxiv.org/abs/2609.25006',
    'Wang, B., Ma, J., Lin, H., Yang, Z., Yang, R., Tian, Y., & Chang, Y. (2024). Explainable fake news detection '
    'with large language model via defense among competing wisdom. In <i>Proceedings of the ACM Web Conference '
    '2024</i> (pp. 2452–2463). https://doi.org/10.1145/3589334.3645471',
    'World Economic Forum. (2026). <i>Global risks report 2026</i>. '
    'https://www.weforum.org/publications/global-risks-report-2026/',
]
