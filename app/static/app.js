/* View state, upload handling, and the /analyze round trip. */

const el = id => document.getElementById(id);
const views = { upload: el('view-upload'), loading: el('view-loading'), result: el('view-result') };

let pendingFiles = [];
let selectedExamples = [];
let profiles = [];
let layout = 'overlay';
let heroSpin = null;
let loadingSpin = null;

function showView(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  if (name === 'upload' && !heroSpin) {
    heroSpin = Decor.spin(el('hero-art'), { size: 420, rings: 12, thickness: 5.6, speed: 0.12 });
  }
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
    showError(el('upload-error'), 'Add a PDF, pick an example, or paste some text first.');
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
    renderResult();
    showView('result');
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

function statCards() {
  const host = el('stat-cards');
  host.innerHTML = '';

  if (profiles.length === 1) {
    const p = profiles[0];
    host.appendChild(card(`
      <div class="card-label">Center reading</div>
      <div class="stat-value">${p.stats.type_token_ratio.toFixed(3)}</div>
      <div class="stat-note">Vocabulary richness — unique words over total words.
        The core of the print scales with it.</div>
    `));
    host.appendChild(card(`
      <div class="card-label">Rhythm</div>
      <div class="stat-note">
        ${p.stats.avg_sentence_length} words per sentence ·
        ${p.stats.sentence_count.toLocaleString()} sentences<br>
        ${p.stats.punctuation_per_1000.comma} commas and
        ${p.stats.punctuation_per_1000.semicolon} semicolons per 1,000 words
      </div>
    `));
    return;
  }

  profiles.forEach((p, i) => {
    host.appendChild(card(`
      <div class="stat-head">
        <span class="dot" style="background:${Spiral.colorFor(i)}"></span>
        <span>${escapeHtml(p.label)}</span>
      </div>
      <div class="stat-note">Richness ${p.stats.type_token_ratio.toFixed(3)} ·
        ${p.stats.word_count.toLocaleString()} words ·
        ${p.stats.avg_sentence_length} per sentence</div>
    `));
  });

  const divergence = largestDivergence();
  if (divergence) {
    host.appendChild(card(`
      <div class="card-label">Largest divergence</div>
      <div class="stat-value" style="font-size:18px;color:var(--paper)">"${divergence.word}"</div>
      <div class="stat-note">Used ${divergence.ratio.toFixed(1)}× more often in
        ${escapeHtml(divergence.high)} than in ${escapeHtml(divergence.low)}.</div>
    `));
  }
}

function card(html) {
  const node = document.createElement('div');
  node.className = 'card';
  node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function largestDivergence() {
  if (profiles.length < 2) return null;

  let best = null;
  profiles[0].words.forEach((_, i) => {
    const rates = profiles.map(p => p.words[i].rate);
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    if (min < 0.05) return; // ignore words too rare to compare meaningfully
    const ratio = max / min;
    if (!best || ratio > best.ratio) {
      best = {
        word: profiles[0].words[i].word,
        ratio,
        high: profiles[rates.indexOf(max)].label,
        low: profiles[rates.indexOf(min)].label,
      };
    }
  });
  return best;
}

function wordBars() {
  const host = el('word-bars');
  host.innerHTML = '';
  el('words-card-label').textContent = profiles.length > 1
    ? 'Most frequent function words'
    : 'Most frequent function words';

  const peak = Math.max(...profiles.flatMap(p => p.words.map(w => w.rate))) || 1;
  const order = [...profiles[0].words.keys()]
    .sort((a, b) => {
      const sum = i => profiles.reduce((acc, p) => acc + p.words[i].rate, 0);
      return sum(b) - sum(a);
    })
    .slice(0, 6);

  order.forEach(i => {
    const row = document.createElement('div');
    row.className = 'word-row';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = profiles[0].words[i].word;

    const stack = document.createElement('div');
    stack.className = 'stack';
    profiles.forEach((p, pi) => {
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${(p.words[i].rate / peak) * 100}%`;
      fill.style.background = Spiral.colorFor(pi);
      track.appendChild(fill);
      stack.appendChild(track);
    });

    row.append(label, stack);
    host.appendChild(row);
  });
}

/* Fill the space available rather than sitting at a fixed size. */
function chartSize(cells) {
  const col = el('chart').parentElement;
  const available = col.clientWidth || window.innerWidth - 480;
  const perCell = (available - (cells - 1) * 28) / cells;
  const vertical = window.innerHeight - 210;
  return Math.round(Math.max(260, Math.min(perCell, vertical, cells > 1 ? 620 : 860)));
}

function renderResult() {
  if (!profiles.length) { showView('upload'); return; }

  renderChips();
  statCards();
  wordBars();

  const toggle = el('layout-toggle');
  toggle.hidden = profiles.length < 2;
  const cells = layout === 'split' && profiles.length > 1 ? profiles.length : 1;
  Spiral.render(el('chart'), profiles, { size: chartSize(cells), layout });

  const single = profiles.length === 1;
  el('chart-title').textContent = single
    ? profiles[0].label
    : (layout === 'split' ? 'Side by side' : 'Overlaid fingerprints');
  el('chart-sub').textContent = single
    ? `${profiles[0].stats.word_count.toLocaleString()} words · rendered from ${profiles[0].words.length} function words`
    : `${profiles.length} documents · ${profiles[0].words.length} function words each · same scale`;

  el('export-btn').textContent = single ? 'Export as PNG' : 'Export comparison as PNG';
  el('add-btn').textContent = single ? 'Compare with another author' : 'Add another';
}

/* ---- Adding a profile from the result screen ---- */

el('add-btn').addEventListener('click', () => el('add-input').click());

el('add-input').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  showError(el('result-error'), '');
  const body = new FormData();
  files.forEach(f => body.append('files', f));

  try {
    const result = await analyze(body);
    profiles = profiles.concat(result.profiles);
    renderResult();
  } catch (err) {
    showError(el('result-error'), err.message);
  }
  showView('result');
});

/* ---- Navigation and export ---- */

el('layout-toggle').addEventListener('click', e => {
  const button = e.target.closest('button[data-layout]');
  if (!button || button.dataset.layout === layout) return;
  layout = button.dataset.layout;
  for (const b of el('layout-toggle').querySelectorAll('button')) {
    b.classList.toggle('is-active', b.dataset.layout === layout);
  }
  renderResult();
});

let resizeJob = null;
window.addEventListener('resize', () => {
  if (views.result.hidden || !profiles.length) return;
  clearTimeout(resizeJob);
  resizeJob = setTimeout(renderResult, 180);
});

function goHome() {
  profiles = [];
  pendingFiles = [];
  selectedExamples = [];
  layout = 'overlay';
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

el('export-btn').addEventListener('click', async () => {
  const svgs = [...el('chart').querySelectorAll('svg')];
  if (!svgs.length) return;

  const scale = 2;
  const gap = svgs.length > 1 ? 24 : 0;
  const cellW = +svgs[0].getAttribute('width');
  const cellH = +svgs[0].getAttribute('height');
  const width = cellW * svgs.length + gap * (svgs.length - 1);
  const height = cellH;

  let images;
  try {
    images = await Promise.all(svgs.map(loadSvgImage));
  } catch {
    showError(el('result-error'), 'Could not export the image.');
    return;
  }

  {
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#12141c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, i) => {
      ctx.drawImage(img, (cellW + gap) * i * scale, 0, cellW * scale, cellH * scale);
    });

    canvas.toBlob(blob => {
      if (!blob) { showError(el('result-error'), 'Could not export the image.'); return; }

      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = profiles.length === 1
        ? `whorl-${slug(profiles[0].label)}.png`
        : 'whorl-comparison.png';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking synchronously can cancel the download before it starts.
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    }, 'image/png');
  }
});

function loadSvgImage(svg) {
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')); };
    img.src = url;
  });
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fingerprint';
}

loadExamples();
showView('upload');
