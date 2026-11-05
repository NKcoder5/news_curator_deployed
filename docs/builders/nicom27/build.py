"""Builds the NICOM 2027 full paper to the conference's own rules (management.nirmauni.ac.in, NICOM page):
A4, .docx; margins 1.5 cm top and bottom, 1 cm left and right; Times New Roman throughout; header
'NICOM 2027, IMNU, Nirma University' 10 pt bold italic left; title 16 pt bold italic centred; author details
12 pt bold centred on page 1; body 12 pt justified, 1.5 spacing, a blank line between paragraphs; headings
14 pt bold left, sub-headings 12 pt bold left; table and figure titles 12 pt bold centred; APA references.
Writes docs/paper/NICOM2027_Paper_CO5.docx, exports a PDF through Word and prints Word's own word count."""
import os
import re
import subprocess

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt

import content as C

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'paper'))
DOCX = os.path.join(OUT, 'NICOM2027_Paper_CO5.docx')
PDF = os.path.join(OUT, 'NICOM2027_Paper_CO5.pdf')
FONT = 'Times New Roman'
J, CTR, L = WD_ALIGN_PARAGRAPH.JUSTIFY, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT
BLANK_LINE = Pt(18)          # one empty line of 12 pt text at 1.5 spacing

TAG = re.compile(r'(</?(?:i|b|sub|sup)>)')


def runs(par, text, size=12, bold=False, italic=False):
    """Adds text with <i>, <b>, <sub> and <sup> markup as runs."""
    state = {'i': italic, 'b': bold, 'sub': False, 'sup': False}
    for piece in TAG.split(text):
        m = re.fullmatch(r'<(/?)(i|b|sub|sup)>', piece)
        if m:
            state[m.group(2)] = not m.group(1)
            continue
        if not piece:
            continue
        r = par.add_run(piece)
        r.font.name = FONT
        r._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
        r.font.size = Pt(size)
        r.font.bold = state['b']
        r.font.italic = state['i']
        r.font.subscript = state['sub']
        r.font.superscript = state['sup']
    return par


def para(doc, text, size=12, bold=False, italic=False, align=J, after=BLANK_LINE, before=Pt(0), keep=False,
         hanging=None):
    p = doc.add_paragraph()
    f = p.paragraph_format
    f.alignment = align
    f.line_spacing = 1.5
    f.space_before = before
    f.space_after = after
    f.keep_with_next = keep
    if hanging:
        f.left_indent = hanging
        f.first_line_indent = -hanging
    return runs(p, text, size, bold, italic)


def borders(table):
    tbl_pr = table._tbl.tblPr
    b = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), '4')
        e.set(qn('w:color'), '000000')
        b.append(e)
    tbl_pr.append(b)


def table(doc, num, title, header, rows, widths_cm):
    para(doc, f'Table {num}. {title}', bold=True, align=CTR, after=Pt(6), keep=True)
    t = doc.add_table(rows=1 + len(rows), cols=len(header))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    borders(t)
    for r, values in enumerate([header] + rows):
        cells = t.rows[r].cells
        for c, value in enumerate(values):
            cell = cells[c]
            cell.width = Cm(widths_cm[c])
            p = cell.paragraphs[0]
            p.paragraph_format.alignment = L if c == 0 else CTR
            p.paragraph_format.space_after = Pt(0)
            runs(p, value, size=11, bold=(r == 0))
        if r == 0:
            tr_pr = t.rows[0]._tr.get_or_add_trPr()
            h = OxmlElement('w:tblHeader')
            tr_pr.append(h)
    doc.add_paragraph().paragraph_format.space_after = Pt(6)


def figure(doc, num, path, width_in, title):
    p = doc.add_paragraph()
    p.paragraph_format.alignment = CTR
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(path, width=Inches(width_in))
    para(doc, f'Figure {num}. {title}', bold=True, align=CTR)


def build():
    doc = Document()
    normal = doc.styles['Normal']
    normal.font.name = FONT
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin = sec.bottom_margin = Cm(1.5)
    sec.left_margin = sec.right_margin = Cm(1.0)
    sec.header_distance = Cm(0.6)
    sec.footer_distance = Cm(0.6)
    hp = sec.header.paragraphs[0]
    hp.paragraph_format.alignment = L
    runs(hp, C.HEADER, size=10, bold=True, italic=True)

    # ---- page 1: title and author details
    para(doc, C.TITLE, size=16, bold=True, italic=True, align=CTR, before=Pt(24), after=Pt(30))
    for name, designation, org, place, email in C.AUTHORS:
        for k, line in enumerate((name, designation, org, place, email)):
            para(doc, line, bold=True, align=CTR, after=Pt(14) if k == 4 else Pt(0))
    doc.paragraphs[-1].runs[-1].add_break(WD_BREAK.PAGE)

    # ---- page 2 onwards
    para(doc, C.TITLE, size=16, bold=True, italic=True, align=CTR)
    para(doc, 'Abstract', size=14, bold=True, align=L, after=Pt(6), keep=True)
    para(doc, C.ABSTRACT)
    para(doc, '<b>Keywords:</b> ' + C.KEYWORDS, align=L)
    for block in C.body():
        kind = block[0]
        if kind == 'h':
            para(doc, f'{block[1]}. {block[2]}', size=14, bold=True, align=L, after=Pt(6), before=Pt(6), keep=True)
        elif kind == 'sh':
            para(doc, f'{block[1]} {block[2]}', bold=True, align=L, after=Pt(6), keep=True)
        elif kind == 'p':
            para(doc, block[1])
        elif kind == 'eq':
            para(doc, f'{block[1]}  ({block[2]})', align=CTR, after=Pt(6))
        elif kind == 'fig':
            figure(doc, *block[1:])
        elif kind == 'table':
            table(doc, *block[1:])
    para(doc, 'References', size=14, bold=True, align=L, after=Pt(6), before=Pt(6), keep=True)
    for ref in C.REFERENCES:
        para(doc, ref, align=L, after=Pt(6), hanging=Cm(1.27))

    os.makedirs(OUT, exist_ok=True)
    doc.save(DOCX)


def export():
    ps1 = os.path.join(HERE, 'export.ps1')
    open(ps1, 'w', encoding='utf-8').write(r'''
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open('%s', $false, $false)
  $doc.Repaginate()
  $pages = $doc.ComputeStatistics(2)
  $words = $doc.ComputeStatistics(0)
  $doc.SaveAs2('%s', 17)
  $doc.Close($false)
  "pages=$pages words=$words"
} finally { $word.Quit() }
''' % (DOCX, PDF))
    out = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
                         capture_output=True, text=True, timeout=900)
    print(out.stdout.strip(), out.stderr.strip()[:400])


if __name__ == '__main__':
    build()
    print('abstract words:', len(C.ABSTRACT.split()))
    export()
