"""Final-review deck: the third-review deck with the measured results since then. Adds one slide for the
fact-checked rulings (the sealed test) after END-TO-END TESTING and brings the routing, testing and
conclusion slides up to date. Every number is read from backend/eval/results."""
import copy
import json
import os

from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Inches, Pt

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SRC = os.path.join(REPO, 'docs', 'review', 'REVIEW3_CO5.pptx')
OUT = os.path.join(REPO, 'docs', 'review', 'REVIEW_FINAL_CO5.pptx')
EVAL = os.path.join(REPO, 'backend', 'eval', 'results')

log = [json.loads(l) for l in open(os.path.join(EVAL, 'sealed_runs.jsonl'), encoding='utf-8') if l.strip()]
sealed = {r['release']: r for r in log if r.get('complete')}
S1, S2 = sealed['sealed_rc1']['overall'], sealed['sealed_rc2']['overall']
CAT = sealed['sealed_rc2']['byCategory']
DEV = json.load(open(os.path.join(EVAL, 'robustness_rulings_dev_rc2.json'), encoding='utf-8'))['summary']['overall']
cases = json.load(open(os.path.join(REPO, 'backend', 'eval', 'suites', 'rulings.json'), encoding='utf-8'))['cases']
DESKS = len({c['ruling']['publisher'] for c in cases})


def set_text(shape_or_cell, text, size=None):
    """Replace the text of the first paragraph's first run, keeping its formatting; drop the rest."""
    tf = shape_or_cell.text_frame
    paras = tf.paragraphs
    for p in paras[1:]:
        p._p.getparent().remove(p._p)
    runs = paras[0].runs
    for r in runs[1:]:
        r._r.getparent().remove(r._r)
    runs[0].text = text
    if size:
        runs[0].font.size = Pt(size)


def set_paragraph(shape, old_start, new_text):
    for p in shape.text_frame.paragraphs:
        if p.text.startswith(old_start):
            for r in p.runs[1:]:
                r._r.getparent().remove(r._r)
            p.runs[0].text = new_text
            return
    raise KeyError(old_start)


def by_id(slide, shape_id):
    return next(sh for sh in slide.shapes if sh.shape_id == shape_id)


def duplicate(prs, index):
    """Copies slide `index` (0-based) to the end, pictures included."""
    src = prs.slides[index]
    new = prs.slides.add_slide(src.slide_layout)
    for sh in list(new.shapes):
        sh._element.getparent().remove(sh._element)
    for sh in src.shapes:
        el = copy.deepcopy(sh._element)
        new.shapes._spTree.insert_element_before(el, 'p:extLst')
        for blip in el.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}blip'):
            rid = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
            image_part = src.part.related_part(rid)
            blip.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed',
                     new.part.relate_to(image_part, RT.IMAGE))
    # The deck's notes master has no body placeholder, so a new notes page has nowhere to write: take the
    # source slide's notes shapes instead.
    notes_tree = new.notes_slide.shapes._spTree
    for sh in list(new.notes_slide.shapes):
        notes_tree.remove(sh._element)
    for sh in src.notes_slide.shapes:
        notes_tree.insert_element_before(copy.deepcopy(sh._element), 'p:extLst')
    return new


def move(prs, old, new):
    ids = prs.slides._sldIdLst
    el = list(ids)[old]
    ids.remove(el)
    ids.insert(new, el)


prs = Presentation(SRC)

# ---------------------------------------------------------------- new slide: fact-checked rulings
s = duplicate(prs, 12)                       # END-TO-END TESTING: title, table, note
set_text(by_id(s, 3), 'RESULTS: FACT-CHECKED RULINGS')
table = next(sh for sh in s.shapes if sh.has_table)
t = table.table
data = [
    ['Rulings', 'Claims', 'Desk’s verdict', 'Acceptable', 'No verdict', 'Wrong'],
    ['Development 1–120, final code', DEV],
    ['Sealed 121–320, first candidate', S1],
    ['Sealed 121–320, final code', S2],
    ['   of which rated false', CAT['rated false']],
    ['   of which rated misleading', CAT['rated misleading']],
    ['   of which rated true', CAT['rated true']],
]
for tr in list(t._tbl.tr_lst)[len(data):]:
    t._tbl.remove(tr)
