// UI for the Free Birds caption maker.
(function () {
  const { POSTERS } = window.FB_CONFIG;
  const Engine = window.CaptionEngine;

  const thumbs = document.getElementById('thumbs');
  const caption = document.getElementById('caption');
  const canvas = document.getElementById('poster');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint');
  const meta = document.getElementById('meta');
  const downloadBtn = document.getElementById('download');
  const restoreBtn = document.getElementById('restore');

  let current = 0;      // index into POSTERS
  let assets = null;    // loaded assets for the current poster
  let edited = false;   // has the user changed the caption from the original?
  let frame = 0;

  // ----- poster picker -----
  POSTERS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.setAttribute('aria-label', `Poster ${p.id}: ${p.name}`);
    b.tabIndex = i === 0 ? 0 : -1;
    const img = document.createElement('img');
    img.src = p.file;
    img.alt = '';
    img.decoding = 'async';
    b.appendChild(img);
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = (current + d + POSTERS.length) % POSTERS.length;
      select(n);
      thumbs.children[n].focus();
    });
    thumbs.appendChild(b);
  });

  async function select(i) {
    current = i;
    [...thumbs.children].forEach((b, k) => {
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
    if (!edited) caption.value = POSTERS[i].original;
    try {
      const a = await window.FBAssets.loadPoster(POSTERS[i]);
      if (current !== i) return; // user picked another poster meanwhile
      assets = a;
      canvas.width = a.W;
      canvas.height = a.H;
      canvas.style.aspectRatio = `${a.W} / ${a.H}`;
      schedule();
    } catch (err) {
      hint.textContent = err.message;
    }
  }

  // ----- caption -----
  caption.addEventListener('input', () => { edited = true; schedule(); });
  restoreBtn.addEventListener('click', () => {
    caption.value = POSTERS[current].original;
    edited = false;
    schedule();
    caption.focus();
  });

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function draw() {
    if (!assets) return;
    const a = assets;
    const r = Engine.fit(caption.value, a.poster, a.W, a.H, a.mask, a.baseline);
    Engine.render(ctx, a.img, a.fg, r.layout, a.shadow);

    const msgs = [];
    if (!a.fg || !a.mask) msgs.push('Character cut-outs are missing. Run tools\\build-masks.ps1 to rebuild them.');
    if (r.hidden) msgs.push('Caption is partly hidden — try fewer words.');
    else if (r.small) msgs.push('Long caption — the letters are getting small. Try fewer words.');
    hint.textContent = msgs.join(' ');

    if (r.layout.empty) { meta.textContent = ''; return; }
    const size = Math.round(Math.pow(0.94, r.steps) * 100);
    meta.textContent = `Hidden behind characters: ${Math.round(r.overlap * 100)}%` +
      (size < 100 ? ` · shrunk to ${size}% to stay readable` : '');
  }

  // ----- download -----
  downloadBtn.addEventListener('click', () => {
    if (!assets) return;
    let done = false;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        done = true;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const words = caption.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        link.download = `freebirds-${assets.poster.id}${words ? '-' + words : ''}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, 'image/png');
    } catch (err) {
      // Browsers block saving a canvas that drew images opened via file://
      hint.textContent = 'Your browser blocks saving when this page is opened as a file. ' +
        'Double-click "Start caption maker.cmd" and use the page it opens.';
    }
  });

  // ----- start -----
  Engine.init().then(() => select(0)).catch((err) => {
    hint.textContent = 'Could not load the caption font: ' + err.message;
  });
})();
