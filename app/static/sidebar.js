/* The result sidebar: Summary / Metrics / Words tabs.
 *
 * With one profile everything is read against the bundled sample average (the
 * `baseline` the API sends); with two or more, profiles are read against each
 * other. Every number here comes from the profiles -- metrics may be null for
 * fingerprints imported from a file that didn't carry them, and are skipped.
 */
const Sidebar = (() => {
  const TABS = ['summary', 'metrics', 'words'];
  const RATE_FLOOR = 0.5;          // per-1000 smoothing so rare words don't blow up ratios
  const MIN_GAP_RATE = 1;          // ignore words rarer than this in the "gaps" ranking
  const MIN_ALIKE_RATE = 5;        // "most alike" only means something for common words
  const WORDS_SHOWN = 8;

  const pct = v => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  const fixed = digits => v => v.toFixed(digits);

  /* key/get read a metric out of a profile's stats; rank=false keeps a metric
   * out of the "biggest gaps" callouts because it mostly tracks text length. */
  const METRICS = [
    { group: 'Vocabulary', label: 'Vocabulary richness', get: s => s.vocab_richness, fmt: fixed(2),
      hint: 'Average share of distinct words across sliding 500-word windows. Unlike a plain type-token ratio it does not fall as a text gets longer.' },
    { group: 'Vocabulary', label: 'Type–token ratio', get: s => s.type_token_ratio, fmt: fixed(3), rank: false,
      hint: 'Unique words divided by total words. Drops as a text gets longer, so only compare texts of similar length.' },
    { group: 'Vocabulary', label: 'One-off words', get: s => s.hapax_ratio, fmt: pct,
      hint: 'Share of the vocabulary used exactly once.' },
    { group: 'Vocabulary', label: 'Unique words', get: s => s.unique_words, fmt: v => Math.round(v).toLocaleString(), rank: false },
    { group: 'Vocabulary', label: 'Function-word share', get: s => s.function_word_share, fmt: pct,
      hint: 'How much of the text is made of the 50 tracked function words.' },

    { group: 'Sentences', label: 'Average sentence length', get: s => s.avg_sentence_length, fmt: v => `${v.toFixed(1)} words` },
    { group: 'Sentences', label: 'Sentence variation', get: s => s.sentence_length_sd, fmt: v => `±${v.toFixed(1)}`,
      hint: 'Standard deviation of sentence length in words. High means a mix of short and long sentences.' },
    { group: 'Sentences', label: 'Reading ease', get: s => s.flesch_reading_ease, fmt: fixed(0), scale: [0, 100],
      hint: 'Approximate Flesch reading ease. Higher is easier; 60–70 is plain English.' },

    { group: 'Words', label: 'Letters per word', get: s => s.avg_word_length, fmt: fixed(2) },
    { group: 'Words', label: 'Long words (7+ letters)', get: s => s.long_word_share, fmt: pct },

    ...[
      ['comma', 'Commas'], ['period', 'Periods'], ['semicolon', 'Semicolons'], ['colon', 'Colons'],
      ['dash', 'Dashes'], ['question', 'Question marks'], ['exclamation', 'Exclamation marks'],
      ['quote', 'Quotation marks'], ['paren', 'Parentheses'],
    ].map(([key, label]) => ({
      group: 'Punctuation per 1,000 words', label, get: s => s.punctuation_per_1000?.[key], fmt: fixed(1),
    })),
  ];

  const DISTRIBUTIONS = [
    { title: 'Word length', key: 'word_length_hist',
      labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12+'] },
    { title: 'Sentence length (words)', key: 'sentence_length_hist',
      labels: ['≤5', '6–10', '11–15', '16–20', '21–30', '31–40', '41+'] },
  ];

  const state = { tab: 'summary', wordsMode: 'used', gapMeasure: 'diff' };
  let profiles = [];
  let baseline = null;

  /* ---- DOM helpers (text only ever goes in as text nodes) ---- */

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') Object.assign(node.style, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const dot = index => h('span', { class: 'dot', style: { background: Spiral.colorFor(index) } });
  const card = (...children) => h('div', { class: 'card' }, children);
  const label = text => h('div', { class: 'card-label' }, text);
  const note = (...children) => h('div', { class: 'stat-note' }, children);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  function segmented(options, current, onPick) {
    return h('div', { class: 'segmented', role: 'group' }, options.map(([value, text]) =>
      h('button', {
        type: 'button',
        class: value === current ? 'is-active' : null,
        'aria-pressed': String(value === current),
        onclick: () => onPick(value),
      }, text)));
  }

  /* ---- Computations ---- */

  /* Hellinger similarity of the two function-word distributions (100% = identical). */
  function similarity(a, b) {
    const dist = p => {
      const total = p.words.reduce((sum, w) => sum + w.rate, 0) || 1;
      return p.words.map(w => w.rate / total);
    };
    const pa = dist(a);
    const pb = dist(b);
    let sum = 0;
    pa.forEach((v, i) => { sum += (Math.sqrt(v) - Math.sqrt(pb[i])) ** 2; });
    return 1 - Math.sqrt(sum / 2);
  }

  /* The things being compared: every profile, or (alone) the profile vs the sample. */
  function subjects() {
    if (profiles.length > 1) {
      return profiles.map((p, i) => ({ name: p.label, stats: p.stats, rates: p.words.map(w => w.rate), color: i }));
    }
    const own = { name: profiles[0].label, stats: profiles[0].stats, rates: profiles[0].words.map(w => w.rate), color: 0 };
    if (!baseline) return [own];
    return [own, { name: baseline.label, stats: baseline.stats, rates: baseline.rates, baseline: true }];
  }

  function comparisonBasis() {
    return profiles.length > 1
      ? `Between ${profiles.length} texts`
      : (baseline ? `Against the ${baseline.label.charAt(0).toLowerCase()}${baseline.label.slice(1)}` : '');
  }

  function metricGaps() {
    const who = subjects();
    if (who.length < 2) return [];

    return METRICS.filter(m => m.rank !== false).map(metric => {
      const points = who.map(s => ({ subject: s, value: metric.get(s.stats) })).filter(p => isNum(p.value));
      if (points.length < 2) return null;
      const hi = points.reduce((a, b) => (b.value > a.value ? b : a));
      const lo = points.reduce((a, b) => (b.value < a.value ? b : a));
      const mean = (hi.value + lo.value) / 2;
      if (mean <= 0 || hi.value === lo.value) return null;
      return { metric, hi, lo, gap: (hi.value - lo.value) / mean };
    }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  }

  function wordGaps(measure) {
    const who = subjects();
    return profiles[0].words.map((w, i) => {
      const points = who.map(s => ({ subject: s, rate: s.rates[i] }));
      const hi = points.reduce((a, b) => (b.rate > a.rate ? b : a));
      const lo = points.reduce((a, b) => (b.rate < a.rate ? b : a));
      return {
        word: w.word, index: i, points, hi, lo,
        diff: hi.rate - lo.rate,
        ratio: (hi.rate + RATE_FLOOR) / (lo.rate + RATE_FLOOR),
      };
    }).filter(g => g.hi.rate >= MIN_GAP_RATE && g.hi.rate !== g.lo.rate)
      .sort((a, b) => (measure === 'ratio' ? b.ratio - a.ratio : b.diff - a.diff));
  }

  /* ---- Shared pieces ---- */

  function subjectMark(subject) {
    return subject.baseline ? h('span', { class: 'dot is-hollow' }) : dot(subject.color);
  }

  function valueOf(metric, stats) {
    const v = metric.get(stats);
    return isNum(v) ? v : null;
  }

  /* A bar per profile on a shared scale, with a tick at the sample average. */
  function metricRow(metric) {
    const values = profiles.map(p => valueOf(metric, p.stats));
    if (values.every(v => v == null)) return null;

    const base = baseline ? valueOf(metric, baseline.stats) : null;
    const [lo, hi] = metric.scale
      || [0, (Math.max(...values.filter(isNum), base ?? 0) * 1.12) || 1];
    const at = v => `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;

    const lines = profiles.map((p, i) => h('div', { class: 'metric-line' },
      h('div', { class: 'metric-track' },
        values[i] != null && h('div', { class: 'bar-fill', style: { width: at(values[i]), background: Spiral.colorFor(i) } }),
        base != null && h('span', { class: 'tick', style: { left: at(base) } })),
      h('span', { class: 'metric-val' }, values[i] == null ? '—' : metric.fmt(values[i]))));

    return h('div', { class: 'metric', title: metric.hint },
      h('div', { class: 'metric-name' },
        metric.label,
        base != null && h('span', { class: 'metric-base' }, `sample ${metric.fmt(base)}`)),
      lines);
  }

  function distributionCard({ title, key, labels }) {
    const series = profiles.map((p, i) => ({ name: p.label, color: Spiral.colorFor(i), values: p.stats[key] }))
      .filter(s => Array.isArray(s.values));
    const base = baseline && Array.isArray(baseline.stats[key])
      ? { name: baseline.label, color: '#8b8578', values: baseline.stats[key], dashed: true } : null;
    if (!series.length) return null;

    const W = 300, H = 112, padX = 8, top = 8, bottom = 22;
    const all = [...series, ...(base ? [base] : [])];
    const max = Math.max(...all.flatMap(s => s.values)) * 1.12 || 1;
    const x = i => padX + (i / (labels.length - 1)) * (W - padX * 2);
    const y = v => top + (1 - v / max) * (H - top - bottom);

    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('class', 'dist-chart').attr('role', 'img')
      .attr('aria-label', `${title} distribution`);
    labels.forEach((text, i) => {
      svg.append('text').attr('x', x(i)).attr('y', H - 6).attr('text-anchor', 'middle')
        .attr('class', 'dist-label').text(text);
    });
    svg.append('line').attr('x1', padX).attr('x2', W - padX).attr('y1', H - bottom).attr('y2', H - bottom)
      .attr('stroke', 'rgba(236,231,218,0.12)');

    const line = d3.line().x((_, i) => x(i)).y(v => y(v)).curve(d3.curveMonotoneX);
    const area = d3.area().x((_, i) => x(i)).y0(H - bottom).y1(v => y(v)).curve(d3.curveMonotoneX);
    for (const s of [...(base ? [base] : []), ...series]) {
      if (!s.dashed) svg.append('path').attr('d', area(s.values)).attr('fill', s.color).attr('fill-opacity', 0.1);
      svg.append('path').attr('d', line(s.values)).attr('fill', 'none').attr('stroke', s.color)
        .attr('stroke-width', s.dashed ? 1.2 : 1.8).attr('stroke-dasharray', s.dashed ? '3 3' : null);
    }
    for (const s of series) {
      s.values.forEach((v, i) => {
        svg.append('circle').attr('cx', x(i)).attr('cy', y(v)).attr('r', 6).attr('fill', 'transparent')
          .append('title').text(`${s.name} — ${labels[i]}: ${(v * 100).toFixed(1)}%`);
      });
    }

    return card(
      label(`${title} distribution`),
      svg.node(),
      base && note(h('span', { class: 'legend-dash' }), ` ${base.name}`));
  }

  /* ---- Summary tab ---- */

  function tile(name, value) {
    return h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, value), h('div', { class: 'tile-name' }, name));
  }

  function callouts() {
    const alone = profiles.length === 1;
    const items = [];

    const words = wordGaps('diff').slice(0, 3).map(g => {
      const ratio = g.ratio >= 1.15 ? ` (${g.ratio.toFixed(1)}×)` : '';
      return h('li', {},
        h('strong', {}, `“${g.word}”`), ' ',
        subjectMark(g.hi.subject), ` ${g.hi.rate.toFixed(1)} vs `, subjectMark(g.lo.subject),
        ` ${g.lo.rate.toFixed(1)} per 1,000${ratio}`);
    });
    if (words.length) items.push(h('div', { class: 'callout-group' }, h('div', { class: 'callout-title' }, 'Function words'), h('ul', {}, words)));

    const metrics = metricGaps().slice(0, 4).map(g => {
      const ratio = g.lo.value > 0 ? ` (${(g.hi.value / g.lo.value).toFixed(1)}×)` : '';
      return h('li', {},
        h('strong', {}, g.metric.label), ' ',
        subjectMark(g.hi.subject), ` ${g.metric.fmt(g.hi.value)} vs `, subjectMark(g.lo.subject),
        ` ${g.metric.fmt(g.lo.value)}${ratio}`);
    });
    if (metrics.length) items.push(h('div', { class: 'callout-group' }, h('div', { class: 'callout-title' }, 'Style metrics'), h('ul', {}, metrics)));

    if (!items.length) return null;
    return card(label(alone ? 'What stands out' : 'Biggest gaps'), items,
      alone && baseline && note(h('span', { class: 'dot is-hollow' }), ` = ${baseline.label}`));
  }

  function summaryTab() {
    const cards = [];

    if (profiles.length === 1) {
      const s = profiles[0].stats;
      if (isNum(s.vocab_richness)) {
        cards.push(card(
          label('Center reading'),
          h('div', { class: 'stat-value' }, s.vocab_richness.toFixed(2)),
          note('Vocabulary richness — how varied the word choice is, measured over sliding 500-word windows. The core of the print scales with it.')));
      }
      cards.push(card(
        label('At a glance'),
        h('div', { class: 'tiles' },
          tile('words', s.word_count.toLocaleString()),
          isNum(s.unique_words) && tile('unique', s.unique_words.toLocaleString()),
          isNum(s.avg_sentence_length) && tile('words / sentence', s.avg_sentence_length.toFixed(1)),
          isNum(s.avg_word_length) && tile('letters / word', s.avg_word_length.toFixed(2)),
          isNum(s.flesch_reading_ease) && tile('reading ease', s.flesch_reading_ease.toFixed(0)),
          isNum(s.function_word_share) && tile('function words', pct(s.function_word_share)))));
    } else {
      cards.push(card(
        label('Texts'),
        profiles.map((p, i) => h('div', { class: 'text-row' },
          dot(i), h('span', { class: 'text-name' }, p.label),
          h('span', { class: 'text-meta' }, `${p.stats.word_count.toLocaleString()} words`)))));

      const pairs = [];
      for (let a = 0; a < profiles.length; a++) {
        for (let b = a + 1; b < profiles.length; b++) pairs.push([a, b, similarity(profiles[a], profiles[b])]);
      }
      cards.push(card(
        label('Function-word similarity'),
        profiles.length === 2
          ? h('div', { class: 'stat-value' }, pct(pairs[0][2]))
          : pairs.sort((x, y) => y[2] - x[2]).map(([a, b, v]) => h('div', { class: 'text-row' },
            dot(a), dot(b), h('span', { class: 'text-name' }, `${profiles[a].label} / ${profiles[b].label}`),
            h('span', { class: 'text-meta' }, pct(v)))),
        note('How closely the texts spread their use of the 50 function words (100% = identical). English writers are broadly alike here, so read it as a ranking, not a verdict.')));
    }

    const gaps = callouts();
    if (gaps) cards.push(gaps);
    return cards;
  }

  /* ---- Metrics tab ---- */

  function metricsTab() {
    const cards = [];
    const groups = [...new Set(METRICS.map(m => m.group))];

    groups.forEach((group, gi) => {
      const rows = METRICS.filter(m => m.group === group).map(metricRow).filter(Boolean);
      if (!rows.length) return;
      cards.push(card(
        label(group),
        rows,
        gi === 0 && baseline && note(h('span', { class: 'tick-key' }), ` marks the ${baseline.label.charAt(0).toLowerCase()}${baseline.label.slice(1)}`)));
    });

    for (const spec of DISTRIBUTIONS) {
      const chart = distributionCard(spec);
      if (chart) cards.push(chart);
    }
    return cards.length ? cards : [card(note('This fingerprint file carries no extra metrics.'))];
  }

  /* ---- Words tab ---- */

  function mostUsedRows() {
    const order = profiles[0].words.map((_, i) => i)
      .sort((a, b) => profiles.reduce((s, p) => s + p.words[b].rate, 0) - profiles.reduce((s, p) => s + p.words[a].rate, 0))
      .slice(0, WORDS_SHOWN);
    const peak = Math.max(...order.flatMap(i => profiles.map(p => p.words[i].rate)),
      ...(baseline ? order.map(i => baseline.rates[i]) : [0])) * 1.05 || 1;

    return order.map(i => h('div', { class: 'word-row' },
      h('div', { class: 'label' }, profiles[0].words[i].word),
      h('div', { class: 'stack' }, profiles.map((p, pi) => {
        const rate = p.words[i].rate;
        return h('div', { class: 'metric-line' },
          h('div', { class: 'metric-track' },
            h('div', { class: 'bar-fill', style: { width: `${(rate / peak) * 100}%`, background: Spiral.colorFor(pi) } }),
            profiles.length === 1 && baseline && h('span', { class: 'tick', title: baseline.label, style: { left: `${(baseline.rates[i] / peak) * 100}%` } })),
          h('span', { class: 'metric-val' }, rate.toFixed(1)));
      }))));
  }

  /* One dumbbell per word: a dot for each text on a shared axis, joined across the gap. */
  function gapRows(mode, measure) {
    let rows = wordGaps(measure);
    if (mode === 'alike') {
      rows = wordGaps('diff').filter(g => g.hi.rate >= MIN_ALIKE_RATE).reverse();
    }
    rows = rows.slice(0, WORDS_SHOWN);
    if (!rows.length) return [note('Nothing to show — these texts are too alike or too short to compare word by word.')];

    const axisMax = Math.max(...rows.flatMap(g => g.points.map(p => p.rate))) * 1.05;
    const log = mode === 'gaps' && measure === 'ratio';
    const scale = v => (log
      ? (Math.log(v + RATE_FLOOR) - Math.log(RATE_FLOOR)) / (Math.log(axisMax + RATE_FLOOR) - Math.log(RATE_FLOOR))
      : v / axisMax) * 100;

    return rows.map(g => {
      const lo = scale(g.lo.rate);
      const hi = scale(g.hi.rate);
      const detail = g.points.map(p => `${p.subject.name}: ${p.rate.toFixed(2)} per 1,000`).join('\n');
      return h('div', { class: 'word-row gap-row', title: detail },
        h('div', { class: 'label' }, g.word),
        h('div', { class: 'dumbbell' },
          h('span', { class: 'dumbbell-span', style: { left: `${lo}%`, width: `${hi - lo}%`, background: g.hi.subject.baseline ? '#8b8578' : Spiral.colorFor(g.hi.subject.color) } }),
          g.points.map(p => h('span', {
            class: `dumbbell-dot${p.subject.baseline ? ' is-hollow' : ''}`,
            style: { left: `${scale(p.rate)}%`, background: p.subject.baseline ? null : Spiral.colorFor(p.subject.color) },
          }))),
        h('div', { class: 'gap-val' }, log ? `${g.ratio.toFixed(1)}×` : `Δ${g.diff.toFixed(1)}`));
    });
  }

  function wordsTab() {
    const multi = profiles.length > 1;
    const modes = [['used', 'Most used'], ['gaps', 'Biggest gaps'], ...(multi ? [['alike', 'Most alike']] : [])];
    if (!modes.some(([value]) => value === state.wordsMode)) state.wordsMode = 'used';
    const mode = state.wordsMode;

    const captions = {
      used: 'Function words used most often, per 1,000 words.',
      gaps: `${state.gapMeasure === 'ratio' ? 'Largest relative gaps' : 'Largest absolute gaps'} in per-1,000-word use. ${comparisonBasis()}.`,
      alike: 'Common function words the texts use at nearly the same rate.',
    };

    const controls = [
      segmented(modes, mode, value => { state.wordsMode = value; draw(); }),
      mode === 'gaps' && h('div', { class: 'measure-row' },
        h('span', { class: 'control-label' }, 'Rank by'),
        segmented([['diff', 'Difference'], ['ratio', 'Ratio']], state.gapMeasure, value => { state.gapMeasure = value; draw(); })),
    ];

    const legend = mode !== 'used' && h('div', { class: 'gap-legend' },
      subjects().map(s => h('span', { class: 'gap-legend-item' }, subjectMark(s), ` ${s.name}`)));

    return [card(
      h('div', { class: 'words-controls' }, controls),
      note(captions[mode]),
      legend,
      h('div', { class: 'word-bars' }, mode === 'used' ? mostUsedRows() : gapRows(mode, state.gapMeasure)))];
  }

  /* ---- Entry points ---- */

  function draw() {
    const body = document.getElementById('sidebar-body');
    if (!profiles.length) { body.replaceChildren(); return; }

    for (const button of document.querySelectorAll('#sidebar-tabs button')) {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    const tabs = { summary: summaryTab, metrics: metricsTab, words: wordsTab };
    body.replaceChildren(...tabs[state.tab]());
  }

  function render(nextProfiles, nextBaseline) {
    profiles = nextProfiles;
    baseline = nextBaseline || null;
    draw();
  }

  function init() {
    document.getElementById('sidebar-tabs').addEventListener('click', event => {
      const button = event.target.closest('button[data-tab]');
      if (!button || !TABS.includes(button.dataset.tab)) return;
      state.tab = button.dataset.tab;
      draw();
    });
  }

  return { init, render };
})();
