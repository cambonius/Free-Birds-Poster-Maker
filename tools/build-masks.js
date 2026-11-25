// Builds the foreground cut-outs ("Captionless Posters/masks/freebirds-N-fg.png")
// plus a small data file with downscaled alpha masks and sampled background
// colours ("Captionless Posters/masks/mask-data.js").
//
// Run with:  powershell -ExecutionPolicy Bypass -File tools\build-masks.ps1
//
// Method (colour key against a modelled background):
//   1. Seed: pixels whose hue/saturation match the poster's background.
//   2. Model the smooth background gradient from the seed with a push-pull
//      pyramid fill (so the background colour is known even behind characters).
//   3. Alpha = smooth ramp of each pixel's colour distance from that model.
//   4. Clean up: fill small enclosed holes, drop specks, smooth edges ~1px,
//      and remove the background colour from semi-transparent edge pixels so
//      fur/feather edges look right over the white caption.

/* global FB_CONFIG */
const { POSTERS } = FB_CONFIG;

// Per-poster keying parameters. Hue in degrees; t0/t1 = colour distance where
// alpha starts / reaches 1.
// fillRects (reference 1395x2000 px): any enclosed hole lying fully inside one of
// these boxes is filled whatever its size. Used for the FREEBIRDS logo, whose
// yellow letter faces are close to the yellow/orange backgrounds but are
// enclosed by the letters' outlines.
const LOGO_1_4 = [220, 1530, 1180, 1770];
const KEY = {
  1: { hue: [280, 322], sMin: 0.35, vMin: 0.30, t0: 16, t1: 48, fillRects: [LOGO_1_4] },
  2: { hue: [55, 95], sMin: 0.50, vMin: 0.40, t0: 16, t1: 48, fillRects: [LOGO_1_4] },
  // poster 3: the lower neck is pale blue, close to the cyan glow behind it
  3: { hue: [185, 220], sMin: 0.50, vMin: 0.40, t0: 16, t1: 48, holeMax: 20000, fillRects: [LOGO_1_4] },
  4: { hue: [34, 60], sMin: 0.75, vMin: 0.50, t0: 16, t1: 46, fillRects: [LOGO_1_4] },
  5: { hue: [36, 60], sMin: 0.80, vMin: 0.50, t0: 18, t1: 50, preBlur: 2, fillRects: [[190, 1650, 1220, 1960]] },
  // poster 6 (900x900): textured brown dirt, not a smooth gradient, so pixels are
  // keyed by how dirt-like their hue/saturation/brightness is (mode 'hsv').
  // Measured: dirt hue 19-27 deg, sat >= 0.65, value <= 0.5 (darker lower down);
  // red head hue ~354, blue head ~219, beaks bright (value > 0.57), wings and
  // the purple head low-saturation.
  6: { mode: 'hsv', hue: [12, 32], hueSoft: 7, sMin: 0.5, sSoft: 0.12, vMax: 0.56, vSoft: 0.08,
       preBlur: 1, holeMax: 3000, speckMax: 400, close: 2, fillRects: [[360, 815, 540, 885, 900, 900]] },
};
const HOLE_MAX = 2500;   // enclosed background blobs smaller than this become foreground
const SPECK_MAX = 60;    // isolated foreground blobs smaller than this are removed
const MASK_SCALE = 4;    // downscale factor for the runtime overlap mask

const log = (m) => fetch('/__log', { method: 'POST', body: String(m) });
const save = (path, blob) => fetch('/__save?path=' + encodeURIComponent(path), { method: 'POST', body: blob });
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; });

function boxBlurRGB(src, W, H, r) {
  // separable box blur on RGB (returns Float32Array of 3 channels)
  const out = new Float32Array(W * H * 3), tmp = new Float32Array(W * H * 3);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { out[i * 3] = src[j]; out[i * 3 + 1] = src[j + 1]; out[i * 3 + 2] = src[j + 2]; }
  if (!r) return out;
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += out[(y * W + Math.min(W - 1, Math.max(0, k))) * 3 + c];
    for (let x = 0; x < W; x++) {
      tmp[(y * W + x) * 3 + c] = s / n;
      s += out[(y * W + Math.min(W - 1, x + r + 1)) * 3 + c] - out[(y * W + Math.max(0, x - r)) * 3 + c];
    }
  }
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(Math.min(H - 1, Math.max(0, k)) * W + x) * 3 + c];
    for (let y = 0; y < H; y++) {
      out[(y * W + x) * 3 + c] = s / n;
      s += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - tmp[(Math.max(0, y - r) * W + x) * 3 + c];
    }
  }
  return out;
}

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

