/* View state, upload handling, and the /analyze round trip. */

const el = id => document.getElementById(id);
const views = { upload: el('view-upload'), loading: el('view-loading'), result: el('view-result') };

let pendingFiles = [];
let selectedExamples = [];
let profiles = [];
let baseline = null;
let layout = 'overlay';
let heroSpin = null;
let loadingSpin = null;

const MAX_PROFILES = 4;   // keep in step with the API

/* The hero is a full 50-ring comparison, sized to the space beside the form. */
function buildHero() {
  if (heroSpin) heroSpin.stop();
  const art = el('hero-art');
  art.replaceChildren(); // so a previous, larger drawing can't hold the column open
  const size = Math.round(Math.max(300, Math.min(600, art.clientWidth || 520, window.innerHeight - 170)));
  heroSpin = Decor.spinComparison(art, { size });
}

function showView(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  if (name === 'upload' && !heroSpin) buildHero();
  if (name === 'loading') {
    loadingSpin = Decor.spin(el('loading-art'), { size: 150, rings: 7, thickness: 4.4, speed: 0.55 });
  } else if (loadingSpin) {
    loadingSpin.stop();
    loadingSpin = null;
  }
  if (name !== 'result') Spiral.stop();
}

function showError(node, message) {
  node.textContent = message;
  node.hidden = !message;
}

/* ---- Upload screen ---- */

function selectionCount() {
  return pendingFiles.length + selectedExamples.length;
}

function renderFileList() {
  const list = el('file-list');
  list.innerHTML = '';
  list.hidden = pendingFiles.length === 0;

  pendingFiles.forEach((file, i) => {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = Spiral.colorFor(i + selectedExamples.length);

    const name = document.createElement('span');
    name.textContent = file.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderFileList();
    });

    li.append(dot, name, meta, remove);
    list.appendChild(li);
  });
}

async function loadExamples() {
  let items;
  try {
    const response = await fetch('/examples');
    items = (await response.json()).examples;
  } catch {
    return; // examples are a convenience; upload still works without them
  }

  const list = el('example-list');
  list.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-btn';
    button.dataset.id = item.id;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML =
      `<span class="ex-author">${escapeHtml(item.author)}</span>` +
      `<span class="ex-title">${escapeHtml(item.title)}</span>`;
    button.addEventListener('click', () => {
      const at = selectedExamples.indexOf(item.id);
      if (at >= 0) selectedExamples.splice(at, 1);
      else selectedExamples.push(item.id);
      button.classList.toggle('is-selected', at < 0);
      button.setAttribute('aria-pressed', String(at < 0));
      renderFileList();
    });
    li.appendChild(button);
    list.appendChild(li);
  });
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (!pendingFiles.some(f => f.name === file.name && f.size === file.size)) {
      pendingFiles.push(file);
    }
  }
  renderFileList();
}

el('file-input').addEventListener('change', e => {
  addFiles(e.target.files);
  e.target.value = '';
});

const dropzone = el('dropzone');
['dragenter', 'dragover'].forEach(type => {
  dropzone.addEventListener(type, e => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
});
['dragleave', 'drop'].forEach(type => {
  dropzone.addEventListener(type, e => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  });
});
dropzone.addEventListener('drop', e => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

el('toggle-paste').addEventListener('click', () => {
  const wrap = el('paste-wrap');
  wrap.hidden = !wrap.hidden;
  if (!wrap.hidden) el('paste-input').focus();
});

el('upload-form').addEventListener('submit', async e => {
  e.preventDefault();
  showError(el('upload-error'), '');

  const text = el('paste-input').value.trim();
  if (!selectionCount() && !text) {
    showError(el('upload-error'), 'Add a document, pick an example, or paste some text first.');
    return;
  }

  const body = new FormData();
  pendingFiles.forEach(f => body.append('files', f));
  selectedExamples.forEach(id => body.append('example_ids', id));
  if (text) {
    body.append('text', text);
    body.append('label', 'Pasted text');
  }

  try {
    const result = await analyze(body);
    profiles = result.profiles;
    baseline = result.baseline;
    showView('result');   // show first: the chart is sized from its column's real width
    renderResult({ intro: true });
  } catch (err) {
    showError(el('upload-error'), err.message);
    showView('upload');
  }
});

async function analyze(body) {
  showView('loading');

  const response = await fetch('/analyze', { method: 'POST', body });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!response.ok) {
    throw new Error(payload.detail || 'Something went wrong analyzing that.');
  }
  return payload;
}

/* ---- Result screen ---- */