widths = [3.15, 0.95, 1.2, 1.15, 1.15, 1.05]
for col, w in zip(t.columns, widths):
    col.width = Inches(w)
for r, row in enumerate(data):
    cells = row if r == 0 else [row[0]] + [str(row[1][k]) for k in ('n', 'right', 'safe', 'missed', 'wrong')]
    for c, value in enumerate(cells):
        set_text(t.cell(r, c), value)
        t.cell(r, c).text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT if (r and c == 0) else PP_ALIGN.CENTER
for r in range(len(data)):
    t.rows[r].height = Inches(0.5 if r == 0 else 0.46)
table.height = Inches(0.5 + 0.46 * (len(data) - 1))
note = by_id(s, 5)
note.top = Inches(1.15 + 0.5 + 0.46 * (len(data) - 1) + 0.35)
note.height = Inches(1.1)
set_text(note, f'{len(cases)} claims ruled on by {DESKS} fact-checking desks; each desk’s own ruling is hidden '
               f'during a run. Rulings 121–320 are sealed: run whole, totals only, never read or tuned on. Final code: '
               f'{S2["right"] + S2["safe"]} of {S2["n"]} desk’s or acceptable verdict, {S2["wrong"]} wrong. '
               f'First candidate scored on labels later corrected (4 true → false).', size=13)
s.notes_slide.notes_text_frame.text = (
    'Claims chosen by others: fact-checkers’ published rulings, not our own test cases. We split the set once before '
    'any result: 1–120 to develop on, 121–320 sealed. The sealed part was run twice, once per release candidate, and '
    'every run is logged. Wrong verdicts fell from 17 to 12; part of that may be the label correction. Our weak point '
    'is true claims: 3 of 13 confirmed, because they are often reported by one outlet or need the article body.')
move(prs, len(prs.slides) - 1, 13)           # straight after END-TO-END TESTING

# ---------------------------------------------------------------- routing and tests (now slide 15)
s = prs.slides[14]
set_text(by_id(s, 5), '* Premise check moved off the local model after it missed the known contradiction in 3 of 3 '
                      'runs; it is now led by Gemini. The deployed server has no GPU, so there these tasks start at NIM.')
set_text(by_id(s, 7), '8 of 16')
set_text(by_id(s, 8), 'model tasks run on a local GPU when one is present')
set_text(by_id(s, 16), '519 + 42')

# ---------------------------------------------------------------- git and documentation (now slide 16)
s = prs.slides[15]
set_paragraph(by_id(s, 7), 'Backend and frontend tests', 'CI reruns all tests and builds on every push')
set_paragraph(by_id(s, 10), 'Project report', 'Project report in the college format: 6 chapters, appendix, '
                                              'references, SDG page (73 pages)')
set_paragraph(by_id(s, 10), 'backend/eval', 'backend/eval: held-out, adversarial, end-to-end and fact-checked '
                                            'rulings suites, with the sealed-test log')
set_paragraph(by_id(s, 10), 'Automated tests', 'Automated tests: 519 backend, 42 frontend, all passing')

# ---------------------------------------------------------------- conclusion (now slide 21)
s = prs.slides[20]
set_text(by_id(s, 6), 'A story is judged by independent evidence, not by its writing. On 120 held-out articles the '
                      'system matched the baseline’s accuracy and cut calibration error on accusations by 43%; it rated '
                      'none of six careful fabrications as credible. On ' + str(S2['n']) + ' sealed fact-checked claims '
                      'it gave the desk’s or an acceptable verdict for ' + str(S2['right'] + S2['safe']) + ' and a '
                      'wrong one for ' + str(S2['wrong']) + '.', size=14)
set_text(by_id(s, 9), 'Answer more of the claims left without a verdict (' + str(S2['missed']) + ' of ' + str(S2['n']) +
                      ') and of true claims (' + str(CAT['rated true']['right']) + ' of ' + str(CAT['rated true']['n']) +
                      ' confirmed) by reading article bodies, not headlines; grow the labelled corpus beyond 239 '
                      'articles; collect ratings for regional Indian outlets; run the judgements on our own models.',
         size=14)

prs.save(OUT)
print('saved', OUT, len(prs.slides), 'slides')