// Push-pull fill: smooth background colour for every pixel from a sparse seed.
function backgroundModel(rgb, seed, W, H) {
  const B = 16;
  let gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  let sum = new Float32Array(gw * gh * 3), wt = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!seed[i]) continue;
    const g = ((y / B) | 0) * gw + ((x / B) | 0);
    sum[g * 3] += rgb[i * 3]; sum[g * 3 + 1] += rgb[i * 3 + 1]; sum[g * 3 + 2] += rgb[i * 3 + 2]; wt[g]++;
  }
  // build pyramid
  const levels = [{ gw, gh, sum, wt, cap: B * B }];
  while (gw > 1 || gh > 1) {
    const nw = Math.ceil(gw / 2), nh = Math.ceil(gh / 2);
    const ns = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const a = y * gw + x, b = ((y >> 1) * nw + (x >> 1));
      ns[b * 3] += sum[a * 3]; ns[b * 3 + 1] += sum[a * 3 + 1]; ns[b * 3 + 2] += sum[a * 3 + 2]; nwt[b] += wt[a];
    }
    gw = nw; gh = nh; sum = ns; wt = nwt;
    levels.push({ gw, gh, sum, wt, cap: levels[levels.length - 1].cap * 4 });
  }
  // normalise coarsest, then pull down
  const top = levels[levels.length - 1];
  top.col = new Float32Array(top.gw * top.gh * 3);
  for (let i = 0; i < top.gw * top.gh; i++) for (let c = 0; c < 3; c++) top.col[i * 3 + c] = top.wt[i] ? top.sum[i * 3 + c] / top.wt[i] : 128;
  for (let k = levels.length - 2; k >= 0; k--) {
    const L = levels[k], P = levels[k + 1];
    L.col = new Float32Array(L.gw * L.gh * 3);
    for (let y = 0; y < L.gh; y++) for (let x = 0; x < L.gw; x++) {
      // bilinear sample of parent at this cell centre
      const px = (x + 0.5) / 2 - 0.5, py = (y + 0.5) / 2 - 0.5;
      const x0 = Math.max(0, Math.min(P.gw - 1, Math.floor(px))), y0 = Math.max(0, Math.min(P.gh - 1, Math.floor(py)));
      const x1 = Math.min(P.gw - 1, x0 + 1), y1 = Math.min(P.gh - 1, y0 + 1);
      const fxw = Math.max(0, Math.min(1, px - x0)), fyw = Math.max(0, Math.min(1, py - y0));
      const i = y * L.gw + x;
      const a = Math.min(1, L.wt[i] / (L.cap * 0.3));
      for (let c = 0; c < 3; c++) {
        const p = (P.col[(y0 * P.gw + x0) * 3 + c] * (1 - fxw) + P.col[(y0 * P.gw + x1) * 3 + c] * fxw) * (1 - fyw) +
                  (P.col[(y1 * P.gw + x0) * 3 + c] * (1 - fxw) + P.col[(y1 * P.gw + x1) * 3 + c] * fxw) * fyw;
        const own = L.wt[i] ? L.sum[i * 3 + c] / L.wt[i] : p;
        L.col[i * 3 + c] = a * own + (1 - a) * p;
      }
    }
  }
  // upsample level 0 to full resolution
  const L = levels[0];
  const bg = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const py = (y + 0.5) / B - 0.5;
    const y0 = Math.max(0, Math.min(L.gh - 1, Math.floor(py))), y1 = Math.min(L.gh - 1, y0 + 1), fyw = Math.max(0, Math.min(1, py - y0));
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / B - 0.5;
      const x0 = Math.max(0, Math.min(L.gw - 1, Math.floor(px))), x1 = Math.min(L.gw - 1, x0 + 1), fxw = Math.max(0, Math.min(1, px - x0));
      const o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        bg[o + c] = (L.col[(y0 * L.gw + x0) * 3 + c] * (1 - fxw) + L.col[(y0 * L.gw + x1) * 3 + c] * fxw) * (1 - fyw) +
                    (L.col[(y1 * L.gw + x0) * 3 + c] * (1 - fxw) + L.col[(y1 * L.gw + x1) * 3 + c] * fxw) * fyw;
      }
    }
  }
  return bg;
}

function colourDist(rgb, bg, i) {
  const dr = rgb[i * 3] - bg[i * 3], dg = rgb[i * 3 + 1] - bg[i * 3 + 1], db = rgb[i * 3 + 2] - bg[i * 3 + 2];
  // weighted RGB distance (roughly perceptual)
  return Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.6;
}

// Square max filter (dilate, want=1) or min filter (erode, want=0) of radius r on a 0/1 mask.
function boxFilter(m, W, H, r, want) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = want ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const xx = Math.min(W - 1, Math.max(0, x + k)), p = m[y * W + xx];
      if (want ? p : !p) { v = want; break; }
    }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = want ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const yy = Math.min(H - 1, Math.max(0, y + k)), p = tmp[yy * W + x];
      if (want ? p : !p) { v = want; break; }
    }
    out[y * W + x] = v;
  }
  return out;
}

