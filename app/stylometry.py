"""Text -> stylometric profile. Pure functions, no I/O, no framework imports."""

import re
import statistics
from collections import Counter

from .function_words import FUNCTION_WORDS

WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")
SENTENCE_RE = re.compile(r"[.!?]+(?:\s|$)")
LONE_PERIOD_RE = re.compile(r"(?<!\.)\.(?!\.)")

# name -> the literal strings counted for it
PUNCTUATION_MARKS = {
    "comma": (",",),
    "period": None,  # counted with LONE_PERIOD_RE so ellipses don't inflate it
    "semicolon": (";",),
    "colon": (":",),
    "dash": ("—", "–", "--"),
    "question": ("?",),
    "exclamation": ("!",),
    "quote": ("“", "”", '"'),
    "paren": ("(",),
}

LONG_WORD_LETTERS = 7
WORD_LENGTH_BUCKETS = 12                                # 1..11 letters, then 12+
SENTENCE_LENGTH_EDGES = (5, 10, 15, 20, 30, 40)         # buckets: <=5, <=10, ... , 41+
MATTR_WINDOW = 500


def tokenize(text: str) -> list[str]:
    # Curly apostrophes would otherwise split "didn't" into "didn" + "t".
    return WORD_RE.findall(text.lower().replace("’", "'"))


def function_word_frequencies(tokens: list[str]) -> list[dict]:
    """Per-1000-word rate for each function word, plus a 0-1 value scaled to the
    largest rate in this text (what the chart's arc sweep uses)."""
    counts = Counter(tokens)
    total = len(tokens)
    return words_from_rates(
        (word, counts[word], (counts[word] / total * 1000) if total else 0.0)
        for word in FUNCTION_WORDS
    )


def words_from_rates(rows) -> list[dict]:
    """rows: (word, count, rate per 1000) in FUNCTION_WORDS order."""
    rows = list(rows)
    peak = max((rate for _, _, rate in rows), default=0.0)
    return [
        {
            "word": word,
            "count": count,
            "rate": round(rate, 4),
            "normalized": round(rate / peak, 6) if peak else 0.0,
        }
        for word, count, rate in rows
    ]


def moving_average_ttr(tokens: list[str], window: int = MATTR_WINDOW) -> float:
    """Type-token ratio averaged over sliding windows. Plain TTR falls as a text
    gets longer, so it can't compare an essay against a novel; this can."""
    n = len(tokens)
    if n == 0:
        return 0.0
    w = min(window, n)
    counts = Counter(tokens[:w])
    distinct = len(counts)
    total = distinct
    for i in range(w, n):
        leaving = tokens[i - w]
        counts[leaving] -= 1
        if counts[leaving] == 0:
            distinct -= 1
        arriving = tokens[i]
        if counts[arriving] == 0:
            distinct += 1
        counts[arriving] += 1
        total += distinct
    return total / (w * (n - w + 1))


def count_syllables(word: str) -> int:
    """Rough English syllable count -- good enough for a reading-ease estimate."""
    word = word.replace("'", "")
    n = len(re.findall(r"[aeiouy]+", word))
    if n > 1 and word.endswith("e") and not word.endswith(("le", "ee", "ie", "ye")):
        n -= 1
    return max(1, n)


def _bucket_shares(weighted_values, edges: tuple[int, ...]) -> list[float]:
    """Share of total weight falling in each bucket; edges are inclusive upper bounds."""
    shares = [0] * (len(edges) + 1)
    for value, weight in weighted_values:
        i = 0
        while i < len(edges) and value > edges[i]:
            i += 1
        shares[i] += weight
    total = sum(shares)
    return [round(s / total, 4) if total else 0.0 for s in shares]


def summary_stats(text: str, tokens: list[str]) -> dict:
    """Everything the sidebar compares besides the function words themselves."""
    total = len(tokens)
    counts = Counter(tokens)
    unique = len(counts)

    sentence_lengths = [
        n for n in (len(tokenize(s)) for s in SENTENCE_RE.split(text)) if n > 0
    ]
    sentences = len(sentence_lengths)

    letters = {word: len(word.replace("'", "")) for word in counts}
    total_letters = sum(letters[w] * c for w, c in counts.items())
    long_words = sum(c for w, c in counts.items() if letters[w] >= LONG_WORD_LETTERS)

    avg_sentence = total / sentences if sentences else 0.0
    syllables = sum(count_syllables(w) * c for w, c in counts.items())
    flesch = (
        206.835 - 1.015 * avg_sentence - 84.6 * (syllables / total)
        if total and sentences else 0.0
    )

    punctuation = {}
    for name, marks in PUNCTUATION_MARKS.items():
        n = (
            len(LONE_PERIOD_RE.findall(text)) if marks is None
            else sum(text.count(m) for m in marks)
        )
        punctuation[name] = round(n / total * 1000, 2) if total else 0.0

    return {
        "word_count": total,
        "unique_words": unique,
        "type_token_ratio": round(unique / total, 4) if total else 0.0,
        "vocab_richness": round(moving_average_ttr(tokens), 4),
        "hapax_ratio": round(sum(1 for c in counts.values() if c == 1) / unique, 4)
        if unique else 0.0,
        "function_word_share": round(sum(counts[w] for w in FUNCTION_WORDS) / total, 4)
        if total else 0.0,
        "avg_word_length": round(total_letters / total, 3) if total else 0.0,
        "long_word_share": round(long_words / total, 4) if total else 0.0,
        "sentence_count": sentences,
        "avg_sentence_length": round(avg_sentence, 2),
        "sentence_length_sd": round(statistics.pstdev(sentence_lengths), 2)
        if sentences > 1 else 0.0,
        "flesch_reading_ease": round(flesch, 1),
        "punctuation_per_1000": punctuation,
        "word_length_hist": _bucket_shares(
            ((letters[w], c) for w, c in counts.items()),
            tuple(range(1, WORD_LENGTH_BUCKETS)),
        ),
        "sentence_length_hist": _bucket_shares(
            ((n, 1) for n in sentence_lengths), SENTENCE_LENGTH_EDGES
        ),
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


def average_stats(all_stats: list[dict]):
    """Element-wise mean of stats dicts (recursing into dicts and lists)."""
    first = all_stats[0]
    if isinstance(first, dict):
        return {k: average_stats([s[k] for s in all_stats]) for k in first}
    if isinstance(first, list):
        return [average_stats(list(col)) for col in zip(*all_stats)]
    return round(sum(all_stats) / len(all_stats), 4)
