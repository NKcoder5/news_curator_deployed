"""Figures for the NICOM paper, drawn in a plain print style: white boxes, thin black lines,
grey fills, Times New Roman. Every number plotted comes from docs/measurements.md or
backend/data/taskRouting.json."""
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle
from PIL import Image, ImageChops, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'figs')
os.makedirs(OUT, exist_ok=True)
SHOTS = os.path.join(HERE, '..', 'report', 'shots')
ROUTING = os.path.join(HERE, '..', '..', '..', 'backend', 'data', 'taskRouting.json')

plt.rcParams.update({
    'font.family': 'Times New Roman',
    'mathtext.fontset': 'stix',
    'font.size': 10,
    'axes.linewidth': 0.8,
    'axes.edgecolor': '#222222',
    'xtick.color': '#222222',
    'ytick.color': '#222222',
    'savefig.dpi': 300,
})
INK = '#1a1a1a'
PANEL = 'white'


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, bbox_inches='tight', pad_inches=0.04, facecolor='white')
    plt.close(fig)
    im = Image.open(path).convert('RGB')
    bg = Image.new('RGB', im.size, 'white')
    box = ImageChops.difference(im, bg).getbbox()
    if box:
        pad = 12
        im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
    im.save(path)
    print('saved', name, im.size)


def box(ax, x, y, w, h, text, size=9.5, fill='white', bold=False, lw=0.9, italic=False, rounded=True):
    style = 'round,pad=0,rounding_size=1.2' if rounded else 'square,pad=0'
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=style, linewidth=lw, edgecolor=INK, facecolor=fill))
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center', fontsize=size, color=INK,
            fontweight='bold' if bold else 'normal', style='italic' if italic else 'normal', linespacing=1.25)


def arrow(ax, x1, y1, x2, y2):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='-|>', color=INK, lw=0.9, mutation_scale=9, shrinkA=0, shrinkB=0))


def line(ax, xs, ys):
    ax.plot(xs, ys, color=INK, lw=0.9, solid_capstyle='butt')


def canvas(w_in, h_in, xmax, ymax):
    fig, ax = plt.subplots(figsize=(w_in, h_in))
    ax.set_xlim(0, xmax)
    ax.set_ylim(0, ymax)
    ax.axis('off')
    return fig, ax


# ----------------------------------------------------------------------------- Figure 1
def framework():
    fig, ax = canvas(6.5, 4.6, 100, 71)
    # the two families of evidence
    for x0, title, items in ((2, 'Controlled by the author',
                              ['Headline wording', 'Tone and slant', 'Persuasion techniques',
                               'How sources are attributed']),
                             (53, 'Outside the author\u2019s control',
                              ['Independent outlets reporting it', 'Reference entries on named people',
                               'Publisher identity from the address'])):
        ax.add_patch(Rectangle((x0, 37), 45, 32, linewidth=0.9, edgecolor=INK, facecolor=PANEL))
        ax.text(x0 + 22.5, 65.6, title, ha='center', va='center', fontsize=10.5, fontweight='bold', color=INK)
        n = len(items)
        top, bottom = 62.0, 38.2
        gap = (top - bottom - n * 4.6) / (n + 1)
        for i, it in enumerate(items):
            y = top - (i + 1) * gap - (i + 1) * 4.6
            box(ax, x0 + 2, y, 41, 4.6, it, size=9.3)
    # what each family may do
    box(ax, 4, 22, 41, 9, 'Counts only against the story\n$W^{\\dagger} = \\max(0,\\, W)$', size=9.5)
    box(ax, 55, 22, 41, 9, 'Counts for or against the story\n$W$ admitted in both directions', size=9.5)
    arrow(ax, 24.5, 37, 24.5, 31)
    arrow(ax, 75.5, 37, 75.5, 31)
    # combination
    box(ax, 17, 9.5, 66, 7.5, 'Weight of evidence:  logit $P$ = logit $\\pi$ + $\\Sigma\\,W$,  then calibrated', size=9.5,
        fill=PANEL)
    line(ax, [24.5, 24.5], [22, 19.5]); line(ax, [75.5, 75.5], [22, 19.5]); line(ax, [24.5, 75.5], [19.5, 19.5])
    arrow(ax, 50, 19.5, 50, 17)
    box(ax, 17, 0.5, 66, 6.5, 'Probability of fabrication, verdict and the grounds behind it', size=9.5)
    arrow(ax, 50, 9.5, 50, 7)
    save(fig, 'fig1_framework.png')


