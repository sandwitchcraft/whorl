/* Spiral arc chart.
 *
 * Each function word sits at its own radius (index -> ring). Its value is an
 * arc at that radius whose angular *length* encodes frequency.
 *
 * Motion has two parts: a one-time "spread" from every arc grouped at 12
 * o'clock out to its own golden-angle offset, then a continuous constant-speed
 * rotation that never reverses. Adjacent rings turn opposite ways.
 *
 * Renders a list of profiles: overlaid in one figure, or side by side.
 */
const Spiral = (() => {
  const PALETTE = ['#c9a66b', '#5f9691', '#a98bb3', '#c98b6b'];
  const GOLDEN_ANGLE = 2.399963;
  const MAX_SWEEP = Math.PI * 1.72;
  const SPREAD_MS = 2200;      // grouped -> spread, happens once
  const ROTATE_RAD_S = 0.075;  // constant drift, radians per second

  let timer = null;

  const colorFor = i => PALETTE[i % PALETTE.length];
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

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

  function newSvg(parent, size) {
    const svg = d3.select(parent).append('svg')
      .attr('width', size)
      .attr('height', size)
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('xmlns', 'http://www.w3.org/2000/svg');
    svg.append('rect').attr('width', size).attr('height', size).attr('fill', '#12141c');
    return svg;
  }

  function buildFigure(svg, size, group, peak, showCore) {
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);
    const wordCount = group[0].profile.words.length;
    const outerR = size / 2 - Math.max(18, size * 0.06);
    const innerStart = Math.max(14, size * 0.055);
    const step = (outerR - innerStart) / wordCount;
    const lanes = group.length;
    const strokeW = Math.max(1.4, Math.min(4.2, (step * 0.62) / Math.max(1, lanes * 0.75)));

    const items = [];
    group.forEach(({ profile, colorIndex }, gi) => {
      const laneOffset = lanes > 1 ? (gi - (lanes - 1) / 2) * (step * 0.42) : 0;
      const color = colorFor(colorIndex);

      profile.words.forEach((w, i) => {
        items.push({
          radius: innerStart + i * step + laneOffset,
          target: (i * GOLDEN_ANGLE) % (2 * Math.PI),
          sweep: (w.rate / peak) * MAX_SWEEP,
          dir: i % 2 === 0 ? 1 : -1,
          path: g.append('path')
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', strokeW)
            .attr('stroke-opacity', 0.88)
            .attr('stroke-linecap', 'round'),
        });
      });
    });

    if (showCore) {
      // Keep the core well inside the first ring so it reads as a center, not a disc.
      const coreMax = innerStart * 0.62;
      group.forEach(({ profile, colorIndex }) => {
        g.append('circle')
          .attr('r', coreMax * (0.35 + Math.min(1, profile.stats.type_token_ratio / 0.5) * 0.65))
          .attr('fill', colorFor(colorIndex))
          .attr('fill-opacity', lanes > 1 ? 0.5 : 0.85);
      });
    }
    return items;
  }

  function render(container, profiles, options = {}) {
    const size = options.size || 460;
    const layout = options.layout === 'split' ? 'split' : 'overlay';
    const showCore = options.showCore !== false;

    stop();
    d3.select(container).selectAll('*').remove();
    if (!profiles || !profiles.length) return;

    const peak = sharedPeak(profiles);
    const tagged = profiles.map((profile, i) => ({ profile, colorIndex: i }));
    const groups = layout === 'split' ? tagged.map(t => [t]) : [tagged];

    let items = [];
    groups.forEach(group => {
      const cell = document.createElement('div');
      cell.className = 'chart-cell';
      container.appendChild(cell);

      if (layout === 'split') {
        const caption = document.createElement('div');
        caption.className = 'chart-cell-label';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorFor(group[0].colorIndex);
        const name = document.createElement('span');
        name.textContent = group[0].profile.label;
        caption.append(dot, name);
        cell.appendChild(caption);
      }

      const svg = newSvg(cell, size);
      items = items.concat(buildFigure(svg, size, group, peak, showCore));
    });

    const arc = d3.arc().cornerRadius(2);
    function frame(elapsedMs) {
      const spread = easeOutCubic(Math.min(1, elapsedMs / SPREAD_MS));
      const drift = (elapsedMs / 1000) * ROTATE_RAD_S;
      for (const it of items) {
        const start = it.target * spread + it.dir * drift * spread + Math.PI / 2;
        it.path.attr('d', arc
          .innerRadius(it.radius).outerRadius(it.radius)
          .startAngle(start).endAngle(start + it.sweep)());
      }
    }

    frame(0);
    timer = d3.timer(frame);
  }

  function stop() {
    if (timer) { timer.stop(); timer = null; }
  }

  return { render, stop, colorFor };
})();
