"""Content of the project report. Every figure quoted here is a measured value recorded in
docs/measurements.md, backend/eval/results, data/taskRouting.json or report/e2e_results*.json."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, 'report', 'figs')
SHOT = os.path.join(HERE, 'report', 'shots')

EVAL = os.path.join(HERE, '..', '..', 'backend', 'eval', 'results')


def _eval(*names):
    for name in names:
        path = os.path.join(EVAL, name)
        if os.path.exists(path):
            return json.load(open(path, encoding='utf-8'))
    return None


ABSTAIN = {'CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR'}


def _tally(rows):
    t = {'n': len(rows), 'right': 0, 'safe': 0, 'missed': 0, 'wrong': 0}
    for r in rows:
        if r['call'] == r['expected']:
            t['right'] += 1
        elif r['call'] in (r.get('alsoAcceptable') or []):
            t['safe'] += 1
        elif r['call'] in ABSTAIN:
            t['missed'] += 1
        else:
            t['wrong'] += 1
    return t


ROBUST_BEFORE = _eval('robustness_before.json')
ROBUST_AFTER = _eval('robustness_final.json', 'robustness_after.json')
HELDOUT_FIRST = _eval('robustness_heldout.json')
HELDOUT_AFTER = _eval('robustness_heldout_final.json')
BENCH = _eval('checkAnything_benchmark_final.json', 'checkAnything_benchmark.json')
RB = _tally(ROBUST_BEFORE['rows'])
RA = _tally(ROBUST_AFTER['rows'])
HF = _tally(HELDOUT_FIRST['rows'])
HA = _tally(HELDOUT_AFTER['rows']) if HELDOUT_AFTER else None
BENCH_N = BENCH['summary']['claims']
BENCH_PLAIN = BENCH['summary']['plain']['right']
BENCH_OURS = BENCH['summary']['ours']['right']
BENCH_TRUE_N = sum(1 for r in BENCH['rows'] if r['truth'])
BENCH_PLAIN_TRUE = sum(1 for r in BENCH['rows'] if r['truth'] and r['plain']['call'] == 'REAL')
BENCH_PLAIN_TRUE_FAKE = sum(1 for r in BENCH['rows'] if r['truth'] and r['plain']['call'] == 'FAKE')
BENCH_MEDIAN = BENCH['summary'].get('medianSecondsOurs')

# Fact-checked rulings: the suite, the development run on the final code, and every sealed run as logged.
RULINGS = json.load(open(os.path.join(EVAL, '..', 'suites', 'rulings.json'), encoding='utf-8'))['cases']
RUL_N = len(RULINGS)
RUL_DESKS = len({c['ruling']['publisher'] for c in RULINGS})
RUL_FROM = min(c['labelledOn'] for c in RULINGS)
RUL_TO = max(c['labelledOn'] for c in RULINGS)
RUL_BY = {k: sum(1 for c in RULINGS if c['category'] == k) for k in ('rated false', 'rated misleading', 'rated true')}
SEALED_LOG = [json.loads(line) for line in open(os.path.join(EVAL, 'sealed_runs.jsonl'), encoding='utf-8') if line.strip()]
SEALED = {r['release']: r for r in SEALED_LOG if r.get('complete')}
S1 = SEALED['sealed_rc1']['overall']
S2 = SEALED['sealed_rc2']['overall']
S2_CAT = SEALED['sealed_rc2']['byCategory']
S2_MEDIAN = SEALED['sealed_rc2']['medianSeconds']
S_STOPPED = [r for r in SEALED_LOG if not r.get('complete')]
RUL_DEV = _eval('robustness_rulings_dev_rc2.json')['summary']['overall']
RUL_GEMINI = _eval('robustness_rulings_others_gemini_2026-10-25_fixed.json')['summary']['overall']
RUL_NO_GEMINI = _eval('robustness_rulings_others_no_gemini_ollama_nim.json')['summary']['overall']


def _date(iso):
    """'2024-10-28' as '28 October 2024'."""
    import datetime
    d = datetime.date.fromisoformat(iso[:10])
    return f'{d.day} {d.strftime("%B")} {d.year}'


def _outcomes(t):
    return [str(t['n']), str(t['right']), str(t['safe']), str(t['missed']), str(t['wrong'])]


def rulings_rows():
    return [['Development, rulings 1–120', 'Final', *_outcomes(RUL_DEV)],
            ['Sealed, rulings 121–320', 'First candidate', *_outcomes(S1)],
            ['Sealed, rulings 121–320', 'Final', *_outcomes(S2)]]


def sealed_category_rows():
    names = [('rated false', 'False'), ('rated misleading', 'Misleading'), ('rated true', 'True')]
    return [[name, *_outcomes(S2_CAT[key])] for key, name in names] + [['Total', *_outcomes(S2)]]

# The suite's 23 categories, grouped for the table.
GROUPS = [
    ('Plain claims, numbers and units', ['plain', 'numbers and units', 'typos and lower case']),
    ('Questions and passed-on claims', ['question', 'hedged']),
    ('Forwards and sarcasm', ['emotional forward', 'sarcasm']),
    ('Negation and opinion', ['negation', 'opinion with fact']),
    ('Several claims in one message', ['several claims']),
    ('Tamil, Tanglish and Hindi', ['Tamil', 'Tanglish', 'Hindi']),
    ('Old news, history and standing facts', ['old news recirculated', 'historical fact', 'stable fact or myth']),
    ('Quotes, local news, rumours and links', ['quote', 'local news', 'viral rumour', 'link', 'long text']),
    ('Forecasts and vague text', ['prediction', 'vague or unfalsifiable']),
]


def robustness_rows():
    rows = []
    for label, cats in GROUPS:
        before = _tally([r for r in ROBUST_BEFORE['rows'] if r['category'] in cats])
        after = _tally([r for r in ROBUST_AFTER['rows'] if r['category'] in cats])
        rows.append([label, str(before['n']), str(before['right']), str(before['missed']), str(before['wrong']),
                     str(after['right']), str(after['missed']), str(after['wrong'])])
    rows.append(['Total', str(RB['n']), str(RB['right']), str(RB['missed']), str(RB['wrong']),
                 str(RA['right']), str(RA['missed']), str(RA['wrong'])])
    return rows


KIND_NAMES = [('figure', 'Wrong figure'), ('outcome', 'Reversed outcome'), ('rumour', 'Viral rumour'),
              ('invented', 'Invented event'), ('premise', 'False premise'), ('true', 'True report')]


def plain_rows():
    out = []
    for kind, name in KIND_NAMES:
        rows = [r for r in BENCH['rows'] if r['kind'] == kind]
        right = lambda who: sum(1 for r in rows if r[who]['call'] == ('REAL' if r['truth'] else 'FAKE'))
        out.append([name, str(len(rows)), str(right('plain')), str(right('ours'))])
    out.append(['Total', str(BENCH_N), str(BENCH_PLAIN), str(BENCH_OURS)])
    return out



TITLE_LINES = ['EVIDENCE-BASED FAKE NEWS DETECTION', 'WITH CALIBRATED SCORING']
TITLE_ONE_LINE = 'EVIDENCE-BASED FAKE NEWS DETECTION WITH CALIBRATED SCORING'
COURSE = '22CSP72 - PROJECT WORK II'
PHASE = 'PHASE-I'
STUDENTS = [('MUGILAN K S', '23CSR138'), ('NANDHA KUMAR S', '23CSR140'), ('NANDHINI A', '23CSR141')]
MONTH_YEAR = 'OCTOBER 2026'
ACADEMIC_YEAR = '2026-2027'
SUPERVISOR = 'Ms. M. KANNUKKINIYAL'

ABSTRACT = [
    'Most style-based fake news detectors judge an article by the way it is written. However, writing style is '
    'also one of the easiest things for someone creating fabricated news to control. We propose an evidence-based '
    'approach that instead checks whether the claims in a message are supported or contradicted by evidence from '
    'outside it. The system accepts article links, pasted text, screenshots and videos, in English, Tamil and Hindi '
    'and in Tamil or Hindi typed in English letters. A reading step first works out what a message asserts, whether '
    'it is a statement, a question, sarcasm or something passed on, and writes its claims as plain English '
    'sentences. Each claim is then checked against four kinds of evidence: independent news coverage, rulings '
    'already published by professional fact-checkers, the current week of coverage about the claim’s subject, and '
    'an encyclopedia for premises and standing facts. Rather than counting articles, the system measures how many '
    'independent sources report a claim. Style-related signals, including clickbait, bias, manipulation and '
    'transparency, are represented as likelihood ratios learned from labelled data and combined as log-odds into a '
    'calibrated probability that the story is fabricated.',
    'The central idea behind the approach is that evidence controlled by the author can increase suspicion, but it '
    'can never establish credibility. Fixed rules over the evidence decide the verdict, real, fake, partly false or '
    'cannot verify, name the rule that decided it, and abstain when the evidence is insufficient. On 120 held-out '
    'ISOT articles, the scoring model matches a conventional hand-weighted baseline to within one article while '
    'reducing the expected calibration error of its accusations from 0.267 to 0.152. On ' + str(RA['n']) + ' test '
    'messages covering questions, sarcasm, negation, several claims, old news and three languages, the system '
    'returned the expected answer for ' + str(RA['right']) + ' and a wrong verdict for ' + str(RA['wrong']) + ', '
    'against ' + str(RB['right']) + ' expected answers before the reading step was added; on ' + str(HF['n']) +
    ' cases written after development it answered ' + str(HF['right']) + ' correctly at first sight. On ' +
    str(BENCH_N) + ' claims about the current month, the same hosted language model asked without evidence answered ' +
    str(BENCH_PLAIN) + ' correctly and called ' + str(BENCH_PLAIN_TRUE_FAKE) + ' true reports fake, while the system '
    'answered ' + str(BENCH_OURS) + ' correctly. On ' + str(S2['n']) + ' claims ruled on by professional fact-checkers '
    'and sealed before development, never read or tuned on, the final system gave the fact-checker’s verdict or an '
    'acceptable one for ' + str(S2['right'] + S2['safe']) + ', no verdict for ' + str(S2['missed']) + ' and a wrong '
    'verdict for ' + str(S2['wrong']) + '.',
]

ABBREVIATIONS = [
    ('API', 'Application Programming Interface'),
    ('AUC', 'Area Under the Curve'),
    ('CORS', 'Cross-Origin Resource Sharing'),
    ('ECE', 'Expected Calibration Error'),
    ('FN', 'False Negative'),
    ('FP', 'False Positive'),
    ('GPU', 'Graphics Processing Unit'),
    ('HTTP', 'Hypertext Transfer Protocol'),
    ('ISOT', 'Information Security and Object Technology (dataset)'),
    ('JSON', 'JavaScript Object Notation'),
    ('JWT', 'JSON Web Token'),
    ('LLM', 'Large Language Model'),
    ('MERN', 'MongoDB, Express, React and Node.js'),
    ('NIM', 'NVIDIA Inference Microservices'),
    ('OCR', 'Optical Character Recognition'),
    ('RDAP', 'Registration Data Access Protocol'),
    ('ROC', 'Receiver Operating Characteristic'),
    ('SDG', 'Sustainable Development Goal'),
    ('TN', 'True Negative'),
    ('TP', 'True Positive'),
    ('URL', 'Uniform Resource Locator'),
    ('WoE', 'Weight of Evidence'),
]


def e2e_rows():
    part1 = json.load(open(os.path.join(HERE, 'report', 'e2e_results_part1.json'), encoding='utf-8'))['rows']
    part2 = json.load(open(os.path.join(HERE, 'report', 'e2e_results_part2.json'), encoding='utf-8'))['rows']
    by_id = {r['id']: r for r in part1}
    for r in part2:
        by_id[r['id']] = r
    rules = {
        'corroborated-by-multiple-independent-sources': 'Two or more independent sources',
        'premise-contradicted-by-reference': 'Premise contradicted by reference',
        'no-independent-coverage': 'No independent coverage found',
        'question': 'Asks a question, asserts nothing',
        'unfalsifiable': 'Exhortation, no checkable claim',
        'publisher blocks reading': 'Publisher blocks automated reading',
    }
    expected = {'1': 'REAL', '2': 'REAL', '3': 'REAL', '4': 'REAL', '5': 'REAL or CANNOT VERIFY',
                '6': 'FAKE', '7': 'FAKE', '8': 'CANNOT VERIFY', '9': 'CANNOT VERIFY',
                '10': 'Refused', '11': 'Refused', '12': 'Refused'}
    rows = []
    for i in [str(n) for n in range(1, 13)]:
        r = by_id[i]
        got = 'Refused' if r['got'] == 'REFUSED' else r['got']
        secs = f"{r['seconds']:.0f} s" if r['seconds'] >= 1 else '< 1 s'
        rows.append([i, r['medium'], expected[i], got, rules.get(r['rule'], r['rule']), secs])
    return rows


def content():
    C = []
    add = C.append

    # =================================================================== CHAPTER 1
    add(('chapter', 1, 'INTRODUCTION'))
    add(('section', '1.1', 'FAKE NEWS AND MISINFORMATION'))
    add(('para', 'Fake news is fabricated or deliberately misleading content presented in the form of news. It reaches '
         'readers through many routes: a link shared on a messaging application, a forwarded message with no source, '
         'a screenshot of a social media post, or a video in which the claim is spoken rather than written. The '
         'volume of such material now exceeds what any individual can verify, and a story that looks like news is '
         'usually believed and shared before anyone checks it. The World Economic Forum’s Global Risks Report 2026 '
         'ranks misinformation and disinformation as the second most severe global risk over the next two years '
         '[@WEF]. Automated assistance is therefore attractive, and recent systems such as DEFAME [@DEFAME] check '
         'claims against evidence gathered from the web.'))
    add(('para', 'Most earlier research treats the task as classification: given an article, output “fake” or '
         '“real”. Classifiers are trained on labelled corpora such as ISOT and learn from how an article is written, '
         'that is, its tone, its headline, its vocabulary and whether it names sources. They report very high accuracy '
         'on these corpora, but a 2026 audit of ISOT [@Verma] shows that much of that accuracy comes from properties '
         'of the corpus rather than from the difficulty of the task. More importantly, every signal of writing style '
         'is chosen by whoever wrote the article. A fabricator who writes calmly, names an expert and avoids '
         'exaggerated headlines produces exactly the style that these classifiers associate with genuine reporting, '
         'and misinformation rewritten by a language model is harder still for detectors to catch [@Chen].'))
    add(('para', 'Label-only output has three further weaknesses. A label carries no reason, so the reader cannot check '
         'or dispute it. A single score hides which evidence it rests on: a poor publisher record, an exaggerated '
         'headline and a contradicted claim are different problems that call for different responses. And the '
         'confidence reported by a modern classifier is not automatically a true probability, since how well it is '
         'calibrated varies considerably from one model to another [@Minderer].'))

    add(('section', '1.2', 'FUNDAMENTALS OF EVIDENCE-BASED VERIFICATION'))
    add(('para', 'Evidence-based verification decides whether a claim holds by consulting evidence outside the claim '
         'itself. Automated fact-checking is usually described as claim detection, evidence retrieval, verdict '
         'prediction and justification [@GuoZ], and benchmarks such as AVeriTeC pair real-world claims with evidence '
         'found on the open web [@AVeriTeC]. For news, the strongest evidence about an event is independent coverage: '
         'if several unrelated newsrooms report the same facts, the event very probably happened. Stable facts, such '
         'as who holds a particular office, are better settled by a reference work, which can expose a story built on '
         'a false premise even when no outlet reports the invented event at all.'))
    add(('para', 'Evidence can be combined in a way that keeps every step checkable. In the weight-of-evidence '
         'formulation, each observation contributes the logarithm of a likelihood ratio, measured in decibans, and '
         'independent contributions add. The final probability is then a sum that a reader can follow line by line, '
         'instead of a number produced by an opaque model.'))
    add(('para', 'Two further ideas complete the foundation. A probability is calibrated when, among all stories given '
         'a 70% chance of being fabricated, about 70% actually are; calibration is measured by the expected '
         'calibration error and corrected by methods such as Platt scaling and isotonic regression [@SilvaFilho]. '
         'Learning with a reject option [@Hendrickx] allows a system to abstain when the evidence does not support an '
         'answer, which is the honest response to a claim that nothing confirms or refutes.'))
    add(('para', 'As shown in Figure 1.1, the proposed system separates the evidence about a story into two kinds. '
         'Evidence chosen by the author may count against the story but never in its favour; evidence outside the '
         'author’s control may count in either direction.'))
    add(('figure', '1.1', os.path.join(FIG, 'fig_1_1_evidence_split.png'), 5.6, 'Author-Controlled and Independent Evidence'))

    add(('section', '1.3', 'PROBLEM STATEMENT'))
    add(('para', 'Existing fake news detectors return a label derived largely from writing style, which a competent '
         'fabricator controls; they rarely show the evidence behind the label, seldom report whether their stated '
         'confidence is calibrated, and do not define what they output when a component fails or when the input '
         'contains nothing that can be checked. The problem addressed here is to build a system that judges a story by '
         'independent evidence, accepts the forms in which readers actually meet stories, states its reasons and a '
         'calibrated probability, abstains when the evidence is insufficient, and cannot be made to call a story '
         'credible through presentation alone.'))

    add(('section', '1.4', 'OBJECTIVES'))
    add(('bullets', [
        'To verify news claims against coverage by independent outlets, counting sources rather than retrieved articles.',
        'To expose false premises by checking named people and organisations against a reference work.',
        'To accept article links, pasted text, screenshots and videos in English, Tamil and Hindi, to read questions, '
        'sarcasm, hedges and forwards for the claim they make, and to decline input that makes no checkable claim.',
        'To find rulings already published by professional fact-checkers and to test claims against the current '
        'week’s coverage of their subject.',
        'To combine evidence as measured likelihood ratios under a one-sided rule, producing a calibrated probability of fabrication.',
        'To route each language-model task to a model that proved reliable for it, and to evaluate the system on '
        'held-out, adversarial, robustness and end-to-end test sets and against a plain language model.',
    ]))

    # =================================================================== CHAPTER 2
    add(('chapter', 2, 'LITERATURE REVIEW'))
    add(('para', 'The ISOT fake news dataset, published by the ISOT research lab of the University of Victoria, collects '
         'real articles from Reuters and fake articles from sites flagged as unreliable. It has become one of the most '
         'widely used benchmarks for fake news classification, with reported accuracies frequently above 98%. Verma '
         '(2026) audited ISOT for shortcut learning [@Verma]. The audit found that the subject field takes disjoint '
         'values across the two classes, so a classifier reading no article text at all attains an F1 score of 1.000; '
         'that a newswire agency tag appears in 99.21% of real articles and 0.04% of fake ones; and that exact '
         'duplicates span 19.37% of a naive test split. Removing these channels costs only 1.21 F1 points, so a strong '
         'lexical signal survives, and it is exactly the signal a careful fabricator does not emit.'))
    add(('para', 'Chen and Shu (2024) asked whether misinformation generated by large language models can be detected, '
         'and found that it is harder for both people and detectors to spot than human-written misinformation with '
         'the same meaning [@Chen]. A detector that relies on writing style is therefore weakest against the '
         'fabrications that are now the cheapest to produce.'))
    add(('para', 'Hu et al. (2024) studied the role of large language models in fake news detection. They found that '
         'GPT-3.5, used directly as a detector, performed worse than a fine-tuned small language model, but that its '
         'written rationales improved the small model when they were supplied as guidance [@Hu]. Their adaptive '
         'rationale guidance network still judges the text of the article alone.'))
    add(('para', 'Amri, Mputu Boleilanga and Aïmeur (2023) presented ExFake, which combines the content of an article '
         'with its social context and external evidence to produce explainable decisions [@ExFake]. Its strongest '
         'signals, such as the credibility of the users who share a post, arrive only after an article has '
         'circulated, whereas the proposed system computes its evidence from the article and from independent news '
         'retrieval at first sight.'))
    add(('para', 'Wang et al. (2024) used a large language model to weigh competing wisdom, that is, conflicting crowd '
         'reports about a claim, and to write a justification for each possible verdict before choosing between them '
         '[@Wang]. The approach works well when many reports exist for a claim. The proposed system uses the language '
         'model in a deliberately narrow role, extracting claims and judging stance over retrieved articles, so that '
         'the factual burden rests on retrieval rather than on the model.'))
    add(('para', 'Guo, Schlichtkrull and Vlachos (2022) surveyed automated fact-checking and described it as claim '
         'detection, evidence retrieval, verdict prediction and justification [@GuoZ]. Schlichtkrull, Guo and Vlachos '
         '(2023) introduced AVeriTeC, a dataset of 4,568 real-world claims checked by 50 fact-checking organisations, '
         'each annotated with question-answer pairs backed by evidence available on the web [@AVeriTeC]. An '
         'encyclopedia alone cannot settle breaking news, so the proposed system retrieves live coverage from '
         'independent outlets for events and uses a reference work only for stable facts about named subjects.'))
    add(('para', 'Braun, Rothermel, Rohrbach and Rohrbach (2025) presented DEFAME, a dynamic evidence-based '
         'fact-checking system with multimodal experts, at the International Conference on Machine Learning '
         '[@DEFAME]. DEFAME is the base paper for the proposed system. It verifies claims that combine text and '
         'images in six stages: it plans actions, executes them, summarises the results, develops the fact-check, '
         'predicts a verdict and justifies it. Its tools include web search, image search, reverse image search and a '
         'geolocation model, and it returns one of four verdicts (supported, refuted, misleading or not enough '
         'information), going back to planning up to three times when the evidence is insufficient. With GPT-4o as '
         'its backbone it reported 70.5% accuracy on AVeriTeC, 59.2% on MOCHEG and 83.9% on the true-versus-false '
         'split of VERITE, at a cost of about thirteen US cents and four minutes per claim.'))
    add(('para', 'DEFAME shares the premise of the proposed system: a verdict should rest on retrieved evidence, not on '
         'the style of the text. Its authors note that it does not weigh the credibility of sources and relies '
         'instead on the search engine’s own trustworthiness checks, and it returns a label without a probability. '
         'The proposed system keeps the evidence-first approach of DEFAME and adds what a reader-facing service '
         'needs: a count of independent sources, the publisher’s identity read from its web address, a one-sided '
         'rule for evidence the author controls, a calibrated probability, and a defined response when a check cannot '
         'run.'))
    add(('para', 'Da San Martino et al. (2020) defined SemEval-2020 Task 11, which labels propaganda and persuasion '
         'techniques at the level of individual spans of text [@DaSan]. The taxonomy has largely remained a research '
         'task; the proposed system adopts it as a reader-facing check that names each technique and quotes the span '
         'that exhibits it.'))
    add(('para', 'Minderer et al. (2021) revisited the calibration of modern neural networks and showed that '
         'calibration differs considerably between model families, with architecture a major factor, so a stated '
         'confidence has to be measured before it can be read as a probability [@Minderer]. Silva Filho et al. (2023) '
         'surveyed how to assess and improve predicted class probabilities, covering the expected calibration error, '
         'the Brier score and post-hoc methods such as Platt scaling and isotonic regression [@SilvaFilho]. The '
         'proposed system reports calibration separately for the cases in which it accuses a story, because a false '
         'accusation is the more harmful error.'))
    add(('para', 'Hendrickx et al. (2024) surveyed machine learning with a reject option, in which a model may abstain '
         'on inputs where a prediction would be unreliable, and described how both the predictions and the rejections '
         'should be evaluated [@Hendrickx]. This view supports treating abstention as a correct outcome rather than a '
         'failure.'))
    add(('para', 'Lin et al. (2023) compared six professional sets of news domain quality ratings, found a high level of '
         'correspondence between them, and combined them into a single published rating for 11,520 news domains '
         '[@Lin]. The proposed system uses that rating set, together with its own curated list, to rate publishers.'))
    add(('para', 'From the literature, it is understood that existing systems are largely classification-centric and '
         'rely on signals that are either chosen by the author or available only after a story has spread. Few of them '
         'show the evidence behind a decision, report calibration, weigh the independence of their sources, or define '
         'their behaviour when a component fails. The proposed system addresses these gaps with an evidence-based, '
         'calibrated and explainable assessment that abstains when it cannot decide.'))

    add(('para', 'Table 2.1 summarises the works reviewed, the approach each takes, and the gap that the proposed system '
         'addresses in relation to each.'))
    add(('table', '2.1', 'Summary of the Literature Reviewed',
         ['Work', 'Approach', 'Gap addressed by the proposed system'],
         [['Braun et al. (2025) [@DEFAME]', 'Multimodal evidence-based fact-checking (DEFAME, base paper)',
           'No weighting of source credibility or independence; no probability'],
          ['Verma (2026) [@Verma]', 'Audit of shortcut learning in ISOT', 'High ISOT accuracy reflects corpus artefacts'],
          ['Chen and Shu (2024) [@Chen]', 'Detectability of LLM-generated misinformation',
           'Style-based detectors miss fluent fabrications'],
          ['Hu et al. (2024) [@Hu]', 'LLM rationales guide a small classifier', 'Judges the article text alone'],
          ['Amri et al. (2023) [@ExFake]', 'Content, social context and external evidence (ExFake)',
           'Strongest signals arrive only after circulation'],
          ['Wang et al. (2024) [@Wang]', 'LLM weighs competing crowd reports', 'Needs many reports for each claim'],
          ['Schlichtkrull et al. (2023) [@AVeriTeC]', 'Real-world claims with web evidence (AVeriTeC)',
           'A benchmark, not a reader-facing system'],
          ['Minderer et al. (2021) [@Minderer]', 'Calibration of modern neural networks',
           'Calibration rarely reported for misinformation'],
          ['Lin et al. (2023) [@Lin]', 'Aggregated news domain quality ratings', 'Rates publishers, not individual stories']],
         [1.75, 2.3, 2.3], ['left', 'left', 'left'], 11))
    # =================================================================== CHAPTER 3
    add(('chapter', 3, 'REQUIREMENTS SPECIFICATION'))
    add(('section', '3.1', 'HARDWARE REQUIREMENTS'))
    add(('label_value', [
        ('Processor', 'Intel Core i7-14700HX or equivalent'),
        ('RAM', '16 GB'),
        ('Graphics', 'NVIDIA GeForce RTX 5050 Laptop GPU (8 GB) for the local model'),
        ('Storage', '10 GB free (the local model occupies 4.9 GB)'),
        ('Network', 'Broadband internet connection'),
    ]))
    add(('section', '3.2', 'SOFTWARE REQUIREMENTS'))
    add(('label_value', [
        ('Operating System', 'Windows 11'),
        ('Runtime', 'Node.js 24'),
        ('Frontend', 'React 19, React Router 7, Axios'),
        ('Backend', 'Express 5, Mongoose 8, JSON Web Token, bcrypt, Tesseract.js 7'),
        ('Database', 'MongoDB 8.3'),
        ('Language Models', 'Ollama 0.35 with llama3.1:8b; NVIDIA NIM; Google Gemini'),
        ('External Services', 'NewsAPI, Wikipedia, RDAP registries, YouTube'),
        ('Tools', 'Visual Studio Code, Git, Microsoft Edge'),
    ]))
    add(('section', '3.3', 'SOFTWARE DESCRIPTION'))
    add(('para', 'The application is built on the MERN stack. MongoDB stores users, reading history, activity and cached '
         'reports; Express on Node.js provides the REST API and hosts the analysis agents; and React provides a '
         'single-page interface. Node.js was chosen because the analysis is dominated by network calls (to the '
         'news index, the reference work and the language models), which its asynchronous model handles '
         'concurrently.'))
    add(('para', 'Ollama is a runtime for running open language models locally. It serves llama3.1:8b on the laptop GPU '
         'and handles nine of the ten model tasks. NVIDIA NIM and Google Gemini are hosted model services used for the '
         'one task the local model cannot perform reliably and as fallbacks when a provider fails. All three are '
         'reached through a single gateway that requests structured JSON output.'))
    add(('para', 'NewsAPI provides the news index used both for the front page and for finding independent coverage of a '
         'claim. The Wikipedia API supplies reference entries for named subjects. RDAP, the registries’ successor to '
         'WHOIS, supplies the registration date of a website’s domain. Tesseract.js performs optical character '
         'recognition on screenshots on the server, and YouTube transcripts are read for video input.'))

    # =================================================================== CHAPTER 4
    add(('chapter', 4, 'PROPOSED SYSTEM'))
    add(('section', '4.1', 'PROPOSED WORK'))
    add(('para', 'The proposed system judges a story by whether independent evidence supports it, rather than by how it '
         'is written. It accepts the four forms in which readers meet stories, reads each message for the claims it '
         'makes whatever its language or tone, declines input that makes no checkable claim, and gathers evidence '
         'through independent news coverage, published fact-check rulings, the current week of coverage about the '
         'claim’s subject, a reference work, the identity and record of the publisher, and four writing checks. The '
         'evidence is combined into a calibrated probability under a one-sided rule, and an ordered set of verdict '
         'rules states what has been established.'))
    add(('para', 'Figure 4.1 shows the proposed approach. Its stages are as follows:'))
    add(('bullets', [
        'Ingestion reduces each input to a title, the text, a source and a provenance record, reading the publisher’s '
        'page, the text inside a screenshot or the transcript of a video as required.',
        'The reading step works out the language and kind of each message and writes up to three claims in English; '
        'input that makes no checkable claim is refused with the reason.',
        'For article links and videos, claim extraction selects up to two checkable claims with search terms.',
        'The evidence channels run in parallel: news coverage, fact-check rulings, this week’s coverage of the '
        'subject, the reference check, publisher identity and the writing checks.',
        'The scoring model combines the evidence into a calibrated probability, and the verdict rules decide REAL, FAKE, '
        'PARTLY FALSE or CANNOT VERIFY, stating the rule that fired and the evidence it acted on.',
    ]))
    add(('figure', '4.1', os.path.join(FIG, 'fig_4_1_proposed_approach.png'), 5.0, 'Proposed Approach'))

    add(('section', '4.2', 'DATASET DESCRIPTION'))
    add(('para', 'The ISOT dataset, published by the ISOT research lab of the University of Victoria, contains 43,294 usable articles after length filtering, of which 21,915 are fake and '
         '21,379 are real. Because its real articles come from Reuters, the identity of the outlet alone predicts the '
         'label; source identity is therefore hidden from the pipeline during evaluation and agency prefixes such as '
         '“CITY (Reuters) –” are removed from the text. Historical articles have no live coverage, so the '
         'corroboration channel is not exercised on this corpus.'))
    add(('para', 'The likelihood ratios were estimated on 239 articles for which every check is recorded as having been '
         'produced by the language model rather than by the deterministic fallback. They were split by a hash of the '
         'article identifier into 119 training and 120 held-out test articles. Two further test sets were written for '
         'the proposed system: an adversarial set of ten items (five fabrications in plain newsroom style, one high-impact '
         'fabrication with manipulation signals, two genuine reports, a satirical piece and a commentary) and an '
         'end-to-end set of twelve cases covering every verdict and every input type.'))
    add(('para', 'Three further sets measure the Check Anything path on current news, each labelled by hand against '
         'published reporting from October 2026. A robustness suite of ' + str(RA['n']) + ' messages covers the ways '
         'people phrase claims: questions, hedges, forwards in capitals, sarcasm, negation, opinion wrapped round a '
         'fact, several claims at once, units and typos, Tamil, Tanglish and Hindi, old news, standing facts, quotes, '
         'local news, forecasts and vague text. A held-out set of ' + str(HF['n']) + ' cases on new topics and '
         'phrasings was written after development and run once before any change was made against it. A benchmark '
         'of ' + str(BENCH_N) + ' claims, spanning wrong figures, reversed outcomes, viral rumours, invented events, '
         'false premises and true reports, compares the system with a plain language model.'))
    add(('para', 'Because those sets were written by the authors, a fourth set takes its claims from other people. It '
         'holds ' + str(RUL_N) + ' claims on which professional fact-checking desks published rulings in the Google '
         'fact-check index between ' + _date(RUL_FROM) + ' and ' + _date(RUL_TO) + ', from ' + str(RUL_DESKS) +
         ' desks including FACTLY, NewsMobile, AFP Fact Check, The Quint, BOOM and Full Fact. Each claim is labelled '
         'with the desk’s published rating: ' + str(RUL_BY['rated false']) + ' were rated false, ' +
         str(RUL_BY['rated misleading']) + ' misleading and ' + str(RUL_BY['rated true']) + ' true. The set was split '
         'once, before any result was seen: rulings 1–120 are used for development, and rulings 121–320 are sealed, '
         'run whole, reported only as totals and never read or tuned on.'))

    add(('section', '4.3', 'SYSTEM ARCHITECTURE'))
    add(('para', 'The system is organised in layers, as shown in Figure 4.2. The React application provides the landing '
         'page, the front page with a trust stamp on every story, the article page, the Check Anything page for any '
         'input, the coverage comparison and the reader’s dashboard. The Express application layer handles '
         'accounts, the analysis API and the news, history and profile routes. Beneath it, the analysis agents carry '
         'out each step of Figure 4.1, and every language-model call passes through a single gateway.'))
    add(('para', 'Accounts use JSON Web Tokens and bcrypt-hashed passwords. The analysis endpoints require a signed-in '
         'reader because each analysis spends part of the daily allowance of the hosted language models; evaluation '
         'scripts present a private key instead. Links are fetched only after their address has been checked, so a '
         'link into the server’s own network is refused, and the browser origins allowed to call the API are '
         'restricted.'))
    add(('para', 'A full analysis takes several seconds, so its progress is streamed: each check is sent to the page as '
         'newline-delimited JSON the moment it finishes. Completed reports are cached by article address for fourteen '
         'days, but only when every check actually ran; a report reached while a service was unavailable, or a story '
         'too recent to check, is never cached, because it would otherwise be served long after it had stopped being '
         'true.'))

    add(('figure', '4.2', os.path.join(FIG, 'fig_4_2_architecture.png'), 5.3, 'System Architecture'))
    add(('section', '4.4', 'INPUT INGESTION AND ADMISSIBILITY'))
    add(('subsection', '4.4.1', 'Multimodal Input'))
    add(('para', 'Every input is reduced to the same object: a title, the text, a source and a record of its provenance. '
         'For an article link, the publisher’s page is fetched and the paragraphs inside its article container are '
         'read, because a news index supplies only about 200 characters of each story. For pasted text, the first '
         'line becomes the title. A screenshot is read with optical character recognition, with an additional '
         'language pack when the reader indicates the language. For a YouTube video, the claim is in the speech, so '
         'the transcript is read together with the title and channel. A publisher that forbids automated reading '
         'receives a clear refusal suggesting the reader paste the text or a screenshot instead.'))
    add(('subsection', '4.4.2', 'Reading the Message'))
    add(('para', 'A message is rarely a tidy claim. People paste a question (“is it true that RBI banned 500 rupee '
         'notes?”), pass something on (“I heard Modi resigned”), forward a warning in capitals and emoji, mock a claim '
         'sarcastically, wrap a fact in an opinion, or write in Tamil, in Hindi or in Tamil typed in English letters. '
         'Before any evidence is gathered, one call to a hosted language model at temperature zero reads the message '
         'and returns its language, whether it is typed in English letters, the kind of message it is, its tone, an '
         'English rendering and up to three claims. Each claim is written as a neutral English sentence with its time '
         'frame (now, past, standing or future), its kind (event, figure, quote or standing fact), a headline, its '
         'subjects and its search terms.'))
    add(('para', 'The claims are what the evidence channels check, while the writing checks still read the message as '
         'written, because tone is evidence there. A question is checked as the claim it asks about and answered '
         'directly; a hedge is checked as the claim passed on; sarcasm is checked as the claim being mocked; negation '
         'is kept exactly as stated. A schedule stated as settled, such as “no electricity in Madurai from tomorrow”, is '
         'read as a claim that it was announced, while a forecast of an undecided outcome, such as “RBI will cut rates '
         'in December”, is a prediction. A fact that an opinion merely takes for granted is not listed, so “Vijay is '
         'the best Chief Minister Tamil Nadu has ever had” is not checked as the claim that Vijay is Chief Minister.'))
    add(('subsection', '4.4.3', 'Admissibility'))
    add(('para', 'Input that asserts nothing checkable receives no verdict: a pure opinion, a forecast, a call to act '
         '(“wake up, share this before it is deleted”) or text that names no person, place, event or figure. The '
         'reader is told why and what would make it checkable. A claim the model calls checkable must still name '
         'something, which a deterministic check confirms. If the reading step cannot run, an earlier rule-based gate '
         'decides instead, requiring an anchor such as a name, place, number or date, so the page loses precision '
         'rather than failing. A verdict on input of this kind would be meaningless, and a system that answers '
         'questions it cannot answer teaches readers to distrust the answers it gets right.'))

    add(('section', '4.5', 'EVIDENCE CHANNELS'))
    add(('subsection', '4.5.1', 'Claim Extraction and Corroboration'))
    add(('para', 'For a message, the claims come from the reading step; for an article or a video transcript, the '
         'language model extracts up to two checkable claims, each with three or four distinctive search terms, and '
         'English terms are added for a story in another language so that a Tamil report can be matched with English '
         'coverage of the same event. Each claim is searched live in Google News, as a sentence, as a headline and by '
         'its key terms, with the story’s own outlet excluded and NewsAPI as a fallback. When a claim states a figure, '
         'the competing figures that headlines report are searched as well, so that a wrong figure meets the right '
         'one. The corroboration channel is shown in Figure 4.3.'))
    add(('figure', '4.3', os.path.join(FIG, 'fig_4_3_corroboration.png'), 6.0, 'Corroboration Channel'))
    add(('para', 'Retrieved coverage must pass a relevance gate before it can count: it must share a name, place or '
         'figure with the claim. A claim that names nothing cannot be corroborated by anything, because topic overlap '
         'is not event identity: an invented “secret chemical leak in three districts” otherwise matched a real '
         'chemical leak elsewhere. A name written in full also matches its initials, so “Reserve Bank of India” matches '
         '“RBI”. The model then judges each remaining headline in turn: whether it concerns the same event, whether '
         'both could be true at once, whether it agrees or disagrees, and the exact words that state the reported '
         'fact, which must be found in the headline before the judgement counts. Figures are compared after converting '
         'units, so ₹5 crore equals ₹50 million, and a bound such as “crossed 80 medals” agrees with a report of 85.'))
    add(('para', 'Two failure cases are handled explicitly. A search that could not run is reported as “could not '
         'verify”, never as “no other outlet reports this”, because an outage is not a finding. And because even a '
         'live index needs time to carry a story, a story published in the last three hours that finds no coverage '
         'is reported as too recent to check, and the empty search adds nothing to its probability. A claim '
         'presented as happening now can be contradicted only by reports from the last three weeks, so an old report '
         'of a different occurrence cannot count against it.'))
    add(('subsection', '4.5.2', 'Source Independence'))
    add(('para', 'Five newspapers carrying one wire story are one source, not five. Before supporting coverage is counted, '
         'outlets with a common owner are grouped, copies of the same agency story are recognised from the agency '
         'credit in the headline or standfirst, near-duplicate articles are collapsed, and state-controlled media from '
         'one state are merged. Every merge is reported to the reader, so the count of independent sources can be '
         'checked against the articles retrieved.'))
    add(('subsection', '4.5.3', 'Premise Verification'))
    add(('para', 'A story built on a false premise, such as a real person placed in an office they have never held, '
         'describes an event nobody reports, so the news search correctly finds nothing and the real problem would be '
         'missed. Up to two named subjects are therefore looked up in Wikipedia, and the model is asked whether the '
         'entry contradicts what the story states about them. A contradiction is admitted only when the entry is '
         'about the same subject, when the two statements cannot both be true, when the story makes the statement in '
         'its own voice rather than quoting someone, and when the conflicting sentence is found word for word in the '
         'entry. The same lookup can also confirm a standing or past fact, such as the capital of a state, when the '
         'entry states it in a sentence that is quoted and found word for word; it never confirms today’s events, '
         'which a reference work cannot yet record.'))
    add(('subsection', '4.5.4', 'Fact-Checker Rulings'))
    add(('para', 'Viral rumours are rarely reported as news, so a news search alone can only fail to find them. '
         'Professional fact-checking desks exist to investigate exactly these, and many, including AFP, PTI, India '
         'Today, The Quint, BOOM and Factly, publish each ruling with ClaimReview markup that Google indexes. The claim '
         'is searched in that index under several short phrasings, because the index matches every word and a full '
         'sentence usually returns nothing, and Google News is searched for fact-check headlines from desks that '
         'publish without the markup.'))
    add(('para', 'A ruling on a similar but different claim must not count: a search for “Modi visited Tamil Nadu” returns '
         'a debunked placard about an earlier visit. The language model is therefore shown every candidate ruling and '
         'asked, for each, whether it examined the same assertion and what its finding makes of the reader’s text. '
         'The finding is translated rather than copied: a ruling that rated “the video is genuine” false makes “the '
         'video is fake” true. A matched ruling of false decides the verdict, and each desk is shown with its rating, '
         'its date and a link to the ruling. One desk’s versions in several languages count as one ruling.'))
    add(('subsection', '4.5.5', 'Current Coverage of the Subject'))
    add(('para', 'An invented event about a heavily covered subject leaves a trace: the rest of the week’s coverage '
         'carries on as though it never happened. On the day a message claimed the Prime Minister had resigned, outlets '
         'reported him launching projects worth ₹13,000 crore in Chennai; in the year a message claimed income tax was '
         'abolished, the Income Tax Department launched a new filing website. The last seven days of Google News '
         'coverage of each subject of the claim are read, and the model marks the headlines that could not be true if '
         'the claim were, quoting the words that show it. A claim about two parties, such as one company buying '
         'another, is checked against the coverage of both.'))
    add(('para', 'Two independent outlets of this kind make the claim probably false. A weaker form applies only to an '
         'event that would have dominated a subject covered every day, claimed within the week, and absent from at '
         'least twelve headlines from five outlets. Both are used only when the news search found the event neither '
         'reported nor contradicted, since evidence about the event itself is better than evidence about its '
         'surroundings.'))
    add(('subsection', '4.5.6', 'Publisher Identity and Reputation'))
    add(('para', 'A page chooses its own site name, so the publisher is identified from its web address, never from the '
         'name it gives itself. A rating is granted only when the page is served from one of the outlet’s own '
         'domains, or from a platform channel listed as the outlet’s own. Ratings come first from a curated list of '
         '90 outlets, which records their factual-reporting rating, editorial lean and type (agency, broadcaster, '
         'state media, satire), and otherwise from the published ratings of Lin et al. [@Lin] for 11,520 news domains.'))
    add(('para', 'A page that claims a distinctive outlet’s name from an address that outlet does not use, for '
         'example a site at a lookalike address calling itself “BBC News”, receives no rating and is marked '
         'as impersonating the outlet, which counts against the story. For sites with no rating, the domain’s '
         'registration date is read through RDAP; a domain registered less than 90 days earlier is a warning sign. An '
         'old domain earns nothing, because one can be bought.'))
    add(('subsection', '4.5.7', 'Writing Checks'))
    add(('para', 'Four checks examine how the story is written. The headline check returns the clickbait signals present, '
         'such as a curiosity gap or unsupported superlatives. The language check quotes sentences that show bias, '
         'one-sided reporting or opinion presented as fact. The persuasion check names techniques from the SemEval '
         'taxonomy [@DaSan] and quotes the span that exhibits each. The transparency check scores a journalism checklist '
         '(named sources, attributed quotes, primary evidence, concrete detail and measured claims) and quotes '
         'unattributable appeals such as “experts say”. If no language model is reachable, each check falls back '
         'to a deterministic analyser, and the report marks the check as degraded.'))

    add(('section', '4.6', 'SCORING MODEL'))
    add(('subsection', '4.6.1', 'Weight of Evidence'))
    add(('para', 'Each observation o contributes a likelihood ratio, the probability of the observation in fabricated '
         'stories divided by its probability in genuine ones. The ratios are estimated from labelled articles by '
         'binning each check’s score, using a Jeffreys prior and shrinking each estimate to the conservative end '
         'of its 95% interval, so that a bin supported by few articles contributes nothing. Each ratio is expressed in '
         'decibans, W = 10 log₁₀ Λ, and the evidence is summed in log-odds:'))
    add(('equation', 'logit P(fabricated | O)  =  logit π  +  Σ W(o)'))
    add(('para', 'where π is a prior set by the publisher’s band, as listed in Table 4.1. The priors and the '
         'likelihood ratios for corroboration are declared rather than measured, and every report labels them so.'))
    add(('table', '4.1', 'Prior Probability of Fabrication by Publisher Band',
         ['Publisher band', 'Prior', 'Basis'],
         [['Strong factual record (rated 8.5 or above)', '0.02', 'Declared'],
          ['Ordinary record (6.5 to 8.4)', '0.06', 'Declared'],
          ['Unrated outlet', '0.15', 'Declared'],
          ['Poor record, or impersonating a known outlet', '0.25', 'Declared'],
          ['Social media account', '0.35', 'Declared']],
         [3.6, 0.9, 1.2], ['left', 'center', 'center']))
    add(('subsection', '4.6.2', 'One-sided Admissibility Rule'))
    add(('para', 'The writing checks are chosen by the author. A capable fabricator drives the favourable value of each '
         'check (a calm headline, measured language, named sources) towards its value in genuine reporting, so the '
         'favourable ratio tends to one whatever a training corpus reports. A corpus of crude fabrications will '
         'measure fluent writing as evidence of a genuine article and be wrong about any competent adversary. The '
         'rule therefore admits author-controlled evidence only in the incriminating direction: W† = max(0, W). An '
         'uninformative or unmeasured observation contributes exactly zero, and presentation cannot establish '
         'credibility at any value.'))
    add(('subsection', '4.6.3', 'Correlation Damping and Calibration'))
    add(('para', 'The four writing checks measure overlapping properties of the same prose. Measured on the clean corpus, '
         'they correlate at a mean of r = 0.55, which corresponds to 1.52 effective independent checks out of four; the '
         'strongest pair, headline and language, correlate at r = 0.93. Their summed weight is therefore scaled by '
         '0.379 and capped. The raw sum ranks stories well but states poor probabilities, so an isotonic map [@SilvaFilho] '
         'fitted on training data converts it into a calibrated probability. The one-sided rule is applied again '
         'after calibration, because a map fitted where fluent prose does predict a genuine article would otherwise '
         'restore exactly the favourable weight the rule removes. The complete scoring pipeline is shown in '
         'Figure 4.4.'))
    add(('figure', '4.4', os.path.join(FIG, 'fig_4_4_scoring.png'), 6.0, 'Scoring Model'))
    add(('subsection', '4.6.4', 'Verdict Rules'))
    add(('para', 'Separately from the probability, an ordered rule set assigns the verdict, and the first rule that '
         'matches decides it, as shown in Figure 4.5. The probability expresses graded belief; the verdict states what '
         'has been established. The two differ exactly where it matters: an uncorroborated story may carry a low '
         'probability of fabrication merely because most stories are genuine, while nothing about it has been '
         'established. Each verdict class also caps the score shown to the reader, so that an uncorroborated story can '
         'never be described as trustworthy, as listed in Table 4.2.'))
    add(('para', 'Three rules concern messages with several claims or a time frame. When one claim is confirmed and '
         'another contradicted, the message is partly false. When a claim presented as happening now is confirmed only '
         'by coverage weeks old, it is old news shared as new and is reported as fake, with the date of the latest '
         'report. When a confirmed claim carries one that nothing reports, the coverage of the unreported claim’s '
         'subject is read separately: the message is partly false if that coverage rules the claim out, and only '
         'partly confirmed otherwise, but never real, since a true claim would otherwise lend its credit to an '
         'invented one.'))
    add(('figure', '4.5', os.path.join(FIG, 'fig_4_5_verdict_rules.png'), 6.0, 'Verdict Rules in Order of Precedence'))
    add(('table', '4.2', 'Verdict Classes and Score Ceilings',
         ['Verdict class', 'Shown as', 'Score ceiling (of 10)'],
         [['Corroborated', 'REAL', '10.0'], ['Likely true', 'REAL', '8.0'], ['Opinion', 'NOT A FACTUAL CLAIM', '6.4'],
          ['Unverified', 'CANNOT VERIFY', '4.9'], ['Satire', 'SATIRE', '4.0'], ['Partly true, partly false', 'PARTLY FALSE', '3.5'],
          ['Likely false', 'FAKE', '3.5'], ['Old news shared as new', 'FAKE', '3.0'], ['False', 'FAKE', '2.0']],
         [2.2, 2.3, 1.7], ['left', 'center', 'center']))
    add(('algorithm', 'Evidence-based verdict', [
        'Input: an article link, pasted text, screenshot or video link',
        'Output: verdict, rule that fired, grounds, probability of fabrication',
    ], [
        'Normalise the input to title, text, source and provenance',
        'Read the message: language, kind of message, tone, and up to three claims in English',
        'If no claim is checkable, return a refusal stating why',
        'For an article or video, extract up to two claims with search terms',
        'In parallel:',
        '-   search independent coverage; keep items sharing an anchor; merge dependent sources; judge stance',
        '-   search published fact-check rulings; keep only rulings on the same assertion',
        '-   read the week’s coverage of each subject; mark headlines that rule the claim out',
        '-   look up named subjects in the reference work; admit only quoted contradictions or confirmations',
        '-   identify the publisher from its address; read its rating, impersonation and domain age',
        '-   run the four writing checks',
        'Set the prior from the publisher band',
        'Convert each writing check to decibans; apply max(0, W), correlation damping and the cap',
        'Calibrate, re-apply the one-sided rule and add the corroboration, ruling and coverage weights',
        'If a confirmed claim carries an unreported one, read the unreported claim’s coverage separately',
        'Apply the verdict rules in order and return the first that matches, with its grounds',
    ]))

    add(('section', '4.7', 'LANGUAGE MODEL GATEWAY AND ROUTING'))
    add(('para', 'Every model call passes through one gateway that owns concurrency, retries and structured output. It '
         'requests JSON from all three providers, checks that the keys the caller needs are present, and retries once '
         'with a corrective instruction if they are not. It distinguishes a withdrawn model, which is replaced '
         'permanently, from congestion, which is retried with exponential back-off, and from an exhausted provider, '
         'which hands over to the next provider in the chain.'))
    add(('para', 'Which provider handles which task was decided by measurement. Each task was run three times on each '
         'provider with fixed inputs, and a task is routed to the local model only if at least 80% of its replies are '
         'valid, at least 80% are correct where a known answer exists, and its scores differ from the hosted reference '
         'by no more than 2.0. The local model met these conditions for eight tasks. It failed the premise check, '
         'reporting no conflict in all three runs on a story that calls an opposition leader “Prime Minister”, so '
         'that task was moved off it and is now led by Google Gemini, with NVIDIA NIM next, as shown in Figure 4.6.'))
    add(('para', 'Six judgements were later routed to Google Gemini by hand, each after a live failure that the '
         'fixed-input benchmark could not see: the local model read “TVK sweeps both seats” as agreeing with “TVK '
         'lost”, and translated the Tamil தவெக (TVK) as DMK. These are the stance judgement, reading the message, '
         'matching fact-check rulings, reading the week’s coverage, extracting claims from non-English text and '
         'translating the verdict. Matching a new claim against earlier checks, added later with the claim memory, is '
         'routed the same way. The deployed server, a free instance with 512 MB of memory and no GPU, cannot run the '
         'local model, so there the eight measured tasks start at NIM. The free tier gives each Gemini model its own daily quota, 500 requests for '
         'gemini-3.1-flash-lite, so the gateway tries six models in turn and skips one whose daily quota is spent until '
         'the quota resets, instead of retrying it, which had once taken a single check to 170 seconds. Keys from '
         'further projects add their own quotas, and judgements made at temperature zero are remembered for thirty '
         'minutes, so a repeated check makes no model call.'))
    add(('figure', '4.6', os.path.join(FIG, 'fig_4_6_routing.png'), 6.0, 'Task Routing Between Local and Hosted Models'))

    # =================================================================== CHAPTER 5
    add(('chapter', 5, 'RESULTS AND DISCUSSION'))
    add(('section', '5.1', 'PARAMETERS FOR EVALUATION'))
    add(('para', 'The system is evaluated on its accuracy, precision, recall, F1-score and ROC-AUC, and on the calibration '
         'of its probabilities, measured by the expected calibration error and the Brier score. A fabricated story is '
         'treated as the positive class, so an accusation is a positive prediction. Because a false accusation does '
         'more harm than a missed one, calibration and precision are also reported for accusations alone.'))
    for label, text in [
        ('True Positive (TP):', 'A situation where the system predicts a story as fabricated, and it is actually fabricated.'),
        ('True Negative (TN):', 'A situation where the system predicts a story as genuine, and it is actually genuine.'),
        ('False Positive (FP):', 'When the system predicts a story as fabricated, but it is actually genuine.'),
        ('False Negative (FN):', 'When the system predicts a story as genuine, but it is actually fabricated.'),
    ]:
        add(('definition', label, text))
    add(('subsection', '5.1.1', 'Accuracy'))
    add(('para', 'Accuracy is the proportion of all predictions that are correct.'))
    add(('equation', 'Accuracy  =  (TP + TN) / (TP + TN + FP + FN)'))
    add(('subsection', '5.1.2', 'Precision'))
    add(('para', 'Precision is the proportion of accusations that are correct, which is the measure of how far an '
         'accusation from the system can be trusted.'))
    add(('equation', 'Precision  =  TP / (TP + FP)'))
    add(('subsection', '5.1.3', 'Recall'))
    add(('para', 'Recall is the proportion of fabricated stories that the system identifies.'))
    add(('equation', 'Recall  =  TP / (TP + FN)'))
    add(('subsection', '5.1.4', 'F1-Score'))
    add(('para', 'The F1-score is the harmonic mean of precision and recall; macro-F1 averages it over both classes.'))
    add(('equation', 'F1  =  2 × Precision × Recall / (Precision + Recall)'))
    add(('subsection', '5.1.5', 'ROC-AUC'))
    add(('para', 'The area under the receiver operating characteristic curve is the probability that a randomly chosen '
         'fabricated story is given a higher probability than a randomly chosen genuine one. It measures ranking and '
         'is independent of any threshold.'))
    add(('subsection', '5.1.6', 'Expected Calibration Error and Brier Score'))
    add(('para', 'The expected calibration error groups predictions into bands of stated probability and averages the gap '
         'between the stated probability and the observed rate of fabrication in each band, weighted by the number of '
         'stories in the band. Calibration error where accusing is the same measure computed only over predictions '
         'above one half. The Brier score is the mean squared difference between the stated probability and the '
         'outcome; lower is better for both.'))
    add(('equation', 'ECE  =  Σₖ (nₖ / n) × | statedₖ − observedₖ |'))

    add(('section', '5.2', 'RESULTS AND DISCUSSION'))
    add(('subsection', '5.2.1', 'Held-out Evaluation on ISOT'))
    add(('para', 'Table 5.1 compares the proposed scoring model, as deployed, with the conventional hand-weighted sum it '
         'replaces, on the same 120 held-out articles. The two classify almost identically: the proposed model is '
         'correct on 114 articles and the baseline on 115. The baseline ranks better, with an ROC-AUC of 0.978 against '
         '0.951. The difference that matters is calibration where the system accuses, which falls from 0.267 to 0.152, '
         'a reduction of 43%, while precision when accusing is essentially unchanged at 0.967.'))
    add(('table', '5.1', 'Held-out Evaluation on 120 ISOT Articles',
         ['Model', 'Accuracy', 'Macro-F1', 'ROC-AUC', 'ECE', 'ECE (accusing)', 'Brier'],
         [['Hand-weighted baseline', '0.958', '0.958', '0.978', '0.237', '0.267', '0.101'],
          ['Proposed (as deployed)', '0.950', '0.950', '0.951', '0.246', '0.152', '0.117']],
         [1.85, 0.75, 0.8, 0.75, 0.6, 0.85, 0.6], ['left'] + ['center'] * 6))
    add(('para', 'Figure 5.1 shows the confusion matrices. Both models make two false accusations among 57 genuine '
         'articles; the proposed model misses one more fabricated article, giving a recall of 0.937 against 0.952.'))
    add(('figure', '5.1', os.path.join(FIG, 'fig_5_1_confusion.png'), 5.4, 'Confusion Matrices on the Held-out Set'))
    add(('para', 'Figure 5.2 compares the two models on every metric. Overall calibration does not improve (ECE 0.246 '
         'against 0.237), and Figure 5.3 shows why. On ISOT the only evidence that could exonerate an article is its '
         'style, which the one-sided rule refuses to admit, so the 59 articles the proposed model does not accuse are '
         'all stated at the prior of 0.41, while only 7% of them are fabricated. Exoneration is left to corroboration '
         'and the publisher’s record, neither of which this corpus can exercise. Where the model does accuse, it '
         'states 0.82 and is right 97% of the time.'))
    add(('figure', '5.2', os.path.join(FIG, 'fig_5_2_metrics.png'), 6.0, 'Comparison of Evaluation Metrics'))
    add(('figure', '5.3', os.path.join(FIG, 'fig_5_3_reliability.png'), 4.3, 'Reliability Diagram'))

    add(('subsection', '5.2.2', 'Cost of the One-sided Rule'))
    add(('para', 'Table 5.2 measures what the one-sided rule costs by disabling it in the deployed scoring path. Without '
         'the rule, ROC-AUC rises from 0.951 to 0.983 and accuracy by one article, but calibration error where '
         'accusing rises from 0.152 to 0.191. The discrimination gained comes from learning that fluent writing '
         'indicates a genuine article, which holds on a corpus of crude fabrications and fails against a careful one, '
         'so the rule is retained.'))
    add(('table', '5.2', 'Effect of the One-sided Rule (Deployed Scoring Path)',
         ['Configuration', 'Accuracy', 'ROC-AUC', 'ECE (accusing)'],
         [['With the one-sided rule', '0.950', '0.951', '0.152'], ['Without the one-sided rule', '0.958', '0.983', '0.191']],
         [2.6, 1.1, 1.1, 1.3], ['left', 'center', 'center', 'center']))

    add(('subsection', '5.2.3', 'Adversarial Benchmark'))
    add(('para', 'ISOT cannot test the failure the proposed system is designed to resist, because its fabrications are crude. The '
         'adversarial set supplies the missing case: fabrications written in plain newsroom style with named sources '
         'and no clickbait. Each item is scored twice from identical check outputs, once under the baseline rule and '
         'once under the proposed one. This run uses the deterministic checks offline, so no corroboration is '
         'available to either rule. As Table 5.3 and Figure 5.4 show, the baseline presents four of the six deceptive '
         'items as credible and the proposed system none; it matches the expected verdict on all six and condemns '
         'neither genuine report.'))
    add(('table', '5.3', 'Adversarial Benchmark',
         ['Measure', 'Baseline', 'Proposed'],
         [['Deceptive items presented as credible', '4 of 6', '0 of 6'], ['Verdict matched expectation', '–', '6 of 6'],
          ['Genuine reports wrongly condemned', '–', '0 of 2'], ['Mean baseline score of the fabrications', '7.3 of 10', '–']],
         [3.4, 1.3, 1.3], ['left', 'center', 'center']))
    add(('figure', '5.4', os.path.join(FIG, 'fig_5_4_adversarial.png'), 5.2, 'Scores of the Adversarial Items'))
    add(('para', 'The fabrications still read well under the baseline, and always will; what has changed is that reading '
         'well no longer determines the answer. The set is small and was written by the authors, so it demonstrates '
         'that the rule works as designed rather than estimating a rate in the wild.'))

    add(('subsection', '5.2.4', 'Premise Check Reliability'))
    add(('para', 'The premise check was measured by repeating it on two inputs before and after two corrections. The hosted '
         'model writes about 2,000 characters of reasoning before its answer, and with a 450-token budget most replies '
         'were cut off before the answer began; and the check once set a woman’s remark in a French interview, that '
         'the Pope’s ancestors came from the region, against his birthplace in Chicago. With a larger budget and the '
         'requirement that the two statements cannot both be true and are made in the story’s own voice, the false '
         'premise is caught in six runs of six and the genuine video is contradicted in none, as shown in Figure 5.5.'))
    add(('figure', '5.5', os.path.join(FIG, 'fig_5_6_premise.png'), 4.8, 'Premise Check Before and After the Corrections'))

    add(('subsection', '5.2.5', 'Publisher Identity'))
    add(('para', 'Identifying the publisher from its web address was tested with lookalike sites. Before the change, '
         'every copycat in Table 5.4 inherited the real outlet’s rating. A fabricated income-tax story on a copycat '
         'site calling itself “BBC News” was then described as an exclusive from an outlet with a strong record, '
         'with a 2% probability of fabrication; after the change it starts from the poor-record prior, has a 33% '
         'probability, and the reader is told the page is posing as the BBC. The genuine BBC article in the test set '
         'is still confirmed.'))
    add(('table', '5.4', 'Lookalike Publishers Before and After Address-Based Identity',
         ['Address', 'Before', 'After'],
         [['bbc-breaking-news.xyz, calling itself “BBC News”', 'BBC News, 9/10', 'No rating; impersonation flagged'],
          ['bbc-world.com', 'BBC News, 9/10', 'No rating'],
          ['bbc.news-today.com', 'BBC News, 9/10', 'No rating'],
          ['reuters-updates.info, calling itself “Reuters”', 'Reuters, 9.5/10', 'No rating; impersonation flagged'],
          ['YouTube channel named “Associated Press”, not AP’s', 'AP, 9.5/10', 'No rating']],
         [2.85, 1.25, 1.95], ['left', 'center', 'center'], 11))
    add(('para', 'The published ratings of Lin et al. [@Lin] extend coverage from 90 outlets to 11,520 domains. Over the 81 '
         'outlets rated by both, the two sets agree closely, with a Pearson correlation of 0.848 and a Spearman '
         'correlation of 0.765, and a least-squares fit over that overlap (0.38 + 8.95 × rating) converts the '
         'published 0–1 scale to the 0–10 scale used here. The nine curated outlets missing from the published set '
         'are all Indian, which is why the curated list is consulted first.'))

    add(('subsection', '5.2.6', 'Model Routing and Response Time'))
    add(('para', 'Table 5.5 lists the measurements behind the routing decision of Section 4.7, and Figure 5.6 compares '
         'the median time per call. The local model replied validly in every run of every task and was 1.7 to 15.5 '
         'times faster than the faster of the two hosted services. On claim extraction the hosted services were the '
         'unreliable ones, with 67% and 33% of replies valid.'))
    add(('table', '5.5', 'Provider Measurements per Task (Three Runs Each)',
         ['Task', 'Local model', 'NVIDIA NIM', 'Google Gemini', 'Routed to'],
         [['Search keywords', '100%, 0.3 s', '100%, 5.4 s', '100%, 3.4 s', 'Local'],
          ['Summary', '100%, 0.7 s', '100%, 4.2 s', '100%, 3.3 s', 'Local'],
          ['Detailed summary', '100%, 0.9 s', '67%, 9.0 s', '100%, 5.3 s', 'Local'],
          ['Stance judgement', '100%, 1.0 s', '100%, 3.3 s', '100%, 1.7 s', 'Local'],
          ['Claim extraction', '100%, 1.6 s', '67%, 39.2 s', '33%, 25.1 s', 'Local'],
          ['Clickbait', '100%, 1.8 s', '100%, 8.0 s', '100%, 3.1 s', 'Local'],
          ['Transparency', '100%, 1.9 s', '100%, 7.7 s', '100%, 9.2 s', 'Local'],
          ['Persuasion', '100%, 3.5 s', '100%, 11.3 s', '100%, 39.5 s', 'Local'],
          ['Bias', '100%, 4.4 s', '67%, 8.0 s', '100%, 10.4 s', 'Local'],
          ['Premise check', '0% correct, 2.4 s', '100% correct, 10.9 s', '100% correct, 10.8 s', 'NVIDIA NIM']],
         [1.45, 1.3, 1.35, 1.35, 0.95], ['left', 'center', 'center', 'center', 'center'], 10))
    add(('figure', '5.6', os.path.join(FIG, 'fig_5_5_latency.png'), 6.0, 'Median Time per Call by Provider'))
    add(('para', 'For the reader, the first check appears 1.47 seconds after an article is opened, because progress is '
         'streamed; a report already in the cache is returned in 2.7 to 3.4 milliseconds. With no model and no news '
         'index reachable at all, the deterministic fallbacks still separate a fabricated story with loaded language '
         '(3.5 of 10) from ordinary attributed reporting (8.5 of 10), and mark every check as degraded.'))

    add(('subsection', '5.2.7', 'End-to-End Verification Across Input Types'))
    add(('para', 'Table 5.6 lists twelve cases run through the deployed application on 4 October 2026, covering every '
         'verdict and every input type. The genuine reports were confirmed by independent outlets whether they '
         'arrived as pasted text, a news link, a screenshot or Tamil text; the story calling Rahul Gandhi “Prime '
         'Minister” was found false through its premise, both as text and as a screenshot; the two invented stories '
         'could not be verified; and the three inputs with nothing to check were refused with a reason.'))
    add(('para', 'Eleven of the twelve cases returned the expected verdict outright. The Associated Press video of the '
         'Pope’s Mass at Lourdes, a genuine report, was returned as CANNOT VERIFY: its transcript is largely an '
         'interview in French, and no independent coverage matching its claims was retrieved on that run. That is '
         'an acceptable outcome for a genuine story, since it was not called false, and in an earlier run it was '
         'confirmed by one independent outlet.'))
    add(('para', 'The run also tested the system’s behaviour under failure. Midway through the first attempt, the '
         'machine lost its internet connection and every news and reference lookup failed. The affected cases were '
         'all reported as CANNOT VERIFY under the rule “verification unavailable”; none was reported as '
         'unsupported or false, and they were re-run once the connection returned. Analysis time ranged from 22 to '
         '112 seconds; refusals were immediate.'))
    add(('table', '5.6', 'End-to-End Test Cases (4 October 2026)',
         ['No.', 'Input', 'Expected', 'Result', 'Rule that decided it', 'Time'],
         e2e_rows(),
         [0.4, 1.2, 1.05, 1.05, 2.15, 0.5], ['center', 'left', 'center', 'center', 'left', 'center'], 10))

    add(('subsection', '5.2.8', 'Robustness Across Ways of Writing a Claim'))
    add(('para', 'The robustness suite measures what readers actually send. Table 5.7 groups its ' + str(RA['n']) + ' '
         'cases and gives the number of expected answers, misses and wrong verdicts before and after the reading step was '
         'added; Figure 5.7 shows the four outcomes. An answer counts as expected when it matches the label; a listed '
         'abstention, such as refusing a forecast, is acceptable; an abstention where a verdict was due is a miss; and '
         'a verdict the wrong way is wrong. Before the reading step, ' + str(RB['right']) + ' answers were as expected, ' + str(RB['missed']) + ' were missed '
         'and ' + str(RB['wrong']) + ' were wrong. Every failure traced to a single cause: only pattern rules read the '
         'message before the evidence channels did, so questions were refused, Tamil and Hindi were refused as '
         'naming no one because the rules look for capital letters, an opinion was checked as a fact, and old news '
         'was confirmed by its own old coverage. After it, ' + str(RA['right']) + ' answers were as expected, ' +
         str(RA['safe']) + ' acceptable, ' + str(RA['missed']) + ' missed and ' + str(RA['wrong']) + ' wrong.'))
    add(('table', '5.7', 'Robustness Suite Before and After the Reading Step',
         ['Kind of message', 'Cases', 'Before: expected', 'Before: missed', 'Before: wrong', 'After: expected',
          'After: missed', 'After: wrong'],
         robustness_rows(),
         [1.86, 0.52, 0.62, 0.6, 0.6, 0.62, 0.6, 0.6], ['left'] + ['center'] * 7, 9))
    add(('para', 'Because the suite was used during development, its result overstates performance on unseen input. '
         'The held-out set answers that: written afterwards and run once before any change, it returned the expected '
         'answer for ' + str(HF['right']) + ' of its ' + str(HF['n']) + ' cases' +
         (', with ' + str(HF['wrong']) + ' wrong verdict' + ('' if HF['wrong'] == 1 else 's') if HF['wrong'] else '') +
         '. The most serious miss was a true claim carrying an invented one, “PM Modi launched ₹13,000 crore projects '
         'in Chennai and also announced free petrol for all college students”, which was returned as real on the '
         'strength of its first half; the rule for a confirmed claim carrying an unreported one was added in response.' +
         ((' After that and two further corrections, the held-out set returned the expected answer for ' + str(HA['right']) +
           ' of ' + str(HA['n']) + ', with ' + str(HA['wrong']) + ' wrong.') if HA else '')))
    add(('figure', '5.7', os.path.join(FIG, 'fig_5_7_robustness.png'), 6.0, 'Outcomes on the Robustness and Held-out Sets'))

    add(('subsection', '5.2.9', 'Comparison with a Plain Language Model'))
    add(('para', 'A reviewer may reasonably ask whether a chatbot could do the same. The benchmark puts each of its ' +
         str(BENCH_N) + ' claims to the same hosted model the system uses, gemini-3.1-flash-lite, asked zero-shot with '
         'the current date and nothing to read, and to the full system. Most of the claims concern October 2026, after '
         'any model’s training data ends, which is the normal case, since what people forward is the current week’s '
         'news. Table 5.8 and Figure 5.8 give the results by kind of claim.'))
    add(('table', '5.8', 'Plain Language Model and Proposed System on Current Claims',
         ['Kind of claim', 'Claims', 'Plain model correct', 'Proposed system correct'],
         plain_rows(),
         [2.4, 0.8, 1.5, 1.6], ['left', 'center', 'center', 'center'], 10))
    add(('para', 'The plain model answered ' + str(BENCH_PLAIN) + ' of ' + str(BENCH_N) + ' correctly, the system ' +
         str(BENCH_OURS) + '. The plain model’s correct answers are less than they appear: it called ' +
         str(BENCH_PLAIN_TRUE_FAKE) + ' of the ' + str(BENCH_TRUE_N) + ' true reports fake, including the Reserve Bank’s '
         'rate rise and India’s 85-medal total at the Asian Games, so its “fake” on a false claim is a habit rather than '
         'a finding, and it cites nothing a reader could check. The system’s answers each rest on evidence shown with '
         'links' + ((', at a median of ' + str(BENCH_MEDIAN) + ' seconds a claim') if BENCH_MEDIAN else '') + '.'))
    add(('figure', '5.8', os.path.join(FIG, 'fig_5_8_plain_model.png'), 6.0, 'Correct Answers by Kind of Claim'))

    add(('subsection', '5.2.10', 'Application Interface'))
    add(('para', 'Figures 5.9 to 5.21 show the application as used in testing. The landing page in Figure 5.9 leads to '
         'sign-up and login. The front page in Figure 5.10 shows current headlines by section, each with a trust stamp '
         'drawn from the cache or the publisher’s rating.'))
    add(('para', 'The Check Anything page in Figure 5.11 accepts pasted text, a link or a screenshot, and explains '
         'beforehand the answers it can return and what it will refuse. While a check runs, each evidence channel is '
         'ticked off with its one-line finding as it lands, as in Figure 5.12. The result opens with the verdict, the '
         'rule that decided it and its confidence, then sets out the evidence one panel per channel. In Figure 5.13, '
         'the message that failed in the earlier review, “India’s 84-Medal Campaign at Asian Games 2026”, is shown '
         'against the outlets reporting 85 medals, with the conflicting words highlighted in each headline. Figure '
         '5.14 shows a viral rumour decided by fact-checkers’ rulings, each with its desk, rating, date and link.'))
    add(('para', 'Figure 5.15 shows a question asked in Tamil: the page states how it read the message, the claim it '
         'checked in English, a direct answer, and the verdict line in Tamil. Figure 5.16 shows a message with one '
         'true and one false claim returned as partly false, and Figure 5.17 the panel that asks a plain language '
         'model the same question, here calling a true rate rise fake. Figure 5.18 shows a refusal with its reason.'))
    add(('para', 'Opening a story from the front page leads to the article page in Figure 5.19, where the verdict is '
         'shown above the story and the summary below it. The comparison in Figure 5.20 sets the coverage of one story '
         'by different outlets side by side, with each outlet’s rating and lean, and the dashboard in Figure 5.21 '
         'records what the reader has opened and what the checks concluded.'))
    add(('figure', '5.9', os.path.join(SHOT, 'landing_crop.png'), 5.6, 'Landing Page'))
    add(('figure', '5.10', os.path.join(SHOT, 'home.png'), 5.6, 'Front Page with Trust Stamps'))
    add(('figure', '5.11', os.path.join(SHOT, 'check_form.png'), 6.0, 'Check Anything Page'))
    add(('figure', '5.12', os.path.join(SHOT, 'check_live.png'), 5.6, 'Evidence Channels Reporting During a Check'))
    add(('figure', '5.13', os.path.join(SHOT, 'check_verdict_figure.png'), 5.6, 'Verdict and Evidence for a Wrong Figure'))
    add(('figure', '5.14', os.path.join(SHOT, 'check_factcheck.png'), 5.6, 'Fact-Checker Rulings on a Viral Rumour'))
    add(('figure', '5.15', os.path.join(SHOT, 'check_tamil_question.png'), 5.6, 'A Question in Tamil, Read and Answered'))
    add(('figure', '5.16', os.path.join(SHOT, 'check_partly_false.png'), 5.6, 'A Message with One True and One False Claim'))
    add(('figure', '5.17', os.path.join(SHOT, 'check_plain_ai.png'), 5.6, 'Comparison with a Plain Language Model'))
    add(('figure', '5.18', os.path.join(SHOT, 'check_refused.png'), 5.6, 'Refusal of Input with Nothing to Check'))
    add(('figure', '5.19', os.path.join(SHOT, 'article_crop.png'), 4.3, 'Article Page'))
    add(('figure', '5.20', os.path.join(SHOT, 'compare_crop.png'), 4.1, 'Coverage Comparison'))
    add(('figure', '5.21', os.path.join(SHOT, 'dashboard.png'), 5.4, 'Reader Dashboard'))

    add(('subsection', '5.2.11', 'Testing'))
    add(('para', 'The backend has 519 automated tests and the frontend 42, all passing on the final code. On every push, '
         'continuous integration runs both suites from a clean copy of the code, builds the production frontend and '
         'builds the container images. The backend tests run without any network or model and cover the admissibility gate, the relevance gate, source independence, the premise '
         'check guards, publisher identity, fact-check rating classes, the current-coverage rules, the scoring model '
         'and every verdict rule, together with a regression test for every defect found during development, '
         'including each failure the robustness and held-out suites exposed. The frontend tests cover the evidence '
         'board, the refusal view and the verdict display. The deterministic components were also checked separately: the '
         'admissibility gate classified four of four test inputs correctly, and language detection identified '
         'English, Tamil, Kannada and Hindi correctly.'))

    add(('subsection', '5.2.12', 'Claim Memory, Explanation and Hardening'))
    add(('para', 'After the third review the system was extended in five directions, each measured. First, every check is '
         'kept as an append-only record holding the exact inputs the verdict engine read, so any stored verdict can be '
         'reached again from its record; rewordings and translations of a claim are filed under one record and changed '
         'figures, dates, outcomes or roles are linked as variants. On 46 held-out claim pairs the matcher, with the '
         'system\'s own fine-tuned pair model judging the unclear pairs, filed all 46 correctly with no false merge and all '
         '18 decoys kept apart.'))
    add(('para', 'Second, the reader is shown what decided each verdict and what would change it. Because the verdict comes '
         'from fixed rules, the explanation is computed by running the same rules again with each line of evidence removed '
         'or with hypothetical evidence added; all 32,272 such statements were confirmed by independent recomputation. The '
         'same machinery tests the engine itself: over 20,000 random combinations of evidence, adding evidence against a '
         'claim never made a verdict milder and adding evidence for it never made it harsher. The hand-set confidence beside '
         'each verdict was replaced by the deciding rule\'s measured record on labelled messages, with its 95% Wilson interval.'))
    add(('para', 'Third, a multilingual pair model (MiniLM, 118M parameters) was fine-tuned on 186,266 English, Tamil and Hindi '
         'pairs in under ten minutes on a laptop GPU and exported as a 43 MB quantised model that judges a pair in 7 ms on one '
         'CPU thread. On hand-written blind pairs it lowered the rate at which true statements are read as contradicted from '
         '29.2% to 12.5%, and it now vetoes contradictions a language model reports but the encyclopedia sentence does not '
         'state. Fourth, a changed detail in a true story is caught by comparison rather than by a model: figures and codes '
         'in the claim are matched against headlines and article snippets, so "sent to 4 days in judicial custody" and '
         '"squawked code 7400" are reported false against outlets stating five days and code 7500. A false title over a true '
         'body makes the whole message false, and general facts are settled against the encyclopedia entry for their subject.'))
    add(('para', 'Fifth, the system was hardened for public use: untrusted text is fenced in every prompt and model replies are '
         'validated strictly (nine of nine live injection attempts in English, Hindi and Tamil failed), fetched links are '
         'checked against private addresses on every redirect, and requests are rate-limited. On the final code the '
         'benchmark of 22 real claims was answered correctly in all 22 cases, and a second held-out suite of 51 messages '
         'written after tuning was answered correctly in 49, with the other two left unanswered and none answered wrongly; '
         'a plain language model on the same benchmark was right in 15 and wrong in 4.'))
    add(('subsection', '5.2.13', 'Evaluation on Fact-Checked Rulings'))
    add(('para', 'Every set above was written by the authors from one month’s news. The rulings set described in '
         'Section 4.2 measures the system on claims chosen by others: what people actually forwarded, on which a '
         'professional desk then ruled. A rating of false expects the verdict fake and accepts partly false or '
         'misleading; a rating of misleading expects misleading and accepts partly false or fake; a rating of true '
         'expects real. The desk’s own ruling is hidden from the system during a run, so the fact-checker channel can '
         'use only other desks’ rulings on the same claim, and the verdict must otherwise come from news coverage and '
         'the encyclopedia.'))
    add(('para', 'Failures on the development rulings were read and corrected; the sealed rulings were run whole, once '
         'per release candidate, and every run was logged with its code version whether or not it completed. Table 5.9 '
         'and Figure 5.22 give the results. The first candidate gave the desk’s verdict for ' + str(S1['right']) +
         ' of the ' + str(S1['n']) + ' sealed rulings, an acceptable verdict for ' + str(S1['safe']) + ', no verdict for ' +
         str(S1['missed']) + ' and a wrong verdict for ' + str(S1['wrong']) + '. Its wrong calls on claims rated true '
         'prompted one further round of corrections, made on the development rulings and on a second development pool '
         'of 160 rulings on claims from outside India, never on sealed cases. During that round the label reader was '
         'found to have taken desk ratings written as sentences, such as “That’s not correct”, as true. The labels were '
         'corrected by a script that reads the ratings alone, without the system’s answers; it changed four sealed '
         'labels from true to false and none in development, and the first candidate’s totals are kept as recorded, on '
         'the old labels. The final code gave the desk’s verdict for ' + str(S2['right']) + ', an acceptable verdict '
         'for ' + str(S2['safe']) + ', no verdict for ' + str(S2['missed']) + ' and a wrong verdict for ' +
         str(S2['wrong']) + ', at a median of ' + f'{S2_MEDIAN:.1f}' + ' seconds a claim.' +
         ((' A first attempt at this run stopped after ' + str(S_STOPPED[0]['overall']['n']) + ' rulings when the free '
           'daily model quota ran out; it is logged as incomplete and its partial totals are not used.') if S_STOPPED else '')))
    add(('table', '5.9', 'Outcomes on Fact-Checked Rulings',
         ['Rulings', 'Code', 'Claims', 'Desk’s verdict', 'Acceptable verdict', 'No verdict', 'Wrong verdict'],
         rulings_rows(),
         [2.0, 1.15, 0.6, 0.72, 0.8, 0.65, 0.68], ['left', 'left'] + ['center'] * 5, 10))
    add(('figure', '5.22', os.path.join(FIG, 'fig_5_22_rulings.png'), 6.0, 'Outcomes on Fact-Checked Rulings'))
    add(('para', 'Table 5.10 divides the final sealed run by the desk’s rating. Of ' + str(S2_CAT['rated false']['n']) +
         ' claims rated false, ' + str(S2_CAT['rated false']['right']) + ' were called fake and ' +
         str(S2_CAT['rated false']['safe']) + ' partly false or misleading, ' + str(S2_CAT['rated false']['missed']) +
         ' were left without a verdict and ' + str(S2_CAT['rated false']['wrong']) + ' were called real. Claims rated '
         'misleading were rarely called misleading, ' + str(S2_CAT['rated misleading']['right']) + ' of ' +
         str(S2_CAT['rated misleading']['n']) + ', but ' + str(S2_CAT['rated misleading']['safe']) + ' were called '
         'partly false or fake, both acceptable since the class lies between them, and ' +
         str(S2_CAT['rated misleading']['wrong']) + ' were called real. Claims rated true are the weak point: ' +
         str(S2_CAT['rated true']['right']) + ' of ' + str(S2_CAT['rated true']['n']) + ' were confirmed, ' +
         str(S2_CAT['rated true']['missed']) + ' left without a verdict and ' + str(S2_CAT['rated true']['wrong']) +
         ' given a verdict against them. In the development sets, the failures on true claims came from events '
         'reported by too few outlets for two independent sources, from rankings and judgements that no single report '
         'states in so many words, and from counts accumulated over different dates.'))
    add(('table', '5.10', 'Final Sealed Run by the Desk’s Rating',
         ['Desk’s rating', 'Claims', 'Desk’s verdict', 'Acceptable verdict', 'No verdict', 'Wrong verdict'],
         sealed_category_rows(),
         [1.7, 0.8, 0.95, 1.05, 0.9, 0.95], ['left'] + ['center'] * 5, 10))
    add(('para', 'Between the two candidates, wrong verdicts fell from ' + str(S1['wrong']) + ' to ' + str(S2['wrong']) +
         ' and claims left without a verdict from ' + str(S1['missed']) + ' to ' + str(S2['missed']) + '. Part of the '
         'fall in wrong verdicts may come from the corrected labels rather than the code: up to four of the first '
         'candidate’s wrong verdicts may have been right answers scored against a wrong label, and because a sealed '
         'run keeps totals only, it cannot be rescored. The result also depends on the hosted model. On rulings 1–60, '
         'measured on 25 October, the system with Gemini gave the desk’s verdict for ' + str(RUL_GEMINI['right']) +
         ', an acceptable one for ' + str(RUL_GEMINI['safe']) + ', no verdict for ' + str(RUL_GEMINI['missed']) +
         ' and a wrong one for ' + str(RUL_GEMINI['wrong']) + '; with Gemini switched off, leaving NIM and the local '
         'model, it gave ' + str(RUL_NO_GEMINI['right']) + ', ' + str(RUL_NO_GEMINI['safe']) + ', ' +
         str(RUL_NO_GEMINI['missed']) + ' and ' + str(RUL_NO_GEMINI['wrong']) + '. The open models made no more wrong '
         'calls, but left ' + str(RUL_NO_GEMINI['missed'] - RUL_GEMINI['missed']) + ' more claims without a verdict.'))

    add(('subsection', '5.2.14', 'Comparison and Discussion'))
    add(('para', 'Taken together, the results show what the design was intended to achieve. On a standard corpus the '
         'proposed model classifies as well as the conventional baseline, to within one article, and its accusations '
         'are better calibrated. Against fabrications written to pass every presentation check, the baseline is '
         'deceived four times in six and the proposed model not at all. Across real inputs of every type, the deployed '
         'system returns the expected verdict, refuses what it cannot check, and reports an outage as an outage. On '
         'messages written the way people write them, in three languages and in every tone tested, it gives no wrong '
         'verdict on the robustness suite, and on current claims it is right where a plain language model guesses. On '
         'claims chosen by others, ruled on by professional fact-checkers and sealed before development, it gives the '
         'desk’s verdict or an acceptable one for ' + str(S2['right'] + S2['safe']) + ' of ' + str(S2['n']) +
         ' and a wrong verdict for ' + str(S2['wrong']) + '; it fails far more often by withholding a verdict than by '
         'giving a wrong one, and is least reliable on claims that are true.'))
    add(('para', 'The limitations are stated plainly. The estimation corpus is small, at 239 articles, so a one-article '
         'difference in accuracy is not a difference. The adversarial set is small and partly self-authored. The '
         'priors and the corroboration, ruling and coverage ratios are declared rather than measured. The robustness, '
         'held-out and benchmark sets were written by the authors from one month’s news, and their labels hold only '
         'while that news is current. The rulings set is labelled by the desks, but its labels pass through a reader '
         'of their ratings, which once misread four of them, and only ' + str(RUL_BY['rated true']) + ' of its ' +
         str(RUL_N) + ' claims are rated true, too few to measure that class closely. Verdicts depend on outside services: Google News, the fact-check index, '
         'Wikipedia and a hosted language model whose free daily quota, once spent, leaves the slower fallback '
         'models at 60 to 110 seconds a check. Events less than a few hours old, purely local events with no online '
         'coverage, voice notes, and edited images are outside what the system can verify, though a manipulated video '
         'is still caught when fact-checkers have ruled on it. And the one-sided rule costs ranking performance on '
         'ISOT, which we accept because the discrimination given up comes from evidence an adversary supplies at will.'))

    # =================================================================== CHAPTER 6
    add(('chapter', 6, 'CONCLUSION AND FUTURE WORK'))
    add(('para', 'The results show that fake news detection is better treated as an assessment of evidence than as the '
         'classification of writing style. When an adversary writes the features, a feature may still incriminate a '
         'story but can no longer exonerate it, because the favourable value is precisely what the adversary '
         'supplies. The system built on that principle judges a story by independent corroboration, the rulings of '
         'professional fact-checkers, the current coverage of its subject, the public record and the publisher’s '
         'verified identity; it reads links, text, screenshots and videos in English, Tamil and Hindi for the claims '
         'they make, whether stated, asked, passed on or mocked; it states the rule and the evidence behind every '
         'verdict; and it abstains when the evidence is insufficient.'))
    add(('para', 'Measured on 120 held-out ISOT articles, the scoring model matched the accuracy of the hand-weighted '
         'baseline to within one article while reducing the calibration error of its accusations from 0.267 to 0.152. '
         'On well-written fabrications, the baseline rated four of six as credible and the proposed method none. On ' +
         str(RA['n']) + ' messages covering the ways people phrase claims, the expected answers rose from ' +
         str(RB['right']) + ' to ' + str(RA['right']) + ' once messages were read before being checked, with ' +
         str(RA['wrong']) + ' wrong verdicts, and ' + str(HF['right']) + ' of ' + str(HF['n']) + ' cases written '
         'afterwards were answered as expected at first sight. On claims about the current month, a plain language '
         'model answered ' + str(BENCH_PLAIN) + ' of ' + str(BENCH_N) + ' correctly and the system ' + str(BENCH_OURS) + '. '
         'On ' + str(S2['n']) + ' claims ruled on by professional fact-checkers and sealed before development, the final '
         'system gave the desk’s verdict for ' + str(S2['right']) + ', an acceptable verdict for ' + str(S2['safe']) +
         ', no verdict for ' + str(S2['missed']) + ' and a wrong verdict for ' + str(S2['wrong']) + '.'))
    add(('para', 'The first task for future work is the claims the system leaves without a verdict, ' + str(S2['missed']) +
         ' of the ' + str(S2['n']) + ' sealed rulings, and claims that are true, of which it confirmed only ' +
         str(S2_CAT['rated true']['right']) + ' of ' + str(S2_CAT['rated true']['n']) + '. Both need evidence that a '
         'headline cannot carry: rankings, running totals and events reported by a single outlet are settled in the '
         'body of an article, not its title. A larger set of rulings, gathered each month and sealed in the same way, '
         'would measure true claims more closely, and running the judgements on the system’s own models would remove '
         'its dependence on a free hosted quota.'))
    add(('para', 'Future work will also enlarge the estimation corpus beyond 239 articles, so that the thinner score bands can '
         'be estimated and the declared priors measured, and will complete a live-news study in which verdicts on '
         'thirty claims are checked by hand for coverage and precision. Ratings for regional-language Indian outlets, '
         'which the published rating set rarely covers, can be accumulated from articles already assessed. The '
         'robustness suites can be refreshed from each month’s news and enlarged, voice notes could be transcribed '
         'like videos, and the declared ratios for fact-check rulings and current coverage can be measured once '
         'enough labelled claims have passed through them. Verified '
         'platform channels, currently listed for one outlet, can be extended in the same way, and a natural-language '
         'inference model reading full article text can replace headline-level stance judgement.'))
    add(('para', 'Ultimately, the property we regard as central is what the system does when it does not '
         'know. A detector that cannot tell its own blindness from the absence of evidence will, under load, present '
         'an outage as a finding. By declining unverifiable input and distinguishing a check that found nothing from '
         'one that could not run, the system gives readers answers they can rely on and reasons they can check.'))

    # =================================================================== APPENDIX
    add(('appendix', 1))
    add(('para_noindent', 'The excerpts below are taken from the source code of the system. For brevity, long reader-facing '
         'messages are shown as named constants, comments are shortened, and some helper calls are condensed.'))
    add(('code', 'Publisher Identity from the Web Address (agents/sourceReputationAgent.js)', [
        "function getSourceReputation(sourceName, articleUrl,",
        "                             { trustedName = false } = {}) {",
        "  const address = articleUrl ? parseAddress(articleUrl) : null;",
        "  if (address && address.host) {",
        "    // A platform account earns a record only through its channel.",
        "    if (hostIn(address.host, PLATFORM_HOSTS)) {",
        "      const owner = outletForChannel(address);",
        "      return owner ? asResult(owner, 'channel')",
        "                   : unknown(PLATFORM_NOTE);",
        "    }",
        "    // The address decides: the outlet's own domain or a subdomain.",
        "    const owner = outletForAddress(address);",
        "    if (owner) return asResult(owner, 'domain');",
        "    if (hostIn(address.host, MIRROR_HOSTS)) {",
        "      return unknown(MIRROR_NOTE);",
        "    }",
        "    // A known name claimed from another address is impersonation.",
        "    const claimed = claimedOutlet(sourceName);",
        "    const rated = ratedDomain(address);   // Lin et al. (2023)",
        "    if (rated) return asRated(rated, claimed);",
        "    if (claimed) {",
        "      return unknown(impersonationNote(claimed),",
        "                     { impersonates: claimed.name });",
        "    }",
        "    return unknown();",
        "  }",
        "  // No address: only a curated dataset label may be matched by name.",
        "  if (trustedName) {",
        "    const entry = outletForTrustedName(sourceName);",
        "    if (entry) return asResult(entry, 'name');",
        "  }",
        "  return unknown();",
        "}",
    ]))
    add(('code', 'Admissibility Gate (agents/checkability.js)', [
        "const assessCheckability = (text, title = '') => {",
        "  const head = String(title || '').trim();",
        "  const body = String(text || '').trim();",
        "  const repeatsBody = head &&",
        "    body.toLowerCase().startsWith(head.toLowerCase());",
        "  const combined = head && !repeatsBody",
        "    ? `${/[.!?]$/.test(head) ? head : `${head}.`} ${body}`.trim()",
        "    : body;",
        "  const words = combined.split(/\\s+/).filter(Boolean);",
        "  const anchors = findAnchors(combined);   // names, numbers, dates",
        "  const anchorCount = anchors.names.length",
        "    + anchors.numbers.length + anchors.dates.length;",
        "",
        "  if (combined.length < MIN_CHARACTERS || words.length < MIN_WORDS) {",
        "    return result('too-short', TOO_SHORT_REASON, ['the full text']);",
        "  }",
        "  const withoutQuestions = combined.replace(/[^.!?]*\\?/g, '').trim();",
        "  if (withoutQuestions.split(/\\s+/).length < MIN_WORDS) {",
        "    return result('question', QUESTION_REASON,",
        "                  ['a statement of what is claimed']);",
        "  }",
        "  if (anchorCount === 0) {",
        "    if (EXHORTATION.test(combined)) {",
        "      return result('unfalsifiable', EXHORTATION_REASON, missing);",
        "    }",
        "    return result('too-vague', TOO_VAGUE_REASON, missing);",
        "  }",
        "  return result('claim', null, []);",
        "};",
    ]))
    add(('code', 'One-sided Rule and Calibration (agents/weightOfEvidence.js)', [
        "// Author-controlled evidence is admitted only in the",
        "// incriminating direction.",
        "const clamped = authorControlled.has(family)",
        "  && declared.authorControlled.clampExculpatory",
        "  ? Math.max(0, bin.decibans)",
        "  : bin.decibans;",
        "",
        "// Damp the correlated style family, then cap it.",
        "const rawStyle = styleEntries.reduce((s, e) => s + e.decibans, 0);",
        "const damped = rawStyle * families.style.damping;   // 0.379",
        "const cap = declared.styleWeightCap.value;",
        "const capped = Math.sign(damped) * Math.min(Math.abs(damped), cap);",
        "",
        "const calibrateContentWeight = (rawDecibans) => {",
        "  let probability = lastBreakpoint.probability;",
        "  for (const point of calibration.breakpoints) {",
        "    if (rawDecibans <= point.upTo) {",
        "      probability = point.probability;",
        "      break;",
        "    }",
        "  }",
        "  const corpus = probabilityToDecibans(calibration.corpusBaseRate);",
        "  const calibrated = probabilityToDecibans(probability) - corpus;",
        "  // The clamp applies after calibration too.",
        "  return Math.min(declared.styleWeightCap.value,",
        "                  Math.max(0, calibrated));",
        "};",
    ]))
    add(('code', 'Verdict Rules (agents/verdictEngine.js, abridged)', [
        "if (ledger.sourceIsSatire) {",
        "  return decide('satire', 'satirical-publisher', grounds);",
        "}",
        "if (ledger.independentContradiction >= 2) {",
        "  return decide('false',",
        "                'contradicted-by-multiple-independent-sources', grounds);",
        "}",
        "if (ledger.independentContradiction === 1) {",
        "  return decide('likely-false',",
        "                'contradicted-by-one-independent-source', grounds);",
        "}",
        "if (ledger.premiseContradictions.length > 0) {",
        "  return decide('likely-false',",
        "                'premise-contradicted-by-reference', grounds);",
        "}",
        "if (!ledger.verificationRan) {",
        "  if (ledger.tooRecentToCorroborate) {",
        "    return decide('unverified', 'too-recent-to-corroborate', grounds);",
        "  }",
        "  return decide('unverified', 'verification-unavailable', grounds);",
        "}",
        "if (ledger.checkableClaimCount === 0) {",
        "  return decide('opinion', 'no-checkable-claims', grounds);",
        "}",
        "if (ledger.independentSupport >= 2) {",
        "  return decide('corroborated',",
        "                'corroborated-by-multiple-independent-sources', grounds);",
        "}",
        "if (ledger.independentSupport === 1) {",
        "  return decide('likely-true',",
        "                'corroborated-by-one-independent-source', grounds);",
        "}",
        "if (ledger.highImpact && risk.length >= 3) {",
        "  return decide('likely-false',",
        "                'uncorroborated-high-impact-with-risk-signals', grounds);",
        "}",
        "return applyProvenanceRelief(",
        "  decide('unverified', 'no-independent-coverage', reasons), ledger);",
    ]))
    add(('code', 'Access to the Analysis Endpoints (middleware/apiAccess.js)', [
        "const apiAccess = (req, res, next) => {",
        "  const expected = process.env.INTERNAL_API_KEY;",
        "  const given = req.header('x-internal-key');",
        "  if (expected && given) {",
        "    const a = Buffer.from(String(given));",
        "    const b = Buffer.from(String(expected));",
        "    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {",
        "      return next();",
        "    }",
        "  }",
        "  return authMiddleware(req, res, next);   // a signed-in reader",
        "};",
    ]))
    return C


# Every reference is from 2020 or later and carries a link. The base paper comes first; the rest are numbered in
# the order they are first cited. Each entry: (authors and title, venue in italics, details, link).
BASE_PAPER = 'DEFAME'
REFERENCES = {
    'DEFAME': ('T. Braun, M. Rothermel, M. Rohrbach and A. Rohrbach (2025). DEFAME: Dynamic Evidence-based '
               'FAct-checking with Multimodal Experts. ',
               'Proceedings of the 42nd International Conference on Machine Learning', ', PMLR 267.',
               'https://arxiv.org/abs/2412.10510'),
    'WEF': ('World Economic Forum (2026). ', 'Global Risks Report 2026', '. World Economic Forum, Geneva.',
            'https://www.weforum.org/publications/global-risks-report-2026/'),
    'Verma': ('Y. Verma (2026). What Does 99% Accuracy Measure? A Reproducible Audit of Shortcut Learning in a Widely '
              'Used Fake News Corpus. ', 'arXiv preprint', ' arXiv:2609.25006.', 'https://arxiv.org/abs/2609.25006'),
    'Chen': ('C. Chen and K. Shu (2024). Can LLM-Generated Misinformation Be Detected? ',
             'Proceedings of the Twelfth International Conference on Learning Representations (ICLR 2024)', '.',
             'https://arxiv.org/abs/2309.13788'),
    'Minderer': ('M. Minderer, J. Djolonga, R. Romijnders, F. Hubis, X. Zhai, N. Houlsby, D. Tran and M. Lucic (2021). '
                 'Revisiting the Calibration of Modern Neural Networks. ',
                 'Advances in Neural Information Processing Systems', ', 34.', 'https://arxiv.org/abs/2106.07998'),
    'GuoZ': ('Z. Guo, M. Schlichtkrull and A. Vlachos (2022). A Survey on Automated Fact-Checking. ',
             'Transactions of the Association for Computational Linguistics', ', 10, 178–206.',
             'https://doi.org/10.1162/tacl_a_00454'),
    'AVeriTeC': ('M. Schlichtkrull, Z. Guo and A. Vlachos (2023). AVeriTeC: A Dataset for Real-world Claim '
                 'Verification with Evidence from the Web. ', 'Advances in Neural Information Processing Systems',
                 ', 36, Datasets and Benchmarks Track.', 'https://arxiv.org/abs/2305.13117'),
    'SilvaFilho': ('T. Silva Filho, H. Song, M. Perello-Nieto, R. Santos-Rodriguez, M. Kull and P. Flach (2023). '
                   'Classifier Calibration: A Survey on How to Assess and Improve Predicted Class Probabilities. ',
                   'Machine Learning', ', 112(9), 3211–3260.', 'https://doi.org/10.1007/s10994-023-06336-7'),
    'Hendrickx': ('K. Hendrickx, L. Perini, D. Van der Plas, W. Meert and J. Davis (2024). Machine Learning with a '
                  'Reject Option: A Survey. ', 'Machine Learning', ', 113, 3073–3110.',
                  'https://arxiv.org/abs/2107.11277'),
    'Hu': ('B. Hu, Q. Sheng, J. Cao, Y. Shi, Y. Li, D. Wang and P. Qi (2024). Bad Actor, Good Advisor: Exploring the '
           'Role of Large Language Models in Fake News Detection. ',
           'Proceedings of the AAAI Conference on Artificial Intelligence', ', 38(20), 22105–22113.',
           'https://doi.org/10.1609/aaai.v38i20.30214'),
    'ExFake': ('S. Amri, H.-C. Mputu Boleilanga and E. Aïmeur (2023). ExFake: Towards an Explainable Fake News '
               'Detection Based on Content and Social Context Information. ', 'arXiv preprint', ' arXiv:2311.10784.',
               'https://arxiv.org/abs/2311.10784'),
    'Wang': ('B. Wang, J. Ma, H. Lin, Z. Yang, R. Yang, Y. Tian and Y. Chang (2024). Explainable Fake News Detection '
             'with Large Language Model via Defense Among Competing Wisdom. ',
             'Proceedings of the ACM Web Conference 2024', ', 2452–2463.',
             'https://doi.org/10.1145/3589334.3645471'),
    'DaSan': ('G. Da San Martino, A. Barrón-Cedeño, H. Wachsmuth, R. Petrov and P. Nakov (2020). SemEval-2020 Task 11: '
              'Detection of Propaganda Techniques in News Articles. ',
              'Proceedings of the 14th Workshop on Semantic Evaluation', ', 1377–1414.',
              'https://doi.org/10.18653/v1/2020.semeval-1.186'),
    'Lin': ('H. Lin, J. Lasser, S. Lewandowsky, R. Cole, A. Gully, D. G. Rand and G. Pennycook (2023). High Level of '
            'Correspondence Across Different News Domain Quality Rating Sets. ', 'PNAS Nexus', ', 2(9), pgad286.',
            'https://doi.org/10.1093/pnasnexus/pgad286'),
}

SDG = [
    ('SDG 16: Peace, Justice and Strong Institutions', [
        'The evidence-based fake news detection system supports SDG 16, and in particular target 16.10, which calls on '
        'countries to ensure public access to information. Access to information is of little use when fabricated stories '
        'are indistinguishable from real ones: misinformation erodes trust in institutions, inflames social conflict and '
        'distorts public decisions. By judging a story through independent corroboration and the public record, and by '
        'showing the reader the evidence behind each verdict, the system helps people tell reliable information from '
        'fabrication.',
        'The system strengthens accountability without acting as a censor. It does not remove or block any content; it '
        'explains why a story could or could not be confirmed, names the outlets that report it, and quotes the reference '
        'entry that contradicts a false premise. A reader can therefore check the reasoning instead of having to trust '
        'it, which supports informed participation in public life and protects the freedom to read and share news.',
        'The system also addresses forms of misinformation that are hardest to trace. Forwarded messages with no source, '
        'screenshots of posts and spoken claims in videos reach large audiences through messaging applications, '
        'particularly in multilingual communities. Accepting these inputs, including text in Indian languages such as '
        'Tamil, extends verification to the places where misinformation actually circulates.',
        'Ultimately, the system advances the aims of SDG 16 by making reliable verification available to any reader, '
        'by refusing to give confident answers where the evidence does not support them, and by flagging pages that '
        'impersonate trusted newsrooms. In doing so it contributes to a healthier information environment, in which '
        'public trust is earned by evidence and institutions are judged on what can be shown to be true.',
    ]),
]


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

ABSTRACT = [tidy(p) for p in ABSTRACT]

_content = content


def content():
    return [tuple(tidy(x) for x in block) for block in _content()]