# ----------------------------------------------------------------------------- Figure 2
def pipeline():
    fig, ax = canvas(6.5, 7.6, 100, 117)
    inputs = [('Article link', 'publisher page'), ('Pasted text', 'used as given'),
              ('Screenshot', 'read by OCR'), ('Video link', 'caption track')]
    w, gap = 22, (100 - 4 * 22) / 5
    xs = [gap + i * (w + gap) for i in range(4)]
    for x, (a, b) in zip(xs, inputs):
        box(ax, x, 104, w, 9.5, f'{a}\n$\\it{{{b.replace(" ", "~")}}}$', size=9.5)
        arrow(ax, x + w / 2, 104, x + w / 2, 99.5)
    line(ax, [xs[0] + w / 2, xs[-1] + w / 2], [99.5, 99.5])
    arrow(ax, 50, 99.5, 50, 96)
    box(ax, 15, 89, 70, 7, 'Common form: text, headline and where the item came from', size=9.5, fill=PANEL)
    arrow(ax, 50, 89, 50, 84)
    box(ax, 22, 74, 56, 10, 'Admissibility check\nDoes it assert something checkable?', size=9.5)
    # refusal branch
    box(ax, 83, 74, 16, 10, 'Declined,\nwith what\nis missing', size=9)
    arrow(ax, 78, 79, 83, 79)
    ax.text(80.5, 79.8, 'no', ha='center', va='bottom', fontsize=8.5, style='italic', color=INK)
    ax.text(51.5, 70.6, 'yes', ha='left', va='center', fontsize=8.5, style='italic', color=INK)
    line(ax, [50, 50], [74, 67.5])
    checks = ['Corroboration\nclaims searched,\neach independent\noutlet counted once',
              'Premise check\nnamed people and\nbodies looked up in\nan encyclopedia',
              'Publisher identity\nweb address, ratings\nand domain age',
              'Writing checks\nclickbait, slant,\npersuasion and\ntransparency']
    cx = [gap + i * (w + gap) for i in range(4)]
    line(ax, [cx[0] + w / 2, cx[-1] + w / 2], [67.5, 67.5])
    for x, t in zip(cx, checks):
        arrow(ax, x + w / 2, 67.5, x + w / 2, 64)
        box(ax, x, 48, w, 16, t, size=9)
        line(ax, [x + w / 2, x + w / 2], [48, 44])
    line(ax, [cx[0] + w / 2, cx[-1] + w / 2], [44, 44])
    arrow(ax, 50, 44, 50, 40.5)
    box(ax, 15, 32.5, 70, 8, 'Weight of evidence: one-sided rule, correlation damping\nand calibration', size=9.5,
        fill=PANEL)
    arrow(ax, 50, 32.5, 50, 28)
    box(ax, 15, 21, 70, 7, 'Ordered verdict rules, each stating why it fired', size=9.5)
    arrow(ax, 50, 21, 50, 16.5)
    box(ax, 15, 8, 70, 8.5, 'Report to the reader: verdict, probability,\ngrounds and the quoted text behind them', size=9.5)
    save(fig, 'fig2_pipeline.png')


