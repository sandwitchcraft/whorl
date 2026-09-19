import json
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .extract import extract_pdf_text
from .stylometry import build_profile, tokenize

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PROFILES = 4
MIN_WORDS = 100

STATIC_DIR = Path(__file__).parent / "static"
EXAMPLES = json.loads((Path(__file__).parent / "data" / "examples.json").read_text())

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
        text = extract_pdf_text(data)
    except Exception:
        raise HTTPException(422, f"Could not read text from {upload.filename!r}.")

    if not text.strip():
        raise HTTPException(
            422,
            f"{upload.filename!r} has no selectable text -- it looks like a "
            f"scanned or image-only PDF. Try a text-based PDF, or paste the text.",
        )
    return text


def _label_from_filename(filename: str | None) -> str:
    stem = (filename or "Untitled").rsplit("/", 1)[-1]
    return stem[:-4] if stem.lower().endswith(".pdf") else stem


@app.get("/examples")
def examples() -> dict:
    return {
        "examples": [
            {"id": key, "title": v["title"], "author": v["author"],
             "words": len(v["text"].split())}
            for key, v in EXAMPLES.items()
        ]
    }


@app.post("/analyze")
async def analyze(
    files: list[UploadFile] = File(default=[]),
    text: str | None = Form(default=None),
    label: str | None = Form(default=None),
    example_ids: list[str] = Form(default=[]),
) -> dict:
    """Accepts PDF uploads, pasted text, and/or bundled example ids. Always
    returns a list of profiles: one renders alone, several overlay."""
    sources: list[tuple[str, str]] = []

    if text and text.strip():
        sources.append((label or "Pasted text", text))
    for example_id in example_ids:
        example = EXAMPLES.get(example_id)
        if example is None:
            raise HTTPException(404, f"No example named {example_id!r}.")
        sources.append((example["author"], example["text"]))
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


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


# Mounted last so it cannot shadow the API routes above.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
