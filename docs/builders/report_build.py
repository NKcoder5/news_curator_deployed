"""Builds the project report as .docx, exports it to PDF through Microsoft Word, then fills the
contents and lists with the page numbers Word actually produced (two passes)."""
import json
import os
import re
import subprocess
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

import report_content as RC

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, 'report')
DOCX = os.path.join(OUTDIR, 'Project_Report_CO5.docx')
PDF = os.path.join(OUTDIR, 'Project_Report_CO5.pdf')
LOGO = os.path.join(OUTDIR, 'logo.png')

J = WD_ALIGN_PARAGRAPH.JUSTIFY
C = WD_ALIGN_PARAGRAPH.CENTER
L = WD_ALIGN_PARAGRAPH.LEFT
R = WD_ALIGN_PARAGRAPH.RIGHT
FONT = 'Times New Roman'


# ----------------------------------------------------------------------------- primitives
def set_run_font(run, size=12, bold=False, italic=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.insert(0, rfonts)
    for attr in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rfonts.set(qn(attr), FONT)


def para(doc_or_cell, runs, align=J, first=0.5, line=1.5, before=0, after=12, left=0.0, keep_next=False,
         page_break=False, size=12, right=0.0):
    p = doc_or_cell.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = align
    pf.first_line_indent = Inches(first) if first else None
    pf.left_indent = Inches(left) if left else None
    pf.right_indent = Inches(right) if right else None
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.keep_with_next = keep_next
    pf.page_break_before = page_break
    pf.widow_control = True
    if isinstance(runs, str):
        runs = [(runs, {})]
    for text, fmt in runs:
        r = p.add_run(text)
        set_run_font(r, size=fmt.get('size', size), bold=fmt.get('bold', False), italic=fmt.get('italic', False))
    return p


def add_field(paragraph, instr, size=9):
    r = paragraph.add_run()
    set_run_font(r, size=size)
    b = OxmlElement('w:fldChar'); b.set(qn('w:fldCharType'), 'begin')
    t = OxmlElement('w:instrText'); t.set(qn('xml:space'), 'preserve'); t.text = instr
    s = OxmlElement('w:fldChar'); s.set(qn('w:fldCharType'), 'separate')
    v = OxmlElement('w:t'); v.text = '1'
    e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), 'end')
    r._element.append(b); r._element.append(t); r._element.append(s); r._element.append(v); r._element.append(e)


# Margins measured from the approved Kongu reference report: body text from 1.04" on the left to 1.07" from the
# right edge, starting 1" from the top and running to 0.7" from the bottom; page number 0.53" from the top edge
# and 0.5" from the right edge.
LEFT_MARGIN, RIGHT_MARGIN = 1.04, 1.07
TEXT_WIDTH = 8.5 - LEFT_MARGIN - RIGHT_MARGIN


def setup_section(sec):
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = Inches(1.0)
    sec.bottom_margin = Inches(0.7)
    sec.left_margin = Inches(LEFT_MARGIN)
    sec.right_margin = Inches(RIGHT_MARGIN)
    sec.header_distance = Inches(0.555)
    sec.footer_distance = Inches(0.4)


def page_numbers(sec, fmt, start):
    pg = sec._sectPr.find(qn('w:pgNumType'))
    if pg is None:
        pg = OxmlElement('w:pgNumType')
        sec._sectPr.append(pg)
    pg.set(qn('w:fmt'), fmt)
    pg.set(qn('w:start'), str(start))
    sec.header.is_linked_to_previous = False
    hp = sec.header.paragraphs[0]
    hp.paragraph_format.alignment = R
    hp.paragraph_format.space_after = Pt(0)
    # The number sits 0.5" from the right edge, outside the text block, as in the reference.
    hp.paragraph_format.right_indent = Inches(0.54 - RIGHT_MARGIN)
    add_field(hp, 'PAGE', size=9)


def no_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}'); el.set(qn('w:val'), 'nil'); borders.append(el)
    tblPr.append(borders)


def set_col_widths(table, widths):
    table.autofit = False
    tblPr = table._tbl.tblPr
    layout = OxmlElement('w:tblLayout'); layout.set(qn('w:type'), 'fixed'); tblPr.append(layout)
    for row in table.rows:
        for idx, w in enumerate(widths):
            row.cells[idx].width = Inches(w)
    grid = table._tbl.tblGrid
    for idx, gc in enumerate(grid.findall(qn('w:gridCol'))):
        gc.set(qn('w:w'), str(int(widths[idx] * 1440)))


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), hex_fill)
    tcPr.append(shd)


