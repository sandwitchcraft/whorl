"""PDF text extraction.

pypdfium2 is the primary extractor -- ~25x faster than pdfplumber because it
skips the per-character layout reconstruction we never use. pdfplumber stays as
a fallback for awkward files pdfium returns little or nothing for.
"""

import io

import pdfplumber
import pypdfium2 as pdfium

MIN_USABLE_CHARS = 200


def _extract_pdfium(data: bytes) -> str:
    doc = pdfium.PdfDocument(io.BytesIO(data))
    try:
        pages = []
        for page in doc:
            textpage = page.get_textpage()
            try:
                pages.append(textpage.get_text_bounded())
            finally:
                textpage.close()
                page.close()
        return "\n".join(pages)
    finally:
        doc.close()


def _extract_pdfplumber(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def extract_pdf_text(data: bytes) -> str:
    try:
        text = _extract_pdfium(data)
    except Exception:
        text = ""

    if len(text.strip()) >= MIN_USABLE_CHARS:
        return text

    fallback = _extract_pdfplumber(data)
    return fallback if len(fallback.strip()) > len(text.strip()) else text
