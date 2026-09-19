/* Decorative spiral used for the hero art and the loading indicator.
 *
 * Same visual language as the real chart -- concentric arcs, alternating
 * rotation direction -- but driven by a fixed pattern rather than data, so it
 * is never mistaken for a reading of a document.
 */
const Decor = (() => {
  const GOLD = '#c9a66b';
  const TEAL = '#5f9691';
  const SWEEPS = [
    0.62, 1.34, 0.48, 1.62, 0.82, 1.18,
    0.55, 1.46, 0.71, 1.05, 1.28, 0.44,
  ];

  function spin(container, options = {}) {
    const size = options.size || 420;
    const rings = options.rings || SWEEPS.length;
    const speed = options.speed || 0.13;      // radians per second
    const thickness = options.thickness || 5.2;

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container).append('svg')
      .attr('width', size).attr('height', size)
      .attr('viewBox', `0 0 ${size} ${size}`);
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    const outerR = size / 2 - thickness * 1.6;
    const innerStart = size * 0.075;
    const step = (outerR - innerStart) / rings;

    const items = [];
    for (let i = 0; i < rings; i++) {
      const sweep = SWEEPS[i % SWEEPS.length] * Math.PI;
      items.push({
        radius: innerStart + i * step,
        sweep,
        offset: (i * 2.399963) % (2 * Math.PI),
        dir: i % 2 === 0 ? 1 : -1,
        path: g.append('path')
          .attr('fill', 'none')
          .attr('stroke', i % 2 === 0 ? GOLD : TEAL)
          .attr('stroke-width', thickness * (0.62 + (i % 3) * 0.28))
          .attr('stroke-opacity', 0.9)
          .attr('stroke-linecap', 'round'),
      });
    }

    const arc = d3.arc().cornerRadius(2);
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

  return { spin };
})();
