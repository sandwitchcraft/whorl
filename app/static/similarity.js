/* How alike two texts are, as a 0-1 score with a breakdown.
 *
 * Function words carry 40% of the score and are measured the way stylometrists
 * usually do it: Burrows' Delta. Each word's rate is turned into a z-score
 * against the bundled sample texts (how many "typical author-to-author spreads"
 * above or below their average), and Delta is the mean absolute difference of
 * those z-scores between the two texts. Delta 0 means identical; the score is
 * exp(-Delta), so identical texts score 100%.
 *
 * Vocabulary, sentence and punctuation metrics carry 20% each. Each metric's
 * gap is measured against that metric's sample average, so "26 vs 20 words per
 * sentence" and "0.51 vs 0.55 richness" are both judged by how big the gap is
 * for that kind of number.
 *
 * Because the yardstick is the bundled samples, scores are relative to them:
 * reference() reports what those authors score against each other.
 */
const Similarity = (() => {
  const SD_FLOOR = 0.5;   // per-1000 floor so a word the samples barely vary on can't dominate

  const PUNCTUATION = ['comma', 'period', 'semicolon', 'colon', 'dash', 'question', 'exclamation', 'quote', 'paren'];
  const GROUPS = [
    { key: 'words', name: 'Function words', weight: 0.4 },
    { key: 'vocabulary', name: 'Vocabulary', weight: 0.2,
      metrics: [s => s.vocab_richness, s => s.hapax_ratio, s => s.avg_word_length, s => s.long_word_share] },
    { key: 'sentences', name: 'Sentences', weight: 0.2,
      metrics: [s => s.avg_sentence_length, s => s.sentence_length_sd, s => s.flesch_reading_ease] },
    { key: 'punctuation', name: 'Punctuation', weight: 0.2, floor: 1,   // per 1,000 words
      metrics: PUNCTUATION.map(key => s => s.punctuation_per_1000?.[key]) },
  ];

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

  /* Anything with rates + stats: a profile ({words, stats}) or a baseline sample. */
  const asSubject = x => ({ rates: x.rates || x.words.map(w => w.rate), stats: x.stats });

  /* What "typical" looks like, from the bundled samples. Null without a baseline. */
  function reference(baseline) {
    const samples = baseline?.samples;
    if (!samples || samples.length < 2) return null;

    const rates = samples.map(s => s.rates);
    const size = rates[0].length;
    const means = [];
    const sds = [];
    for (let i = 0; i < size; i++) {
      const column = rates.map(r => r[i]);
      const mu = mean(column);
      means.push(mu);
      sds.push(Math.max(Math.sqrt(mean(column.map(v => (v - mu) ** 2))), SD_FLOOR));
    }
    return { means, sds, stats: baseline.stats, samples };
  }

  function wordsScore(a, b, ref) {
    if (ref) {
      let sum = 0;
      for (let i = 0; i < a.rates.length; i++) {
        sum += Math.abs((a.rates[i] - b.rates[i]) / ref.sds[i]);   // = |za - zb|
      }
      const delta = sum / a.rates.length;
      return { score: Math.exp(-delta), delta };
    }
    // No baseline: fall back to Hellinger similarity of the two distributions.
    const share = r => { const t = r.reduce((x, y) => x + y, 0) || 1; return r.map(v => v / t); };
    const pa = share(a.rates);
    const pb = share(b.rates);
    const h = Math.sqrt(pa.reduce((s, v, i) => s + (Math.sqrt(v) - Math.sqrt(pb[i])) ** 2, 0) / 2);
    return { score: 1 - h, delta: null };
  }

  function groupScore(group, a, b, ref) {
    const scores = [];
    for (const get of group.metrics) {
      const va = get(a.stats);
      const vb = get(b.stats);
      if (!isNum(va) || !isNum(vb)) continue;
      const typical = ref ? get(ref.stats) : null;
      const scale = Math.max(isNum(typical) && typical > 0 ? typical : (Math.abs(va) + Math.abs(vb)) / 2, group.floor || 0, 1e-9);
      scores.push(Math.max(0, 1 - Math.abs(va - vb) / scale));
    }
    return scores.length ? mean(scores) : null;
  }

  /* { overall, delta, parts: [{ key, name, weight, score|null }] } */
  function compare(x, y, ref) {
    const a = asSubject(x);
    const b = asSubject(y);
    const words = wordsScore(a, b, ref);

    const parts = GROUPS.map(group => ({
      key: group.key,
      name: group.name,
      weight: group.weight,
      score: group.key === 'words' ? words.score : groupScore(group, a, b, ref),
    }));

    // A metric group a fingerprint file doesn't carry simply drops out.
    const present = parts.filter(p => p.score != null);
    const weight = present.reduce((s, p) => s + p.weight, 0);
    const overall = present.reduce((s, p) => s + p.score * p.weight, 0) / weight;
    return { overall, delta: words.delta, parts };
  }

  /* How the bundled samples score against each other: a yardstick for "different authors". */
  function yardstick(ref) {
    if (!ref) return null;
    const scores = [];
    for (let i = 0; i < ref.samples.length; i++) {
      for (let j = i + 1; j < ref.samples.length; j++) {
        scores.push(compare(ref.samples[i], ref.samples[j], ref).overall);
      }
    }
    return { min: Math.min(...scores), max: Math.max(...scores) };
  }

  return { reference, compare, yardstick };
})();
