"""Backend tests. Run from the repo root:  .venv/bin/python -m unittest discover tests"""

import io
import json
import unittest
import zipfile

from app.extract import ExtractError, extract_text, label_from_filename
from app.fingerprint import SCHEMA, from_fingerprint, to_fingerprint
from app.function_words import FUNCTION_WORDS
from app.stylometry import build_profile, count_syllables, moving_average_ttr, tokenize

SENTENCES = (
    "The quick brown fox jumps over the lazy dog. It was a bright cold day in April, "
    "and the clocks were striking thirteen; nobody had seen anything like it before! "
    "Which of them would speak first? Not one of the men, who had been waiting, said a word."
)
TEXT = " ".join([SENTENCES] * 6)


def make_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


class ExtractionTests(unittest.TestCase):
    def test_plain_text_and_markdown(self):
        self.assertEqual(extract_text("a.txt", b"Hello there."), "Hello there.")
        self.assertIn("café", extract_text("a.md", "café".encode("cp1252")))

    def test_utf16_text(self):
        self.assertEqual(extract_text("a.txt", "Hi there".encode("utf-16")), "Hi there")

    def test_html_drops_scripts_and_decodes_entities(self):
        html = b"<html><script>var x = 1;</script><p>Fish &amp; chips.</p><p>Second.</p></html>"
        text = extract_text("page.html", html)
        self.assertIn("Fish & chips.", text)
        self.assertNotIn("var x", text)
        self.assertIn("\n", text)

    def test_docx(self):
        document = (
            '<w:document xmlns:w="x"><w:body>'
            '<w:p><w:r><w:t>First &amp; foremost.</w:t></w:r><w:r><w:tab/></w:r></w:p>'
            '<w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>one.</w:t></w:r></w:p>'
            "</w:body></w:document>"
        )
        text = extract_text("a.docx", make_zip({"word/document.xml": document}))
        self.assertEqual(text.split("\n")[0], "First & foremost.")
        self.assertIn("Second one.", text)

    def test_odt(self):
        content = (
            "<office:document-content><office:body><office:text>"
            "<text:h>Title</text:h><text:p>One<text:s/>two &lt;three&gt;.</text:p>"
            "</office:text></office:body></office:document-content>"
        )
        text = extract_text("a.odt", make_zip({"content.xml": content}))
        self.assertIn("One two <three>.", text)
        self.assertIn("Title\n", text)

    def test_epub(self):
        book = make_zip({
            "mimetype": "application/epub+zip",
            "OEBPS/ch2.xhtml": "<html><body><p>Second chapter.</p></body></html>",
            "OEBPS/ch1.xhtml": "<html><body><p>First chapter.</p></body></html>",
            "OEBPS/style.css": "p { color: red }",
        })
        text = extract_text("a.epub", book)
        self.assertLess(text.index("First"), text.index("Second"))
        self.assertNotIn("color", text)

    def test_rejects_bad_inputs(self):
        with self.assertRaises(ExtractError):
            extract_text("a.pdf", b"not a pdf")
        with self.assertRaises(ExtractError):
            extract_text("a.epub", b"not a zip")
        with self.assertRaises(ExtractError):
            extract_text("a.docx", make_zip({"other.xml": "x"}))
        with self.assertRaises(ExtractError):
            extract_text("a.txt", b"\x00\x01\x02binary")
        with self.assertRaises(ExtractError):
            extract_text("a.doc", b"whatever")

    def test_labels_only_strip_known_extensions(self):
        self.assertEqual(label_from_filename("notes.epub"), "notes")
        self.assertEqual(label_from_filename("dir/sub/My Book.PDF"), "My Book")
        self.assertEqual(label_from_filename("Dr. Smith"), "Dr. Smith")


class MetricTests(unittest.TestCase):
    def test_curly_apostrophes_stay_one_word(self):
        self.assertEqual(tokenize("Didn’t stop"), ["didn't", "stop"])

    def test_syllables(self):
        self.assertEqual(
            [count_syllables(w) for w in ("the", "were", "table", "banana", "strengths")],
            [1, 1, 2, 3, 1],
        )

    def test_mattr_bounds(self):
        self.assertEqual(moving_average_ttr(["a"] * 50), 1 / 50)
        self.assertEqual(moving_average_ttr(["a", "b", "c", "d"]), 1.0)
        self.assertAlmostEqual(moving_average_ttr(list("abab") * 10, window=4), 0.5)

    def test_stats_shape(self):
        stats = build_profile(TEXT, "t")["stats"]
        self.assertEqual(stats["word_count"], len(tokenize(TEXT)))
        self.assertEqual(stats["sentence_count"], 24)
        self.assertAlmostEqual(sum(stats["word_length_hist"]), 1, places=2)
        self.assertAlmostEqual(sum(stats["sentence_length_hist"]), 1, places=2)
        self.assertEqual(len(stats["word_length_hist"]), 12)
        self.assertEqual(len(stats["sentence_length_hist"]), 7)
        self.assertGreater(stats["punctuation_per_1000"]["semicolon"], 0)
        self.assertGreater(stats["punctuation_per_1000"]["question"], 0)
        self.assertGreater(stats["punctuation_per_1000"]["exclamation"], 0)


