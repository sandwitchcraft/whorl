/* Getting things out of Whorl: images of the chart, and fingerprint JSON files.
 *
 * Images come from Spiral.snapshot() -- a standalone copy of the chart as it
 * looks right now. SVG is saved as-is (true vector); PNG / JPEG / WebP draw
 * that SVG onto a canvas at the chosen resolution.
 */
const Exporter = (() => {
  const FORMATS = {
    png: { mime: 'image/png', raster: true, alpha: true },
    jpeg: { mime: 'image/jpeg', raster: true, alpha: false },
    webp: { mime: 'image/webp', raster: true, alpha: true },
    svg: { mime: 'image/svg+xml', raster: false, alpha: true },
  };
  const EXTENSIONS = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  };
  const BACKGROUND = '#12141c';
  const MAX_CANVAS_EDGE = 12000;   // stay comfortably inside browser canvas limits
  const FINGERPRINT_STAGGER_MS = 300;

  const byId = id => document.getElementById(id);
  let getProfiles = () => [];
  let onError = () => {};

  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fingerprint';

  function save(blob, filename) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = href;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking synchronously can cancel the download before it starts.
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  function baseName() {
    const profiles = getProfiles();
    return profiles.length === 1 ? `whorl-${slug(profiles[0].label)}` : 'whorl-comparison';
  }

  /* ---- Fingerprint JSON ---- */

  function downloadFingerprints() {
    getProfiles().forEach((profile, i) => {
      // Refresh the timestamp so the file records when it was saved.
      const document_ = { ...profile.fingerprint, generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
      const blob = new Blob([`${JSON.stringify(document_, null, 2)}\n`], { type: 'application/json' });
      setTimeout(() => save(blob, `${slug(profile.label)}.whorl.json`), i * FINGERPRINT_STAGGER_MS);
    });
  }

  /* ---- Images ---- */

  function readOptions() {
    const format = byId('export-format').value;
    return {
      format,
      scale: +byId('export-scale').value,
      transparent: byId('export-bg').value === 'transparent' && FORMATS[format].alpha,
      labels: byId('export-labels').checked,
    };
  }

  function loadImage(source) {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')); };
      img.src = url;
    });
  }

  const toBlob = (canvas, mime) => new Promise(resolve => canvas.toBlob(resolve, mime, 0.95));

  async function renderImage(options) {
    const snap = Spiral.snapshot({ labels: options.labels, transparent: options.transparent });
    if (!snap) throw new Error('nothing to export');
    const source = new XMLSerializer().serializeToString(snap.node);
    const spec = FORMATS[options.format];

    if (!spec.raster) {
      return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}\n`], { type: spec.mime });
    }

    const scale = Math.min(options.scale, MAX_CANVAS_EDGE / Math.max(snap.width, snap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(snap.width * scale);
    canvas.height = Math.round(snap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!options.transparent) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(await loadImage(source), 0, 0, canvas.width, canvas.height);

    const blob = await toBlob(canvas, spec.mime);
    if (!blob) throw new Error('encode failed');
    return blob;
  }

  /* Keep the dialog's options consistent, and say how big the file will be. */
  function syncDialog() {
    const format = byId('export-format').value;
    const spec = FORMATS[format];
    byId('export-scale').disabled = !spec.raster;
    byId('export-bg').querySelector('[value="transparent"]').disabled = !spec.alpha;
    if (!spec.alpha) byId('export-bg').value = 'dark';

    const options = readOptions();
    const snap = Spiral.snapshot({ labels: options.labels, transparent: options.transparent });
    if (!snap) return;
    const note = byId('export-note');
    if (!spec.raster) {
      note.textContent = `Vector — scales to any size. ${Math.round(snap.width)} × ${Math.round(snap.height)} units.`;
      return;
    }
    const scale = Math.min(options.scale, MAX_CANVAS_EDGE / Math.max(snap.width, snap.height));
    note.textContent = `${Math.round(snap.width * scale)} × ${Math.round(snap.height * scale)} px`
      + (scale < options.scale ? ' (reduced to fit browser limits)' : '')
      + '. Exports the chart as it looks right now.';
  }

  async function downloadImage() {
    const button = byId('export-go');
    button.disabled = true;
    try {
      const options = readOptions();
      const blob = await renderImage(options);
      save(blob, `${baseName()}.${EXTENSIONS[blob.type] || 'png'}`);
      byId('export-dialog').close();
    } catch {
      onError('Could not export the image. Try SVG, or a lower resolution.');
      byId('export-dialog').close();
    } finally {
      button.disabled = false;
    }
  }

  function init(hooks) {
    getProfiles = hooks.getProfiles;
    onError = hooks.onError;

    const dialog = byId('export-dialog');
    byId('export-btn').addEventListener('click', () => {
      if (typeof dialog.showModal !== 'function') { downloadImage(); return; }
      syncDialog();
      dialog.showModal();
    });
    for (const id of ['export-format', 'export-scale', 'export-bg', 'export-labels']) {
      byId(id).addEventListener('change', syncDialog);
    }
    byId('export-go').addEventListener('click', downloadImage);
    byId('export-cancel').addEventListener('click', () => dialog.close());
    // Clicking the dimmed backdrop (the dialog element itself) dismisses it.
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

    byId('fingerprint-btn').addEventListener('click', downloadFingerprints);
  }

  return { init, slug };
})();