# ----------------------------------------------------------------------------- Figure 3
def heldout():
    legacy = {'Accuracy': 0.958, 'ROC-AUC': 0.978, 'Precision\n(accusing)': 0.968,
              'ECE': 0.237, 'ECE\n(accusing)': 0.267, 'Brier\nscore': 0.101}
    ours = {'Accuracy': 0.950, 'ROC-AUC': 0.951, 'Precision\n(accusing)': 0.967,
            'ECE': 0.246, 'ECE\n(accusing)': 0.152, 'Brier\nscore': 0.117}
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.5, 2.9), gridspec_kw={'wspace': 0.32})
    for ax, keys, lim, title in ((a1, ['Accuracy', 'ROC-AUC', 'Precision\n(accusing)'], (0.80, 1.0),
                                  '(a) Higher is better'),
                                 (a2, ['ECE', 'ECE\n(accusing)', 'Brier\nscore'], (0.0, 0.30), '(b) Lower is better')):
        idx = range(len(keys))
        bw = 0.36
        b1 = ax.bar([i - 0.2 for i in idx], [legacy[k] for k in keys], bw, color='white', edgecolor=INK,
                    lw=0.7, label='Hand-weighted baseline')
        b2 = ax.bar([i + 0.2 for i in idx], [ours[k] for k in keys], bw, color='#4a4a4a', edgecolor=INK,
                    lw=0.7, label='Proposed (as deployed)')
        for bars in (b1, b2):
            for b in bars:
                ax.text(b.get_x() + b.get_width() / 2, b.get_height() + (lim[1] - lim[0]) * 0.012,
                        f'{b.get_height():.3f}', ha='center', va='bottom', fontsize=7.2, color=INK)
        ax.set_xticks(list(idx))
        ax.set_xticklabels(keys, fontsize=9)
        ax.set_ylim(*lim)
        ax.set_title(title, fontsize=10, pad=6)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.tick_params(axis='y', labelsize=8.5)
        ax.set_axisbelow(True)
    h, l = a1.get_legend_handles_labels()
    fig.legend(h, l, loc='lower center', ncol=2, frameon=False, fontsize=9, bbox_to_anchor=(0.5, -0.17))
    save(fig, 'fig3_heldout.png')


# ----------------------------------------------------------------------------- Figure 4
def screenshot():
    im = Image.open(os.path.join(SHOTS, 'check_fake.png')).convert('RGB')
    im = ImageOps.expand(im, border=2, fill='#8a8a8a')
    im.save(os.path.join(OUT, 'fig4_report.png'))
    print('saved fig4_report.png', im.size)


# ----------------------------------------------------------------------------- Figure 5
def latency():
    data = json.load(open(ROUTING, encoding='utf-8'))['tasks']
    order = ['coverage keywords', 'summary', 'detailed summary', 'stance judgement', 'claim extraction',
             'clickbait', 'transparency', 'manipulation', 'bias', 'premise check']
    names = {'coverage keywords': 'Search keywords', 'summary': 'Summary', 'detailed summary': 'Detailed summary',
             'stance judgement': 'Stance judgement', 'claim extraction': 'Claim extraction', 'clickbait': 'Clickbait',
             'transparency': 'Transparency', 'manipulation': 'Persuasion', 'bias': 'Bias',
             'premise check': 'Premise check*'}
    provs = [('ollama', 'Local model (Llama 3.1 8B)', '#2b2b2b'), ('nim', 'NVIDIA NIM', '#8f8f8f'),
             ('gemini', 'Google Gemini', '#dcdcdc')]
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    bh = 0.26
    for j, (key, label, col) in enumerate(provs):
        ys = [len(order) - 1 - i + (1 - j) * bh for i in range(len(order))]
        vals = [data[t]['measured'][key]['medianMs'] / 1000 for t in order]
        ax.barh(ys, vals, bh, color=col, edgecolor=INK, lw=0.6, label=label)
    ax.set_yticks([len(order) - 1 - i for i in range(len(order))])
    ax.set_yticklabels([names[t] for t in order], fontsize=9)
    ax.set_xscale('log')
    ax.set_xlim(0.2, 60)
    ax.set_xticks([0.25, 0.5, 1, 2, 5, 10, 20, 50])
    ax.set_xticklabels(['0.25', '0.5', '1', '2', '5', '10', '20', '50'], fontsize=8.5)
    ax.set_xlabel('Median time per call, seconds (log scale)', fontsize=9.5)
    ax.set_axisbelow(True)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.legend(loc='lower center', ncol=3, frameon=False, fontsize=8.8, bbox_to_anchor=(0.45, -0.24))
    save(fig, 'fig5_latency.png')


if __name__ == '__main__':
    framework()
    pipeline()
    heldout()
    screenshot()
    latency()
