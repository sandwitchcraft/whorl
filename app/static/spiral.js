/* Spiral arc chart.
 *
 * Each function word sits at its own radius (index -> ring). Its value is an
 * arc at that radius whose angular *length* encodes frequency. Start angles
 * animate between "together" (all arcs at 12 o'clock) and "out" (each arc at
 * its own golden-angle offset), looping on a smooth sine ease.
 *
 * Renders a list of profiles: one draws alone, several overlay as compare mode.
 */
const Spiral = (() => {
  const PALETTE = ['#c9a66b', '#5f9691', '#a98bb3', '#c98b6b'];
  const GOLDEN_ANGLE = 2.399963;
  const MAX_SWEEP = Math.PI * 1.72;
  const CYCLE_MS = 7000;

  let timer = null;

  function colorFor(i) {
    return PALETTE[i % PALETTE.length];
  }

  /* Compare mode is only honest if every profile is scaled the same way. The
   * API normalizes each profile against its own peak, so re-normalize here
   * against the peak across all profiles on screen. */
  function sharedPeak(profiles) {
    let peak = 0;
    for (const p of profiles) {
      for (const w of p.words) if (w.rate > peak) peak = w.rate;
    }
    return peak || 1;
  }

  function render(container, profiles, options = {}) {
    const size = options.size || 460;
    const showCore = options.showCore !== false;

    if (timer) { timer.stop(); timer = null; }
    d3.select(container).selectAll('*').remove();
    if (!profiles.length) return;

    const svg = d3.select(container).append('svg')
      .attr('width', size)
      .attr('height', size)
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('xmlns', 'http://www.w3.org/2000/svg');

    svg.append('rect')
      .attr('width', size).attr('height', size)
      .attr('fill', '#12141c');

    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    const wordCount = profiles[0].words.length;
    const outerR = size / 2 - 46;
    const innerStart = 26;
    const step = (outerR - innerStart) / wordCount;
    const peak = sharedPeak(profiles);
    const strokeW = Math.max(1.6, Math.min(4, step * 0.5 / Math.max(1, profiles.length * 0.7)));

    const items = [];
    profiles.forEach((profile, pi) => {
      const color = colorFor(pi);
      // Stack profiles within each word's ring so overlaid arcs stay readable.
      const laneOffset = profiles.length > 1
        ? (pi - (profiles.length - 1) / 2) * (step * 0.42)
        : 0;

      profile.words.forEach((w, i) => {
        const path = g.append('path')
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', strokeW)
          .attr('stroke-opacity', 0.88)
          .attr('stroke-linecap', 'round');

        items.push({
          radius: innerStart + i * step + laneOffset,
          target: (i * GOLDEN_ANGLE) % (2 * Math.PI),
          sweep: (w.rate / peak) * MAX_SWEEP,
          path,
        });
      });
    });

    if (showCore) {
      profiles.forEach((profile, pi) => {
        const ttr = profile.stats.type_token_ratio;
        g.append('circle')
          .attr('r', 6 + ttr * 60)
          .attr('fill', colorFor(pi))
          .attr('fill-opacity', profiles.length > 1 ? 0.55 : 0.85);
      });
    }

    function renderAt(phase) {
      for (const it of items) {
        const start = it.target * phase + Math.PI / 2;
        it.path.attr('d', d3.arc()
          .innerRadius(it.radius).outerRadius(it.radius)
          .startAngle(start).endAngle(start + it.sweep)
          .cornerRadius(2)());
      }
    }

    renderAt(0);
    timer = d3.timer(elapsed => {
      const t = (elapsed % CYCLE_MS) / CYCLE_MS;
      renderAt((1 - Math.cos(t * 2 * Math.PI)) / 2);
    });

    return svg.node();
  }

  return { render, colorFor };
})();
