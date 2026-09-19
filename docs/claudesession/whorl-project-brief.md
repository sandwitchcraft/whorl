# Whorl — project brief

A stylometry-to-art tool for a creativity hackathon. Upload a document, get back
a unique visual "fingerprint" of the author's writing style, built from function
word frequency.

**Name:** Whorl — pronounced like "whirl" (/wɜːrl/). Also the real forensic term
for a spiral fingerprint ridge pattern, which is the literal shape the chart draws.

---

## Concept

1. Person uploads a PDF (or pastes text).
2. Backend extracts the text and counts how often ~50 common function words
   appear ("the," "of," "which," "but," etc.), normalized against total word count.
3. Frontend renders those frequencies as a **spiral arc chart**: each function
   word gets its own radius (like a set of nested rings), and its frequency is
   drawn as an arc whose *length* — not its position — encodes the value.
4. The chart animates continuously, swinging between all arcs aligned at 12
   o'clock ("together") and each arc rotated to its own offset ("out"), so the
   piece is never fully static.
5. Default output is a single author's fingerprint, exportable as an image.
   Comparing two authors (overlaid) is a secondary mode, not the default.

---

## Visual design — chosen direction: spiral arc chart

Two other chart forms were prototyped and set aside: a plain circular bar plot
(too chart-like) and concentric ring layers (too illegible as data on their own,
though the ring *structure* — one word per radius — carries over into the spiral).
A polar-area "bloom" and a spline radar were also tried and dropped in favor of
the spiral.

**How the spiral arc chart works:**
- Each function word sits at its own radius: `radius = innerStart + i * step`,
  where `i` is the word's index in the function-word list.
- Each word's value is drawn as an arc at that radius. Arc *length* (angular
  sweep) encodes frequency: `sweep = normalizedFrequency * maxSweep` (maxSweep
  was ~1.72π in the prototype, tune to taste).
- Start angle is **not** fixed — each word's arc starts at a rotated offset
  using the golden angle (`goldenAngle = 2.399963` radians, ~137.5°) so the
  rotation never falls into an obvious repeating pattern:
  `targetAngle = (i * goldenAngle) % (2π)`.
- The chart **animates** by interpolating each arc's start angle between 0
  (every arc aligned at the top — "together") and its own `targetAngle`
  ("out"), looping continuously with a smooth sine-based ease:
  ```js
  const cycleMs = 7000;
  d3.timer(elapsed => {
    const t = (elapsed % cycleMs) / cycleMs;
    const phase = (1 - Math.cos(t * 2 * Math.PI)) / 2; // smooth 0→1→0
    // startAngle = targetAngle * phase
  });
  ```
- No background guide rings, spokes, or axis labels — the arcs alone carry the
  piece. (An earlier version had these for reference; they were deliberately
  removed once the shape was legible on its own.)
- A decorative "filler" arc (extra line with no data behind it, just texture)
  was tried and then explicitly rejected — every line on the chart should map
  to real data, nothing purely ornamental.

**Center of the fingerprint (still open):**
Real fingerprints have a literal named "core" point. Candidates discussed for
what to put there, not yet decided:
- A single composite score (vocabulary richness / type-token ratio, or average
  sentence length) as a filled dot whose size/color reflects the value.
- Punctuation rhythm (comma/semicolon/dash frequency) as small tick marks
  clustered at the center, distinct in scale from the outer word rings.
- Current mockups keep this stat in a sidebar panel instead of embedded in the
  chart itself, to avoid cluttering the art — worth revisiting.

---

## Design tokens

```
--ink:       #12141c   (background)
--card:      #1c202e   (panel background)
--paper:     #ece7da   (primary text)
--paper-dim: #b8b2a2   (secondary text)
--gold:      #c9a66b   (author A / primary accent)
--teal:      #5f9691   (author B / secondary accent, compare mode)
--hair:      rgba(236, 231, 218, 0.1)   (hairline borders, used sparingly)
```

