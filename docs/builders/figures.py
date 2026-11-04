"""Diagrams and charts for the project report. Every figure is drawn at its printed size."""
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'report', 'figs')
os.makedirs(OUT, exist_ok=True)
BACKEND = os.path.join(HERE, '..', '..', 'backend')

plt.rcParams.update({
    'font.family': 'Times New Roman', 'font.size': 10, 'axes.titlesize': 10.5,
    'axes.labelsize': 10, 'xtick.labelsize': 9, 'ytick.labelsize': 9, 'legend.fontsize': 9,
    'axes.edgecolor': '#333333', 'axes.linewidth': 0.7, 'savefig.dpi': 300, 'mathtext.fontset': 'stix',
})

INK = '#000000'
NAVY = '#404040'
BLUE_FILL = '#ffffff'
GREEN_FILL = '#ffffff'
AMBER_FILL = '#ffffff'
RED_FILL = '#ffffff'
GREY_FILL = '#ffffff'
BLUE = '#555555'
GREEN = '#1a1a1a'
RED = '#000000'
GREY = '#8a8a8a'


def save(fig, name):
    path = os.path.join(OUT, name + '.png')
    fig.savefig(path, bbox_inches='tight', pad_inches=0.04, facecolor='white')
    plt.close(fig)
    # Trim the white margin left by full-figure drawing canvases, keeping a
    # small even border so every figure sits the same way on the page.
    from PIL import Image, ImageChops
    im = Image.open(path).convert('RGB')
    diff = ImageChops.difference(im, Image.new('RGB', im.size, 'white'))
    bbox = diff.getbbox()
    if bbox:
        pad = 18
        im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))).save(path, dpi=(300, 300))
    print('saved', name)


def canvas(w_in, h_in):
    fig = plt.figure(figsize=(w_in, h_in))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, w_in)
    ax.set_ylim(0, h_in)
    ax.axis('off')
    return fig, ax


def box(ax, cx, cy, w, h, text, fc=BLUE_FILL, ec=NAVY, size=9.5, weight='normal', lw=0.9, style='round,pad=0.02,rounding_size=0.06'):
    ax.add_patch(FancyBboxPatch((cx - w / 2, cy - h / 2), w, h, boxstyle=style, fc=fc, ec=ec, lw=lw))
    ax.text(cx, cy, text, ha='center', va='center', fontsize=size, weight=weight, color=INK, linespacing=1.25)
    return (cx, cy, w, h)


def arrow(ax, x1, y1, x2, y2, color=INK, lw=0.9, style='-|>', ms=8, ls='-'):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=ms, color=color, lw=lw, linestyle=ls,
                                 shrinkA=0, shrinkB=0))


def elbow(ax, pts, color=INK, lw=0.9):
    """Polyline whose last segment ends in an arrowhead."""
    for (x1, y1), (x2, y2) in zip(pts[:-2], pts[1:-1]):
        ax.plot([x1, x2], [y1, y2], color=color, lw=lw, solid_capstyle='butt')
    arrow(ax, *pts[-2], *pts[-1], color=color, lw=lw)


# --------------------------------------------------------------------------- Fig 1.1
def fig_evidence_split():
    fig, ax = canvas(6.0, 3.15)
    box(ax, 1.5, 2.88, 2.7, 0.36, 'Chosen by the author', fc=AMBER_FILL, ec='#333333', weight='bold', size=10)
    box(ax, 4.5, 2.88, 2.7, 0.36, 'Outside the author\u2019s control', fc=GREEN_FILL, ec=GREEN, weight='bold', size=10)
    left = ['Headline wording', 'Tone and language', 'Persuasion techniques', 'How sources are attributed',
            'The site\u2019s own name']
    right = ['Coverage by independent outlets', 'Reference work (refutes premises)',
             'Publisher\u2019s web address and record', 'Domain registration age']
    for i, t in enumerate(left):
        box(ax, 1.5, 2.38 - i * 0.36, 2.5, 0.28, t, fc='white', ec='#555555', size=9)
    for i, t in enumerate(right):
        box(ax, 4.5, 2.38 - i * 0.36, 2.5, 0.28, t, fc='white', ec='#555555', size=9)
    box(ax, 1.5, 0.3, 2.7, 0.42, 'May count against a story,\nnever in its favour', fc=RED_FILL, ec=RED, size=9.5)
    box(ax, 4.5, 0.3, 2.7, 0.42, 'May count for or against\n(young domains count only against)', fc=GREEN_FILL, ec=GREEN, size=9.5)
    arrow(ax, 1.5, 0.84, 1.5, 0.53)
    arrow(ax, 4.5, 1.2, 4.5, 0.53)
    ax.plot([3.0, 3.0], [0.1, 3.08], color='#9a9a9a', lw=0.7, ls=(0, (4, 3)))
    save(fig, 'fig_1_1_evidence_split')


