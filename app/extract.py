"""Document text extraction: PDF, EPUB, DOCX, ODT, HTML, and plain text.

PDF: pypdfium2 is the primary extractor -- ~25x faster than pdfplumber because
it skips the per-character layout reconstruction we never use. pdfplumber stays
as a fallback for awkward files pdfium returns little or nothing for.

Everything else is standard library only. Office/EPUB files are zip archives of
XML/HTML; we pull the text out with regexes and html.parser rather than a full
XML parser (no entity-expansion attack surface), and refuse archives that would
unpack to an absurd size.
"""

import codecs
import io
import re
import zipfile
from html import unescape
from html.parser import HTMLParser
from pathlib import PurePosixPath

import pdfplumber
import pypdfium2 as pdfium

MIN_USABLE_CHARS = 200
MAX_UNPACKED_BYTES = 200 * 1024 * 1024

PDF_EXTENSIONS = {".pdf"}
ZIP_EXTENSIONS = {".epub", ".docx", ".odt"}
HTML_EXTENSIONS = {".html", ".htm", ".xhtml"}
TEXT_EXTENSIONS = {".txt", ".text", ".md", ".markdown"}
DOCUMENT_EXTENSIONS = PDF_EXTENSIONS | ZIP_EXTENSIONS | HTML_EXTENSIONS | TEXT_EXTENSIONS

BLOCK_TAGS = {
    "p", "div", "br", "li", "tr", "blockquote", "pre", "section", "article",
    "h1", "h2", "h3", "h4", "h5", "h6",
}


class ExtractError(ValueError):
    """A file we can explain why we can't read. The message completes the
    sentence "<filename> ..." and is safe to show to the user."""


def extension_of(filename: str | None) -> str:
    return PurePosixPath((filename or "").replace("\\", "/")).suffix.lower()


def label_from_filename(filename: str | None) -> str:
    """A display name: the file name minus a known document extension, so
    "Dr. Smith" stays intact while "notes.epub" becomes "notes"."""
    name = PurePosixPath((filename or "Untitled").replace("\\", "/")).name
    if extension_of(name) in DOCUMENT_EXTENSIONS | {".json"}:
        return name.rsplit(".", 1)[0]
    return name


# ---- PDF ----

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


# ---- Plain text and HTML ----

def decode_text(data: bytes) -> str:
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skipping = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skipping += 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skipping = max(0, self._skipping - 1)
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skipping:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _HTMLText()
    parser.feed(markup)
    parser.close()
    return "".join(parser.parts)


# ---- Zip-based formats ----

def _open_zip(data: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ExtractError("is not a valid archive")
    if sum(info.file_size for info in archive.infolist()) > MAX_UNPACKED_BYTES:
        raise ExtractError("is too large once unpacked")
    return archive


def _read_member(archive: zipfile.ZipFile, name: str) -> str:
    try:
        return decode_text(archive.read(name))
    except KeyError:
        raise ExtractError(f"is missing {name}")


def _epub_text(archive: zipfile.ZipFile) -> str:
    chapters = sorted(
        name for name in archive.namelist()
        if extension_of(name) in HTML_EXTENSIONS
    )
    if not chapters:
        raise ExtractError("has no readable chapters")
    return "\n".join(html_to_text(decode_text(archive.read(name))) for name in chapters)


def _docx_text(archive: zipfile.ZipFile) -> str:
    xml = _read_member(archive, "word/document.xml")
    paragraphs = []
    for chunk in xml.split("</w:p>"):
        runs = re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", chunk)
        paragraphs.append(unescape("".join(runs)))
    return "\n".join(paragraphs)


def _odt_text(archive: zipfile.ZipFile) -> str:
    xml = _read_member(archive, "content.xml")
    xml = re.sub(r"</text:(?:p|h)>", "\n", xml)
    xml = re.sub(r"<text:(?:s|tab|line-break)\b[^>]*/>", " ", xml)
    return unescape(re.sub(r"<[^>]+>", "", xml))


_ZIP_EXTRACTORS = {".epub": _epub_text, ".docx": _docx_text, ".odt": _odt_text}


# ---- Entry point ----

def extract_text(filename: str | None, data: bytes) -> str:
    """Text of an uploaded document. Raises ExtractError with a message that
    completes the sentence "<filename> ..." when the file is unusable."""
    ext = extension_of(filename)

    if ext in PDF_EXTENSIONS:
        if not data.startswith(b"%PDF-"):
            raise ExtractError("is not a valid PDF")
        return extract_pdf_text(data)

    if ext in ZIP_EXTENSIONS:
        if not data.startswith(b"PK"):
            raise ExtractError(f"is not a valid {ext[1:].upper()} file")
        return _ZIP_EXTRACTORS[ext](_open_zip(data))

    if ext in HTML_EXTENSIONS | TEXT_EXTENSIONS:
        is_utf16 = data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE))
        if not is_utf16 and b"\x00" in data[:4096]:
            raise ExtractError("looks like a binary file, not text")
        text = decode_text(data)
        return html_to_text(text) if ext in HTML_EXTENSIONS else text

    raise ExtractError("is not a supported file type")