def cell_margins(table, top=40, bottom=40, left=90, right=90):
    tblPr = table._tbl.tblPr
    mar = OxmlElement('w:tblCellMar')
    for side, val in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        el = OxmlElement(f'w:{side}'); el.set(qn('w:w'), str(val)); el.set(qn('w:type'), 'dxa'); mar.append(el)
    tblPr.append(mar)


def no_split_rows(table, header=True):
    for i, row in enumerate(table.rows):
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement('w:cantSplit'); trPr.append(cs)
        if header and i == 0:
            th = OxmlElement('w:tblHeader'); trPr.append(th)


def cell_text(cell, runs, align=L, size=12, before=0, after=0, line=1.0, left=0.0):
    cell.paragraphs[0].text = ''
    p = cell.paragraphs[0]
    pf = p.paragraph_format
    pf.alignment = align
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.left_indent = Inches(left) if left else None
    if isinstance(runs, str):
        runs = [(runs, {})]
    for text, fmt in runs:
        r = p.add_run(text)
        set_run_font(r, size=fmt.get('size', size), bold=fmt.get('bold', False), italic=fmt.get('italic', False))
    return p


# ----------------------------------------------------------------------------- citations
CITE = re.compile(r'\[@([^\]]+)\]')


def resolve_citations(blocks):
    """Text cites works as [@key] or [@a; @b]. The base paper is reference 1; the rest are numbered in the order
    they are first cited. Every listed reference must be cited, and every citation must be listed."""
    order = [RC.BASE_PAPER]

    def walk(x, fn):
        if isinstance(x, str):
            return fn(x)
        if isinstance(x, (list, tuple)):
            return type(x)(walk(y, fn) for y in x)
        return x

    def scan(t):
        for m in CITE.finditer(t):
            for k in (k.strip().lstrip('@') for k in m.group(1).split(';')):
                if k not in order:
                    order.append(k)
        return t

    walk(blocks, scan)
    assert all(k in RC.REFERENCES for k in order), [k for k in order if k not in RC.REFERENCES]
    assert all(k in order for k in RC.REFERENCES), [k for k in RC.REFERENCES if k not in order]
    num = {k: i + 1 for i, k in enumerate(order)}

    def sub(t):
        def repl(m):
            keys = [k.strip().lstrip('@') for k in m.group(1).split(';')]
            return ', '.join(f'[{num[k]}]' for k in sorted(keys, key=num.get))
        return CITE.sub(repl, t)

    return walk(blocks, sub), order


