/* Decorative spirals: the hero art and the loading indicator.
 *
 * Same visual language as the real chart -- concentric arcs, alternating
 * rotation direction, golden-angle offsets -- but driven by generated numbers
 * rather than a document, so it is never mistaken for a reading of one.
 *
 * spin()         a handful of alternating gold/teal rings (the loader).
 * spinComparison a full comparison: 50 rings, two overlaid "authors" sharing
 *                each ring the way the real compare view does (the hero).
 */
const Decor = (() => {
  const GOLD = '#c9a66b';
  const TEAL = '#5f9691';
  const GOLDEN_ANGLE = 2.399963;
  const SWEEPS = [
    0.62, 1.34, 0.48, 1.62, 0.82, 1.18,
    0.55, 1.46, 0.71, 1.05, 1.28, 0.44,
  ];

  const arc = d3.arc().cornerRadius(2);

  /* mulberry32: a tiny seeded PRNG so the hero looks the same on every load. */
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Arc lengths (in units of pi) shaped like a real function-word profile: a
   * few long arcs on the inner rings, then a long tail of short ones. The
   * second author follows the first with some drift, as real writers do. */
  function fakeProfiles(rings) {
    const rand = seeded(11);
    const first = Array.from({ length: rings }, (_, i) => {
      const decay = 1.85 * Math.exp(-i / (rings * 0.16)) + 0.1;
      return Math.min(1.94, decay * (0.55 + rand() * 0.9));
    });
    const second = first.map(v => Math.min(1.94, v * (0.65 + rand() * 0.75)));
    return [first, second];
  }

  function makeSvg(container, size) {
    d3.select(container).selectAll('*').remove();
    const svg = d3.select(container).append('svg')
      .attr('width', size).attr('height', size)
      .attr('viewBox', `0 0 ${size} ${size}`);
    return svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);
  }

  function animate(items, speed) {
    function frame(elapsed) {
      const drift = (elapsed / 1000) * speed;
      for (const it of items) {
        const start = it.offset + it.dir * drift + Math.PI / 2;
        it.path.attr('d', arc
          .innerRadius(it.radius).outerRadius(it.radius)
          .startAngle(start).endAngle(start + it.sweep)());
      }
    }
    frame(0); // paint immediately; the timer only animates from here
    const timer = d3.timer(frame);
    return { stop: () => timer.stop() };
  }

  function spin(container, options = {}) {
    const size = options.size || 420;
    const rings = options.rings || SWEEPS.length;
    const speed = options.speed || 0.13;      // radians per second
    const thickness = options.thickness || 5.2;

    const g = makeSvg(container, size);
    const outerR = size / 2 - thickness * 1.6;
    const innerStart = size * 0.075;
    const step = (outerR - innerStart) / rings;

    const items = [];
    for (let i = 0; i < rings; i++) {
      items.push({
        radius: innerStart + i * step,
        sweep: SWEEPS[i % SWEEPS.length] * Math.PI,
        offset: (i * GOLDEN_ANGLE) % (2 * Math.PI),
        dir: i % 2 === 0 ? 1 : -1,
        path: g.append('path')
          .attr('fill', 'none')
          .attr('stroke', i % 2 === 0 ? GOLD : TEAL)
          .attr('stroke-width', thickness * (0.62 + (i % 3) * 0.28))
          .attr('stroke-opacity', 0.9)
          .attr('stroke-linecap', 'round'),
      });
    }
    return animate(items, speed);
  }

  function spinComparison(container, options = {}) {
    const size = options.size || 520;
    const rings = options.rings || 50;
    const speed = options.speed || 0.08;

    const g = makeSvg(container, size);
    const outerR = size / 2 - 8;
    const innerStart = size * 0.045;
    const step = (outerR - innerStart) / rings;
    const lanes = [GOLD, TEAL];
    const lane = (step * 0.92) / lanes.length;
    const profiles = fakeProfiles(rings);

    const items = [];
    for (let i = 0; i < rings; i++) {
      lanes.forEach((color, li) => {
        items.push({
          radius: innerStart + i * step + (li - (lanes.length - 1) / 2) * lane,
          sweep: profiles[li][i] * Math.PI,
          offset: (i * GOLDEN_ANGLE) % (2 * Math.PI),
          dir: i % 2 === 0 ? 1 : -1,
          path: g.append('path')
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', lane * 0.96)
            .attr('stroke-opacity', 0.9)
            .attr('stroke-linecap', 'round'),
        });
      });
    }
    return animate(items, speed);
  }

  return { spin, spinComparison };
})();