class BaselineTests(unittest.TestCase):
    def test_baseline_carries_its_samples(self):
        from app.main import BASELINE, EXAMPLES

        self.assertEqual(len(BASELINE["samples"]), len(EXAMPLES))
        self.assertEqual(len(BASELINE["rates"]), len(FUNCTION_WORDS))
        for sample in BASELINE["samples"]:
            self.assertEqual(len(sample["rates"]), len(FUNCTION_WORDS))
            self.assertIn("vocab_richness", sample["stats"])
        # the average really is the mean of the samples
        first = sum(s["rates"][0] for s in BASELINE["samples"]) / len(BASELINE["samples"])
        self.assertAlmostEqual(BASELINE["rates"][0], first, places=3)


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.profile = build_profile(TEXT, "sample-manuscript")
        self.document = to_fingerprint(self.profile)

    def test_export_shape(self):
        self.assertEqual(self.document["schema"], SCHEMA)
        self.assertEqual(self.document["title"], "sample-manuscript")
        self.assertEqual(self.document["wordCount"], self.profile["stats"]["word_count"])
        self.assertEqual(list(self.document["frequencies"]), FUNCTION_WORDS)
        self.assertLessEqual(sum(self.document["frequencies"].values()), 1)
        json.dumps(self.document)  # serializable

    def test_round_trip_preserves_what_the_chart_uses(self):
        restored = from_fingerprint(json.loads(json.dumps(self.document)))
        self.assertEqual(restored["label"], "sample-manuscript")
        for before, after in zip(self.profile["words"], restored["words"]):
            self.assertEqual(before["word"], after["word"])
            self.assertEqual(before["count"], after["count"])
            self.assertAlmostEqual(before["rate"], after["rate"], places=3)
        for key in ("vocab_richness", "avg_sentence_length", "flesch_reading_ease"):
            self.assertEqual(self.profile["stats"][key], restored["stats"][key])
        self.assertEqual(
            self.profile["stats"]["punctuation_per_1000"], restored["stats"]["punctuation_per_1000"]
        )
        self.assertEqual(self.profile["stats"]["word_length_hist"], restored["stats"]["word_length_hist"])

    def test_minimal_file_is_accepted(self):
        minimal = {
            "schema": SCHEMA,
            "title": "bare.pdf",
            "wordCount": 1000,
            "frequencies": {w: 0.01 for w in FUNCTION_WORDS},
        }
        restored = from_fingerprint(minimal)
        self.assertEqual(restored["label"], "bare")
        self.assertIsNone(restored["stats"]["vocab_richness"])
        self.assertIsNone(restored["stats"]["word_length_hist"])
        self.assertEqual(restored["words"][0]["count"], 10)
        self.assertEqual(restored["words"][0]["rate"], 10.0)

    def test_sparse_import_can_be_exported_again(self):
        sparse = {
            "schema": SCHEMA,
            "title": "bare",
            "wordCount": 1000,
            "frequencies": {w: 0.01 for w in FUNCTION_WORDS},
            "stats": {"vocabRichness": 0.6},
        }
        again = to_fingerprint(from_fingerprint(sparse))
        self.assertEqual(again["stats"], {"vocabRichness": 0.6})
        self.assertEqual(again["frequencies"], sparse["frequencies"])
        from_fingerprint(again)  # and it is still a valid file

    def test_rejections(self):
        def broken(**changes):
            document = json.loads(json.dumps(self.document))
            document.update(changes)
            return document

        cases = {
            "wrong schema": broken(schema="something-else"),
            "wrong word list": broken(functionWordVersion="v2-100word"),
            "zero words": broken(wordCount=0),
            "fractional words": broken(wordCount=10.5),
            "string words": broken(wordCount="lots"),
            "no frequencies": broken(frequencies=[]),
            "missing word": broken(frequencies={"the": 0.05}),
            "negative": broken(frequencies={**self.document["frequencies"], "the": -0.1}),
            "peak-scaled values": broken(frequencies={w: 0.5 for w in FUNCTION_WORDS}),
        }
        for name, document in cases.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    from_fingerprint(document)
        with self.assertRaises(ValueError):
            from_fingerprint(["not", "an", "object"])

    def test_bad_optional_stats_are_dropped_not_fatal(self):
        document = json.loads(json.dumps(self.document))
        document["stats"]["vocabRichness"] = "high"
        document["stats"]["wordLengthHist"] = [1, 2, 3]
        restored = from_fingerprint(document)
        self.assertIsNone(restored["stats"]["vocab_richness"])
        self.assertIsNone(restored["stats"]["word_length_hist"])


if __name__ == "__main__":
    unittest.main()