# ----------------------------------------------------------------------------- building blocks
class Report:
    def __init__(self, pages):
        self.pages = pages or {}
        self.doc = Document()
        st = self.doc.styles['Normal']
        st.font.name = FONT
        st.font.size = Pt(12)
        rpr = st.element.get_or_add_rPr()
        rfonts = rpr.find(qn('w:rFonts'))
        if rfonts is None:
            rfonts = OxmlElement('w:rFonts'); rpr.insert(0, rfonts)
        for attr in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
            rfonts.set(qn(attr), FONT)
        lang = OxmlElement('w:lang'); lang.set(qn('w:val'), 'en-GB'); lang.set(qn('w:eastAsia'), 'en-GB')
        rpr.append(lang)
        st.paragraph_format.space_after = Pt(0)
        st.paragraph_format.space_before = Pt(0)
        st.paragraph_format.line_spacing = 1.0
        setup_section(self.doc.sections[0])
        self.figures = []   # (num, title)
        self.tables = []
        self.toc = []       # (chapter_no, title, level, key)

    def page_of(self, key):
        return self.pages.get(key, '00')

    # --- title page --------------------------------------------------------
    def title_page(self):
        d = self.doc
        def line(text, size, before, italic=False, bold=True):
            para(d, [(text, {'bold': bold, 'italic': italic})], align=C, first=0, line=1.0, before=before, after=0, size=size)
        line(RC.TITLE_LINES[0], 15, 27)
        line(RC.TITLE_LINES[1], 15, 9)
        line(RC.COURSE, 13, 22)
        line(RC.PHASE, 13, 20)
        line('Submitted by', 11, 4)
        gaps = [9, 15, 13]
        for (name, roll), gap in zip(RC.STUDENTS, gaps):
            line(name, 13, gap)
            line(roll, 11, 1)
        line('in partial fulfilment of the requirements for', 11, 13, italic=True)
        line('the award of the', 11, 2, italic=True)
        line('degree of', 11, 2, italic=True)
        line('BACHELOR OF ENGINEERING', 13, 13)
        line('IN', 13, 3)
        line('COMPUTER SCIENCE AND ENGINEERING', 13, 3)
        line('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', 13, 5)
        p = para(d, [], align=C, first=0, line=1.0, before=12, after=0)
        p.add_run().add_picture(LOGO, width=Inches(1.32))
        line('KONGU ENGINEERING COLLEGE', 13, 12)
        line('(Autonomous)', 13, 8)
        line('PERUNDURAI ERODE-638060', 13, 14)
        line(RC.MONTH_YEAR, 13, 8)

    def college_block(self, title, page_break=True):
        d = self.doc
        para(d, [('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', {'bold': True})], align=C, first=0, line=1.0,
             before=0, after=8, size=14, page_break=page_break)
        para(d, [('KONGU ENGINEERING COLLEGE', {'bold': True})], align=C, first=0, line=1.0, after=8, size=14)
        para(d, [('(Autonomous)', {'bold': True})], align=C, first=0, line=1.0, after=8, size=12)
        para(d, [('PERUNDURAI, ERODE-638060', {'bold': True})], align=C, first=0, line=1.0, after=8, size=12)
        para(d, [(RC.MONTH_YEAR, {'bold': True})], align=C, first=0, line=1.0, after=30, size=12)
        para(d, [(title, {'bold': True})], align=C, first=0, line=1.0, after=26, size=14)

    def bonafide(self):
        d = self.doc
        # The section break before this page already starts a new page.
        self.college_block('BONAFIDE CERTIFICATE', page_break=False)
        names = []
        for n, r in RC.STUDENTS:
            names.append((f'{n} ({r})', {'bold': True}))
            names.append((', ', {}))
        runs = [('This is to certify that the Project Report entitled ', {}), (RC.TITLE_ONE_LINE, {'bold': True}),
                (' is the bonafide record of project work done by ', {})] + names + [
               ('in partial fulfilment of the requirements for the award of the Degree of Bachelor of Engineering in ', {}),
               ('Computer Science and Engineering', {'bold': True}),
               (f' of Anna University, Chennai during the year {RC.ACADEMIC_YEAR}.', {})]
        para(d, runs, align=J, first=0, left=0.17, right=0.08, line=1.5, after=0)
        # Positions follow the approved reference: SUPERVISOR at the left, HEAD OF THE DEPARTMENT ending near
        # the right margin, and "(Signature with seal)" centred under it.
        hod_right = 6.30          # right edge of HEAD OF THE DEPARTMENT, from the left margin
        hod_centre = hod_right - 2.375 / 2
        p = para(d, [('SUPERVISOR', {'bold': True}), ('\tHEAD OF THE DEPARTMENT', {'bold': True})], align=L, first=0,
                 left=0.21, line=1.0, before=66, after=0, size=12)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(hod_right), WD_TAB_ALIGNMENT.RIGHT)
        p = para(d, [('\t(Signature with seal)', {'bold': True})], align=L, first=0, left=0, line=1.0, before=12,
                 after=0, size=11.5)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(hod_centre), WD_TAB_ALIGNMENT.CENTER)
        para(d, [('Date:', {'bold': True})], align=L, first=0, left=0.21, line=1.0, before=30, after=0, size=12)
        para(d, [('Submitted for the end semester viva voce examination held on ', {}),
                 ('______________________________', {})], align=L, first=0, left=0.04, line=1.0, before=40,
             after=0, size=12)
        p = para(d, [('INTERNAL EXAMINER', {'bold': True}), ('\tEXTERNAL EXAMINER', {'bold': True})], align=L,
                 first=0, left=0.26, line=1.0, before=52, after=0, size=11.5)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(6.02), WD_TAB_ALIGNMENT.RIGHT)

    def declaration(self):
        d = self.doc
        self.college_block('DECLARATION')
        runs = [('We affirm that the project titled ', {}), (RC.TITLE_ONE_LINE, {'bold': True}),
                (' being submitted in partial fulfilment of the requirements for the award of Degree of Bachelor of '
                 'Engineering is the original work carried out by us. It has not formed part of any other project report '
                 'or dissertation on the basis of which a degree or award was conferred on an earlier occasion on this or '
                 'any other candidate.', {})]
        para(d, runs, align=J, first=0, line=2.0, after=36)
        for n, r in RC.STUDENTS:
            para(d, [(n, {'bold': True})], align=R, first=0, line=1.0, after=2)
            para(d, [(f'({r})', {'bold': True})], align=R, first=0, line=1.0, after=26)
        para(d, 'I certify that the declaration made by the above candidates is true to the best of my knowledge.',
             align=L, first=0, line=1.0, before=28, after=40)
        p = para(d, [('Date:', {}), ('\tName & Signature of the Supervisor with seal', {})], align=L, first=0, line=1.0, after=0)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(TEXT_WIDTH), WD_TAB_ALIGNMENT.RIGHT)

    def heading_page(self, title, key, after=28):
        para(self.doc, [(title, {'bold': True})], align=C, first=0, line=1.0, after=after, size=14, page_break=True)
        self.toc.append(('', title, 1, key))

    def abstract(self):
        # As advised at review: only the first paragraph has a first-line indent.
        self.heading_page('ABSTRACT', 'front:abstract', after=46)
        for i, text in enumerate(RC.ABSTRACT):
            para(self.doc, text, align=J, first=0.5 if i == 0 else 0, line=1.5, after=14)

    def acknowledgement(self):
        d = self.doc
        para(d, [('ACKNOWLEDGEMENT', {'bold': True})], align=C, first=0, line=1.0, after=56, size=14, page_break=True)
        blocks = [
            [('Owing deeply to the supreme, we extend our thanks to the Almighty, who has blessed us to come out '
              'successfully with our project. We take pleasure in expressing our deep sense of gratitude to our beloved '
              'parents.', {})],
            [('We extend our hearty gratitude to our honourable Correspondent ', {}), ('Thiru. E.R.K. KRISHNAN M.Com.,', {'bold': True}),
             (' and other trust members for having provided us with all the necessary infrastructure to undertake our '
              'project. We extend our thanks to our Principal, ', {}), ('Dr. R. PARAMESHWARAN M.E., Ph.D.,', {'bold': True}),
             (' for his consistent encouragement throughout our college days.', {})],
            [('We express our deep sense of gratitude to ', {}), ('Dr. S. MALLIGA M.E., Ph.D.,', {'bold': True}),
             (' Head of the Department, for her constant support. We also express our sincere thanks to our project '
              'coordinator ', {}), ('Mr. N. ARAVINDHRAJ M.E., (Ph.D.),', {'bold': True}),
             (' Assistant Professor, for his constant encouragement for the development of our project.', {})],
            [('We take immense pleasure in expressing our heartfelt thanks to our supervisor, ', {}),
             (RC.SUPERVISOR + ',', {'bold': True}),
             (' Assistant Professor, Department of Computer Science and Engineering, for the valuable guidance '
              'throughout our project.', {})],
        ]
        for runs in blocks:
            para(d, runs, align=J, first=0.5, line=2.0, after=28)

    def toc_page(self):
        d = self.doc
        para(d, [('TABLE OF CONTENTS', {'bold': True})], align=C, first=0, line=1.0, after=22, size=14, page_break=True)
        rows = [('', 'ABSTRACT', 1, 'front:abstract'), ('', 'LIST OF FIGURES', 1, 'front:lof'),
                ('', 'LIST OF TABLES', 1, 'front:lot'), ('', 'LIST OF ABBREVIATIONS', 1, 'front:abbr')] + self.planned_toc
        t = d.add_table(rows=len(rows) + 1, cols=3)
        no_borders(t)
        set_col_widths(t, [1.45, 4.0, 0.95])
        cell_text(t.cell(0, 0), [('CHAPTER No.', {'bold': True})], align=L, after=10)
        cell_text(t.cell(0, 1), [('TITLE', {'bold': True})], align=C, after=10)
        cell_text(t.cell(0, 2), [('PAGE No.', {'bold': True})], align=C, after=10)
        for i, (num, title, level, key) in enumerate(rows, start=1):
            # As in the reference: chapter titles, the appendix and the back matter in bold; the front-matter
            # entries and the sections in regular weight; chapter numbers at the left.
            bold = level == 1 and not key.startswith('front:')
            cell_text(t.cell(i, 0), [(str(num), {'bold': True})], align=L, before=5, after=3, left=0.1)
            indent = {1: 0.0, 2: 0.0, 3: 0.3}[level]
            cell_text(t.cell(i, 1), [(title, {'bold': bold})], align=L, before=5, after=3, left=indent)
            cell_text(t.cell(i, 2), [(str(self.page_of(key)), {'bold': True})], align=C, before=5, after=3)
        no_split_rows(t, header=False)

    def list_page(self, heading, key, head_cols, items, prefix):
        d = self.doc
        para(d, [(heading, {'bold': True})], align=C, first=0, line=1.0, after=22, size=14, page_break=True)
        t = d.add_table(rows=len(items) + 1, cols=3)
        no_borders(t)
        set_col_widths(t, [1.15, 4.25, 0.95])
        for c, h in enumerate(head_cols):
            cell_text(t.cell(0, c), [(h, {'bold': True})], align=C if c != 1 else C, after=10)
        for i, (num, title) in enumerate(items, start=1):
            cell_text(t.cell(i, 0), num, align=C, before=4, after=4)
            cell_text(t.cell(i, 1), title, align=L, before=4, after=4)
            cell_text(t.cell(i, 2), str(self.page_of(f'{prefix}:{num}')), align=C, before=4, after=4)
        no_split_rows(t, header=False)

    def abbreviations(self):
        d = self.doc
        para(d, [('LIST OF ABBREVIATIONS', {'bold': True})], align=C, first=0, line=1.0, after=22, size=14, page_break=True)
        t = d.add_table(rows=len(RC.ABBREVIATIONS), cols=3)
        no_borders(t)
        set_col_widths(t, [1.4, 0.5, 4.3])
        for i, (a, e) in enumerate(RC.ABBREVIATIONS):
            cell_text(t.cell(i, 0), a, align=L, before=3, after=3, left=0.15)
            cell_text(t.cell(i, 1), '-', align=C, before=3, after=3)
            cell_text(t.cell(i, 2), e, align=L, before=3, after=3)

    # --- body ---------------------------------------------------------------
    # Heading spacing follows the reference: about one blank line above and below a section heading, a little
    # less for a subsection. Where one heading directly follows another, only the lower heading's space is used.
    def chapter(self, n, title, next_kind=None):
        d = self.doc
        para(d, [(f'CHAPTER {n}', {'bold': True})], align=C, first=0, line=1.5, after=14, size=14, page_break=True, keep_next=True)
        after = 0 if next_kind in ('section', 'subsection') else 42
        para(d, [(title, {'bold': True})], align=C, first=0, line=1.5, after=after, size=14, keep_next=True)

    def section(self, num, title, next_kind=None):
        after = 0 if next_kind == 'subsection' else 18
        para(self.doc, [(f'{num}  {title}', {'bold': True})], align=L, first=0, line=1.5, before=24, after=after, keep_next=True)

    def subsection(self, num, title, next_kind=None):
        para(self.doc, [(f'{num}  {title}', {'bold': True})], align=L, first=0, line=1.5, before=14, after=12, keep_next=True)

    def figure(self, num, path, width, title):
        d = self.doc
        p = para(d, [], align=C, first=0, line=1.0, before=6, after=6, keep_next=True)
        p.add_run().add_picture(path, width=Inches(width))
        para(d, [(f'Figure {num}', {}), ('    ' + title, {})], align=C, first=0, line=1.0, before=2, after=16)
        self.figures.append((num, title))

    def table(self, num, title, headers, rows, widths, aligns, size=11):
        d = self.doc
        para(d, [(f'Table {num}', {}), ('    ' + title, {})], align=C, first=0, line=1.0, before=6, after=8, keep_next=True)
        t = d.add_table(rows=len(rows) + 1, cols=len(headers))
        t.style = d.styles['Table Grid']
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_col_widths(t, widths)
        cell_margins(t)
        for c, h in enumerate(headers):
            cell = t.cell(0, c)
            cell_text(cell, [(h, {'bold': True})], align=C, size=size, before=2, after=2)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for r, row in enumerate(rows, start=1):
            for c, val in enumerate(row):
                al = {'left': L, 'center': C, 'right': R}[aligns[c]]
                cell = t.cell(r, c)
                cell_text(cell, str(val), align=al, size=size, before=2, after=2)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        no_split_rows(t)
        # Short tables are kept on one page. A long one may continue on the next
        # page with its header row repeated, rather than leaving half a page empty;
        # its first two rows stay with the caption.
        keep_rows = t.rows[:-1] if len(rows) <= 9 else t.rows[:3]
        for row in keep_rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    p.paragraph_format.keep_with_next = True
        para(d, '', align=L, first=0, line=1.0, after=10, size=6)
        self.tables.append((num, title))

    def bullets(self, items):
        for it in items:
            p = para(self.doc, [('•\t', {}), (it, {})], align=J, first=-0.3, left=0.55, line=1.5, after=6)
            p.paragraph_format.tab_stops.add_tab_stop(Inches(0.55))
        self.doc.paragraphs[-1].paragraph_format.space_after = Pt(12)

    def definition(self, label, text):
        para(self.doc, [(label, {'bold': True})], align=L, first=0, line=1.5, after=2, keep_next=True)
        para(self.doc, text, align=J, first=0, line=1.5, after=8)

    def equation(self, text):
        para(self.doc, [(text, {'italic': True})], align=C, first=0, line=1.5, before=0, after=12)

    def label_value(self, rows):
        t = self.doc.add_table(rows=len(rows), cols=3)
        no_borders(t)
        set_col_widths(t, [1.9, 0.3, TEXT_WIDTH - 0.55 - 2.2])
        tblPr = t._tbl.tblPr
        ind = OxmlElement('w:tblInd'); ind.set(qn('w:w'), str(int(0.55 * 1440))); ind.set(qn('w:type'), 'dxa'); tblPr.append(ind)
        for i, (k, v) in enumerate(rows):
            cell_text(t.cell(i, 0), k, align=L, before=3, after=6, line=1.15)
            cell_text(t.cell(i, 1), ':', align=C, before=3, after=6, line=1.15)
            cell_text(t.cell(i, 2), v, align=L, before=3, after=6, line=1.15)
        para(self.doc, '', align=L, first=0, line=1.0, after=6, size=6)

    def algorithm(self, title, io_lines, steps):
        d = self.doc
        para(d, [('Algorithm: ', {'bold': True}), (title, {'bold': True})], align=L, first=0, line=1.5, before=6, after=2, keep_next=True)
        for ln in io_lines:
            para(d, ln, align=L, first=0, line=1.5, after=0, keep_next=True)
        n = 0
        for s in steps:
            if s.startswith('-'):
                para(d, [('–\t', {}), (s.lstrip('- ').strip(), {})], align=L, first=-0.25, left=0.85, line=1.5, after=0)
                d.paragraphs[-1].paragraph_format.tab_stops.add_tab_stop(Inches(0.85))
            else:
                n += 1
                p = para(d, [(f'{n}.\t', {}), (s, {})], align=L, first=-0.3, left=0.35, line=1.5, after=0)
                p.paragraph_format.tab_stops.add_tab_stop(Inches(0.35))
        d.paragraphs[-1].paragraph_format.space_after = Pt(12)

    def appendix(self, n):
        para(self.doc, [(f'APPENDIX {n}', {'bold': True})], align=C, first=0, line=1.5, after=14, size=14, page_break=True, keep_next=True)

    def code(self, title, lines):
        d = self.doc
        para(d, [(title, {'bold': True})], align=L, first=0, line=1.5, before=10, after=4, keep_next=True)
        # Indentation by nesting level. Times New Roman is proportional, so lines that
        # continue the previous statement cannot be aligned by counting characters;
        # they are set one step deeper than the line they continue.
        structural = 0
        for ln in lines:
            stripped = ln.lstrip(' ')
            spaces = len(ln) - len(stripped)
            if len(ln) > 74:
                print('  WARNING long code line:', len(ln), ln)
            if spaces > 8:
                level = structural // 2 + 2
            else:
                level = spaces // 2
                structural = spaces
            p = para(d, stripped if stripped else '', align=L, first=0, left=0.25 + level * 0.3, line=1.5, after=0)
        d.paragraphs[-1].paragraph_format.space_after = Pt(10)

    def references(self):
        d = self.doc
        para(d, [('REFERENCES', {'bold': True})], align=C, first=0, line=1.0, after=24, size=14, page_break=True)
        for i, key in enumerate(self.ref_order, start=1):
            lead, venue, tail, link = RC.REFERENCES[key]
            para(d, [(f'{i}. {lead}', {}), (venue, {'italic': True}), (tail, {})], align=J, first=0, line=1.0, after=2)
            para(d, [('Available at: ' + link, {})], align=L, first=0, line=1.0, after=12)

    def sdg(self):
        d = self.doc
        para(d, [('SDG GOALS', {'bold': True})], align=C, first=0, line=1.0, after=20, size=14, page_break=True)
        for title, paras in RC.SDG:
            para(d, [(title, {'bold': True})], align=L, first=0, line=1.5, after=8, size=14)
            for text in paras:
                para(d, text, align=J, first=0.5, line=1.5, after=12)

    # --- plan the contents table from the body blocks -------------------------
    def plan(self, blocks):
        toc = []
        for b in blocks:
            if b[0] == 'chapter':
                toc.append((b[1], b[2], 1, f'ch:{b[1]}'))
            elif b[0] == 'section':
                toc.append(('', f'{b[1]} {b[2]}', 2, f'sec:{b[1]}'))
            elif b[0] == 'subsection':
                toc.append(('', f'{b[1]} {b[2]}', 3, f'sec:{b[1]}'))
            elif b[0] == 'appendix':
                toc.append(('', f'APPENDIX {b[1]}', 1, f'app:{b[1]}'))
        toc.append(('', 'REFERENCES', 1, 'back:refs'))
        toc.append(('', 'SDG GOALS', 1, 'back:sdg'))
        self.planned_toc = toc
        self.planned_figs = [(b[1], b[4]) for b in blocks if b[0] == 'figure']
        self.planned_tables = [(b[1], b[2]) for b in blocks if b[0] == 'table']

    def build(self):
        blocks, self.ref_order = resolve_citations(RC.content())
        self.plan(blocks)
        # Section 1: title page, no number
        self.title_page()
        # Section 2: front matter, lower-case roman from ii
        s2 = self.doc.add_section(WD_SECTION.NEW_PAGE)
        setup_section(s2)
        page_numbers(s2, 'lowerRoman', 2)
        self.bonafide()
        self.declaration()
        self.abstract()
        self.acknowledgement()
        self.toc_page()
        self.list_page('LIST OF FIGURES', 'front:lof', ['FIGURE No.', 'TITLE', 'PAGE No.'], self.planned_figs, 'fig')
        self.list_page('LIST OF TABLES', 'front:lot', ['TABLE No.', 'TITLE', 'PAGE No.'], self.planned_tables, 'tab')
        self.abbreviations()
        # Section 3: body, arabic from 1
        s3 = self.doc.add_section(WD_SECTION.NEW_PAGE)
        setup_section(s3)
        page_numbers(s3, 'decimal', 1)
        first = True
        for idx, b in enumerate(blocks):
            kind = b[0]
            next_kind = blocks[idx + 1][0] if idx + 1 < len(blocks) else None
            if kind == 'chapter':
                self.chapter(b[1], b[2], next_kind)
                if first:
                    self.doc.paragraphs[-2].paragraph_format.page_break_before = False
                    first = False
            elif kind == 'section':
                self.section(b[1], b[2], next_kind)
            elif kind == 'subsection':
                self.subsection(b[1], b[2], next_kind)
            elif kind == 'para':
                para(self.doc, b[1], align=J, first=0.5, line=1.5, after=12)
            elif kind == 'para_noindent':
                para(self.doc, b[1], align=J, first=0, line=1.5, after=8)
            elif kind == 'bullets':
                self.bullets(b[1])
            elif kind == 'figure':
                self.figure(b[1], b[2], b[3], b[4])
            elif kind == 'table':
                size = b[7] if len(b) > 7 else 11
                self.table(b[1], b[2], b[3], b[4], b[5], b[6], size=size)
            elif kind == 'equation':
                self.equation(b[1])
            elif kind == 'definition':
                self.definition(b[1], b[2])
            elif kind == 'label_value':
                self.label_value(b[1])
            elif kind == 'algorithm':
                self.algorithm(b[1], b[2], b[3])
            elif kind == 'appendix':
                self.appendix(b[1])
            elif kind == 'code':
                self.code(b[1], b[2])
            else:
                raise ValueError(kind)
        self.references()
        self.sdg()
        # The section break paragraphs carry page breaks of their own; the first heading
        # of each new section must not add a second one.
        self.doc.save(DOCX)