# --------------------------------------------------------------------------- Fig 4.1
def fig_proposed_approach():
    fig, ax = canvas(6.2, 7.6)
    cx = 3.1
    inputs = ['Article link', 'Pasted text', 'Screenshot', 'YouTube video']
    for i, t in enumerate(inputs):
        box(ax, 0.95 + i * 1.43, 7.3, 1.25, 0.36, t, fc=GREY_FILL, ec='#555555', size=9)
        elbow(ax, [(0.95 + i * 1.43, 7.12), (0.95 + i * 1.43, 6.98), (cx, 6.98), (cx, 6.86)])
    box(ax, cx, 6.62, 3.6, 0.46, 'Ingestion\narticle reader \u00b7 OCR \u00b7 video transcript', size=9.5)
    arrow(ax, cx, 6.39, cx, 6.13)
    box(ax, cx, 5.88, 3.3, 0.48, 'Reading the message\nlanguage \u00b7 kind of message \u00b7 claims', fc=AMBER_FILL, ec='#333333', size=9.5)
    box(ax, 5.62, 5.88, 1.05, 0.48, 'Refusal, with\nthe reason', fc=RED_FILL, ec=RED, size=8.8)
    arrow(ax, cx + 1.65, 5.88, 5.09, 5.88)
    ax.text((cx + 1.65 + 5.09) / 2, 5.95, 'none', fontsize=8.5, ha='center', va='bottom', style='italic')
    arrow(ax, cx, 5.64, cx, 5.38)
    box(ax, cx, 5.14, 3.9, 0.46, 'Claims in English\nup to three, with time frame, subjects and search terms', size=9.3)
    xs = [0.66, 1.88, 3.1, 4.32, 5.54]
    for x in xs:
        elbow(ax, [(cx, 4.91), (cx, 4.72), (x, 4.72), (x, 4.56)])
    chans = [('News reporting', 'news search\nrelevance gate\nindependent\nsources\nstance'),
             ('Fact-checkers', 'published\nrulings on the\nsame claim'),
             ('This week', 'subject\u2019s news\nthat rules the\nclaim out'),
             ('Reference', 'premises\nand standing\nfacts'),
             ('Writing', 'headline\nlanguage\npersuasion\ntransparency')]
    for x, (head, body) in zip(xs, chans):
        fc = AMBER_FILL if head == 'Writing' else GREEN_FILL
        ec = '#333333' if head == 'Writing' else GREEN
        ax.add_patch(FancyBboxPatch((x - 0.56, 3.28), 1.12, 1.28, boxstyle='round,pad=0.02,rounding_size=0.06', fc=fc, ec=ec, lw=0.9))
        ax.text(x, 4.38, head, ha='center', va='center', fontsize=8.9, weight='bold')
        ax.text(x, 4.2, body, ha='center', va='top', fontsize=8.2, linespacing=1.25)
        elbow(ax, [(x, 3.28), (x, 3.1), (cx, 3.1), (cx, 2.98)])
    box(ax, cx, 2.68, 4.2, 0.56, 'Weight of evidence\nlog-odds sum \u00b7 one-sided rule \u00b7 calibration', size=9.5)
    arrow(ax, cx, 2.4, cx, 2.14)
    box(ax, cx, 1.88, 4.2, 0.48, 'Verdict rules\nan ordered rule set states which rule fired', size=9.5)
    arrow(ax, cx, 1.64, cx, 1.38)
    box(ax, cx, 1.02, 5.6, 0.68, 'Report\nREAL \u00b7 FAKE \u00b7 PARTLY FALSE \u00b7 CANNOT VERIFY, with the evidence, the rule\nthat decided it, the probability of fabrication and the writing checks apart', fc=BLUE_FILL, ec=NAVY, size=9.3)
    save(fig, 'fig_4_1_proposed_approach')