Typography: **Fraunces** (serif, display/headlines) + **Inter** (sans, body/UI).
Loaded via Google Fonts. No AI-default fonts (Inter is fine for body copy,
just never for headlines).

---

## Screens (mockups exist, static, no functionality wired up)

1. **Upload** — headline + PDF dropzone (with a hidden `<input type="file">`
   + `<label>` for accessibility) + "or paste text instead" fallback + decorative
   spiral SVG as hero art.
2. **Result** — single fingerprint centered, sidebar with: center-reading stat
   card, ranked list of most-distinctive words with mini bars, "Export as PNG"
   (primary action), "Compare with another author" (secondary, links to Compare).
3. **Compare** — two fingerprints overlaid (gold + teal), removable chips per
   author up top, per-author stat cards, a called-out "largest divergence" word,
   "Export comparison as PNG."

Single-author is the default path; compare is explicitly opt-in, not the
starting state.

---

## Tech stack

**Backend — Python, FastAPI** (over Flask): free request validation, auto
docs, good for moving fast without hand-debugging malformed requests mid-demo.
One real endpoint needed: `POST /analyze`, takes a PDF upload, returns JSON of
normalized function-word frequencies (and any secondary stats, e.g. TTR).

**PDF extraction — pdfplumber**: more reliable than PyPDF2 across varied PDF
formatting. Test early against a few different real-world PDFs, not just your
own — this is the step most likely to break on a submitted file.

**Function word counting — plain Python**, no NLP library needed:
`re` for tokenization + `collections.Counter` for frequency, normalized by
total word count. Deliberately skipping spaCy/NLTK here — one less dependency
that could break mid-hackathon, and unnecessary for counting a fixed list.

**Frontend — HTML + vanilla D3.js**, no framework. D3 is a low-level SVG
toolkit, not a chart library — you assemble the chart type yourself, which is
why the spiral arc chart (not a stock chart type anywhere) is possible. Core
idiom: shape generators (`d3.arc()`, `d3.line()`) take data in, return an SVG
path string, which gets appended to the page. `d3.timer()` handles the
animation loop (see swing animation above).

**Serving** — have FastAPI serve the frontend as a static route rather than
standing up a separate frontend host. Avoids CORS entirely, one deployable
unit instead of two.

**Fallback plan** — if backend setup eats more time than expected, **pdf.js**
can extract PDF text entirely client-side, no Python backend, no deployment.
Legitimate insurance policy, not the primary plan (gives up the "built in
Python" story for extraction).

**Export** — serialize the SVG to a string → draw onto an off-screen
`<canvas>` → `canvas.toBlob()` → trigger download as PNG.

---

## Function word list (~50 words, placeholder — swap freely)

```python
FUNCTION_WORDS = [
    "the", "of", "and", "a", "to", "in", "is", "was", "it", "for",
    "with", "as", "his", "on", "be", "at", "by", "this", "had", "not",
    "are", "but", "from", "or", "have", "an", "they", "which", "one", "you",
    "were", "her", "all", "she", "there", "would", "their", "we", "him", "been",
    "has", "when", "who", "will", "more", "no", "if", "out", "so", "said",
]
```

---

## Data model note (for single vs compare refactor)

Prototype code currently hardcodes exactly two authors (`authorA`, `authorB`)
in every drawing function. For real implementation, refactor to a list of
"profiles" instead of two fixed slots — one profile renders alone (default),
two-or-more render overlaid (compare mode) — so the drawing functions loop
over however many profiles exist rather than assuming a fixed count of two.

---

## Reference artifacts from this session

- Working D3 spiral arc chart prototype (interactive, live-editable):
  https://claude.ai/artifact/77MQA6mrf29ojgXXRY6z14
- Static screen mockups (Upload / Result / Compare):
  https://claude.ai/artifact/XCCZMZNwxetjNBEs9ZrF63

---

## Open questions going into build

- What exactly goes at the fingerprint's center (see above) — not decided.
- SVG/vector export in addition to PNG? Raised, not resolved.
- Should the swing animation extend to other/backup chart forms, or stay
  unique to the spiral as the one moment of motion in the piece?