# ----------------------------------------------------------------------------- Word export
PS1 = os.path.join(OUTDIR, 'export.ps1')


def export_pdf(spell_report=None):
    script = r'''
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
  $doc.SaveAs2('%s', 17)
  %s
  $doc.Close($false)
  "pages=$pages"
} finally { $word.Quit() }
''' % (DOCX, PDF, (r'''
  $doc.Content.LanguageID = 2057
  $errs = @()
  foreach ($e in $doc.Range().SpellingErrors) { $errs += $e.Text }
  ($errs | Sort-Object -Unique) -join "`n" | Out-File -Encoding utf8 '%s'
''' % spell_report) if spell_report else '')
    open(PS1, 'w', encoding='utf-8').write(script)
    out = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1],
                         capture_output=True, text=True, timeout=1500)
    print(out.stdout.strip(), out.stderr.strip()[:500])


# ----------------------------------------------------------------------------- page map
def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def roman(n):
    vals = [(10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]
    out = ''
    for v, sym in vals:
        while n >= v:
            out += sym; n -= v
    return out


def page_map(rep):
    import pymupdf
    d = pymupdf.open(PDF)
    texts = [norm(p.get_text()) for p in d]
    # Find where the body starts: the first page whose text begins with CHAPTER 1.
    body_start = next(i for i, t in enumerate(texts) if t.startswith('1chapter1introduction') or 'chapter1introduction' in t[:60])
    def label(i):
        return str(i - body_start + 1) if i >= body_start else roman(i + 1)
    pages = {}
    def find(key, needle, start=0, end=None, front=False):
        n = norm(needle)
        rng = range(start, end if end is not None else len(texts))
        for i in rng:
            if n in texts[i]:
                pages[key] = label(i)
                return i
        print('  NOT FOUND', key, needle)
        return None
    # front matter: the heading must start the page (after the page number)
    for key, title in [('front:abstract', 'ABSTRACT'), ('front:lof', 'LIST OF FIGURES'), ('front:lot', 'LIST OF TABLES'),
                       ('front:abbr', 'LIST OF ABBREVIATIONS')]:
        nt = norm(title)
        for i in range(1, body_start):
            t = texts[i]
            if t.lstrip('ivx').startswith(nt):
                pages[key] = label(i); break
    cursor = body_start
    for num, title, level, key in rep.planned_toc:
        if key.startswith('ch:'):
            i = find(key, f'CHAPTER {num} {title}', cursor)
        elif key.startswith('sec:'):
            i = find(key, title, cursor)
        elif key.startswith('app:'):
            i = find(key, title, cursor)
        elif key == 'back:refs':
            i = find(key, 'REFERENCES 1.', cursor)
        elif key == 'back:sdg':
            i = find(key, 'SDG GOALS', cursor)
        if i is not None:
            cursor = i
    for num, title in rep.planned_figs:
        find(f'fig:{num}', f'Figure {num} {title}', body_start)
    for num, title in rep.planned_tables:
        find(f'tab:{num}', f'Table {num} {title}', body_start)
    return pages, d.page_count, body_start


if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    pages = {}
    for attempt in range(3):
        rep = Report(pages)
        rep.build()
        export_pdf(os.path.join(OUTDIR, 'spelling.txt') if attempt == 2 else None)
        new_pages, total, body_start = page_map(rep)
        print(f'pass {attempt + 1}: {total} pages, body starts at PDF page {body_start + 1}')
        if new_pages == pages:
            if attempt < 2:
                rep = Report(pages); rep.build()
                export_pdf(os.path.join(OUTDIR, 'spelling.txt'))
            break
        pages = new_pages
    json.dump(pages, open(os.path.join(OUTDIR, 'page_map.json'), 'w'), indent=1)
    print('done')
