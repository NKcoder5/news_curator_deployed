"""Builds the NICOM 2027 full paper in the conventions of the reference Kongu paper (numbered citations,
run-in headings, running head, 'Table N.' above tables and 'Fig. N.' below figures), on the NICOM page:
A4, Times New Roman 12 pt, 1.5 line spacing, justified. Exports to PDF through Microsoft Word."""
import os
import re
import subprocess

import latex2mathml.converter
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from lxml import etree

from paper_build import font, borders, fixed_widths, MML2OMML, TEXT_W
import paper2_content as PC

HERE = os.path.dirname(os.path.abspath(__file__))
DOCX = os.path.join(HERE, 'NICOM_Paper_CO5.docx')
PDF = os.path.join(HERE, 'NICOM_Paper_CO5.pdf')
SPELL = os.path.join(HERE, 'spelling.txt')

J = WD_ALIGN_PARAGRAPH.JUSTIFY
C = WD_ALIGN_PARAGRAPH.CENTER
L = WD_ALIGN_PARAGRAPH.LEFT
R = WD_ALIGN_PARAGRAPH.RIGHT
TAG = re.compile(r'(</?(?:i|b|sub|sup|tt)>)')
CITE = re.compile(r'\[@([^\]]+)\]')
INDENT = 0.4


# ----------------------------------------------------------------------------- citations
def number_citations(blocks):
    # The base paper is reference 1; the others are numbered in the order they are first cited.
    order = [PC.BASE_PAPER]

    def scan(text):
        for m in CITE.finditer(text):
            for key in (k.strip().lstrip('@') for k in m.group(1).split(';')):
                if key not in order:
                    order.append(key)

    for b in blocks:
        for part in b[1:]:
            if isinstance(part, str):
                scan(part)
            elif isinstance(part, list):
                for row in part:
                    for cell in (row if isinstance(row, list) else [row]):
                        scan(str(cell))
    missing = [k for k in PC.REFERENCES if k not in order]
    assert not missing, f'references never cited: {missing}'
    return {k: i + 1 for i, k in enumerate(order)}, order


def cite(text, num):
    def repl(m):
        keys = [k.strip().lstrip('@') for k in m.group(1).split(';')]
        return '[' + ', '.join(str(n) for n in sorted(num[k] for k in keys)) + ']'
    return CITE.sub(repl, text)


# ----------------------------------------------------------------------------- text
def rich(p, text, size=12, bold=False, italic=False):
    st = {'i': italic, 'b': bold, 'sub': False, 'sup': False, 'tt': False}
    for piece in TAG.split(text):
        if not piece:
            continue
        m = re.fullmatch(r'<(/?)(i|b|sub|sup|tt)>', piece)
        if m:
            st[m.group(2)] = not m.group(1)
            continue
        r = p.add_run(piece)
        font(r, size=size - 1.5 if st['tt'] else size, bold=st['b'], italic=st['i'], sub=st['sub'], sup=st['sup'])
        if st['tt']:
            r.font.name = 'Courier New'
            rf = r._element.rPr.find(qn('w:rFonts'))
            for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
                rf.set(qn(a), 'Courier New')
    return p


