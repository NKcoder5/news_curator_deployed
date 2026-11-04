"""Builds the NICOM 2027 full paper as .docx and exports it to PDF through Microsoft Word.
NICOM author guidelines: Times New Roman, 12 pt, 1.5 line spacing, justified. Tables, figures and
references follow APA 7."""
import os
import re
import subprocess

import latex2mathml.converter
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from lxml import etree

import paper_content as PC

HERE = os.path.dirname(os.path.abspath(__file__))
DOCX = os.path.join(HERE, 'NICOM_Paper_CO5.docx')
PDF = os.path.join(HERE, 'NICOM_Paper_CO5.pdf')
SPELL = os.path.join(HERE, 'spelling.txt')
MML2OMML = etree.XSLT(etree.parse(r'C:\Program Files\Microsoft Office\root\Office16\MML2OMML.XSL'))

J = WD_ALIGN_PARAGRAPH.JUSTIFY
C = WD_ALIGN_PARAGRAPH.CENTER
L = WD_ALIGN_PARAGRAPH.LEFT
FONT = 'Times New Roman'
TEXT_W = 6.27  # A4 width less two one-inch margins
TAG = re.compile(r'(</?(?:i|b|sub|sup)>)')


def font(run, size=12, bold=False, italic=False, sub=False, sup=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.subscript = sub
    run.font.superscript = sup
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts')
        rpr.insert(0, rf)
    for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rf.set(qn(a), FONT)


def rich(p, text, size=12, bold=False, italic=False):
    """Adds marked-up text (<i>, <b>, <sub>, <sup>) to a paragraph."""
    st = {'i': italic, 'b': bold, 'sub': False, 'sup': False}
    for piece in TAG.split(text):
        if not piece:
            continue
        m = re.fullmatch(r'<(/?)(i|b|sub|sup)>', piece)
        if m:
            st[m.group(2)] = not m.group(1)
            continue
        r = p.add_run(piece)
        font(r, size=size, bold=st['b'], italic=st['i'], sub=st['sub'], sup=st['sup'])
    return p


def para(doc, text='', align=J, first=0.5, line=1.5, before=0, after=6, left=0.0, size=12, bold=False,
         italic=False, keep_next=False, hanging=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = align
    if hanging is not None:
        pf.left_indent = Inches(hanging)
        pf.first_line_indent = Inches(-hanging)
    else:
        pf.first_line_indent = Inches(first) if first else None
        pf.left_indent = Inches(left) if left else None
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.keep_with_next = keep_next
    pf.widow_control = True
    if text:
        rich(p, text, size=size, bold=bold, italic=italic)
    return p


def borders(cell, **edges):
    tcPr = cell._tc.get_or_add_tcPr()
    tb = tcPr.find(qn('w:tcBorders'))
    if tb is None:
        tb = OxmlElement('w:tcBorders')
        tcPr.append(tb)
    for edge, sz in edges.items():
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single' if sz else 'nil')
        if sz:
            el.set(qn('w:sz'), str(sz)); el.set(qn('w:space'), '0'); el.set(qn('w:color'), '000000')
        tb.append(el)


def fixed_widths(table, widths):
    table.autofit = False
    tblPr = table._tbl.tblPr
    lay = OxmlElement('w:tblLayout'); lay.set(qn('w:type'), 'fixed'); tblPr.append(lay)
    for row in table.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Inches(w)
    for i, gc in enumerate(table._tbl.tblGrid.findall(qn('w:gridCol'))):
        gc.set(qn('w:w'), str(int(widths[i] * 1440)))
    mar = OxmlElement('w:tblCellMar')
    for side, v in (('top', 30), ('left', 80), ('bottom', 30), ('right', 80)):
        el = OxmlElement(f'w:{side}'); el.set(qn('w:w'), str(v)); el.set(qn('w:type'), 'dxa'); mar.append(el)
    tblPr.append(mar)


def page_number_footer(section):
    fp = section.footer.paragraphs[0]
    fp.alignment = C
    r = fp.add_run()
    font(r, size=11)
    for tag, attr in (('w:fldChar', 'begin'), ('w:instrText', None), ('w:fldChar', 'separate'), ('w:t', None),
                      ('w:fldChar', 'end')):
        el = OxmlElement(tag)
        if tag == 'w:fldChar':
            el.set(qn('w:fldCharType'), attr)
        elif tag == 'w:instrText':
            el.set(qn('xml:space'), 'preserve'); el.text = 'PAGE'
        else:
            el.text = '1'
        r._element.append(el)


class Paper:
    def __init__(self):
        self.doc = Document()
        d = self.doc
        st = d.styles['Normal']
        st.font.name = FONT
        st.font.size = Pt(12)
        st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
        sec = d.sections[0]
        sec.page_width, sec.page_height = Inches(8.27), Inches(11.69)
        for side in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'):
            setattr(sec, side, Inches(1.0))
        sec.footer_distance = Inches(0.5)
        page_number_footer(sec)
        # Word spell-checks in British English, as the paper is written.
        lang = OxmlElement('w:lang'); lang.set(qn('w:val'), 'en-GB')
        st.element.get_or_add_rPr().append(lang)

    # ---------------------------------------------------------------- front
    def front(self):
        d = self.doc
        para(d, PC.TITLE, align=C, first=0, line=1.15, after=14, size=16, bold=True)
        p = para(d, '', align=C, first=0, line=1.15, after=4)
        for i, (name, mark) in enumerate(PC.AUTHORS):
            rich(p, name + f'<sup>{mark}</sup>' + (', ' if i < len(PC.AUTHORS) - 1 else ''), size=12)
        para(d, PC.AFFILIATION, align=C, first=0, line=1.15, after=2, size=11, italic=True)
        para(d, PC.CORRESPONDING, align=C, first=0, line=1.15, after=18, size=11)
        para(d, 'Abstract', align=C, first=0, line=1.5, after=4, bold=True, keep_next=True)
        para(d, PC.ABSTRACT, align=J, first=0, line=1.5, after=8)
        para(d, '<b><i>Keywords:</i></b> ' + PC.KEYWORDS, align=J, first=0, line=1.5, after=12)

    # ---------------------------------------------------------------- body blocks
    def h1(self, text):
        para(self.doc, text, align=L, first=0, line=1.5, before=12, after=4, bold=True, keep_next=True)

    def h2(self, text):
        para(self.doc, text, align=L, first=0, line=1.5, before=6, after=2, bold=True, italic=True, keep_next=True)

    def p(self, text, indent=True):
        para(self.doc, text, first=0.5 if indent else 0)

    def numbered(self, items):
        for n, it in enumerate(items, 1):
            p = para(self.doc, '', align=J, line=1.5, after=3, hanging=0.3)
            p.paragraph_format.left_indent = Inches(0.8)
            p.paragraph_format.first_line_indent = Inches(-0.3)
            p.paragraph_format.tab_stops.add_tab_stop(Inches(0.8))
            rich(p, f'{n}.\t{it}')
        self.doc.paragraphs[-1].paragraph_format.space_after = Pt(6)

    def equation(self, latex, number):
        """A display equation centred in a borderless three-column row, with its number at the right."""
        latex = (latex.replace(r'\qquad', r'\text{' + '\u2003\u2003' + '}')
                 .replace(r'\,', r'\text{' + '\u2009' + '}')
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
            pf.space_before, pf.space_after, pf.line_spacing = Pt(4), Pt(4), 1.0
        mid = t.cell(0, 1).paragraphs[0]
        mid.alignment = C
        from docx.oxml import parse_xml
        mpara = parse_xml('<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
                          '<m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr></m:oMathPara>')
        mpara.append(parse_xml(etree.tostring(omath)))
        mid._p.append(mpara)
        right = t.cell(0, 2).paragraphs[0]
        right.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r = right.add_run(f'({number})'); font(r)

    def caption(self, kind, num, title):
        para(self.doc, f'<b>{kind} {num}</b>', align=L, first=0, line=1.15, before=8, after=2, keep_next=True)
        para(self.doc, f'<i>{title}</i>', align=L, first=0, line=1.15, after=6, keep_next=True)

    def note(self, text):
        para(self.doc, '<i>Note.</i> ' + text, align=J, first=0, line=1.15, before=4, after=10, size=10.5)

    def table(self, num, title, headers, rows, widths, aligns, note):
        d = self.doc
        self.caption('Table', num, title)
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
                rich(p, str(val), size=11, bold=(r == 0))
                edges = {'left': 0, 'right': 0, 'insideV': 0}
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
        if note:
            self.note(note)
        else:
            para(d, '', first=0, line=1.0, after=6, size=6)

    def figure(self, num, title, path, width, note):
        d = self.doc
        self.caption('Figure', num, title)
        p = para(d, '', align=C, first=0, line=1.0, before=2, after=4 if note else 12)
        p.add_run().add_picture(path, width=Inches(width))
        if note:
            para(d, '<i>Note.</i> ' + note, align=L, first=0, line=1.15, after=12, size=10.5)

    def declarations(self):
        self.h1('Declarations')
        for label, text in PC.DECLARATIONS:
            para(self.doc, f'<b>{label}.</b> {text}', first=0, after=4)

    def references(self):
        self.h1('References')
        for ref in PC.REFERENCES:
            para(self.doc, ref, align=L, line=1.5, after=4, hanging=0.5)

    def build(self):
        self.front()
        for blk in PC.body():
            kind = blk[0]
            if kind == 'h1':
                self.h1(blk[1])
            elif kind == 'h2':
                self.h2(blk[1])
            elif kind == 'p':
                self.p(blk[1])
            elif kind == 'p_noindent':
                self.p(blk[1], indent=False)
            elif kind == 'list':
                self.numbered(blk[1])
            elif kind == 'eq':
                self.equation(blk[1], blk[2])
            elif kind == 'table':
                self.table(*blk[1:])
            elif kind == 'figure':
                self.figure(*blk[1:])
        self.declarations()
        self.references()
        self.doc.save(DOCX)


def export():
    ps1 = os.path.join(HERE, 'export.ps1')
    open(ps1, 'w', encoding='utf-8').write(r'''
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open('%s', $false, $false)
  $doc.Fields.Update() | Out-Null
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
    words = len(re.sub(r'<[^>]+>', '', PC.ABSTRACT).split())
    print('abstract words:', words)
    Paper().build()
    export()