# --------------------------------------------------------------------------- Fig 4.2
def fig_architecture():
    fig, ax = canvas(6.3, 6.6)
    def band(y, h, title, fc, ec):
        ax.add_patch(FancyBboxPatch((0.08, y), 4.62, h, boxstyle='round,pad=0.02,rounding_size=0.05', fc=fc, ec=ec, lw=0.9))
        ax.text(0.2, y + h - 0.16, title, fontsize=9.5, weight='bold', va='center')
    band(5.25, 1.25, 'Presentation layer: React single-page application', BLUE_FILL, NAVY)
    pages = ['Landing', 'Front page', 'Article', 'Check Anything', 'Compare', 'Dashboard']
    for i, p in enumerate(pages):
        box(ax, 0.86 + (i % 3) * 1.5, 5.88 - (i // 3) * 0.42, 1.38, 0.3, p, fc='white', ec='#555555', size=8.8)
    band(4.0, 0.95, 'Application layer: Node.js and Express', GREY_FILL, '#555555')
    for i, p in enumerate(['Accounts (JWT)', 'Analysis API', 'News, history, profile']):
        box(ax, 0.86 + i * 1.5, 4.32, 1.38, 0.32, p, fc='white', ec='#888888', size=8.8)
    band(1.85, 1.9, 'Analysis agents', GREEN_FILL, GREEN)
    agents = ['Ingestion', 'Reading the message', 'Claim extraction', 'Corroboration', 'Independence', 'Fact-check rulings',
              'This week’s coverage', 'Premise check', 'Publisher identity', 'Writing checks', 'Weight of evidence', 'Verdict engine']
    for i, a in enumerate(agents):
        r, c = divmod(i, 3)
        box(ax, 0.86 + c * 1.5, 3.25 - r * 0.36, 1.38, 0.28, a, fc='white', ec='#555555', size=8.3)
    band(0.95, 0.72, 'Language-model gateway: task routing', AMBER_FILL, '#333333')
    for i, p in enumerate(['Ollama (local)', 'NVIDIA NIM', 'Google Gemini']):
        box(ax, 0.86 + i * 1.5, 1.17, 1.38, 0.29, p, fc='white', ec='#555555', size=8.6)
    box(ax, 2.39, 0.33, 4.62, 0.42, 'MongoDB: users, reading history, activity, report and summary caches', fc=GREY_FILL, ec='#555555', size=8.8)
    for y1, y2 in [(5.25, 4.95), (4.0, 3.75), (1.85, 1.67), (0.95, 0.54)]:
        arrow(ax, 2.39, y1, 2.39, y2, style='<|-|>')
    ax.add_patch(FancyBboxPatch((5.0, 1.0), 1.22, 4.3, boxstyle='round,pad=0.02,rounding_size=0.05', fc='white', ec='#555555', lw=0.9))
    ax.text(5.61, 5.08, 'External\nservices', ha='center', va='center', fontsize=9.5, weight='bold', linespacing=1.15)
    for i, s in enumerate(['Google News\n(NewsAPI)', 'Fact Check\nindex', 'Wikipedia', 'RDAP ·\nYouTube', 'Publisher\npages']):
        box(ax, 5.61, 4.45 - i * 0.74, 1.04, 0.5, s, fc=GREY_FILL, ec='#888888', size=8.5)
    arrow(ax, 4.7, 2.8, 5.0, 2.8, style='<|-|>')
    save(fig, 'fig_4_2_architecture')


# --------------------------------------------------------------------------- Fig 4.3
def fig_corroboration():
    fig, ax = canvas(6.3, 2.55)
    steps = [('Claim and\nsearch terms', BLUE_FILL, NAVY), ('News\nsearch', GREY_FILL, '#555555'),
             ('Relevance\ngate', AMBER_FILL, '#333333'), ('Independence\nanalysis', GREEN_FILL, GREEN),
             ('Stance\njudgement', BLUE_FILL, NAVY)]
    xs = [0.6, 1.88, 3.16, 4.44, 5.72]
    for x, (t, fc, ec) in zip(xs, steps):
        box(ax, x, 2.2, 1.08, 0.62, t, fc=fc, ec=ec, size=9.2)
    for a, b in zip(xs[:-1], xs[1:]):
        arrow(ax, a + 0.54, 2.2, b - 0.54, 2.2)
    notes = ['up to three claims;\nEnglish terms for\nother languages', 'Google News live;\nsentence, headline\nand competing figures',
             'evidence must share\na name, place or\nfigure with the claim', 'owners, wire copy,\nnear-duplicates and\nstate media merged',
             'headline by headline,\nthe reported words\nquoted and checked']
    for x, n in zip(xs, notes):
        ax.text(x, 1.78, n, ha='center', va='top', fontsize=8.4, linespacing=1.25, color='#333333')
    box(ax, 3.16, 0.62, 5.6, 0.4, 'A search that could not run is reported as "could not verify", never as "no outlet reports this"',
        fc=RED_FILL, ec=RED, size=8.8)
    save(fig, 'fig_4_3_corroboration')


# --------------------------------------------------------------------------- Fig 4.4
def fig_scoring():
    fig, ax = canvas(6.3, 4.3)
    box(ax, 1.15, 3.85, 2.0, 0.5, 'Prior from provenance\n(publisher band)', fc=GREEN_FILL, ec=GREEN, size=9.2)
    box(ax, 3.15, 3.85, 1.7, 0.5, 'Writing checks\n(four scores)', fc=AMBER_FILL, ec='#333333', size=9.2)
    box(ax, 5.25, 3.85, 1.8, 0.5, 'Corroboration\noutcome', fc=GREEN_FILL, ec=GREEN, size=9.2)
    box(ax, 3.15, 3.05, 1.7, 0.46, 'Likelihood ratio\nper bin, in decibans', size=9.0)
    box(ax, 3.15, 2.3, 1.7, 0.46, 'One-sided rule\nW\u2020 = max(0, W)', fc=RED_FILL, ec=RED, size=9.0)
    box(ax, 3.15, 1.55, 1.7, 0.46, 'Correlation damping\n' + r'$\times\,n_{\mathrm{eff}}\,/\,k = 0.379$', size=9.0)
    box(ax, 5.25, 2.3, 1.8, 0.46, 'Declared likelihood\nratios', size=9.0)
    arrow(ax, 3.15, 3.6, 3.15, 3.28)
    arrow(ax, 3.15, 2.82, 3.15, 2.53)
    arrow(ax, 3.15, 2.07, 3.15, 1.78)
    arrow(ax, 5.25, 3.6, 5.25, 2.53)
    box(ax, 3.15, 0.78, 6.0, 0.42, 'logit P = logit \u03c0  +  \u03a3 W  \u2192  isotonic calibration  \u2192  one-sided rule re-applied  \u2192  P(fabricated)',
        fc=BLUE_FILL, ec=NAVY, size=9.0)
    elbow(ax, [(1.15, 3.6), (1.15, 1.2), (1.15, 1.0)])
    arrow(ax, 3.15, 1.32, 3.15, 1.0)
    elbow(ax, [(5.25, 2.07), (5.25, 1.2), (5.25, 1.0)])
    ax.text(3.15, 0.36, 'Each row of the sum is shown to the reader, so the probability can be checked by hand.',
            ha='center', fontsize=8.6, style='italic', color='#333333')
    save(fig, 'fig_4_4_scoring')


# --------------------------------------------------------------------------- Fig 4.5
def fig_verdict_rules():
    # In the order verdictEngine.decideVerdict applies them; the first that
    # matches decides.
    rules = [
        ('Publisher is a known satirical outlet', 'SATIRE', GREY_FILL),
        ('Fact-checkers rated this same claim false or misleading', 'FAKE', RED_FILL),
        ('One claim confirmed, another contradicted', 'PARTLY FALSE', RED_FILL),
        ('Two or more independent sources contradict it', 'FAKE (false)', RED_FILL),
        ('One independent source contradicts it', 'FAKE (likely false)', RED_FILL),
        ('A reference work contradicts a premise', 'FAKE (likely false)', RED_FILL),
        ('Fact-checkers rated it true', 'REAL (likely true)', GREEN_FILL),
        ('Search could not run, or the story is too recent', 'CANNOT VERIFY', AMBER_FILL),
        ('No checkable claim', 'NOT A FACTUAL CLAIM', GREY_FILL),
        ('Confirmed only by coverage weeks old, claimed as new', 'FAKE (old news)', RED_FILL),
        ('A confirmed claim carrying an unreported one', 'PARTLY FALSE / CANNOT VERIFY', AMBER_FILL),
        ('Two or more independent sources support it', 'REAL (confirmed)', GREEN_FILL),
        ('One independent source supports it', 'REAL (likely true)', GREEN_FILL),
        ('A reference work states a standing fact', 'REAL (likely true)', GREEN_FILL),
        ('This week’s news on the subject rules it out', 'FAKE (likely false)', RED_FILL),
        ('A dominant event missing from heavy coverage', 'FAKE (likely false)', RED_FILL),
        ('High-impact claim with three or more warning signs', 'FAKE (likely false)', RED_FILL),
        ('Otherwise: nothing independent found either way', 'CANNOT VERIFY', AMBER_FILL),
    ]
    h = 0.36
    fig, ax = canvas(6.3, len(rules) * h + 0.25)
    for i, (cond, call, fc) in enumerate(rules):
        y = len(rules) * h + 0.05 - (i + 0.5) * h
        box(ax, 0.3, y, 0.42, 0.26, f'R{i + 1}', fc='white', ec='#555555', size=8.4, weight='bold')
        box(ax, 2.3, y, 3.36, 0.26, cond, fc='white', ec='#888888', size=8.4)
        box(ax, 5.22, y, 1.92, 0.26, call, fc=fc, ec='#666666', size=8.0, weight='bold')
        arrow(ax, 3.98, y, 4.26, y)
        if i < len(rules) - 1:
            arrow(ax, 0.3, y - 0.13, 0.3, y - h + 0.13, color='#555555')
    save(fig, 'fig_4_5_verdict_rules')


# --------------------------------------------------------------------------- Fig 4.6
def fig_routing():
    fig, ax = canvas(6.3, 3.5)
    box(ax, 1.08, 2.85, 2.0, 0.92, 'Eight tasks, measured\nclickbait \u00b7 bias\npersuasion \u00b7 transparency\nsummaries \u00b7 English claims\nsearch keywords', fc=BLUE_FILL, ec=NAVY, size=8.3)
    box(ax, 5.25, 2.85, 2.0, 0.92, 'Eight judgements, by hand\npremise check \u00b7 stance\nreading the message\nfact-check match \u00b7 this week\nnon-English claims \u00b7 translation\nclaim matching', fc=AMBER_FILL, ec='#333333', size=7.7)
    box(ax, 3.18, 2.85, 1.7, 0.92, 'Premise check on the\nlocal model: 0 of 3\ncorrect, so moved\nto the judgements', fc=GREY_FILL, ec='#555555', size=7.9)
    box(ax, 1.08, 1.55, 2.0, 0.55, 'Ollama, local\nllama3.1:8b', fc=GREEN_FILL, ec=GREEN, size=8.8)
    box(ax, 3.18, 1.55, 1.7, 0.55, 'NVIDIA NIM\nnext provider', fc=GREEN_FILL, ec=GREEN, size=8.8)
    box(ax, 5.25, 1.55, 2.0, 0.55, 'Google Gemini\nsix models, own quotas', fc=GREEN_FILL, ec=GREEN, size=8.8)
    box(ax, 3.18, 0.38, 5.4, 0.48, 'On failure: the next model, then the next provider; a model whose daily quota is spent\nis skipped until it resets. The deployed server has no local model, so the eight measured tasks start at NIM', fc=GREY_FILL, ec='#555555', size=7.9)
    arrow(ax, 4.03, 2.85, 4.25, 2.85)
    for x in (1.08, 5.25):
        arrow(ax, x, 2.39, x, 1.83)
    arrow(ax, 2.08, 1.55, 2.33, 1.55)
    arrow(ax, 4.25, 1.55, 4.03, 1.55)
    arrow(ax, 3.18, 1.27, 3.18, 0.62)
    save(fig, 'fig_4_6_routing')


# --------------------------------------------------------------------------- new charts (Oct 2026)
EVAL = os.path.join(BACKEND, 'eval', 'results')


def _load(name):
    path = os.path.join(EVAL, name)
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else None


def chart_robustness():
    """Right / acceptable / missed / wrong, before and after reading the message, and on held-out cases."""
    runs = [('Robustness suite,\nbefore', _load('robustness_before.json')),
            ('Robustness suite,\nafter', _load('robustness_final.json') or _load('robustness_after.json')),
            ('Held-out cases,\nfirst run', _load('robustness_heldout.json')),
            ('Held-out cases,\nafter fixes', _load('robustness_heldout_final.json'))]
    runs = [(label, r) for label, r in runs if r]

    def tally(rows):
        out = {'right': 0, 'safe': 0, 'missed': 0, 'wrong': 0}
        abst = {'CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR'}
        for r in rows:
            if r['call'] == r['expected']:
                out['right'] += 1
            elif r['call'] in (r.get('alsoAcceptable') or []):
                out['safe'] += 1
            elif r['call'] in abst:
                out['missed'] += 1
            else:
                out['wrong'] += 1
        return out

    fig, ax = plt.subplots(figsize=(6.2, 2.7))
    parts = [('right', 'Right', '#3a3a3a', None), ('safe', 'Acceptable abstention', '#9a9a9a', None),
             ('missed', 'Missed (no verdict)', '#ffffff', '...'), ('wrong', 'Wrong verdict', '#ffffff', '////')]
    for i, (label, data) in enumerate(runs):
        t = tally(data['rows'])
        n = sum(t.values())
        left = 0
        for key, name, color, hatch in parts:
            share = 100 * t[key] / n
            ax.barh(i, share, left=left, color=color, edgecolor='#222222', hatch=hatch, lw=0.6,
                    label=name if i == 0 else None)
            if t[key]:
                ax.text(left + share / 2, i, str(t[key]), ha='center', va='center', fontsize=8.5,
                        color='white' if key == 'right' else 'black')
            left += share
        ax.text(101, i, f'of {n}', va='center', fontsize=8.5)
    ax.set_yticks(range(len(runs)))
    ax.set_yticklabels([r[0] for r in runs])
    ax.invert_yaxis()
    ax.set_xlim(0, 108)
    ax.set_xlabel('Share of cases (%)')
    ax.legend(loc='lower center', bbox_to_anchor=(0.45, -0.62), ncol=4, frameon=False, fontsize=8.3)
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.tight_layout()
    save(fig, 'fig_5_7_robustness')


def sealed_runs():
    """The complete sealed runs, in order (eval/results/sealed_runs.jsonl)."""
    path = os.path.join(EVAL, 'sealed_runs.jsonl')
    runs = [json.loads(line) for line in open(path, encoding='utf-8') if line.strip()]
    return [r for r in runs if r.get('complete')]


def chart_rulings():
    """Outcomes on fact-checked rulings: development, and the two complete sealed runs."""
    dev = _load('robustness_rulings_dev_rc2.json')['summary']['overall']
    sealed = {r['release']: r['overall'] for r in sealed_runs()}
    runs = [('Development, rulings\n1–120, final code', dev),
            ('Sealed, rulings 121–320,\nfirst candidate', sealed['sealed_rc1']),
            ('Sealed, rulings 121–320,\nfinal code', sealed['sealed_rc2'])]
    fig, ax = plt.subplots(figsize=(6.2, 2.7))
    parts = [('right', 'Desk’s verdict', '#3a3a3a', None), ('safe', 'Acceptable verdict', '#9a9a9a', None),
             ('missed', 'Missed (no verdict)', '#ffffff', '...'), ('wrong', 'Wrong verdict', '#ffffff', '////')]
    for i, (label, t) in enumerate(runs):
        n = t['n']
        left = 0
        for key, name, color, hatch in parts:
            share = 100 * t[key] / n
            ax.barh(i, share, left=left, color=color, edgecolor='#222222', hatch=hatch, lw=0.6,
                    label=name if i == 0 else None)
            if t[key]:
                ax.text(left + share / 2, i, str(t[key]), ha='center', va='center', fontsize=8.5,
                        color='white' if key == 'right' else 'black')
            left += share
        ax.text(101, i, f'of {n}', va='center', fontsize=8.5)
    ax.set_yticks(range(len(runs)))
    ax.set_yticklabels([r[0] for r in runs])
    ax.invert_yaxis()
    ax.set_xlim(0, 108)
    ax.set_xlabel('Share of rulings (%)')
    ax.legend(loc='upper center', bbox_to_anchor=(0.45, -0.3), ncol=4, frameon=False, fontsize=8.3)
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.tight_layout()
    save(fig, 'fig_5_22_rulings')


def chart_plain_model():
    data = _load('checkAnything_benchmark.json')
    if not data:
        return
    kinds = ['figure', 'outcome', 'rumour', 'invented', 'premise', 'true']
    names = ['Wrong\nfigure', 'Reversed\noutcome', 'Viral\nrumour', 'Invented\nevent', 'False\npremise', 'True\nreport']
    rows = data['rows']
    n = [sum(1 for r in rows if r['kind'] == k) for k in kinds]
    right = lambda who, k: sum(1 for r in rows if r['kind'] == k and r[who]['call'] == ('REAL' if r['truth'] else 'FAKE'))
    plain = [right('plain', k) for k in kinds]
    ours = [right('ours', k) for k in kinds]
    fig, ax = plt.subplots(figsize=(6.2, 2.8))
    x = range(len(kinds))
    ax.bar([i - 0.19 for i in x], plain, 0.36, color='#ffffff', edgecolor='#222222', hatch='////', lw=0.6, label='Plain model, no evidence')
    ax.bar([i + 0.19 for i in x], ours, 0.36, color='#3a3a3a', edgecolor='#222222', lw=0.6, label='Check Anything')
    for i in x:
        ax.text(i, n[i] + 0.25, f'of {n[i]}', ha='center', fontsize=8.3)
    ax.set_xticks(list(x))
    ax.set_xticklabels(names)
    ax.set_ylabel('Claims answered correctly')
    ax.set_ylim(0, max(n) + 1.3)
    ax.legend(frameon=False, fontsize=8.5, loc='upper left')
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.tight_layout()
    save(fig, 'fig_5_8_plain_model')


# --------------------------------------------------------------------------- charts
def chart_confusion():
    fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.75))
    data = [('Hand-weighted baseline', [[55, 2], [3, 60]]), ('Proposed (as deployed)', [[55, 2], [4, 59]])]
    for ax, (title, m) in zip(axes, data):
        ax.imshow([[1, 0], [0, 1]], cmap=matplotlib.colors.ListedColormap(['#ffffff', '#ffffff']), vmin=0, vmax=1)
        for i in range(2):
            for j in range(2):
                ax.text(j, i, str(m[i][j]), ha='center', va='center', fontsize=13, weight='bold', color=INK)
        ax.set_xticks([0, 1], ['Genuine', 'Fabricated'])
        ax.set_yticks([0, 1], ['Genuine', 'Fabricated'])
        ax.set_xlabel('Predicted')
        ax.set_ylabel('Actual')
        ax.set_title(title, weight='bold')
        for s in ax.spines.values():
            s.set_visible(True)
    fig.tight_layout(w_pad=2.5)
    save(fig, 'fig_5_1_confusion')


