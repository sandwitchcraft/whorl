from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .extract import extract_pdf_text
from .stylometry import build_profile, tokenize

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PROFILES = 4
MIN_WORDS = 100

app = FastAPI(title="Whorl", description="Stylometric fingerprints from text.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


async def _read_upload(upload: UploadFile) -> str:
    if not (upload.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, f"{upload.filename!r} is not a PDF.")

    data = await upload.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{upload.filename!r} exceeds 20 MB.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, f"{upload.filename!r} is not a valid PDF.")

    try:
        return extract_pdf_text(data)
    except Exception:
        raise HTTPException(422, f"Could not read text from {upload.filename!r}.")


def _label_from_filename(filename: str | None) -> str:
    stem = (filename or "Untitled").rsplit("/", 1)[-1]
    return stem[:-4] if stem.lower().endswith(".pdf") else stem


@app.post("/analyze")
async def analyze(
    files: list[UploadFile] = File(default=[]),
    text: str | None = Form(default=None),
    label: str | None = Form(default=None),
) -> dict:
    """Accepts PDF uploads and/or pasted text. Always returns a list of
    profiles: one renders alone, several overlay as compare mode."""
    sources: list[tuple[str, str]] = []

    if text and text.strip():
        sources.append((label or "Pasted text", text))
    for upload in files:
        sources.append((_label_from_filename(upload.filename), await _read_upload(upload)))

    if not sources:
        raise HTTPException(400, "Provide at least one PDF file or some text.")
    if len(sources) > MAX_PROFILES:
        raise HTTPException(400, f"At most {MAX_PROFILES} sources at a time.")

    for source_label, source_text in sources:
        if len(tokenize(source_text)) < MIN_WORDS:
            raise HTTPException(
                422, f"{source_label!r} has too little text to fingerprint "
                     f"(need at least {MIN_WORDS} words)."
            )

    return {
        "profiles": [build_profile(t, source_label) for source_label, t in sources]
    }