def para(doc, text='', align=J, first=0.0, line=1.5, before=0, after=0, left=0.0, right=0.0, size=12,
         bold=False, italic=False, keep_next=False, hanging=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = align
    if hanging is not None:
        pf.left_indent = Inches(hanging)
        pf.first_line_indent = Inches(-hanging)
    else:
        pf.first_line_indent = Inches(first) if first else None
        pf.left_indent = Inches(left) if left else None
    pf.right_indent = Inches(right) if right else None
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.keep_with_next = keep_next
    pf.widow_control = True
    if text:
        rich(p, text, size=size, bold=bold, italic=italic)
    return p


def field(run, instr):
    for tag, val in (('w:fldChar', 'begin'), ('w:instrText', instr), ('w:fldChar', 'separate'), ('w:t', '1'),
                     ('w:fldChar', 'end')):
        el = OxmlElement(tag)
        if tag == 'w:fldChar':
            el.set(qn('w:fldCharType'), val)
        else:
            if tag == 'w:instrText':
                el.set(qn('xml:space'), 'preserve')
            el.text = val
        run._element.append(el)


class Paper:
    def __init__(self):
        self.doc = Document()
        d = self.doc
        st = d.styles['Normal']
        st.font.name = 'Times New Roman'
        st.font.size = Pt(12)
        st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Times New Roman')
        lang = OxmlElement('w:lang'); lang.set(qn('w:val'), 'en-GB')
        st.element.get_or_add_rPr().append(lang)
        sec = d.sections[0]
        sec.page_width, sec.page_height = Inches(8.27), Inches(11.69)
        for side in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'):
            setattr(sec, side, Inches(1.0))
        sec.header_distance = Inches(0.5)
        sec.different_first_page_header_footer = True
        # Only the page number goes in the header; the title is not repeated on every page.
        hp = sec.header.paragraphs[0]
        hp.alignment = R
        r = hp.add_run(); font(r, size=10); field(r, 'PAGE')
        self.after_heading = False
        self.blocks = PC.body()
        self.num, self.order = number_citations(self.blocks)

    # ------------------------------------------------------------------ front matter
    def front(self):
        d = self.doc
        para(d, PC.TITLE, align=C, line=1.15, after=16, size=16, bold=True)
        p = para(d, '', align=C, line=1.3, after=10)
        rich(p, PC.AUTHORS)
        r = p.add_run('(✉)'); font(r, size=11, sup=True)
        rf = r._element.rPr.find(qn('w:rFonts'))
        for a in ('w:ascii', 'w:hAnsi', 'w:cs'):
            rf.set(qn(a), 'Segoe UI Symbol')
        para(d, PC.AFFILIATION, align=C, line=1.15, left=0.4, right=0.4, after=3, size=11)
        for k, e in enumerate(PC.EMAILS):
            para(d, f'<tt>{e}</tt>', align=C, line=1.15, after=18 if k == len(PC.EMAILS) - 1 else 0, size=11)
        para(d, '<b>Abstract.</b> ' + PC.ABSTRACT, align=J, left=INDENT, right=INDENT, line=1.5, after=8)
        para(d, '<b>Keywords:</b> ' + PC.KEYWORDS, align=J, left=INDENT, right=INDENT, line=1.5, after=12)

    # ------------------------------------------------------------------ body
    def h1(self, n, title):
        p = para(self.doc, '', align=L, line=1.5, before=14, after=4, bold=True, keep_next=True)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(0.45))
        rich(p, f'{n}\t{title}' if n else title, size=13, bold=True)
        self.after_heading = True

    def h2(self, n, title):
        p = para(self.doc, '', align=L, line=1.5, before=8, after=2, keep_next=True)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(0.45))
        rich(p, f'{n}\t{title}', bold=True)
        self.after_heading = True

    def p(self, text, cont=False):
        first = 0 if (self.after_heading or cont) else INDENT
        para(self.doc, cite(text, self.num), first=first, after=2)
        self.after_heading = False

    def run_in(self, label, text):
        para(self.doc, f'<b>{label}</b> ' + cite(text, self.num), before=6, after=2)
        self.after_heading = False

    def equation(self, latex, number):
        latex = (latex.replace(r'\qquad', r'\text{' + '  ' + '}')
                 .replace(r'\,', r'\text{' + ' ' + '}')
                 .replace(r'\max', r'\mathrm{max}'))
        mathml = latex2mathml.converter.convert(latex, display='block')
        omml = MML2OMML(etree.fromstring(mathml.encode('utf-8'))).getroot()
        M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
        omath = omml if omml.tag == M + 'oMath' else omml.find(M + 'oMath')
        t = self.doc.add_table(rows=1, cols=3)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        fixed_widths(t, [0.75, TEXT_W - 1.5, 0.75])
        for c in t.rows[0].cells:
            c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            borders(c, top=0, bottom=0, left=0, right=0)
            pf = c.paragraphs[0].paragraph_format
            pf.space_before, pf.space_after, pf.line_spacing = Pt(3), Pt(3), 1.0
        mid = t.cell(0, 1).paragraphs[0]
        mid.alignment = C
        mpara = parse_xml('<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
                          '<m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr></m:oMathPara>')
        mpara.append(parse_xml(etree.tostring(omath)))
        mid._p.append(mpara)
        right = t.cell(0, 2).paragraphs[0]
        right.alignment = R
        r = right.add_run(f'({number})'); font(r)

    def caption(self, label, text, keep_next, before, after):
        text = cite(text, self.num)
        long = len(text) > 95
        para(self.doc, f'<b>{label}</b> {text}', align=J if long else C, left=0.3 if long else 0,
             right=0.3 if long else 0, line=1.15, before=before, after=after, size=11, keep_next=keep_next)

    def table(self, num, caption, headers, rows, widths, aligns):
        d = self.doc
        self.caption(f'Table {num}.', caption, True, 8, 4)
        t = d.add_table(rows=len(rows) + 1, cols=len(headers))
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        fixed_widths(t, widths)
        al = {'left': L, 'center': C}
        for r, row in enumerate([headers] + rows):
            for c, val in enumerate(row):
                cell = t.cell(r, c)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                p = cell.paragraphs[0]
                pf = p.paragraph_format
                pf.alignment = C if r == 0 else al[aligns[c]]
                pf.space_before, pf.space_after, pf.line_spacing = Pt(2), Pt(2), 1.0
                pf.keep_with_next = r < len(rows)
                rich(p, cite(str(val), self.num), size=11, bold=(r == 0))
                edges = {'left': 0, 'right': 0}
                if r == 0:
                    edges.update(top=10, bottom=6)
                elif r == len(rows):
                    edges.update(bottom=10)
                borders(cell, **edges)
        for i, row in enumerate(t.rows):
            trPr = row._tr.get_or_add_trPr()
            trPr.append(OxmlElement('w:cantSplit'))
            if i == 0:
                trPr.append(OxmlElement('w:tblHeader'))
        para(d, '', line=1.0, after=8, size=6)
        self.after_heading = False

    def figure(self, num, path, width, caption):
        p = para(self.doc, '', align=C, line=1.0, before=8, after=4, keep_next=True)
        p.add_run().add_picture(path, width=Inches(width))
        self.caption(f'Fig. {num}.', caption, False, 2, 12)
        self.after_heading = False

    def references(self):
        self.h1('', 'References')
        for i, key in enumerate(self.order, 1):
            p = para(self.doc, '', align=L, line=1.5, after=3, hanging=0.4)
            p.paragraph_format.tab_stops.add_tab_stop(Inches(0.4))
            rich(p, f'{i}.\t' + PC.REFERENCES[key])

    def build(self):
        self.front()
        for b in self.blocks:
            k = b[0]
            if k == 'h1':
                self.h1(b[1], b[2])
            elif k == 'h2':
                self.h2(b[1], b[2])
            elif k == 'p':
                self.p(b[1])
            elif k == 'p_cont':
                self.p(b[1], cont=True)
            elif k == 'run':
                self.run_in(b[1], b[2])
            elif k == 'eq':
                self.equation(b[1], b[2])
            elif k == 'table':
                self.table(*b[1:])
            elif k == 'figure':
                self.figure(*b[1:])
        self.references()
        self.doc.save(DOCX)


