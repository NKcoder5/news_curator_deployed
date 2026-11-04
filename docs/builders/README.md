# Document builders

The scripts that produce the report, the NICOM paper and the final-review deck. Every number in them is read
from `backend/eval/results` and `backend/eval/suites`, so a document is rebuilt rather than edited by hand.
Needs Python with python-docx, python-pptx, matplotlib, pymupdf and latex2mathml, plus Microsoft Word and
PowerPoint for the PDF export.

| Document | Build | Output (copy into `docs/`) |
|---|---|---|
| Project report | `python figures.py` then `python report_build.py` | `report/Project_Report_CO5.docx`, `.pdf` → `docs/report/Project_Report_CO5_final.*` |
| NICOM paper | `python paper/paper2_build.py` | `paper/NICOM_Paper_CO5.docx`, `.pdf` → `docs/paper/NICOM_Paper_CO5_final.*` |
| Final-review deck | `python deck/final_deck.py` | writes `docs/review/REVIEW_FINAL_CO5.pptx` from `REVIEW3_CO5.pptx` |

`report/shots` holds the application screenshots and `report/figs`, `paper/figs` the figures as last drawn.
