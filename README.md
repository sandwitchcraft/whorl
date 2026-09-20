# Whorl
*An artist's concept of stylometric fingerprints*

<img width="1678" height="1048" alt="upload" src="https://github.com/user-attachments/assets/b25c4633-9356-4618-915f-57e2c78a1a43" />


Whorl is an *authorial fingerprint visualizer tool*. In plain english, it's able to take an uploaded piece of text, extract the functional word frequencies (how often you use *like* vs *as*, *their*, etc.) that can connect an author to its source.

You can upload a document and get a visual fingerprint of the author's style, drawn as a
spiral from how often they use 50 common function words. Compare up to four texts.

It accepts PDF, EPUB, DOCX, ODT, HTML, TXT, Markdown, pasted text, or a saved
fingerprint (`.json`). Documents are processed in memory and never stored.

<img width="1678" height="1048" alt="result" src="https://github.com/user-attachments/assets/2cd06559-caca-4c07-b943-f17499a48255" />

## Try it on the web!

Visit [whorl.onrender.com](https://whorl.onrender.com) to give it a try! (Don't mind the waiting time for it to start...)


## Run locally

Needs Python 3.14 and [uv](https://docs.astral.sh/uv/).

```
uv sync
uv run uvicorn app.main:app --reload
```

Then open http://localhost:8000.

## Deploy on Docker


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
