/* View state, upload handling, and the /analyze round trip. */

const el = id => document.getElementById(id);
const views = { upload: el('view-upload'), loading: el('view-loading'), result: el('view-result') };

let pendingFiles = [];
let profiles = [];

function showView(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
}

function showError(node, message) {
  node.textContent = message;
  node.hidden = !message;
}

/* ---- Upload screen ---- */

function renderFileList() {
  const list = el('file-list');
  list.innerHTML = '';
  list.hidden = pendingFiles.length === 0;

  pendingFiles.forEach((file, i) => {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = Spiral.colorFor(i);

    const name = document.createElement('span');
    name.textContent = file.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderFileList();
    });

    li.append(dot, name, remove);
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
  if (!pendingFiles.length && !text) {
    showError(el('upload-error'), 'Add a PDF or paste some text first.');
    return;
  }

  const body = new FormData();
  pendingFiles.forEach(f => body.append('files', f));
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
  el('loading-label').textContent = 'Reading the document\u2026';
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

function renderResult() {
  if (!profiles.length) { showView('upload'); return; }

  renderChips();
  statCards();
  wordBars();
  Spiral.render(el('chart'), profiles, { size: 460 });

  const single = profiles.length === 1;
  el('chart-title').textContent = single ? profiles[0].label : 'Overlaid fingerprints';
  el('chart-sub').textContent = single
    ? `${profiles[0].stats.word_count.toLocaleString()} words · rendered from ${profiles[0].words.length} function words`
    : `${profiles.length} documents · ${profiles[0].words.length} function words each`;

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

function goHome() {
  profiles = [];
  pendingFiles = [];
  renderFileList();
  el('paste-input').value = '';
  showError(el('upload-error'), '');
  showError(el('result-error'), '');
  showView('upload');
}

el('back-btn').addEventListener('click', goHome);
el('home-link').addEventListener('click', e => { e.preventDefault(); goHome(); });

el('export-btn').addEventListener('click', () => {
  const svg = el('chart').querySelector('svg');
  if (!svg) return;

  const scale = 2;
  const width = +svg.getAttribute('width');
  const height = +svg.getAttribute('height');
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#12141c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

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
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showError(el('result-error'), 'Could not export the image.');
  };
  img.src = url;
});

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fingerprint';
}