def export():
    ps1 = os.path.join(HERE, 'export2.ps1')
    open(ps1, 'w', encoding='utf-8').write(r'''
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open('%s', $false, $false)
  $doc.Fields.Update() | Out-Null
  foreach ($s in $doc.Sections) { foreach ($h in $s.Headers) { $h.Range.Fields.Update() | Out-Null } }
  $doc.Repaginate()
  $pages = $doc.ComputeStatistics(2)
  $words = $doc.ComputeStatistics(0)
  $doc.SaveAs2('%s', 17)
  $doc.Content.LanguageID = 2057
  $errs = @()
  foreach ($e in $doc.Range().SpellingErrors) { $errs += $e.Text }
  $gram = @()
  foreach ($g in $doc.Range().GrammaticalErrors) { $gram += $g.Text }
  (($errs | Sort-Object -Unique) -join "`n") + "`n--- grammar ---`n" + ($gram -join "`n") | Out-File -Encoding utf8 '%s'
  $doc.Close($false)
  "pages=$pages words=$words"
} finally { $word.Quit() }
''' % (DOCX, PDF, SPELL))
    out = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
                         capture_output=True, text=True, timeout=600)
    print(out.stdout.strip(), out.stderr.strip()[:800])


if __name__ == '__main__':
    print('abstract words:', len(PC.ABSTRACT.split()))
    Paper().build()
    export()