def chart_metrics():
    fig, axes = plt.subplots(1, 2, figsize=(6.3, 2.95))
    legacy_hi = [0.958, 0.958, 0.978, 0.968]
    ours_hi = [0.950, 0.950, 0.951, 0.967]
    labels_hi = ['Accuracy', 'Macro-F1', 'ROC-AUC', 'Precision\n(accusing)']
    legacy_lo = [0.237, 0.267, 0.101]
    ours_lo = [0.246, 0.152, 0.117]
    labels_lo = ['ECE', 'ECE\n(accusing)', 'Brier']
    for ax, lab, a, b, title, ylim in [(axes[0], labels_hi, legacy_hi, ours_hi, 'Higher is better', (0.8, 1.04)),
                                        (axes[1], labels_lo, legacy_lo, ours_lo, 'Lower is better', (0, 0.34))]:
        x = range(len(lab))
        w = 0.4
        b1 = ax.bar([i - w / 2 for i in x], a, w, color='#ffffff', edgecolor='#000000', lw=0.6, label='Hand-weighted baseline')
        b2 = ax.bar([i + w / 2 for i in x], b, w, color=NAVY, edgecolor=NAVY, lw=0.6, label='Proposed (as deployed)')
        for bars in (b1, b2):
            for r in bars:
                ax.text(r.get_x() + r.get_width() / 2, r.get_height() + (ylim[1] - ylim[0]) * 0.015, f'{r.get_height():.3f}',
                        ha='center', va='bottom', fontsize=6.9, rotation=90)
        ax.set_xticks(list(x), lab)
        ax.set_ylim(*ylim)
        ax.set_title(title, weight='bold')
        ax.spines[['top', 'right']].set_visible(False)
        ax.set_axisbelow(True)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='lower center', ncol=2, frameon=False, fontsize=8.6, bbox_to_anchor=(0.5, -0.01))
    fig.tight_layout(w_pad=2, rect=(0, 0.07, 1, 1))
    save(fig, 'fig_5_2_metrics')


