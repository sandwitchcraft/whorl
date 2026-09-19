/* The Whorl chart: a circular spiral or a bar chart of the same data.
 *
 * Each function word is one line. In the circle it is an arc on its own ring
 * whose angular *length* encodes frequency; in the bar chart the very same line
 * is a vertical bar whose *height* does. Switching views unrolls the arcs into
 * bars (see geometry.js).
 *
 * Everything lives in ONE svg. Each profile is a figure drawn in a fixed
 * nominal square and scaled into place, so four things can animate without a
 * re-render, all independently:
 *
 *   view    circle | bars     arcs unroll into bars, and back
 *   motion  spin | pause      circle only: keep rotating, or hold still
 *   order   natural | sorted  words slide to ascending order, largest at the end
 *   layout  overlay | split   figures merge into one print or slide apart
 *
 * The circle is never "aligned": arcs open from 12 o'clock once on arrival
 * (the intro) and from then on always sit at their own golden-angle offsets.
 * The bar chart is the view for side-by-side comparison.
 *
 * Hovering a line shows that word's numbers for every profile on screen.
 */
const Spiral = (() => {
  const PALETTE = ['#c9a66b', '#5f9691', '#a98bb3', '#c98b6b'];
  const GOLDEN_ANGLE = 2.399963;
  const MAX_SWEEP = (350 * Math.PI) / 180;  // the most frequent word's arc, in radians
  const SPREAD_MS = 1800;      // intro: arcs open from 12 o'clock
  const MERGE_MS = 1100;       // separate <-> together
  const VIEW_MS = 1200;        // circle <-> bars
  const SORT_MS = 1000;        // natural <-> sorted
  const INTRO_MERGE_DELAY_MS = 800;
  const ROTATE_RAD_S = 0.075;  // constant drift, radians per second
  const BASE_OPACITY = 0.88;
  const DIM_OPACITY = 0.18;

  const NOMINAL = 1000;                  // figures are drawn in a 1000-unit square
  const OUTER_R = NOMINAL / 2 - 20;
  const INNER_R = NOMINAL * 0.045;
  const BAR_LEFT = -440;                 // bar chart, in the same square
  const BAR_RIGHT = 460;
  const BAR_BASE_Y = 400;
  const BAR_MAX_H = 740;
  const BAR_FILL = 0.82;                 // share of a bar's slot the bar occupies
  const BAR_LABEL_FONT = 15;
  const GAP = 28;                        // px between side-by-side figures
  const LABEL_H = 34;                    // px band for captions / legend
  const LEGEND_GAP = 22;
  const LABEL_MAX_CHARS = 26;
  const LABEL_FONT = '13px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const BACKGROUND = '#12141c';

  let timer = null;
  let mode = 'spin';
  let view = 'circle';
  let sorted = false;
  let layout = 'overlay';
  let tip = null;
  let current = null;

  const colorFor = i => PALETTE[i % PALETTE.length];
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* Compare mode is only honest if every profile is scaled the same way. The
   * API normalizes each profile against its own peak, so re-normalize here
   * against the peak across everything on screen. */
  function sharedPeak(profiles) {
    let peak = 0;
    for (const p of profiles) {
      for (const w of p.words) if (w.rate > peak) peak = w.rate;
    }
    return peak || 1;
  }

  /* ranks[wordIndex] = 1 for the profile's most frequent function word. */
  function ranksFor(profile) {
    const order = profile.words.map((_, i) => i)
      .sort((a, b) => profile.words[b].rate - profile.words[a].rate);
    const ranks = [];
    order.forEach((wordIndex, pos) => { ranks[wordIndex] = pos + 1; });
    return ranks;
  }

  /* Vocabulary richness sets the core dot: 0 at 0.2, full at 0.75. */
  function coreScale(stats) {
    const richness = stats.vocab_richness ?? stats.type_token_ratio;
    return richness == null ? 0.5 : clamp01((richness - 0.2) / 0.55);
  }

  const textMeasurer = document.createElement('canvas').getContext('2d');
  function measure(text) {
    textMeasurer.font = LABEL_FONT;
    return textMeasurer.measureText(text).width;
  }

  function truncate(text) {
    return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…` : text;
  }

  /* ---- Tooltip ---- */

  function tooltipEl() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }

  function fillTip(node, ctx, wordIndex, hoveredProfile) {
    const multi = ctx.profiles.length > 1;
    const total = ctx.profiles[0].words.length;

    const word = document.createElement('div');
    word.className = 'tip-word';
    word.textContent = ctx.profiles[0].words[wordIndex].word;

    const table = document.createElement('table');
    const headRow = table.createTHead().insertRow();
    const heads = ['Per 1,000', 'Count', `Rank of ${total}`];
    for (const text of multi ? ['', ...heads] : heads) {
      const th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    }

    const body = table.createTBody();
    ctx.profiles.forEach((profile, pi) => {
      const w = profile.words[wordIndex];
      const row = body.insertRow();
      if (pi === hoveredProfile) row.className = 'is-hovered';

      if (multi) {
        // The flex layout lives on an inner div; display:flex on a <td> breaks the table.
        const who = document.createElement('div');
        who.className = 'tip-who';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorFor(pi);
        const name = document.createElement('span');
        name.textContent = profile.label;
        who.append(dot, name);
        row.insertCell().appendChild(who);
      }
      row.insertCell().textContent = w.rate.toFixed(2);
      row.insertCell().textContent = w.count.toLocaleString();
      row.insertCell().textContent = `#${ctx.ranks[pi][wordIndex]}`;
    });

    node.replaceChildren(word, table);
  }

  function placeTip(event) {
    const node = tooltipEl();
    const pad = 16;
    const margin = 8;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + node.offsetWidth > window.innerWidth - margin) x = event.clientX - pad - node.offsetWidth;
    if (y + node.offsetHeight > window.innerHeight - margin) y = event.clientY - pad - node.offsetHeight;
    node.style.left = `${Math.max(margin, x)}px`;
    node.style.top = `${Math.max(margin, y)}px`;
  }

  /* Emphasize one word's lines across every profile; null restores everything. */
  function highlight(ctx, wordIndex) {
    for (const it of ctx.items) {
      const opacity = wordIndex === null ? BASE_OPACITY
        : it.wordIndex === wordIndex ? 1 : DIM_OPACITY;
      it.path.attr('stroke-opacity', opacity);
    }
  }

  function hideTip(ctx) {
    if (tip) tip.hidden = true;
    if (ctx) highlight(ctx, null);
  }

  function showTip(event, ctx, item) {
    const node = tooltipEl();
    fillTip(node, ctx, item.wordIndex, item.profileIndex);
    node.hidden = false;
    highlight(ctx, item.wordIndex);
    placeTip(event);
  }

  /* ---- Figures ---- */

  /* Gridlines, value axis and word labels; only visible in the bar view. */
  function buildBarDecor(g, profile, ctx) {
    const group = g.append('g').attr('class', 'bar-decor').attr('display', 'none').attr('opacity', 0);
    const text = (x, y, anchor, size, fill) => group.append('text')
      .attr('x', x).attr('y', y).attr('dy', '0.35em').attr('text-anchor', anchor)
      .attr('font-size', size).attr('font-family', FONT_FAMILY).attr('fill', fill);

    for (const tick of d3.ticks(0, ctx.peak, 4).filter(t => t > 0)) {
      const y = BAR_BASE_Y - (tick / ctx.peak) * BAR_MAX_H;
      group.append('line').attr('x1', BAR_LEFT - 6).attr('x2', BAR_RIGHT).attr('y1', y).attr('y2', y)
        .attr('stroke', 'rgba(236,231,218,0.09)').attr('stroke-width', 1.5);
      text(BAR_LEFT - 12, y, 'end', 13, '#8b8578').text(String(tick));
    }
    group.append('line').attr('x1', BAR_LEFT - 6).attr('x2', BAR_RIGHT).attr('y1', BAR_BASE_Y).attr('y2', BAR_BASE_Y)
      .attr('stroke', 'rgba(236,231,218,0.3)').attr('stroke-width', 1.5);
    text(BAR_LEFT - 40, -448, 'start', 14, '#8b8578').text('per 1,000 words');

    const labels = profile.words.map(w => text(0, 0, 'end', BAR_LABEL_FONT, '#b8b2a2').text(w.word));
    return { group, labels };
  }

  /* One profile's lines + core, in nominal units around (0, 0). Geometry that
   * depends on layout, view or order is applied per frame. */
  function buildFigure(svg, profile, pi, ctx) {
    const g = svg.append('g');
    const color = colorFor(pi);
    const decor = buildBarDecor(g, profile, ctx);

    profile.words.forEach((w, i) => {
      const path = g.append('path')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-opacity', BASE_OPACITY)
        .attr('stroke-linecap', 'round');

      const frac = w.rate / ctx.peak;
      const sweep = frac * MAX_SWEEP;
      if (sweep <= 0) path.attr('display', 'none'); // a zero-length round cap would draw a dot

      const item = {
        target: (i * GOLDEN_ANGLE) % (2 * Math.PI),
        frac,
        sweep,
        wordIndex: i,
        profileIndex: pi,
        path,
      };
      path
        .on('mouseenter', event => showTip(event, ctx, item))
        .on('mousemove', event => placeTip(event))
        .on('mouseleave', () => hideTip(ctx));
      ctx.items.push(item);
    });

    // Keep the core well inside the first ring so it reads as a center, not a disc.
    const core = g.append('circle')
      .attr('r', INNER_R * 0.62 * (0.35 + coreScale(profile.stats) * 0.65))
      .attr('fill', color);

    return { g, core, decor };
  }

  /* Captions under each figure when separate; one centered legend when together. */
  function buildLegend(svg, profiles) {
    const group = svg.append('g').attr('class', 'legend');
    const entries = profiles.map((profile, pi) => {
      const text = truncate(profile.label);
      const g = group.append('g');
      g.append('circle').attr('r', 4.5).attr('fill', colorFor(pi));
      g.append('text')
        .attr('x', 12).attr('dy', '0.35em')
        .attr('fill', '#b8b2a2')
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY)
        .text(text);
      return { g, width: 12 + measure(text) };
    });

    const total = entries.reduce((sum, e) => sum + e.width, 0) + LEGEND_GAP * (entries.length - 1);
    let x = 0;
    for (const e of entries) {
      e.legendOffset = x - total / 2;   // left edge relative to the legend's center
      x += e.width + LEGEND_GAP;
    }
    return { group, entries };
  }

  function render(container, profiles, options = {}) {
    const showCore = options.showCore !== false;

    stop();
    container.replaceChildren();
    current = null;
    if (!profiles || !profiles.length) return;

    const n = profiles.length;
    const sizes = options.sizes || { overlay: 460, split: 460 };
    const maxWidth = options.maxWidth || Infinity;
    layout = options.layout === 'split' ? 'split' : 'overlay';

    const wordCount = profiles[0].words.length;
    const ctx = {
      profiles,
      ranks: profiles.map(ranksFor),
      items: [],
      peak: sharedPeak(profiles),
      step: (OUTER_R - INNER_R) / wordCount,
    };
    const barStep = (BAR_RIGHT - BAR_LEFT) / wordCount;

    const svg = d3.select(container).append('svg').attr('xmlns', 'http://www.w3.org/2000/svg');
    const background = svg.append('rect').attr('fill', BACKGROUND);
    const figures = profiles.map((profile, pi) => buildFigure(svg, profile, pi, ctx));
    const legend = buildLegend(svg, profiles);
    if (!showCore) figures.forEach(f => f.core.remove());

    // The lines move under a stationary cursor, so a leave event can be missed;
    // any mouse movement over the empty background clears the tooltip.
    svg.on('mousemove', event => {
      if (event.target.tagName !== 'path') hideTip(ctx);
    });

    /* ---- Animated state. Each of these eases toward what the module-level
     * controls ask for; nothing here re-renders. ---- */
    let m = layout === 'overlay' ? 1 : 0;   // 0 separate .. 1 together
    let b = view === 'bars' ? 1 : 0;        // 0 circle .. 1 bars
    let progress = options.intro ? 0 : 1;   // intro: arcs open from 12 o'clock
    let drift = 0;
    let last = 0;
    let lastKey = '';
    let me = easeInOutCubic(m);
    let e = easeInOutCubic(b);
    const mergeDelay = options.intro && n > 1 && layout === 'overlay' ? INTRO_MERGE_DELAY_MS : 0;
    if (mergeDelay) m = 0;

    // Order: where each word sits (ring index / bar slot), sliding between layouts.
    const scores = Array.from({ length: wordCount }, (_, i) => profiles.reduce((s, p) => s + p.words[i].rate, 0));
    const positionsFor = isSorted => (isSorted
      ? Geometry.sortedPositions(scores)
      : scores.map((_, i) => i));
    const parity = pos => (Math.round(pos) % 2 === 0 ? 1 : -1);   // neighbouring rings counter-rotate
    let appliedSorted = sorted;
    let posTo = positionsFor(sorted);
    let posFrom = posTo.slice();
    let posNow = posTo.slice();
    let dirTo = posTo.map(parity);
    let dirFrom = dirTo.slice();
    let dirNow = dirTo.slice();
    let sortT = 1;

    const arc = d3.arc().cornerRadius(2);
    const laneFull = ctx.step * 0.92;
    const laneShared = laneFull / n;
    const barFull = barStep * BAR_FILL;
    const barShared = barFull / n;
    let strokeKey = '';
    let strokeNow = laneFull * 0.96;

    /* Size, position and per-figure geometry for a given merge amount. */
    function applyGeometry(showLabels) {
      // Midway through a merge the figures overlap partly; cap the size so the
      // whole row never outgrows the column (which would flash a scrollbar).
      const apart = (n - 1) * (1 - me);
      const fits = (maxWidth - apart * GAP) / (1 + apart);
      const s = Math.min(lerp(sizes.split, sizes.overlay, me), fits);
      const k = s / NOMINAL;
      const spacing = (s + GAP) * (1 - me);
      const W = (n - 1) * spacing + s;
      const H = s + (showLabels ? LABEL_H : 0);

      svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
      background.attr('width', W).attr('height', H);

      const centerX = pi => W / 2 + (pi - (n - 1) / 2) * spacing;
      figures.forEach((f, pi) => {
        f.g.attr('transform', `translate(${centerX(pi)},${s / 2}) scale(${k})`);
        f.core
          .attr('fill-opacity', (n > 1 ? lerp(0.85, 0.5, me) : 0.85) * (1 - e))
          .attr('display', e >= 1 ? 'none' : null);
        f.decor.group
          .attr('opacity', e)
          .attr('display', e > 0 ? null : 'none');
      });

      legend.group.attr('display', showLabels ? null : 'none');
      legend.entries.forEach((entry, pi) => {
        const apartX = centerX(pi) - entry.width / 2;
        const togetherX = W / 2 + entry.legendOffset;
        entry.g.attr('transform', `translate(${lerp(apartX, togetherX, me)},${s + LABEL_H / 2})`);
      });
    }

    /* Overlaid profiles share each ring's band (or bar's slot); separate ones own it. */
    function applyStroke() {
      const circle = lerp(laneFull, laneShared, me) * 0.96;
      const bar = lerp(barFull, barShared, me);
      strokeNow = lerp(circle, bar, e);
      const key = `${me}|${e}`;
      if (key === strokeKey) return;
      strokeKey = key;
      for (const it of ctx.items) it.path.attr('stroke-width', strokeNow);
    }

    function frame(elapsedMs) {
      const dt = Math.min(100, elapsedMs - last);
      last = elapsedMs;

      progress = clamp01(progress + dt / SPREAD_MS);
      b = clamp01(b + (view === 'bars' ? dt : -dt) / VIEW_MS);
      // Rotation only happens in the circle -- it carries on while the arcs
      // unroll (so nothing stops dead), and resumes where it left off.
      if (mode === 'spin' && (view === 'circle' || b < 1)) drift += (dt / 1000) * ROTATE_RAD_S;
      if (n > 1 && elapsedMs >= mergeDelay) {
        m = clamp01(m + (layout === 'overlay' ? dt : -dt) / MERGE_MS);
      }

      if (sorted !== appliedSorted) {
        appliedSorted = sorted;
        posFrom = posNow.slice();
        dirFrom = dirNow.slice();
        posTo = positionsFor(sorted);
        dirTo = posTo.map(parity);
        sortT = 0;
      }
      sortT = clamp01(sortT + dt / SORT_MS);

      // Once everything has settled nothing changes, so stop touching the DOM.
      const key = `${progress}|${drift}|${m}|${b}|${sortT}`;
      if (key === lastKey) return;
      lastKey = key;

      const spread = easeInOutCubic(progress);
      const sortE = easeInOutCubic(sortT);
      me = easeInOutCubic(m);
      e = easeInOutCubic(b);

      for (let i = 0; i < wordCount; i++) {
        posNow[i] = lerp(posFrom[i], posTo[i], sortE);
        dirNow[i] = lerp(dirFrom[i], dirTo[i], sortE);
      }

      applyGeometry(n > 1);
      applyStroke();

      if (e > 0) {
        figures.forEach(f => f.decor.labels.forEach((label, i) => {
          label.attr('transform', `translate(${BAR_LEFT + (posNow[i] + 0.5) * barStep},${BAR_BASE_Y + 14}) rotate(-90)`);
        }));
      }

      for (const it of ctx.items) {
        const pos = posNow[it.wordIndex];
        const lane = it.profileIndex - (n - 1) / 2;
        const radius = INNER_R + pos * ctx.step + me * lane * laneShared;
        const start = (it.target + dirNow[it.wordIndex] * drift) * spread + Math.PI / 2;

        if (e === 0) {
          it.path.attr('d', arc.innerRadius(radius).outerRadius(radius)
            .startAngle(start).endAngle(start + it.sweep)());
        } else {
          it.path.attr('d', Geometry.morphPath(
            { radius, start },
            {
              x: BAR_LEFT + (pos + 0.5) * barStep + me * lane * barShared,
              yBase: BAR_BASE_Y - strokeNow / 2,   // so the round cap sits on the baseline
              height: it.frac * BAR_MAX_H,
            },
            it.sweep,
            e));
        }
      }
    }

    /* A standalone copy of the chart as it looks right now, for export. */
    function snapshot({ labels = n > 1, transparent = false } = {}) {
      highlight(ctx, null);
      applyGeometry(labels);
      const clone = svg.node().cloneNode(true);
      applyGeometry(n > 1);

      const width = +clone.getAttribute('width');
      const height = +clone.getAttribute('height');
      if (transparent) clone.querySelector('rect').remove();
      if (!labels) clone.querySelector('.legend').remove();
      clone.querySelectorAll('[display="none"]').forEach(node => node.remove());
      return { node: clone, width, height };
    }

    current = { snapshot };
    frame(0);
    timer = d3.timer(frame);
  }

  function stop() {
    if (timer) { timer.stop(); timer = null; }
    hideTip();
  }

  return {
    render,
    stop,
    colorFor,
    setView: next => { view = next === 'bars' ? 'bars' : 'circle'; },
    getView: () => view,
    setMode: next => { mode = next === 'pause' ? 'pause' : 'spin'; },
    getMode: () => mode,
    setSorted: next => { sorted = Boolean(next); },
    isSorted: () => sorted,
    setLayout: next => { layout = next === 'split' ? 'split' : 'overlay'; },
    getLayout: () => layout,
    snapshot: options => (current ? current.snapshot(options) : null),
  };
})();