// Label 4-connected components of pixels where mask[i] === want; calls fn(pixels, count, touchesBorder).
function components(mask, W, H, want, fn) {
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H), list = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || mask[s] !== want) continue;
    let sp = 0, n = 0, border = false;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp]; list[n++] = i;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && !seen[i - 1] && mask[i - 1] === want) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && !seen[i + 1] && mask[i + 1] === want) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !seen[i - W] && mask[i - W] === want) { seen[i - W] = 1; stack[sp++] = i - W; }
      if (y < H - 1 && !seen[i + W] && mask[i + W] === want) { seen[i + W] = 1; stack[sp++] = i + W; }
    }
    fn(list, n, border);
  }
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

async function buildOne(poster) {
  const img = await loadImg('../' + poster.file);
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, W, H), src = id.data;
  const P = KEY[poster.id];
  const N = W * H;

  const sharp = boxBlurRGB(src, W, H, 0);
  const soft = boxBlurRGB(src, W, H, P.preBlur || 1);

  const alpha = new Float32Array(N);
  let bg;
  if (P.mode === 'hsv') {
    // Textured background: alpha = 1 - "how background-like is this colour".
    // A soft window on each of hue, saturation and brightness keeps fur edges soft.
    const win = (x, lo, hi, soft) => Math.max(0, Math.min(1, (x - (lo - soft)) / soft, ((hi + soft) - x) / soft));
    const seed = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const [h, s, v] = hsv(soft[i * 3], soft[i * 3 + 1], soft[i * 3 + 2]);
      const like = win(h, P.hue[0], P.hue[1], P.hueSoft) * win(s, P.sMin, 2, P.sSoft) * win(v, -1, P.vMax, P.vSoft);
      alpha[i] = 1 - like;
      if (like > 0.95) seed[i] = 1;
    }
    bg = backgroundModel(soft, seed, W, H); // smooth background colour, for edge clean-up
  } else {
    // 1. seed
    const seed = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const [h, s, v] = hsv(soft[i * 3], soft[i * 3 + 1], soft[i * 3 + 2]);
      if (h >= P.hue[0] && h <= P.hue[1] && s >= P.sMin && v >= P.vMin) seed[i] = 1;
    }
    // 2. model, refined twice: seed pixels far from the model (character pixels
    //    that happen to share the background hue) are dropped. Refinement only
    //    removes seeds, so it can never grow into a character.
    bg = backgroundModel(soft, seed, W, H);
    for (let it = 0; it < 2; it++) {
      const s2 = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (seed[i] && colourDist(soft, bg, i) < P.t0 * 1.3) s2[i] = 1;
      bg = backgroundModel(soft, s2, W, H);
    }
    // 3. alpha ramp (classification on lightly blurred colours, detail from sharp)
    for (let i = 0; i < N; i++) {
      const d = Math.min(colourDist(soft, bg, i), colourDist(sharp, bg, i) * 0.5 + colourDist(soft, bg, i) * 0.5);
      let a = (d - P.t0) / (P.t1 - P.t0);
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      alpha[i] = a;
    }
  }
  // 4a. fill enclosed holes, 4b. remove specks
  const hard = new Uint8Array(N);
  for (let i = 0; i < N; i++) hard[i] = alpha[i] >= 0.5 ? 1 : 0;
  if (P.close) {
    // Morphological closing (grow then shrink by `close` px): fills thin streaks
    // that keyed out inside a character, e.g. shaded beak undersides on poster 6.
    // Run on the solid part (alpha >= 0.9) so translucent streaks get filled too.
    const solid = new Uint8Array(N);
    for (let i = 0; i < N; i++) solid[i] = alpha[i] >= 0.9 ? 1 : 0;
    const closed = boxFilter(boxFilter(solid, W, H, P.close, 1), W, H, P.close, 0);
    for (let i = 0; i < N; i++) if (closed[i] && !solid[i]) { alpha[i] = 1; hard[i] = 1; }
  }
  let holes = 0, specks = 0;
  const holeMax = P.holeMax || HOLE_MAX;
  const rects = (P.fillRects || []).map(([x0, y0, x1, y1, rw = 1395, rh = 2000]) => [x0 / rw * W, y0 / rh * H, x1 / rw * W, y1 / rh * H]);
  components(hard, W, H, 0, (list, n, border) => {
    if (border) return;
    let fill = n < holeMax;
    if (!fill && rects.length) {
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (let k = 0; k < n; k++) { const x = list[k] % W, y = (list[k] / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      fill = rects.some(([x0, y0, x1, y1]) => bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1);
    }
    if (fill) { holes++; for (let k = 0; k < n; k++) alpha[list[k]] = 1; }
  });
  for (let i = 0; i < N; i++) hard[i] = alpha[i] >= 0.5 ? 1 : 0;
  components(hard, W, H, 1, (list, n) => {
    if (n < (P.speckMax || SPECK_MAX)) { specks++; for (let k = 0; k < n; k++) alpha[list[k]] = 0; }
  });
  // 4c. smooth edges (3x3 binomial blur of alpha)
  const sm = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, w = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = (dx ? 1 : 2) * (dy ? 1 : 2); s += alpha[yy * W + xx] * k; w += k;
    }
    sm[y * W + x] = s / w;
  }
  // 4d. decontaminate edge colours and write the cut-out
  const out = new ImageData(W, H);
  const o = out.data;
  for (let i = 0; i < N; i++) {
    // pull the faintest edge pixels in a little so no background-coloured fringe remains
    let a = (sm[i] - 0.08) / 0.92; a = a <= 0.02 ? 0 : a > 1 ? 1 : a;
    sm[i] = a;
    const j = i * 4;
    if (a >= 0.999) { o[j] = src[j]; o[j + 1] = src[j + 1]; o[j + 2] = src[j + 2]; o[j + 3] = 255; continue; }
    if (a === 0) { o[j + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) {
      const f = (src[j + c] - (1 - a) * bg[i * 3 + c]) / a;
      o[j + c] = Math.max(0, Math.min(255, f));
    }
    o[j + 3] = Math.round(a * 255);
  }
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  oc.getContext('2d').putImageData(out, 0, 0);
  await save(poster.fg, await new Promise(r => oc.toBlob(r, 'image/png')));

  // downscaled alpha (grey image: R=G=B=alpha) for the runtime overlap check
  const mw = Math.ceil(W / MASK_SCALE), mh = Math.ceil(H / MASK_SCALE);
  const md = new ImageData(mw, mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    let s = 0, n = 0;
    for (let dy = 0; dy < MASK_SCALE; dy++) for (let dx = 0; dx < MASK_SCALE; dx++) {
      const xx = x * MASK_SCALE + dx, yy = y * MASK_SCALE + dy; if (xx >= W || yy >= H) continue;
      s += sm[yy * W + xx]; n++;
    }
    const v = Math.round(s / n * 255), k = (y * mw + x) * 4;
    md.data[k] = md.data[k + 1] = md.data[k + 2] = v; md.data[k + 3] = 255;
  }
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  mc.getContext('2d').putImageData(md, 0, 0);

  // background colour just outside the caption area (only where it's background)
  const xs = poster.area.map(b => [b.x0, b.x1]).flat(), ys = poster.area.map(b => [b.y0, b.y1]).flat();
  const ax0 = Math.min(...xs) * W, ax1 = Math.max(...xs) * W, ay0 = Math.min(...ys) * H, ay1 = Math.max(...ys) * H;
  const m = 25, samples = [];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    for (const [x, y] of [[ax0 + (ax1 - ax0) * t, ay0 - m], [ax0 + (ax1 - ax0) * t, ay1 + m], [ax0 - m, ay0 + (ay1 - ay0) * t], [ax1 + m, ay0 + (ay1 - ay0) * t]]) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      const i = yi * W + xi;
      if (sm[i] === 0) samples.push([src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]);
    }
  }
  const med = (k) => { const v = samples.map(s => s[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bgSample = samples.length >= 10 ? hex(med(0), med(1), med(2)) : null;

  let fgFrac = 0; for (let i = 0; i < N; i++) fgFrac += sm[i]; fgFrac /= N;
  await log(`poster ${poster.id}: ${W}x${H}, holes filled ${holes}, specks removed ${specks}, fg ${(fgFrac * 100).toFixed(1)}%, bg sample ${bgSample} (${samples.length} pts)`);
  return { id: poster.id, w: W, h: H, maskScale: MASK_SCALE, mask: mc.toDataURL('image/png'), bgSample };
}

(async () => {
  try {
    const only = new URLSearchParams(location.search).get('only');
    const results = {};
    for (const p of POSTERS) {
      if (only && String(p.id) !== only) continue;
      results[p.id] = await buildOne(p);
    }
    if (!only) {
      const js = '// Generated by tools/build-masks.js. Do not edit by hand.\n' +
        '// Downscaled foreground alpha (data URLs work even when the page is opened from disk)\n' +
        '// and the background colour sampled just outside each caption area.\n' +
        'window.FB_MASKS = ' + JSON.stringify(results) + ';\n';
      await save('Captionless Posters/masks/mask-data.js', new Blob([js], { type: 'text/javascript' }));
    }
    await log('done');
  } catch (e) {
    await log('ERR ' + e.stack);
  }
  await fetch('/__quit', { method: 'POST' });
})();
