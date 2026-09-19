import json
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .extract import (
    DOCUMENT_EXTENSIONS,
    ExtractError,
    decode_text,
    extension_of,
    extract_text,
    label_from_filename,
)
from .fingerprint import from_fingerprint, to_fingerprint
from .stylometry import average_stats, build_profile, tokenize

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_FINGERPRINT_BYTES = 1024 * 1024
MAX_PROFILES = 4
MIN_WORDS = 100

FINGERPRINT_EXTENSION = ".json"
SUPPORTED_HINT = (
    "PDF, EPUB, DOCX, ODT, HTML, TXT, Markdown, or a Whorl fingerprint (.json)"
)

STATIC_DIR = Path(__file__).parent / "static"
EXAMPLES = json.loads((Path(__file__).parent / "data" / "examples.json").read_text())


def _build_baseline() -> dict:
    """The average of the bundled example texts. It gives a single fingerprint
    something to be compared against ("you use 'which' 2x more than the samples")."""
    profiles = [build_profile(v["text"], v["author"]) for v in EXAMPLES.values()]
    rates = [
        round(sum(p["words"][i]["rate"] for p in profiles) / len(profiles), 4)
        for i in range(len(profiles[0]["words"]))
    ]
    return {
        "label": f"Sample average ({len(profiles)} bundled texts)",
        "rates": rates,
        "stats": average_stats([p["stats"] for p in profiles]),
        # The individual texts, so the client can judge how far apart two
        # authors are *relative to how much these samples differ* (see similarity.js).
        "samples": [
            {
                "label": p["label"],
                "rates": [w["rate"] for w in p["words"]],
                "stats": p["stats"],
            }
            for p in profiles
        ],
    }


BASELINE = _build_baseline()

app = FastAPI(title="Whorl", description="Stylometric fingerprints from text.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _profile_from_text(label: str, text: str, empty_message: str | None = None) -> dict:
    if not text.strip():
        raise HTTPException(422, empty_message or f"{label!r} has no readable text.")
    if len(tokenize(text)) < MIN_WORDS:
        raise HTTPException(
            422, f"{label!r} has too little text to fingerprint "
                 f"(need at least {MIN_WORDS} words)."
        )
    return build_profile(text, label)


async def _profile_from_upload(upload: UploadFile) -> dict:
    name = upload.filename or "Untitled"
    ext = extension_of(name)
    if ext != FINGERPRINT_EXTENSION and ext not in DOCUMENT_EXTENSIONS:
        raise HTTPException(400, f"{name!r} isn't a supported file type. Use {SUPPORTED_HINT}.")

    is_fingerprint = ext == FINGERPRINT_EXTENSION
    limit = MAX_FINGERPRINT_BYTES if is_fingerprint else MAX_UPLOAD_BYTES
    data = await upload.read()
    if len(data) > limit:
        raise HTTPException(413, f"{name!r} exceeds {limit // (1024 * 1024)} MB.")

    if is_fingerprint:
        try:
            document = json.loads(decode_text(data))
        except Exception:
            raise HTTPException(400, f"{name!r} is not valid JSON.")
        try:
            return from_fingerprint(document, label_from_filename(name))
        except ValueError as err:
            raise HTTPException(422, f"{name!r} {err}.")

    try:
        text = extract_text(name, data)
    except ExtractError as err:
        raise HTTPException(400, f"{name!r} {err}.")
    except Exception:
        raise HTTPException(422, f"Could not read text from {name!r}.")

    empty_message = (
        f"{name!r} has no selectable text -- it looks like a scanned or image-only "
        f"PDF. Try a text-based PDF, or paste the text."
        if ext == ".pdf" else None
    )
    return _profile_from_text(label_from_filename(name), text, empty_message)


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
    """Accepts documents (PDF, EPUB, ...), saved fingerprints, pasted text, and/or
    bundled example ids. Always returns a list of profiles: one renders alone,
    several overlay. Each profile carries its own downloadable `fingerprint`."""
    has_text = bool(text and text.strip())
    count = int(has_text) + len(example_ids) + len(files)
    if count == 0:
        raise HTTPException(400, f"Provide a file ({SUPPORTED_HINT}) or some text.")
    if count > MAX_PROFILES:
        raise HTTPException(400, f"At most {MAX_PROFILES} sources at a time.")

    profiles: list[dict] = []
    if has_text:
        profiles.append(_profile_from_text(label or "Pasted text", text))
    for example_id in example_ids:
        example = EXAMPLES.get(example_id)
        if example is None:
            raise HTTPException(404, f"No example named {example_id!r}.")
        profiles.append(_profile_from_text(example["author"], example["text"]))
    for upload in files:
        profiles.append(await _profile_from_upload(upload))

    for profile in profiles:
        profile["fingerprint"] = to_fingerprint(profile)

    return {"profiles": profiles, "baseline": BASELINE}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


# Mounted last so it cannot shadow the API routes above.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
