// Loads a poster's images, its downscaled foreground mask and derived values.
// Shared by the caption maker page and tools/verify.html.
(function (root) {
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + src));
    img.src = src;
  });

  async function loadMask(entry) {
    if (!entry || !entry.mask) return null;
    const img = await loadImage(entry.mask); // data URL, so pixels are readable even from file://
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    // Halve again (1/8 of the poster) so the per-keystroke overlap search stays
    // fast; letters are still >= 7px tall at this scale.
    const w = Math.ceil(c.width / 2), h = Math.ceil(c.height / 2);
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      let s = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = xx * 2 + dx, sy = y * 2 + dy;
        if (sx < c.width && sy < c.height) { s += d[(sy * c.width + sx) * 4]; n++; }
      }
      data[y * w + xx] = Math.round(s / n);
    }
    return { data, w, h, scale: entry.maskScale * 2 };
  }

  const cache = new Map();
  // base: path prefix from the page to the project root ('' or '../')
  function loadPoster(poster, base = '') {
    if (cache.has(poster.id)) return cache.get(poster.id);
    const p = (async () => {
      const entry = (root.FB_MASKS || {})[poster.id];
      const [img, fg, mask] = await Promise.all([
        loadImage(base + poster.file),
        loadImage(base + poster.fg).catch(() => null),
        loadMask(entry).catch(() => null),
      ]);
      const W = img.naturalWidth, H = img.naturalHeight;
      // How hidden was the original caption? Lay it out and measure. The
      // measurement is capped at 1.5x the design-note figure: poster 5's
      // captionless art places the turkeys higher than the original poster
      // did, so its original caption would be far more hidden here than it
      // was in the real poster (and "ALL" would be unreadable).
      // The worst single word is measured too (capped at 15%) so that no word
      // ends up mostly hidden.
      let baseline = { ov: poster.baselineFallback, worst: 0.1 };
      if (mask) {
        const L = root.CaptionEngine.layout(poster.original, poster, W, H, 1);
        const m = root.CaptionEngine.overlap(L, mask);
        baseline = { ov: Math.min(m.ov, poster.baselineFallback * 1.5), worst: Math.min(m.worst, 0.15) };
      }
      const shadow = root.CaptionEngine.shadowColour(entry && entry.bgSample, poster.shadowFallback);
      return { poster, img, fg, mask, W, H, baseline, shadow };
    })();
    cache.set(poster.id, p);
    p.catch(() => cache.delete(poster.id));
    return p;
  }

  root.FBAssets = { loadPoster, loadImage };
})(window);
