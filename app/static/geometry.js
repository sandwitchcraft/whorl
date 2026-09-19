/* Pure geometry for morphing between the circular chart and the bar chart.
 *
 * A word's value is one line. In the circle it is an arc of `sweep` radians on
 * a ring; in the bar chart it is a vertical bar of `height`. Both are the same
 * parametric line, so morphing is just blending each sample point between its
 * circular position and its bar position -- the arc visibly unrolls into a bar.
 *
 * Angles follow d3.arc: 0 is 12 o'clock and they run clockwise.
 */
const Geometry = (() => {
  const POINT_STEP_RAD = 0.035;   // ~2 degrees between samples on a morphing arc
  const round = v => Math.round(v * 10) / 10;

  /* Point at fraction t (0..1) along an arc of `sweep` radians starting at `start`. */
  function circlePoint(radius, start, sweep, t) {
    const angle = start + sweep * t;
    return [radius * Math.sin(angle), -radius * Math.cos(angle)];
  }

  /* Point at fraction t along a vertical bar rising from yBase (y grows downward). */
  function barPoint(x, yBase, height, t) {
    return [x, yBase - height * t];
  }

  /* SVG path for the line `e` of the way from circle (0) to bar (1).
   * Fully a bar it is one straight segment; in between it is sampled finely
   * enough that the bend stays smooth. */
  function morphPath(arc, bar, sweep, e) {
    const steps = e >= 1 ? 1 : Math.max(2, Math.ceil(sweep / POINT_STEP_RAD));
    let d = '';
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const [cx, cy] = circlePoint(arc.radius, arc.start, sweep, t);
      const [bx, by] = barPoint(bar.x, bar.yBase, bar.height, t);
      d += `${k ? 'L' : 'M'}${round(cx + (bx - cx) * e)},${round(cy + (by - cy) * e)}`;
    }
    return d;
  }

  /* Positions for the "largest at the end" order: position[wordIndex] = rank,
   * ascending by score, ties keeping their original order. */
  function sortedPositions(scores) {
    const order = scores.map((score, i) => i)
      .sort((a, b) => scores[a] - scores[b] || a - b);
    const positions = [];
    order.forEach((wordIndex, rank) => { positions[wordIndex] = rank; });
    return positions;
  }

  return { circlePoint, barPoint, morphPath, sortedPositions };
})();