function renderChips() {
  const chips = el('chips');
  chips.innerHTML = '';
  if (profiles.length < 2) return;

  profiles.forEach((profile, i) => {
    const li = document.createElement('li');
    li.className = 'chip';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = Spiral.colorFor(i);

    const name = document.createElement('span');
    name.textContent = profile.label;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', `Remove ${profile.label}`);
    remove.addEventListener('click', () => {
      profiles.splice(i, 1);
      renderResult();
    });

    li.append(dot, name, remove);
    chips.appendChild(li);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Fill the space available rather than sitting at a fixed size. */
function chartSize(cells) {
  const col = el('chart').parentElement;
  const available = col.clientWidth || window.innerWidth - 480;
  const perCell = (available - (cells - 1) * 28) / cells;
  const vertical = window.innerHeight - 210;
  return Math.round(Math.max(260, Math.min(perCell, vertical, cells > 1 ? 620 : 860)));
}

function updateCaptions() {
  const single = profiles.length === 1;
  el('chart-title').textContent = single
    ? profiles[0].label
    : (layout === 'split' ? 'Side by side' : 'Overlaid fingerprints');
  el('chart-sub').textContent = single
    ? `${profiles[0].stats.word_count.toLocaleString()} words · rendered from ${profiles[0].words.length} function words`
    : `${profiles.length} documents · ${profiles[0].words.length} function words each · same scale`;
  el('add-btn').textContent = single ? 'Compare with another author' : 'Add another';
  el('fingerprint-btn').textContent = single
    ? 'Download fingerprint (.json)'
    : 'Download fingerprints (.json)';
}

/* `intro` plays the slide-together when several prints arrive; a resize re-renders
 * without it so the chart doesn't replay its entrance. */
function renderResult({ intro = false } = {}) {
  if (!profiles.length) { showView('upload'); return; }

  const n = profiles.length;
  renderChips();
  Sidebar.render(profiles, baseline);

  el('layout-toggle').hidden = n < 2;
  Spiral.render(el('chart'), profiles, {
    sizes: { overlay: chartSize(1), split: chartSize(n) },
    maxWidth: el('chart').parentElement.clientWidth,
    layout,
    intro,
  });
  updateCaptions();
}

/* ---- Adding a profile from the result screen ---- */

el('add-btn').addEventListener('click', () => el('add-input').click());

el('add-input').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  showError(el('result-error'), '');
  if (profiles.length + files.length > MAX_PROFILES) {
    showError(el('result-error'), `At most ${MAX_PROFILES} texts can be compared at once.`);
    return;
  }

  const body = new FormData();
  files.forEach(f => body.append('files', f));

  try {
    const result = await analyze(body);
    profiles = profiles.concat(result.profiles);
    baseline = result.baseline;
    showView('result');
    renderResult({ intro: true });
  } catch (err) {
    showError(el('result-error'), err.message);
    showView('result');
  }
});

/* ---- Navigation, layout, motion ---- */

/* Switching layout animates inside the chart -- no re-render. */
el('layout-toggle').addEventListener('click', e => {
  const button = e.target.closest('button[data-layout]');
  if (!button || button.dataset.layout === layout) return;
  layout = button.dataset.layout;
  Spiral.setLayout(layout);
  for (const b of el('layout-toggle').querySelectorAll('button')) {
    b.classList.toggle('is-active', b.dataset.layout === layout);
  }
  updateCaptions();
});

/* View, motion and order all animate inside the chart -- none re-render it. */
function markActive(groupId, attr, value) {
  for (const b of el(groupId).querySelectorAll('button')) {
    const active = b.dataset[attr] === value;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  }
}

/* Motion only means something in the circle, so it dims while bars are showing. */
function syncDisplayControls() {
  const bars = Spiral.getView() === 'bars';
  markActive('view-toggle', 'view', Spiral.getView());
  markActive('motion-toggle', 'motion', Spiral.getMode());
  markActive('order-toggle', 'order', Spiral.isSorted() ? 'sorted' : 'natural');
  el('motion-row').classList.toggle('is-disabled', bars);
  for (const b of el('motion-toggle').querySelectorAll('button')) b.disabled = bars;
}

function bindDisplayControl(groupId, attr, apply) {
  el(groupId).addEventListener('click', e => {
    const button = e.target.closest(`button[data-${attr}]`);
    if (!button || button.disabled) return;
    apply(button.dataset[attr]);
    syncDisplayControls();
  });
}

bindDisplayControl('view-toggle', 'view', value => Spiral.setView(value));
bindDisplayControl('motion-toggle', 'motion', value => Spiral.setMode(value));
bindDisplayControl('order-toggle', 'order', value => Spiral.setSorted(value === 'sorted'));
syncDisplayControls();

/* Mobile browsers fire `resize` while scrolling as the address bar collapses and
 * returns, changing only the height by a few dozen px. Re-rendering then restarts the
 * animation, so only react to a width change or a substantial height change. */
let resizeJob = null;
let lastWidth = window.innerWidth;
let lastHeight = window.innerHeight;
window.addEventListener('resize', () => {
  const widthChanged = window.innerWidth !== lastWidth;
  const heightJump = Math.abs(window.innerHeight - lastHeight) > 150;
  if (!widthChanged && !heightJump) return;
  lastWidth = window.innerWidth;
  lastHeight = window.innerHeight;
  clearTimeout(resizeJob);
  resizeJob = setTimeout(() => {
    if (!views.result.hidden && profiles.length) renderResult();
    else if (!views.upload.hidden) buildHero();
  }, 180);
});

function goHome() {
  profiles = [];
  baseline = null;
  pendingFiles = [];
  selectedExamples = [];
  layout = 'overlay';
  Spiral.setLayout(layout);
  for (const b of el('layout-toggle').querySelectorAll('button')) {
    b.classList.toggle('is-active', b.dataset.layout === 'overlay');
  }
  for (const b of el('example-list').querySelectorAll('.example-btn')) {
    b.classList.remove('is-selected');
    b.setAttribute('aria-pressed', 'false');
  }
  renderFileList();
  el('paste-input').value = '';
  showError(el('upload-error'), '');
  showError(el('result-error'), '');
  showView('upload');
}

el('back-btn').addEventListener('click', goHome);
el('home-link').addEventListener('click', e => { e.preventDefault(); goHome(); });

Sidebar.init();
Exporter.init({
  getProfiles: () => profiles,
  onError: message => showError(el('result-error'), message),
});

loadExamples();
showView('upload');