def chart_reliability():
    r = json.load(open(os.path.join(BACKEND, 'eval', 'results', 'scoring-validation.json')))
    fig, ax = plt.subplots(figsize=(4.6, 3.6))
    ax.plot([0, 1], [0, 1], color='#999999', lw=0.8, ls='--', label='Perfect calibration')
    for key, label, color, marker in [('legacyWeightedSum', 'Hand-weighted baseline', '#8c8c8c', 'o'),
                                      ('productionPath', 'Proposed (as deployed)', NAVY, 's')]:
        rel = r[key]['reliability']
        xs = [b['stated'] for b in rel]
        ys = [b['observed'] for b in rel]
        ns = [b['n'] for b in rel]
        ax.plot(xs, ys, color=color, lw=1.0)
        ax.scatter(xs, ys, s=[18 + n * 2.2 for n in ns], color=color, edgecolor='#1a1a1a', lw=0.5, marker=marker, label=label, zorder=3)
    ax.set_xlabel('Stated probability of fabrication')
    ax.set_ylabel('Observed rate of fabrication')
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.03, 1.05)
    ax.spines[['top', 'right']].set_visible(False)
    ax.legend(loc='upper left', frameon=False, fontsize=8.4, markerscale=0.6)
    ax.text(0.98, 0.06, 'larger marker = more articles in that band', ha='right', fontsize=8, style='italic', transform=ax.transAxes)
    fig.tight_layout()
    save(fig, 'fig_5_3_reliability')


