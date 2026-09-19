/* Spiral arc chart.
 *
 * Each function word sits at its own radius (index -> ring). Its value is an
 * arc at that radius whose angular *length* encodes frequency.
 *
 * Everything lives in ONE svg. Each profile is a figure drawn in a fixed
 * nominal square and scaled into place, which lets "together" and "separate"
 * be two poses of the same drawing: switching between them slides the figures
 * across each other while the ring lanes and stroke widths interpolate.
 *
 * Two independent animations, neither of which re-renders:
 *   motion  spin | aligned   arcs spread from 12 o'clock to their golden-angle
 *                            offsets and rotate, or all sit at the same angle
 *                            so lengths compare directly.
 *   layout  overlay | split  figures merge into one print or slide apart.
 *
 * Hovering an arc shows that word's numbers for every profile on screen.
 */
const Spiral = (() => {
  const PALETTE = ['#c9a66b', '#5f9691', '#a98bb3', '#c98b6b'];
  const GOLDEN_ANGLE = 2.399963;
  const MAX_SWEEP = (350 * Math.PI) / 180;  // the most frequent word's arc, in radians
  const SPREAD_MS = 1800;      // aligned <-> spread transition
  const MERGE_MS = 1100;       // separate <-> together transition
  const INTRO_MERGE_DELAY_MS = 800;
  const ROTATE_RAD_S = 0.075;  // constant drift, radians per second
  const BASE_OPACITY = 0.88;
  const DIM_OPACITY = 0.18;

  const NOMINAL = 1000;                  // figures are drawn in a 1000-unit square
  const OUTER_R = NOMINAL / 2 - 20;
  const INNER_R = NOMINAL * 0.045;
  const GAP = 28;                        // px between side-by-side figures
  const LABEL_H = 34;                    // px band for captions / legend
  const LEGEND_GAP = 22;
  const LABEL_MAX_CHARS = 26;
  const LABEL_FONT = '13px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const BACKGROUND = '#12141c';

  let timer = null;
  let mode = 'spin';
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

  /* Emphasize one word's arcs across every profile; null restores everything. */
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

  /* One profile's rings + core, in nominal units around (0, 0). Geometry that
   * depends on the layout (stroke width, lane offset) is applied per frame. */
  function buildFigure(svg, profile, pi, ctx) {
    const g = svg.append('g');
    const color = colorFor(pi);

    profile.words.forEach((w, i) => {
      const path = g.append('path')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-opacity', BASE_OPACITY)
        .attr('stroke-linecap', 'round');

      const sweep = (w.rate / ctx.peak) * MAX_SWEEP;
      if (sweep <= 0) path.attr('display', 'none'); // a zero-length round cap would draw a dot

      const item = {
        base: INNER_R + i * ctx.step,
        target: (i * GOLDEN_ANGLE) % (2 * Math.PI),
        sweep,
        dir: i % 2 === 0 ? 1 : -1,
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

    return { g, core };
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
        .attr('font-family', '"Helvetica Neue", Helvetica, Arial, sans-serif')
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

    const ctx = {
      profiles,
      ranks: profiles.map(ranksFor),
      items: [],
      peak: sharedPeak(profiles),
      step: (OUTER_R - INNER_R) / profiles[0].words.length,
    };

    const svg = d3.select(container).append('svg').attr('xmlns', 'http://www.w3.org/2000/svg');
    const background = svg.append('rect').attr('fill', BACKGROUND);
    const figures = profiles.map((profile, pi) => buildFigure(svg, profile, pi, ctx));
    const legend = buildLegend(svg, profiles);
    if (!showCore) figures.forEach(f => f.core.remove());

    // The arcs move under a stationary cursor, so a leave event can be missed;
    // any mouse movement over the empty background clears the tooltip.
    svg.on('mousemove', event => {
      if (event.target.tagName !== 'path') hideTip(ctx);
    });

    // m: 0 = separate, 1 = together. progress: 0 = aligned, 1 = fully spread.
    // Drift only accrues while spinning, so resuming picks up where it left off.
    let m = layout === 'overlay' ? 1 : 0;
    let progress = 0;
    let drift = 0;
    let last = 0;
    let lastKey = '';
    const mergeDelay = options.intro && n > 1 && layout === 'overlay' ? INTRO_MERGE_DELAY_MS : 0;
    if (mergeDelay) m = 0;

    const arc = d3.arc().cornerRadius(2);
    const laneFull = ctx.step * 0.92;

    /* Size, position and per-figure geometry for a given merge amount. */
    function applyGeometry(me, showLabels) {
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
        f.core.attr('fill-opacity', n > 1 ? lerp(0.85, 0.5, me) : 0.85);
      });

      legend.group.attr('display', showLabels ? null : 'none');
      legend.entries.forEach((e, pi) => {
        const apart = centerX(pi) - e.width / 2;
        const together = W / 2 + e.legendOffset;
        e.g.attr('transform', `translate(${lerp(apart, together, me)},${s + LABEL_H / 2})`);
      });
    }

    /* Lanes: overlaid profiles share each ring's band; separate ones own it. */
    const laneShared = laneFull / n;
    let strokeFor = null;
    function applyStroke(me) {
      if (me === strokeFor) return;   // only the merge changes stroke widths
      strokeFor = me;
      const strokeW = lerp(laneFull, laneShared, me) * 0.96;
      for (const it of ctx.items) it.path.attr('stroke-width', strokeW);
    }

    function frame(elapsedMs) {
      const dt = Math.min(100, elapsedMs - last);
      last = elapsedMs;

      const spinning = mode === 'spin';
      progress = clamp01(progress + (spinning ? dt : -dt) / SPREAD_MS);
      if (spinning) drift += (dt / 1000) * ROTATE_RAD_S;

      if (n > 1 && elapsedMs >= mergeDelay) {
        m = clamp01(m + (layout === 'overlay' ? dt : -dt) / MERGE_MS);
      }

      // Once everything has settled nothing changes, so stop touching the DOM.
      const key = `${progress}|${spinning ? drift : 0}|${m}`;
      if (key === lastKey) return;
      lastKey = key;

      const spread = easeInOutCubic(progress);
      const me = easeInOutCubic(m);
      applyGeometry(me, n > 1);
      applyStroke(me);

      for (const it of ctx.items) {
        const laneShift = me * (it.profileIndex - (n - 1) / 2) * laneShared;
        const start = (it.target + it.dir * drift) * spread + Math.PI / 2;
        it.path.attr('d', arc
          .innerRadius(it.base + laneShift).outerRadius(it.base + laneShift)
          .startAngle(start).endAngle(start + it.sweep)());
      }
    }

    /* A standalone copy of the chart as it looks right now, for export. */
    function snapshot({ labels = n > 1, transparent = false } = {}) {
      highlight(ctx, null);
      const me = easeInOutCubic(m);
      applyGeometry(me, labels);
      const clone = svg.node().cloneNode(true);
      applyGeometry(me, n > 1);

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

  function setMode(next) {
    mode = next === 'aligned' ? 'aligned' : 'spin';
  }

  function setLayout(next) {
    layout = next === 'split' ? 'split' : 'overlay';
  }

  return {
    render,
    stop,
    colorFor,
    setMode,
    getMode: () => mode,
    setLayout,
    getLayout: () => layout,
    snapshot: options => (current ? current.snapshot(options) : null),
  };
})();
