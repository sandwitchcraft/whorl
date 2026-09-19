"""Text -> stylometric profile. Pure functions, no I/O, no framework imports."""

import re
from collections import Counter

from .function_words import FUNCTION_WORDS

WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")
SENTENCE_RE = re.compile(r"[.!?]+(?:\s|$)")
PUNCTUATION_MARKS = {"comma": ",", "semicolon": ";", "colon": ":", "dash": "—-"}


def tokenize(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def function_word_frequencies(tokens: list[str]) -> list[dict]:
    """Per-1000-word rate for each function word, plus a 0-1 value scaled to the
    largest rate in this text (what the chart's arc sweep uses)."""
    counts = Counter(tokens)
    total = len(tokens)

    rates = [
        (word, (counts[word] / total * 1000) if total else 0.0)
        for word in FUNCTION_WORDS
    ]
    peak = max((rate for _, rate in rates), default=0.0)

    return [
        {
            "word": word,
            "count": counts[word],
            "rate": round(rate, 4),
            "normalized": round(rate / peak, 6) if peak else 0.0,
        }
        for word, rate in rates
    ]


def summary_stats(text: str, tokens: list[str]) -> dict:
    """Secondary stats: the candidates for the fingerprint's center reading."""
    total = len(tokens)
    sentences = [s for s in SENTENCE_RE.split(text) if s.strip()]

    return {
        "word_count": total,
        "unique_words": len(set(tokens)),
        "type_token_ratio": round(len(set(tokens)) / total, 4) if total else 0.0,
        "sentence_count": len(sentences),
        "avg_sentence_length": round(total / len(sentences), 2) if sentences else 0.0,
        "punctuation_per_1000": {
            name: round(sum(text.count(c) for c in chars) / total * 1000, 2)
            if total
            else 0.0
            for name, chars in PUNCTUATION_MARKS.items()
        },
    }


def build_profile(text: str, label: str) -> dict:
    """One author's fingerprint. The frontend renders a list of these -- one
    alone is the default view, two or more overlay as compare mode."""
    tokens = tokenize(text)
    return {
        "label": label,
        "words": function_word_frequencies(tokens),
        "stats": summary_stats(text, tokens),
    }
