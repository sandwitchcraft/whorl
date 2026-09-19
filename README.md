# Whorl

Upload a document and get a visual fingerprint of the author's style, drawn as a
spiral from how often they use 50 common function words. Compare up to four texts.

Accepts PDF, EPUB, DOCX, ODT, HTML, TXT, Markdown, pasted text, or a saved
fingerprint (`.json`). Documents are processed in memory and never stored.

## Run locally

Needs Python 3.14 and [uv](https://docs.astral.sh/uv/).

```
uv sync
uv run uvicorn app.main:app --reload
```

Then open http://localhost:8000.

## Tests

```
uv run python -m unittest discover tests
```

## Deploy

Whorl is one process: FastAPI serves both the API and the frontend, so there is
no CORS to configure and nothing else to host. Any host that runs a Dockerfile
works (Render, Railway, Fly.io, Google Cloud Run, ...):

1. Point the host at this repo and choose the Docker build option.
2. The container listens on `$PORT` (default 8000); hosts set it for you.
3. Set the health check path to `/health`.

Or without Docker, use the host's Python runtime with the start command
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`. The lockfile requires
Python 3.14, which not every host offers yet -- the Dockerfile avoids that.

There is no rate limiting: each request can be a 20 MB upload that costs CPU,
so put the host's own limits or a proxy in front of it before sharing widely.