def chart_adversarial():
    items = ['fab-01', 'fab-02', 'fab-03', 'fab-04', 'fab-05', 'real-01', 'real-02', 'satire', 'opinion', 'low-qual.']
    legacy = [8.5, 8.0, 8.0, 3.8, 8.0, 8.9, 8.8, 5.8, 7.4, 4.2]
    ours = [4.9, 4.9, 4.9, 4.9, 4.9, 4.9, 4.9, 4.0, 4.9, 4.9]
    fig, ax = plt.subplots(figsize=(6.2, 2.8))
    x = range(len(items))
    w = 0.38
    ax.bar([i - w / 2 for i in x], legacy, w, color='#ffffff', edgecolor='#000000', lw=0.5, label='Hand-weighted baseline')
    ax.bar([i + w / 2 for i in x], ours, w, color=NAVY, edgecolor='#1a1a1a', lw=0.5, label='Proposed (offline: no corroboration)')
    ax.axhline(7.5, color=RED, lw=0.9, ls='--')
    ax.text(9.6, 7.62, 'reads as trustworthy (7.5)', color=RED, fontsize=8.2, ha='right')
    ax.set_xticks(list(x), items)
    ax.set_ylabel('Score out of 10')
    ax.set_ylim(0, 10)
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_axisbelow(True)
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.13), ncol=2, frameon=False, fontsize=8.6)
    fig.tight_layout()
    save(fig, 'fig_5_4_adversarial')


