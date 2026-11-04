"""Text of the NICOM 2027 full paper. Every figure quoted here is taken from docs/measurements.md,
backend/data/taskRouting.json or the end-to-end run of 4 October 2026 (report/e2e_results_*.json).
Inline markup: <i>..</i> italic, <b>..</b> bold, <sub>..</sub>, <sup>..</sup>."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, 'figs')

TITLE = 'Evidence-Based Fake News Detection with Calibrated Scoring'

AUTHORS = [
    ('Mugilan K S', '1'),
    ('Nandha Kumar S', '1*'),
    ('Nandhini A', '1'),
    ('M. Kannukkiniyal', '1'),
]
AFFILIATION = ('<sup>1</sup>Department of Computer Science and Engineering, Kongu Engineering College, '
               'Perundurai, Erode, Tamil Nadu, India')
CORRESPONDING = '<sup>*</sup>Corresponding author: nandhakumar4115@gmail.com'
TRACK = 'Track: Digitalisation, AI & Future Technologies'

ABSTRACT = (
    'Most fake news detectors judge an article by how it is written, yet writing style is the one thing a '
    'person producing fabricated news controls completely. We propose an evidence-based approach that asks a '
    'different question: are the claims in a story independently supported? The system accepts article links, '
    'pasted text, screenshots and videos, reading screenshots through optical character recognition and videos '
    'through their transcripts, and it declines input that contains no checkable claim. For everything else, it '
    'extracts the main claims, searches for coverage of the same events and counts the independent outlets that '
    'report them, rather than the articles retrieved. People and organisations named in the story are checked '
    'against an encyclopedia to expose false premises, and the publisher is identified from its web address, '
    'not from the name the page gives itself. Writing signals such as clickbait, bias, manipulation and '
    'transparency enter as likelihood ratios learned from labelled data and are combined as log-odds into a '
    'calibrated probability of fabrication. The guiding principle is that evidence the author controls may raise '
    'suspicion but can never establish credibility; trust has to come from independent corroboration and the '
    'publisher’s record. When the evidence is insufficient, the system abstains. On 120 held-out ISOT '
    'articles, the approach matches a hand-weighted scoring baseline to within one article while reducing '
    'calibration error on its accusations from 0.267 to 0.152. On a set of carefully written fabrications, the '
    'baseline rated four of six as credible; the proposed method rated none.'
)

KEYWORDS = ('Fake news detection; Evidence-based verification; Independent corroboration; Likelihood ratio; '
            'Probability calibration; Selective prediction; Digital trust')


def e2e_rows():
    return [
        ['1', 'Pasted text', 'REAL', 'REAL', 'Five independent outlets', '100 s'],
        ['2', 'News link', 'REAL', 'REAL', 'Three independent outlets', '33 s'],
        ['3', 'Screenshot', 'REAL', 'REAL', 'Five independent outlets', '112 s'],
        ['4', 'Pasted text (Tamil)', 'REAL', 'REAL', 'Four independent outlets', '30 s'],
        ['5', 'YouTube video', 'REAL or CANNOT VERIFY', 'CANNOT VERIFY', 'No independent coverage found', '55 s'],
        ['6', 'Pasted text', 'FAKE', 'FAKE', 'Premise contradicted by reference', '22 s'],
        ['7', 'Screenshot', 'FAKE', 'FAKE', 'Premise contradicted by reference', '30 s'],
        ['8', 'Pasted text', 'CANNOT VERIFY', 'CANNOT VERIFY', 'No independent coverage found', '25 s'],
        ['9', 'Pasted text', 'CANNOT VERIFY', 'CANNOT VERIFY', 'No independent coverage found', '28 s'],
        ['10', 'Pasted text', 'Declined', 'Declined', 'A question; asserts nothing', '< 1 s'],
        ['11', 'Screenshot', 'Declined', 'Declined', 'An exhortation; no claim', '< 1 s'],
        ['12', 'News link', 'Declined', 'Declined', 'Publisher blocks automated reading', '< 1 s'],
    ]


def body():
    B = []
    add = B.append

    # ------------------------------------------------------------------ 1
    add(('h1', '1. Introduction'))
    add(('p', 'The World Economic Forum’s <i>Global Risks Report 2026</i> ranks misinformation and '
         'disinformation second among the risks the world faces over the next two years, behind only geoeconomic '
         'confrontation (World Economic Forum, 2026). The ranking describes something newsrooms, platforms and '
         'public offices already deal with every day. False stories spread further and faster than true ones '
         '(Vosoughi et al., 2018), and the means to produce a convincing article, screenshot or video now cost '
         'almost nothing. For the person who receives a forwarded message or a link, though, the question is '
         'narrow and practical: should I believe this, and on what grounds?'))
    add(('p', 'Automated detection was meant to help answer that question. Most of the research frames it as text '
         'classification, in which a model reads an article and labels it fake or real from its wording, tone and '
         'headline. Reported accuracy on public datasets is very high. On the widely used ISOT corpus (Ahmed et '
         'al., 2017), figures above 99 per cent are common, yet an audit by Verma (2026) traces much of that '
         'performance to artefacts in the way the corpus was assembled, not to any ability to judge '
         'whether a story is true. There is a more basic difficulty as well. The author of the text chooses every feature a style-based detector reads. A person fabricating a story can write in calm newsroom prose, '
         'quote named officials and avoid sensational headlines, and the detector will reward them for it. '
         'Language models make this easier still: Chen and Shu (2024) found that misinformation written by a '
         'language model is harder for both people and detectors to spot than human-written misinformation with '
         'the same meaning.'))
    add(('p', 'We observed the problem directly while building our system. A conventional design that adds up six '
         'analysis factors with hand-chosen weights gave invented stories, written in plain newsroom style, an '
         'average of 7.3 out of 10, and it presented four of six deceptive items to the reader as credible. No '
         'single factor was at fault. The trouble lay in what the sum allowed: good presentation could buy trust.'))
    add(('p', 'This paper describes the design that replaced it. The design rests on one rule about evidence: an '
         'observation the author controls may count against an article but never in its favour. Support must come '
         'from outside the author’s reach, which in practice means independent outlets reporting the same '
         'event, reference entries on the people and organisations named, and the publisher’s own record, '
         'established from its web address. Each observation contributes a likelihood ratio measured on labelled '
         'articles instead of a weight picked by hand, and the system reports a calibrated probability along with '
         'a verdict and the rule that produced it. When it cannot check a story, it says so, and it keeps a search '
         'that found nothing separate from a search that could not run.'))
    add(('p', 'We position the work against DEFAME (Braun et al., 2025), an evidence-based fact-checking system '
         'presented at the International Conference on Machine Learning in 2025, which serves as our base paper. '
         'DEFAME showed that a language-model pipeline can plan web searches, collect textual and visual evidence '
         'and write a justified verdict. We keep its evidence-first stance and extend it where a public-facing '
         'service needs more: how much a given piece of evidence is allowed to prove, whether the sources behind it '
         'are independent of each other, who actually published the page, and what the system should say when one '
         'of its checks fails.'))
    add(('p', 'The paper makes five contributions:'))
    add(('list', [
        'A one-sided admissibility rule for author-controlled evidence, enforced at every stage of scoring, '
        'including after calibration.',
        'A weight-of-evidence model in which each weight is a likelihood ratio estimated from labelled data, '
        'correlated writing signals are damped, and the output is a calibrated probability of fabrication.',
        'Corroboration counted in independent outlets rather than retrieved articles, together with a premise '
        'check against a reference work and a publisher identity read from the web address. The last of these '
        'closes a copycat-site attack that fooled name-based identification.',
        'An abstention policy that declines input with nothing to check and reports a check that could not run '
        'as unavailable, never as missing evidence.',
        'A local-first routing of language-model tasks, under which nine of ten tasks run on a laptop graphics '
        'card, faster and more reliably than on the hosted services we measured.',
    ]))
    add(('p', 'Section 2 reviews related work and the base paper. Section 3 describes the method, Section 4 the '
         'evaluation and Section 5 the results. Section 6 discusses what the findings mean for platforms, newsrooms '
         'and policy, Section 7 sets out the limitations and Section 8 concludes.'))

    # ------------------------------------------------------------------ 2
    add(('h1', '2. Literature Review'))
    add(('h2', '2.1 Detection from Content and Style'))
    add(('p', 'Early work treated fake news detection as supervised text classification. Ahmed et al. (2017) built '
         'the ISOT dataset from Reuters articles and from stories flagged by fact-checking organisations, and they '
         'reported high accuracy with n-gram features and linear classifiers. Shu et al. (2019) added explanation '
         'with dEFEND, which attends jointly to the sentences of an article and to user comments about it, and '
         'surfaces the comments that best indicate deception. The explanations are useful, but they depend on a '
         'stream of comments that does not yet exist for an article someone has just been sent. Da San Martino et '
         'al. (2020) defined a taxonomy of persuasion techniques annotated at the level of text spans, which made '
         'propaganda detection measurable, although it has remained mostly a research task.'))
    add(('p', 'Large language models changed the picture without removing the dependence on content. Hu et al. '
         '(2024) found that GPT-3.5, used directly as a detector, underperformed a fine-tuned small model, but that '
         'its rationales improved the small model when supplied as guidance. In their phrase, the large model was a '
         'bad actor but a good advisor. Wang et al. (2024) used a language model to argue for and against a claim '
         'from collections of raw reports and then chose between the two explanations. Both approaches still judge '
         'the content, or depend on many reports per claim, and neither asks who controls the signals being '
         'weighed.'))
    add(('h2', '2.2 Evidence-Based Fact-Checking'))
    add(('p', 'A second line of work verifies claims against external evidence. Thorne et al. (2018) formalised the '
         'task with FEVER, in which claims are checked against sentences from Wikipedia. Guo et al. (2022) describe '
         'the full pipeline as claim detection, evidence retrieval, verdict prediction and justification, and note '
         'that most systems of the time assumed the evidence had already been found. Schlichtkrull et al. (2023) '
         'moved closer to real use with AVeriTeC, a dataset of real-world claims paired with evidence from the open '
         'web. For breaking news, a reference work on its own is rarely enough, since the event in question is '
         'usually too new to appear there.'))
    add(('h2', '2.3 The Base Paper: DEFAME'))
    add(('p', 'DEFAME (Braun et al., 2025) is, to our knowledge, the most complete open-domain system of this kind '
         'published so far. It verifies claims that combine text and images in six stages: it plans actions, '
         'executes them, summarises the results, develops the fact-check, predicts a verdict and justifies it. Its '
         'tools include web search, image search, reverse image search and a geolocation model, and it returns one '
         'of four verdicts: supported, refuted, misleading, or not enough information. When the evidence is '
         'insufficient it returns to planning, up to three times. With GPT-4o as its backbone, it reported 70.5 per '
         'cent accuracy on AVeriTeC, 59.2 per cent on MOCHEG and 83.9 per cent on the true-versus-false split of '
         'VERITE, along with 69.7 per cent on ClaimReview2024+, a set of claims published after the model’s '
         'training cut-off. Each claim cost about thirteen US cents and took roughly four minutes.'))
    add(('p', 'We chose DEFAME as the base paper because it is recent, it was peer-reviewed at a leading venue, and '
         'it shares our premise that a verdict should rest on retrieved evidence rather than on the model’s '
         'own knowledge or on the style of the text. It also produces a justification a reader can follow. Its '
         'authors are candid about where it stops. DEFAME does not weigh how credible a source is; it relies '
         'instead on diversification and on the search engine’s own trustworthiness checks. It gives a '
         'categorical verdict without a probability, and its best results depend on a large hosted model whose cost and latency matter for a public service. These are the points at which our work picks '
         'up.'))
    add(('h2', '2.4 Source Credibility'))
    add(('p', 'Judging the outlet as well as the article has a long history in media research. Pennycook and Rand '
         '(2019) showed that ratings of news-source quality gathered from ordinary people agree well with those of '
         'professional fact-checkers. Lin et al. (2023) compared six professional rating sets, found high agreement '
         'among them and published an aggregate quality score for 11,520 news domains. A rating, however, is only '
         'as good as the identification of the outlet it is attached to. A system that accepts the name a page '
         'gives itself will hand a copycat site the record of the outlet it imitates.'))
    add(('h2', '2.5 Calibration and Abstention'))
    add(('p', 'A stated confidence is useful only if it is calibrated, meaning that events predicted at 70 per cent '
         'happen about 70 per cent of the time. Guo et al. (2017) showed that modern neural networks are '
         'systematically overconfident, and post-hoc methods such as isotonic regression (Zadrozny & Elkan, 2002) '
         'are the usual remedy. The weight-of-evidence formulation we use goes back to Good (1950): each observation '
         'contributes the logarithm of a likelihood ratio, measured in decibans, and independent contributions add. '
         'Declining to answer has an equally long history. Chow (1970) characterised the optimal reject option for '
         'a classifier, and Geifman and El-Yaniv (2017) carried selective classification to deep networks. Fake '
         'news benchmarks rarely reward it, because the usual protocol forces a label on every item.'))
    add(('h2', '2.6 Research Gap'))
    add(('p', 'Table 1 summarises the approaches reviewed. None of them separates evidence the author controls from '
         'evidence the author cannot control, so a well-presented fabrication can earn credit for its presentation. '
         'Corroboration, where it exists, is counted in retrieved pages, not in independent sources, and no '
         'system checks whether the publisher is who it claims to be. Apart from DEFAME’s ‘not enough '
         'information’ verdict, none defines its output when evidence is missing, and none distinguishes a '
         'check that failed from one that found nothing. The present work is aimed at these gaps.'))
    add(('table', '1', 'Comparison of Related Approaches with the Proposed System',
         ['Study', 'Evidence used', 'Independence of sources', 'Output', 'Abstains'],
         [['Ahmed et al. (2017)', 'Article text', 'Not considered', 'Label', 'No'],
          ['Shu et al. (2019), dEFEND', 'Article text and user comments', 'Not considered', 'Label with explanation',
           'No'],
          ['Hu et al. (2024), ARG', 'Article text and model rationales', 'Not considered', 'Label', 'No'],
          ['Wang et al. (2024)', 'Raw reports about the claim', 'Not considered', 'Label with explanation', 'No'],
          ['Braun et al. (2025), DEFAME (base paper)', 'Web and image search, reverse image search',
           'Left to the search engine', 'Verdict with justification', 'Yes, ‘not enough information’'],
          ['Proposed system', 'Independent news coverage, reference work, publisher record, writing checks',
           'Ownership, wire copies and reprints collapsed', 'Verdict, calibrated probability and grounds',
           'Yes; failed checks reported separately']],
         [1.35, 1.45, 1.2, 1.15, 1.12], ['left', 'left', 'left', 'left', 'left'], None))

    # ------------------------------------------------------------------ 3
    add(('h1', '3. Proposed Methodology'))
    add(('h2', '3.1 Overview'))
    add(('p', 'Figure 1 shows the idea behind the design and Figure 2 the processing pipeline. The system accepts '
         'four kinds of input. A link is read from the publisher’s page, a screenshot is read with optical '
         'character recognition, a video link is read through its caption track, and pasted text is used as it '
         'stands. Each is reduced to the same form: the text, a headline where there is one, and a record of where '
         'the item came from. Text in Indian languages such as Tamil, Hindi and Kannada is recognised, and its '
         'claims are searched both in the original language and in English, because an event reported in Tamil is '
         'often reported in English as well.'))
    add(('figure', '1', 'The Admissibility Principle Behind the Scoring Model',
         os.path.join(FIG, 'fig1_framework.png'), 5.6, None))
    add(('p', 'Page extraction needed care. Publisher pages carry menus, newsletter boxes and links to related '
         'stories, and on one BBC page our first extractor read the site menu as the opening paragraph of the '
         'article. Extraction is now limited to the article body, and the extracted text is accepted only when at '
         'least half of the headline’s distinctive words appear in it.'))
    add(('figure', '2', 'Processing Pipeline from Input to the Reader’s Report',
         os.path.join(FIG, 'fig2_pipeline.png'), 5.3, None))
    add(('h2', '3.2 Admissibility Check'))
    add(('p', 'Before any expensive step, a deterministic check asks whether the input asserts anything a newsroom '
         'could confirm or deny. Questions, exhortations such as ‘Wake up and share this before it is '
         'deleted’, and fragments too short to carry a claim are declined with a short statement of what is '
         'missing. An input passes only if it contains at least one anchor, such as a name, a number or a date. We '
         'made this a separate step because a verdict on something unverifiable is worse than no verdict: it '
         'teaches readers to discount the answers the system gets right.'))
    add(('h2', '3.3 Claim Extraction and Independent Corroboration'))
    add(('p', 'A language model extracts up to two checkable claims, each with a few search keywords. For each '
         'claim, the system queries a news index, leaving out the article’s own outlet, and a second model '
         'call judges whether each retrieved report supports the claim, contradicts it or does not address it.'))
    add(('p', 'Retrieved articles are then reduced to the distinct sources behind them. Outlets with a common '
         'owner count once, copies of the same wire-agency report count once, and near-duplicate reprints collapse '
         'into a single item. Each merge is shown to the reader. A relevance gate then discards coverage that '
         'shares no anchor with the claim. We tightened this gate after an invented story about a chemical leak, '
         'written without a single proper noun, was ‘confirmed’ by a real chemical-leak report from Ohio '
         'that happened to share four ordinary words with it. A claim that names no person, place, organisation or '
         'figure can now never be corroborated.'))
    add(('p', 'The outcome for each claim also records whether the search ran. A search that was rate-limited, '
         'timed out or returned something unreadable is reported as unavailable and contributes nothing to the '
         'probability. Only a search that ran and came back empty is treated as an absence of coverage. We learned '
         'the importance of this the hard way: an early version told readers that no other outlet was reporting a '
         'wire story that five major outlets were carrying at the time, because the news index had refused the '
         'request. The index also runs behind live publication. On the day we measured it, the newest article it '
         'returned for any query was 30.5 hours old, so a story less than about a day old is reported as too recent '
         'to corroborate instead of being counted against.'))
    add(('h2', '3.4 Premise Check'))
    add(('p', 'Corroboration has a blind spot. A story built on a false premise describes an event that nobody '
         'reports, so the search correctly finds nothing, and the important fact, that the premise is wrong, goes '
         'unnoticed. The system therefore looks up the people and organisations a story names in an encyclopedia '
         'and asks a language model whether the story states anything that conflicts with the entry. A conflict '
         'counts only if the model quotes the entry and the quotation is found in the retrieved text, the entry is '
         'about the same subject, the two statements cannot both be true, and the story makes the statement in its '
         'own voice rather than reporting someone else saying it.'))
    add(('p', 'The last three conditions each came from a real error. One of our genuine test articles quoted a '
         'council official named Meera Krishnan and was flagged, because the encyclopedia entry under that name '
         'describes an actress. An Associated Press video report was flagged because a woman interviewed in it said '
         'the Pope’s ancestors came from the region, which the check had set against his birthplace in '
         'Chicago. A reference work is used only where it is strong: it may refute a premise, but it never '
         'corroborates an event.'))
    add(('h2', '3.5 Publisher Identity'))
    add(('p', 'Who published a page is decided from its web address, never from the name the page uses. A record is '
         'granted only on a domain the outlet publishes from, or on a platform channel listed as the outlet’s '
         'own. Ratings come first from a curated list of 90 outlets, which includes Indian publishers that the '
         'published sets do not cover, and otherwise from the aggregate ratings of Lin et al. (2023) for 11,520 '
         'domains. Over the 81 outlets rated by both, the two agree closely (Pearson <i>r</i> = 0.848, Spearman '
         '<i>ρ</i> = 0.765), and a least-squares fit over that overlap converts the published 0 to 1 score '
         'to our 0 to 10 scale.'))
    add(('p', 'A page that uses a well-known outlet’s name from an address the outlet does not use receives no '
         'record and is flagged as impersonation. For unrated sites, the system reads the registration date of the '
         'domain from the public RDAP registry, and a domain less than 90 days old is treated as one warning sign '
         'among others. Age never counts in a site’s favour, since an old domain can simply be bought.'))
    add(('h2', '3.6 Writing Checks'))
    add(('p', 'Four checks describe how a story is written: clickbait in the headline, slanted or one-sided '
         'language, persuasion techniques drawn from the SemEval-2020 taxonomy (Da San Martino et al., 2020), and '
         'transparency, a five-point checklist of whether the story names its sources, attributes its quotes, '
         'points to primary evidence, gives concrete detail and keeps its claims measured. Every check must quote '
         'the words it reacts to, so its output can be verified against the text. The checks are reported to the '
         'reader in full. How much they may affect the verdict is the subject of the next section.'))
    add(('h2', '3.7 Weighing the Evidence'))
    add(('p', 'Each observation <i>o</i> is converted into a likelihood ratio, the factor by which it changes the '
         'odds that a story is fabricated, and expressed in decibans (Good, 1950):'))
    add(('eq', r'\Lambda(o) = \frac{P(o \mid \mathrm{fabricated})}{P(o \mid \mathrm{genuine})}, \qquad W(o) = 10\,\log_{10} \Lambda(o)', '1'))
    add(('p_noindent', 'Ratios are estimated from labelled articles by grouping each observation into bands and '
         'counting, with a Jeffreys prior (Jeffreys, 1961) and shrinkage to the conservative end of a 95 per cent '
         'interval, so that a band supported by only a few articles contributes nothing. The posterior then follows '
         'by addition:'))
    add(('eq', r'\mathrm{logit}\, P(\mathrm{fabricated} \mid O) = \mathrm{logit}\, \pi + \sum_{o \in O} W(o)', '2'))
    add(('p_noindent', 'where <i>π</i> is a prior set by the publisher’s record: 0.02 for an outlet with '
         'a strong record, 0.06 for an ordinary one, 0.15 for an unrated outlet, 0.25 for a poor record or an '
         'impersonating page, and 0.35 for a post from a social-media account. These priors are declared, not '
         'measured, and every report labels them that way.'))
    add(('p', 'The admissibility rule divides the observations into <i>O</i><sub>A</sub>, those the author controls, '
         'and <i>O</i><sub>I</sub>, those outside the author’s control. For an author-controlled observation, '
         'only the incriminating part is admitted:'))
    add(('eq', r'W^{\dagger}(o) = \max\left(0, W(o)\right), \qquad o \in O_{A}', '3'))
    add(('p_noindent', 'The reason is adversarial rather than statistical. On a corpus of crude fabrications, fluent '
         'prose really does predict a genuine article, and a model trained there will learn to reward it. A '
         'competent fabricator supplies fluent prose on purpose, so the lesson fails exactly when it matters, and '
         'the rule declines to learn it. Two useful properties follow. An observation that carries no information '
         'has a ratio of one and contributes zero, so abstaining on a single factor falls out of the arithmetic '
         'and needs no special case in the code. An observation that has never been measured also contributes '
         'zero, and the report names it as unmeasured instead of giving it an invented weight.'))
    add(('p', 'The writing checks overlap, because they all read the same prose. Across the four checks the mean '
         'correlation <i>r̄</i> was 0.55, and headline quality and language correlated at 0.93. Under equal '
         'correlation, the effective number of independent checks among <i>k</i> is'))
    add(('eq', r'n_{\mathrm{eff}} = \frac{k}{1 + (k - 1)\,\bar{r}}', '4'))
    add(('p_noindent', 'which gives 1.52 for our four checks. Their summed weight is therefore scaled by '
         '<i>n</i><sub>eff</sub>/<i>k</i> = 0.379 and capped at 8 decibans.'))
    add(('p', 'Finally, the summed log-odds are mapped to a probability with isotonic regression (Zadrozny & Elkan, '
         '2002) fitted on held-out data. We found that the fitted map, trained where clean style does predict '
         'genuine articles, quietly restored the exculpatory weight the rule had removed, so the rule is applied '
         'again after calibration. A regression test now guards that step.'))
    add(('h2', '3.8 Verdict Rules and Abstention'))
    add(('p', 'The probability expresses graded belief. A separate verdict states what has been established. It is chosen by an ordered set of rules from the evidence gathered, and the rule that fired '
         'is shown with it (Table 2). The two can diverge, and that is intended. An uncorroborated story may carry '
         'a low probability of fabrication simply because most stories are genuine, yet nothing about it has been '
         'established, so its verdict remains CANNOT VERIFY.'))
    add(('table', '2', 'Verdict Rules in Order of Precedence',
         ['Order', 'Condition', 'Verdict shown'],
         [['1', 'The publisher is a known satirical outlet', 'SATIRE'],
          ['2', 'Two or more independent outlets contradict a claim', 'FAKE (false)'],
          ['3', 'One independent outlet contradicts a claim', 'FAKE (probably false)'],
          ['4', 'A reference entry contradicts the story’s premise', 'FAKE (probably false)'],
          ['5', 'The story is too recent for the news index, or verification could not run', 'CANNOT VERIFY'],
          ['6', 'No checkable claim remains after extraction', 'NOT A FACTUAL CLAIM'],
          ['7', 'Two or more independent outlets support the claims', 'REAL (confirmed)'],
          ['8', 'One independent outlet supports the claims', 'REAL (probably true)'],
          ['9', 'A high-impact claim is uncorroborated and shows three or more risk signals',
           'FAKE (probably false)'],
          ['10', 'None of the above', 'CANNOT VERIFY (not confirmed)']],
         [0.55, 3.6, 2.1], ['center', 'left', 'left'],
         'Input that fails the admissibility check is declined before these rules are reached.'))
    add(('h2', '3.9 Model Routing and Implementation'))
    add(('p', 'All language-model calls pass through one gateway that can use a local model (Llama 3.1 8B served by '
         'Ollama) or two hosted services, NVIDIA NIM and Google Gemini. Which provider handles which task was '
         'decided by measurement (Section 5.5). A task is routed locally only if at least 80 per cent of local '
         'replies are valid, at least 80 per cent are correct where the right answer is known, and the local '
         'scores stay within 2 points of the hosted reference on the 0 to 10 scale. The gateway retries a '
         'congested service and moves to the next model when one is withdrawn, which happened to a hosted model we '
         'relied on midway through the project. If no provider answers at all, each writing check falls back to a '
         'deterministic analyser based on word lists and surface patterns, and the report marks every check that '
         'ran in this degraded mode.'))
    add(('p', 'The application is built on MongoDB, Express, React and Node.js. Reports are cached by article '
         'address for 14 days, and results stream to the reader as each check finishes. The backend is covered by '
         '182 automated tests and the frontend by 14, all of which run without network access or model keys.'))

    # ------------------------------------------------------------------ 4
    add(('h1', '4. Evaluation Design'))
    add(('p', 'The evaluation was designed to answer five questions, each with its own test.'))
    add(('p', '<b>Is the scoring model accurate and calibrated?</b> The model was estimated and tested on ISOT. We '
         'used 239 articles for which every writing check had been produced by the language model rather than by '
         'the fallback analyser, split by a hash of the article identifier into 119 for estimation and 120 for '
         'testing. All of ISOT’s genuine articles come from Reuters, so the outlet alone predicts the label. We therefore hid the source and removed agency prefixes such as ‘WASHINGTON (Reuters)’ from the text. Historical articles have no live coverage, so corroboration was not exercised; this test '
         'measures the content half of the model. The baseline is the hand-weighted sum described in Section 1, '
         'applied to the same check outputs. We report accuracy, ROC-AUC, the Brier score and the expected '
         'calibration error (ECE) over ten bins, together with ECE and precision computed only over accusations, '
         'that is, predictions that give a probability of fabrication above one half.'))
    add(('p', '<b>Can careful writing still buy trust?</b> ISOT’s fabrications are crude, so it cannot test the '
         'attack this design is meant to resist. We therefore wrote ten items: five fabrications in plain newsroom '
         'register with named sources and no clickbait, one high-impact fabrication carrying manipulation signals, '
         'two genuine reports, a satirical piece and a commentary. Each item was scored twice from identical check '
         'outputs, once under each rule, using the deterministic analysers so that the result can be reproduced '
         'without network access.'))
    add(('p', '<b>Does the deployed system behave correctly from end to end?</b> Twelve cases were run through the '
         'live application on 4 October 2026, covering every verdict and every input type: pasted text, Tamil '
         'text, news links, screenshots and a YouTube video.'))
    add(('p', '<b>Can a copycat site borrow a trusted name?</b> We tested five lookalike addresses imitating the '
         'BBC, Reuters and the Associated Press, and ran a fabricated story on one of them live.'))
    add(('p', '<b>Which model should run which task?</b> Ten model tasks were run three times on each provider, with '
         'the configuration pinned so that a failing local model could not fall through to a hosted one and be '
         'recorded as a local success. The machine was a Windows 11 laptop with an NVIDIA RTX 5050 graphics card '
         '(8 GB). The hosted models were Nemotron 3 Super 120B on NVIDIA NIM and Gemini 3.1 Flash-Lite on '
         'Google Gemini.'))

    # ------------------------------------------------------------------ 5
    add(('h1', '5. Results'))
    add(('h2', '5.1 Accuracy and Calibration on Held-Out Articles'))
    add(('p', 'Table 3 and Figure 3 compare the two scoring rules on the 120 held-out articles. Accuracy is '
         'effectively the same: the proposed model classified 114 articles correctly and the baseline 115. The difference that matters lies in calibration on the cases where the system accuses. Expected calibration error on '
         'accusations fell from 0.267 to 0.152, a reduction of 43 per cent, while precision on accusations stayed '
         'at 0.967. When the proposed system says a story is probably fabricated, the probability it states is '
         'much closer to how often that turns out to be the case.'))
    add(('table', '3', 'Held-Out Comparison of the Two Scoring Rules',
         ['Model', 'Accuracy', 'ROC-AUC', 'ECE', 'ECE (accusing)', 'Precision (accusing)', 'Brier'],
         [['Hand-weighted baseline', '0.958', '0.978', '0.237', '0.267', '0.968', '0.101'],
          ['Proposed, as deployed', '0.950', '0.951', '0.246', '0.152', '0.967', '0.117']],
         [1.6, 0.82, 0.76, 0.6, 0.82, 0.92, 0.6], ['left', 'center', 'center', 'center', 'center', 'center',
                                                    'center'],
         '<i>n</i> = 120 held-out ISOT articles. Lower is better for ECE and the Brier score.'))
    add(('figure', '3', 'Held-Out Metrics for the Baseline and the Proposed Model',
         os.path.join(FIG, 'fig3_heldout.png'), 5.9, None))
    add(('p', 'The proposed model ranks slightly less well (ROC-AUC 0.951 against 0.978), and its overall ECE and '
         'Brier score are a little higher. Both effects come from the rule itself. On ISOT the only exculpatory '
         'evidence available is style, which the rule refuses to admit, so genuine articles stay at their prior: '
         'the 59 held-out articles in the lowest band were stated at 0.41 and turned out to be fabricated 7 per '
         'cent of the time. In use, exoneration comes from corroboration and the publisher’s record, neither of '
         'which a historical corpus with hidden sources can supply. Switching the rule off shows its cost directly: '
         'ROC-AUC rises to 0.983, but ECE on accusations rises to 0.191. That extra discrimination comes from '
         'learning that fluent writing signals a genuine story, which is exactly the lesson a careful fabricator '
         'exploits, so the deployed system keeps the rule.'))
    add(('h2', '5.2 Adversarial Benchmark'))
    add(('p', 'Table 4 shows the result on the adversarial set. The baseline presented four of the six deceptive '
         'items as credible. The proposed rule presented none, returned the expected verdict for all six and '
         'condemned neither genuine report. The fabrications still score well for writing, averaging 7.3 out of 10 '
         'under the baseline, and they always will. What has changed is that writing well no longer decides the '
         'outcome.'))
    add(('table', '4', 'Adversarial Benchmark',
         ['Measure', 'Baseline', 'Proposed'],
         [['Deceptive items presented as credible', '4 of 6', '0 of 6'],
          ['Verdicts matching expectation', '–', '6 of 6'],
          ['Genuine reports wrongly condemned', '–', '0 of 2'],
          ['Mean writing score of the fabrications', '7.3 of 10', '–']],
         [3.4, 1.3, 1.3], ['left', 'center', 'center'],
         'The baseline gives a score rather than a verdict, so its verdict rows are empty. Both rules were scored '
         'from identical outputs of the deterministic analysers.'))
    add(('h2', '5.3 End-to-End Behaviour'))
    add(('p', 'Table 5 lists the twelve cases run through the deployed application. Genuine reports were confirmed '
         'by three to five independent outlets whether they arrived as pasted text, a link, a screenshot or Tamil '
         'text. The story calling Rahul Gandhi ‘Prime Minister’ was caught through its premise, both as '
         'text and as a screenshot; Figure 4 shows the report the reader sees, with the line from the reference '
         'entry that settles it. The two invented stories could not be verified, and the three inputs with nothing '
         'to check were declined with a reason. The Associated Press video, a genuine report whose transcript is '
         'largely an interview in French, was returned as CANNOT VERIFY because no matching coverage was retrieved '
         'on that run. It was not called false. Analyses took between 22 and 112 seconds, and refusals were '
         'immediate.'))
    add(('table', '5', 'End-to-End Test Cases Run on 4 October 2026',
         ['No.', 'Input', 'Expected', 'Result', 'Rule that decided it', 'Time'],
         e2e_rows(),
         [0.35, 1.05, 1.45, 1.45, 1.5, 0.47], ['center', 'left', 'center', 'center', 'left', 'center'], None))
    add(('figure', '4', 'The Reader’s Report for a Story Built on a False Premise',
         os.path.join(FIG, 'fig4_report.png'), 5.4, None))
    add(('p', 'The run also tested failure, though not by design. Midway through the first attempt, the machine lost '
         'its internet connection and every news and reference lookup failed. All the affected cases were reported '
         'as CANNOT VERIFY under the rule ‘verification unavailable’, with the message ‘We could not '
         'complete the search, so nothing has been checked’. None was reported as false or as unsupported. The '
         'cases were run again once the connection returned, and Table 5 shows their results from that second run.'))
    add(('h2', '5.4 Publisher Identity'))
    add(('p', 'When the outlet is identified from the name a page gives itself, every lookalike in Table 6 inherits '
         'the rating of the outlet it imitates. A fabricated income-tax story placed on bbc-breaking-news.xyz, a '
         'page calling itself BBC News, was then described as an exclusive from an outlet with a strong record and '
         'given a 2 per cent probability of fabrication. With identity read from the address, the same story '
         'starts from the poor-record prior, receives 33 per cent, and the reader is told that the page is posing '
         'as the BBC. The genuine BBC article in the test set is still confirmed.'))
    add(('table', '6', 'Lookalike Publishers Under Name-Based and Address-Based Identity',
         ['Address', 'Identified by name', 'Identified by address'],
         [['bbc-breaking-news.xyz, calling itself “BBC News”', 'BBC News, 9/10',
           'No rating; impersonation flagged'],
          ['bbc-world.com', 'BBC News, 9/10', 'No rating'],
          ['bbc.news-today.com', 'BBC News, 9/10', 'No rating'],
          ['reuters-updates.info, calling itself “Reuters”', 'Reuters, 9.5/10',
           'No rating; impersonation flagged'],
          ['YouTube channel named “Associated Press”, not AP’s own', 'AP, 9.5/10', 'No rating']],
         [2.9, 1.45, 1.9], ['left', 'center', 'center'], None))
    add(('h2', '5.5 Model Routing and Response Time'))
    add(('p', 'Figure 5 shows the median response time per task for the three providers. The local model was faster '
         'on every task, by a factor of 1.7 to 15.5 against the faster of the two hosted services. It was also more '
         'reliable on claim extraction, where hosted replies were valid in 67 and 33 per cent of runs against 100 '
         'per cent locally.'))
    add(('figure', '5', 'Median Time per Call by Task and Provider',
         os.path.join(FIG, 'fig5_latency.png'), 5.2,
         '*Routed to NVIDIA NIM, because the local model missed the known contradiction in all three runs.'))
    add(('p', 'The exception was the premise check. Asked whether an article calling Rahul Gandhi ‘Prime '
         'Minister’ conflicts with his encyclopedia entry, the local model returned well-formed output in 2.4 '
         'seconds reporting no conflict, three times out of three, while both hosted models found the conflict and '
         'quoted the line that settles it. A benchmark that checked only whether replies parsed would have routed '
         'this task locally and silently switched off the premise check, so a task with a known answer must now be '
         'answered correctly before it is moved. With this routing, nine of ten tasks run locally at no cost per '
         'call, and the article text sent to those tasks never leaves the machine.'))
    add(('p', 'In use, the first check reaches the reader 1.47 seconds after an article is opened, because results '
         'stream as they finish, and a cached report returns in 2.7 to 3.4 milliseconds. For comparison, DEFAME '
         'reported about four minutes and thirteen US cents per claim with GPT-4o (Braun et al., 2025). The tasks '
         'differ, so these figures give a sense of scale; they are not a head-to-head result.'))

    # ------------------------------------------------------------------ 6
    add(('h1', '6. Discussion'))
    add(('h2', '6.1 Relation to the Base Paper'))
    add(('p', 'DEFAME and the present system agree on the main point: a verdict on a news claim should rest on '
         'evidence gathered from outside the claim. They differ in what they treat as the hard part. DEFAME '
         'concentrates on gathering evidence across text and images and on reasoning over it with a strong model. '
         'Our system concentrates on what the gathered evidence is allowed to prove: whether two reports are really '
         'two sources, whether the page comes from the outlet it names, whether a presentation signal may count in '
         'a story’s favour, and what to tell the reader when a check fails. The two are complementary. '
         'DEFAME’s image tools could enter our pipeline as further observations, and its verdicts would gain '
         'from the independence and identity checks described here. We did not run DEFAME on our test cases, so '
         'the comparison in this paper concerns design and documented behaviour, not a benchmark result.'))
    add(('h2', '6.2 Implications for Practice and Policy'))
    add(('p', 'For platforms and messaging services, the results suggest that a label is more useful when it carries '
         'its grounds and when the service is willing to abstain. A reader told CANNOT VERIFY, along with the '
         'reason, is better served than one shown a confident number assembled from guesswork.'))
    add(('p', 'For newsrooms and brands, identity read from the address protects reputation as much as it protects '
         'readers. A copycat site trades on the record of the outlet it imitates, and refusing to transfer that '
         'record, while telling the reader why, removes much of the incentive. The same mechanism applies to any '
         'organisation whose name lends credibility, including banks and government departments.'))
    add(('p', 'For regulators and public bodies, the design offers a model of accountable automation. Every verdict '
         'comes with the rule that produced it, the outlets that supported or contradicted the claim, and the '
         'quoted text behind each finding, so a decision can be checked and challenged. The system also declines '
         'to rule on opinion and exhortation, which keeps it a verification aid rather than a censor.'))
    add(('p', 'There is an argument from cost and digital sovereignty as well. Running nine of ten model tasks on a '
         'laptop graphics card removes per-call charges and reduces dependence on foreign hosted services. That '
         'matters for public-interest deployments in countries such as India, where volumes are large and budgets '
         'are not. Support for Indian-language input extends verification to the messaging groups where much misinformation circulates. In these respects, the work supports Sustainable Development Goal 16, '
         'in particular target 16.10 on public access to information.'))
    add(('h2', '6.3 Implications for Research'))
    add(('p', 'The findings support treating misinformation detection as the assessment of adversarial evidence '
         'rather than as ordinary classification. When an adversary writes the features, high accuracy on a '
         'benchmark of crude fabrications says little about performance against a careful one. Calibration where '
         'the system accuses deserves to be reported alongside accuracy, and so does the rate at which a system '
         'abstains.'))

    # ------------------------------------------------------------------ 7
    add(('h1', '7. Limitations and Future Research'))
    add(('p', 'Several limitations bear on how the results should be read. The scoring model was estimated on 239 '
         'articles, so a difference of one article in accuracy is not meaningful, and some bands of the scoring '
         'table remain too thin to estimate. The adversarial set is small and was written by the authors, which '
         'makes it a test of whether the rule behaves as designed. It does not estimate performance in the wild. '
         'It was scored with the deterministic analysers, and a full live run is planned. The publisher priors '
         'and the likelihood ratios for corroboration were set by reasoning about publishing practice, not '
         'estimated from data.'))
    add(('p', 'Corroboration depends on a commercial news index whose free tier allows 100 requests a day, runs about '
         'a day behind and covers local and regional-language reporting unevenly. ISOT consists mainly of United '
         'States political news from 2016 and 2017, so behaviour on current Indian news has not yet been measured. Stance '
         'is judged from headlines and short descriptions, not from full articles, and detecting manipulated '
         'images or synthetic video is outside the present scope.'))
    add(('p', 'Future work follows from these points. A larger estimation corpus would allow the priors to be '
         'measured. A live study in which thirty claims are checked by hand would give the coverage rate and the '
         'precision of verdicts on current news. Ratings for regional-language Indian outlets can be accumulated '
         'from articles the system has already assessed. Natural-language inference over full article text could '
         'replace headline-level stance judgement, and image forensics could be added as one more observation in '
         'the same weighing scheme.'))

    # ------------------------------------------------------------------ 8
    add(('h1', '8. Conclusion'))
    add(('p', 'Fake news detection is not an ordinary classification problem, because the person being detected '
         'writes the features. A detector that rewards good presentation can be satisfied on purpose, and one '
         'trained on crude fabrications learns exactly the habits a careful fabricator avoids. We built a system on '
         'the opposite assumption. Evidence the author controls may raise suspicion but never confers trust. Trust '
         'comes from independent outlets, reference works and a publisher identity read from the web address, and '
         'every weight is a measured likelihood ratio, so the scores add up to a calibrated probability.'))
    add(('p', 'Building on the evidence-first approach of DEFAME, the system matches a hand-weighted baseline’s '
         'accuracy on held-out articles while cutting calibration error on its accusations by 43 per cent. It '
         'presents none of six carefully written fabrications as credible, and it returned an acceptable verdict '
         'in all twelve end-to-end cases across text, links, screenshots, Tamil text and video. It also knows when '
         'it does not know. It declines input with nothing to check, and it keeps a search that failed apart from '
         'a search that found nothing, which is the difference between an honest ‘cannot verify’ and a '
         'false all-clear.'))
    return place(B, MOVES)


# Figures and tables are inline, so one that does not fit at the foot of a page leaves a gap. These moves
# place each one after the text that follows its first mention, where it starts a fresh page cleanly.
MOVES = [
    (('figure', '1'), 'Page extraction needed care'),
    (('figure', '2'), 'A language model extracts up to two'),
    (('figure', '3'), 'Table 4 shows the result on the adversarial set'),
    (('table', '4'), ('figure', '3')),
    (('table', '5'), 'The run also tested failure'),
    (('figure', '4'), ('table', '5')),
]


def place(blocks, moves):
    def find(anchor):
        for k, b in enumerate(blocks):
            if isinstance(anchor, tuple) and b[0] == anchor[0] and b[1] == anchor[1]:
                return k
            if isinstance(anchor, str) and b[0] in ('p', 'p_noindent') and b[1].startswith(anchor):
                return k
        raise KeyError(anchor)
    for item, anchor in moves:
        blk = blocks.pop(find(item))
        blocks.insert(find(anchor) + 1, blk)
    return blocks


DECLARATIONS = [
    ('Acknowledgements', 'The authors thank the Department of Computer Science and Engineering, Kongu Engineering '
     'College, for the facilities provided for this work.'),
    ('Funding', 'This research received no specific grant from any funding agency.'),
    ('Conflict of interest', 'The authors declare that they have no conflict of interest.'),
    ('Data availability', 'The evaluation scripts, test cases and measured results are available from the '
     'corresponding author on reasonable request.'),
]

REFERENCES = [
    'Ahmed, H., Traore, I., & Saad, S. (2017). Detection of online fake news using n-gram analysis and machine '
    'learning techniques. In I. Traore, I. Woungang, & A. Awad (Eds.), <i>Intelligent, secure, and dependable '
    'systems in distributed and cloud environments</i> (pp. 127–138). Springer.',
    'Braun, T., Rothermel, M., Rohrbach, M., & Rohrbach, A. (2025). DEFAME: Dynamic evidence-based fact-checking '
    'with multimodal experts. In <i>Proceedings of the 42nd International Conference on Machine Learning</i> '
    '(Proceedings of Machine Learning Research, Vol. 267). PMLR.',
    'Chen, C., & Shu, K. (2024). Can LLM-generated misinformation be detected? In <i>Proceedings of the Twelfth '
    'International Conference on Learning Representations</i>. ICLR.',
    'Chow, C. K. (1970). On optimum recognition error and reject tradeoff. <i>IEEE Transactions on Information '
    'Theory, 16</i>(1), 41–46. https://doi.org/10.1109/TIT.1970.1054406',
    'Da San Martino, G., Barrón-Cedeño, A., Wachsmuth, H., Petrov, R., & Nakov, P. (2020). SemEval-2020 '
    'Task 11: Detection of propaganda techniques in news articles. In <i>Proceedings of the Fourteenth Workshop on '
    'Semantic Evaluation</i> (pp. 1377–1414). International Committee for Computational Linguistics. '
    'https://doi.org/10.18653/v1/2020.semeval-1.186',
    'Geifman, Y., & El-Yaniv, R. (2017). Selective classification for deep neural networks. In <i>Advances in '
    'Neural Information Processing Systems</i> (Vol. 30, pp. 4878–4887). Curran Associates.',
    'Good, I. J. (1950). <i>Probability and the weighing of evidence</i>. Charles Griffin.',
    'Guo, C., Pleiss, G., Sun, Y., & Weinberger, K. Q. (2017). On calibration of modern neural networks. In '
    '<i>Proceedings of the 34th International Conference on Machine Learning</i> (Proceedings of Machine Learning '
    'Research, Vol. 70, pp. 1321–1330). PMLR.',
    'Guo, Z., Schlichtkrull, M., & Vlachos, A. (2022). A survey on automated fact-checking. <i>Transactions of the '
    'Association for Computational Linguistics, 10</i>, 178–206. https://doi.org/10.1162/tacl_a_00454',
    'Hu, B., Sheng, Q., Cao, J., Shi, Y., Li, Y., Wang, D., & Qi, P. (2024). Bad actor, good advisor: Exploring the '
    'role of large language models in fake news detection. <i>Proceedings of the AAAI Conference on Artificial '
    'Intelligence, 38</i>(20), 22105–22113. https://doi.org/10.1609/aaai.v38i20.30214',
    'Jeffreys, H. (1961). <i>Theory of probability</i> (3rd ed.). Clarendon Press.',
    'Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D. G., & Pennycook, G. (2023). High level of '
    'correspondence across different news domain quality rating sets. <i>PNAS Nexus, 2</i>(9), Article pgad286. '
    'https://doi.org/10.1093/pnasnexus/pgad286',
    'Pennycook, G., & Rand, D. G. (2019). Fighting misinformation on social media using crowdsourced judgments of '
    'news source quality. <i>Proceedings of the National Academy of Sciences, 116</i>(7), 2521–2526. '
    'https://doi.org/10.1073/pnas.1806781116',
    'Schlichtkrull, M., Guo, Z., & Vlachos, A. (2023). AVeriTeC: A dataset for real-world claim verification with '
    'evidence from the web. In <i>Advances in Neural Information Processing Systems</i> (Vol. 36, Datasets and '
    'Benchmarks Track). Curran Associates.',
    'Shu, K., Cui, L., Wang, S., Lee, D., & Liu, H. (2019). dEFEND: Explainable fake news detection. In '
    '<i>Proceedings of the 25th ACM SIGKDD International Conference on Knowledge Discovery and Data Mining</i> '
    '(pp. 395–405). ACM. https://doi.org/10.1145/3292500.3330935',
    'Thorne, J., Vlachos, A., Christodoulopoulos, C., & Mittal, A. (2018). FEVER: A large-scale dataset for fact '
    'extraction and VERification. In <i>Proceedings of the 2018 Conference of the North American Chapter of the '
    'Association for Computational Linguistics: Human Language Technologies</i> (Vol. 1, pp. 809–819). '
    'Association for Computational Linguistics. https://doi.org/10.18653/v1/N18-1074',
    'Verma, Y. (2026). <i>What does 99% accuracy measure? A reproducible audit of shortcut learning in a widely used '
    'fake news corpus</i> (arXiv:2609.25006). arXiv. https://arxiv.org/abs/2609.25006',
    'Vosoughi, S., Roy, D., & Aral, S. (2018). The spread of true and false news online. <i>Science, 359</i>(6380), '
    '1146–1151. https://doi.org/10.1126/science.aap9559',
    'Wang, B., Ma, J., Lin, H., Yang, Z., Yang, R., Tian, Y., & Chang, Y. (2024). Explainable fake news detection '
    'with large language model via defense among competing wisdom. In <i>Proceedings of the ACM Web Conference '
    '2024</i> (pp. 2452–2463). ACM.',
    'World Economic Forum. (2026). <i>Global risks report 2026</i>. '
    'https://www.weforum.org/publications/global-risks-report-2026/',
    'Zadrozny, B., & Elkan, C. (2002). Transforming classifier scores into accurate multiclass probability '
    'estimates. In <i>Proceedings of the Eighth ACM SIGKDD International Conference on Knowledge Discovery and Data '
    'Mining</i> (pp. 694–699). ACM. https://doi.org/10.1145/775047.775151',
]
