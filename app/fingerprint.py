"""Portable fingerprint files: a profile <-> a small JSON document.

    {
      "schema": "whorl-fingerprint-v1",
      "title": "sample-manuscript.pdf",
      "generatedAt": "2026-09-19T00:00:00Z",
      "wordCount": 42318,
      "functionWordVersion": "v1-50word",
      "frequencies": {"the": 0.0612, "of": 0.0301, ...},
      "stats": {"vocabRichness": 0.61, ...}
    }

`frequencies` are each word's share of ALL words (0.0612 = 6.12%, i.e. 61.2 per
1,000). Absolute shares -- not values scaled to the file's own peak -- so two
fingerprints made from different documents stay directly comparable.

Everything under `stats` is optional on import; the sidebar simply skips metrics
a file doesn't carry. `frequencies` must cover every function word.
"""

import math
from datetime import datetime, timezone

from .extract import label_from_filename
from .function_words import FUNCTION_WORDS
from .stylometry import PUNCTUATION_MARKS, WORD_LENGTH_BUCKETS, SENTENCE_LENGTH_EDGES, words_from_rates

SCHEMA = "whorl-fingerprint-v1"
FUNCTION_WORD_VERSION = "v1-50word"
MAX_TITLE_CHARS = 120

SCALAR_STATS = {
    "unique_words": "uniqueWords",
    "type_token_ratio": "typeTokenRatio",
    "vocab_richness": "vocabRichness",
    "hapax_ratio": "hapaxRatio",
    "function_word_share": "functionWordShare",
    "avg_word_length": "avgWordLength",
    "long_word_share": "longWordShare",
    "sentence_count": "sentenceCount",
    "avg_sentence_length": "avgSentenceLength",
    "sentence_length_sd": "sentenceLengthSd",
    "flesch_reading_ease": "fleschReadingEase",
}
HISTOGRAMS = {
    "word_length_hist": ("wordLengthHist", WORD_LENGTH_BUCKETS),
    "sentence_length_hist": ("sentenceLengthHist", len(SENTENCE_LENGTH_EDGES) + 1),
}


def to_fingerprint(profile: dict) -> dict:
    # A profile imported from a sparse fingerprint has None for what the file
    # didn't carry; leave those out rather than inventing them.
    stats = profile["stats"]
    exported = {
        camel: stats[snake] for snake, camel in SCALAR_STATS.items()
        if stats.get(snake) is not None
    }
    punctuation = {k: v for k, v in stats["punctuation_per_1000"].items() if v is not None}
    if punctuation:
        exported["punctuationPer1000"] = punctuation
    for snake, (camel, _) in HISTOGRAMS.items():
        if stats.get(snake) is not None:
            exported[camel] = list(stats[snake])

    return {
        "schema": SCHEMA,
        "title": profile["label"],
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wordCount": stats["word_count"],
        "functionWordVersion": FUNCTION_WORD_VERSION,
        "frequencies": {w["word"]: round(w["rate"] / 1000, 8) for w in profile["words"]},
        "stats": exported,
    }


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def from_fingerprint(data, fallback_label: str = "Imported fingerprint") -> dict:
    """Validate an uploaded fingerprint and rebuild a profile from it.
    Raises ValueError with a user-facing message on anything malformed."""
    if not isinstance(data, dict):
        raise ValueError("is not a Whorl fingerprint (expected a JSON object)")
    if data.get("schema") != SCHEMA:
        raise ValueError(f"is not a Whorl fingerprint (expected schema {SCHEMA!r})")

    version = data.get("functionWordVersion", FUNCTION_WORD_VERSION)
    if version != FUNCTION_WORD_VERSION:
        raise ValueError(
            f"was made with function word list {version!r}; this version of "
            f"Whorl uses {FUNCTION_WORD_VERSION!r}"
        )

    word_count = _number(data.get("wordCount"))
    if word_count is None or word_count < 1 or word_count != int(word_count):
        raise ValueError("needs a positive whole-number wordCount")
    word_count = int(word_count)

    frequencies = data.get("frequencies")
    if not isinstance(frequencies, dict):
        raise ValueError("needs a frequencies object")

    shares = []
    for word in FUNCTION_WORDS:
        share = _number(frequencies.get(word))
        if share is None:
            raise ValueError(f"is missing a numeric frequency for {word!r}")
        if not 0 <= share <= 1:
            raise ValueError(f"has an out-of-range frequency for {word!r} (must be 0 to 1)")
        shares.append(share)
    if sum(shares) > 1.0001:
        raise ValueError(
            f"has frequencies summing to {sum(shares):.2f}; they must be each word's "
            f"share of all words (0.06 = 6%), so they can't add up to more than 1"
        )

    title = data.get("title")
    label = (title.strip()[:MAX_TITLE_CHARS] if isinstance(title, str) else "") or fallback_label
    label = label_from_filename(label)

    raw = data.get("stats") if isinstance(data.get("stats"), dict) else {}
    stats = {"word_count": word_count}
    for snake, camel in SCALAR_STATS.items():
        stats[snake] = _number(raw.get(camel))

    punctuation = raw.get("punctuationPer1000")
    punctuation = punctuation if isinstance(punctuation, dict) else {}
    stats["punctuation_per_1000"] = {name: _number(punctuation.get(name)) for name in PUNCTUATION_MARKS}

    for snake, (camel, size) in HISTOGRAMS.items():
        values = raw.get(camel)
        numbers = [_number(v) for v in values] if isinstance(values, list) else []
        ok = len(numbers) == size and all(n is not None and n >= 0 for n in numbers)
        stats[snake] = numbers if ok else None

    words = words_from_rates(
        (word, round(share * word_count), share * 1000)
        for word, share in zip(FUNCTION_WORDS, shares)
    )
    return {"label": label, "words": words, "stats": stats}