def chart_latency():
    t = json.load(open(os.path.join(BACKEND, 'data', 'taskRouting.json')))
    order = ['coverage keywords', 'summary', 'detailed summary', 'stance judgement', 'claim extraction', 'clickbait',
             'transparency', 'premise check', 'manipulation', 'bias']
    names = {'coverage keywords': 'Search\nkeywords', 'summary': 'Summary', 'detailed summary': 'Detailed\nsummary',
             'stance judgement': 'Stance', 'claim extraction': 'Claim\nextraction', 'clickbait': 'Clickbait',
             'transparency': 'Transpa-\nrency', 'premise check': 'Premise\ncheck', 'manipulation': 'Persua-\nsion', 'bias': 'Bias'}
    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    w = 0.27
    for k, (prov, label, color) in enumerate([('ollama', 'Ollama, local (llama3.1:8b)', GREEN),
                                              ('nim', 'NVIDIA NIM', '#8c8c8c'), ('gemini', 'Google Gemini', '#ffffff')]):
        vals = [t['tasks'][task]['measured'][prov]['medianMs'] / 1000 for task in order]
        ax.bar([i + (k - 1) * w for i in range(len(order))], vals, w, color=color, edgecolor='#1a1a1a', lw=0.5, label=label)
    ax.set_yscale('log')
    ax.set_ylim(0.2, 60)
    ax.set_yticks([0.25, 0.5, 1, 2, 5, 10, 20, 50], ['0.25', '0.5', '1', '2', '5', '10', '20', '50'])
    ax.set_ylabel('Median time per call (s, log scale)')
    ax.set_xticks(range(len(order)), [names[o] for o in order], fontsize=8.2)
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_axisbelow(True)
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.2), frameon=False, fontsize=8.6, ncol=3)
    fig.tight_layout()
    save(fig, 'fig_5_5_latency')


