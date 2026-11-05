"""Figures for the NICOM 2027 paper, black and white as the conference requires. The drawing helpers and the
outcome chart come from the report's figure script (docs/builders/figures.py)."""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import figures as F  # noqa: E402

F.OUT = os.path.join(HERE, 'figs')
os.makedirs(F.OUT, exist_ok=True)


def fig_pipeline():
    fig, ax = F.canvas(6.3, 5.0)
    inputs = ['Article link\npublisher page', 'Pasted text\nas received', 'Screenshot\nread by OCR', 'Video link\ncaption track']
    xs = [0.78, 2.1, 3.42, 4.74]
    for x, label in zip(xs, inputs):
        F.box(ax, x, 4.62, 1.22, 0.55, label, size=8.4)
        F.arrow(ax, x, 4.34, x, 4.12)
    F.box(ax, 2.76, 3.78, 5.3, 0.62, 'Reading step: what the message asserts, in which language and tone;\n'
          'up to three claims, each a plain English sentence', size=8.4)
    F.box(ax, 5.92, 3.78, 0.72, 0.62, 'Refused,\nwith the\nreason', size=7.6)
    F.arrow(ax, 5.41, 3.78, 5.56, 3.78)
    channels = ['News\ncoverage,\noutlets\ncounted once', 'Fact-checker\nrulings on\nthe same\nclaim', 'This week’s\ncoverage of\nthe subject',
                'Encyclopedia\nentries for\npremises', 'Publisher\nidentity and\nwriting\nchecks']
    cxs = [0.72, 1.92, 3.12, 4.32, 5.52]
    for x, label in zip(cxs, channels):
        F.arrow(ax, x, 3.3, x, 3.06)
        F.box(ax, x, 2.6, 1.08, 0.88, label, size=7.9)
        F.arrow(ax, x, 2.15, x, 1.93)
    ax.plot([0.72, 5.52], [3.3, 3.3], color=F.INK, lw=0.9)
    F.arrow(ax, 2.9, 3.47, 2.9, 3.3, style='-')
    F.box(ax, 3.12, 1.68, 5.6, 0.48, 'Evidence ledger, then ordered verdict rules: the first rule that applies decides', size=8.6)
    F.arrow(ax, 3.12, 1.43, 3.12, 1.2)
    F.box(ax, 3.12, 0.85, 5.6, 0.66, 'Report to the reader: verdict, probability of fabrication, the deciding rule,\n'
          'linked evidence, and the smallest change in evidence that would alter the verdict', size=8.4)
    F.save(fig, 'fig2_pipeline')


if __name__ == '__main__':
    fig_pipeline()
    shutil.copy(os.path.join(HERE, '..', 'paper', 'figs', 'fig1_framework.png'), os.path.join(F.OUT, 'fig1_framework.png'))
    F.chart_rulings()   # saved as fig_5_22_rulings in figs/