def chart_premise():
    fig, ax = plt.subplots(figsize=(5.6, 2.5))
    groups = ['False premise caught\n("Prime Minister Rahul Gandhi")', 'Genuine AP video\nwrongly contradicted']
    before = [3 / 5 * 100, 1 / 8 * 100]
    after = [6 / 6 * 100, 0 / 6 * 100]
    labels_b = ['3 of 5', '1 of 8']
    labels_a = ['6 of 6', '0 of 6']
    y = [1, 0]
    h = 0.34
    ax.barh([v + h / 2 for v in y], before, h, color='#ffffff', edgecolor='#000000', lw=0.5, label='Before the fix')
    ax.barh([v - h / 2 for v in y], after, h, color=NAVY, edgecolor='#1a1a1a', lw=0.5, label='After the fix')
    for v, b, a, lb, la in zip(y, before, after, labels_b, labels_a):
        ax.text(b + 1.5, v + h / 2, lb, va='center', fontsize=8.6)
        ax.text(a + 1.5, v - h / 2, la, va='center', fontsize=8.6)
    ax.set_yticks(y, groups)
    ax.set_xlim(0, 115)
    ax.set_xticks([0, 25, 50, 75, 100], ['0%', '25%', '50%', '75%', '100%'])
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_axisbelow(True)
    ax.legend(loc='lower right', frameon=False, fontsize=8.4)
    fig.tight_layout()
    save(fig, 'fig_5_6_premise')


if __name__ == '__main__':
    fig_evidence_split()
    fig_proposed_approach()
    fig_architecture()
    fig_corroboration()
    fig_scoring()
    fig_verdict_rules()
    fig_routing()
    chart_confusion()
    chart_metrics()
    chart_reliability()
    chart_adversarial()
    chart_latency()
    chart_premise()
    chart_robustness()
    chart_plain_model()
    chart_rulings()
