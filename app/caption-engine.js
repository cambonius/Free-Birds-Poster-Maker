// Caption layout + rendering for the Free Birds caption maker.
//
//  layout()   breaks text into stacked headline lines (1-2 words, short 3-word
//             lines allowed), sizes each line to fill the caption area width,
//             caps very short lines, and centres the block in the area.
//  fit()      runs layout(), measures how much of the lettering is hidden by
//             the foreground cut-out, and shrinks/moves the block if it is
//             hidden noticeably more than the original caption was.
//  render()   poster -> shadow (multiply) -> bevel -> white letters -> cut-out.
(function (root) {
  // Active caption style: the shared STYLE merged with the current poster's own
  // `style` overrides (set by useStyle() at the start of layout/fit/draw).
  const BASE_STYLE = root.FB_CONFIG.STYLE;
  let STYLE = BASE_STYLE;
  const styleCache = new Map();
  function useStyle(poster) {
    if (!poster || !poster.style) { STYLE = BASE_STYLE; return STYLE; }
    if (!styleCache.has(poster.id)) styleCache.set(poster.id, { ...BASE_STYLE, ...poster.style });
    STYLE = styleCache.get(poster.id);
    return STYLE;
  }
  const FONT = 'FBCaption';
  const SMALL_WORDS = new Set(['THE', 'A', 'AN', 'OF', 'TO', 'IN', 'ON', 'AT', 'BY', 'FOR', 'AND', 'OR', 'NOR', 'IS', 'IT', 'AS', 'SO', 'BE', 'MY', 'WE', 'US', 'UP', 'IF']);
  const MAX_WORDS_ENUM = 14; // try every line split up to this many words (~3k splits)

  // ---------- text metrics (measured once per string at 1000px) ----------
  const mctx = document.createElement('canvas').getContext('2d');
  const hasTracking = 'letterSpacing' in mctx;
  const cache = new Map();
  let capAsc = 0.766, capDesc = 0.031; // replaced by measured values in init()

  function setFont(ctx, size) {
    ctx.font = `${size}px ${FONT}`;
    if (hasTracking) ctx.letterSpacing = `${(STYLE.tracking * size).toFixed(2)}px`;
  }
  function measure(text) {
    const key = STYLE.tracking + '|' + text;
    let m = cache.get(key);
    if (!m) {
      setFont(mctx, 1000);
      const t = mctx.measureText(text);
      m = { left: t.actualBoundingBoxLeft / 1000, right: t.actualBoundingBoxRight / 1000,
        asc: t.actualBoundingBoxAscent / 1000, desc: t.actualBoundingBoxDescent / 1000 };
      m.ink = m.left + m.right; // ink width per 1px of font size
      cache.set(key, m);
    }
    return m;
  }
  const capH = () => capAsc + capDesc; // cap height per 1px of font size

  async function init() {
    await document.fonts.load(`100px ${FONT}`, 'ABC');
    await document.fonts.ready;
    cache.clear();
    setFont(mctx, 1000);
    const h = mctx.measureText('H');
    capAsc = h.actualBoundingBoxAscent / 1000;
    capDesc = h.actualBoundingBoxDescent / 1000;
  }

  // ---------- line breaking + sizing ----------
  const letters = (s) => s.replace(/[^A-Z0-9]/g, '').length;
  function isSmall(line) {
    const words = line.split(' ');
    if (letters(line) <= 2) return true;
    return letters(line) <= 3 && words.every(w => SMALL_WORDS.has(w.replace(/[^A-Z]/g, '')));
  }

  // Heights for a list of lines in an area of width Wav, height Hav.
  function sizeLines(lines, Wav, Hav, maxL) {
    const ch = capH();
    const n = lines.length;
    const small = lines.map(isSmall);
    const hs = lines.map(t => Math.min(maxL, Wav / measure(t).ink * ch));
    // neighbouring normal lines of similar size get the same size (like the originals)
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i + 1 < n; i++) {
        if (small[i] || small[i + 1]) continue;
        const a = hs[i], b = hs[i + 1];
        if (Math.max(a, b) / Math.min(a, b) < STYLE.equalizeRatio) hs[i] = hs[i + 1] = Math.min(a, b);
      }
    }
    // very short lines ("THE", "A", "OF") are capped relative to the other lines
    const normal = hs.filter((_, i) => !small[i]).sort((a, b) => a - b);
    const ref = normal.length ? normal[normal.length >> 1] : maxL;
    for (let i = 0; i < n; i++) if (small[i]) hs[i] = Math.min(hs[i], ref * STYLE.smallLineRatio);
    return finishSizes(hs, small, Hav);
  }
  function finishSizes(hs, small, Hav) {
    const gaps = [];
    for (let i = 0; i + 1 < hs.length; i++) gaps.push(gapFor(Math.min(hs[i], hs[i + 1])));
    const total = hs.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
    const k = total > Hav ? Hav / total : 1;
    return { hs: hs.map(h => h * k), gaps: gaps.map(g => g * k), small };
  }
  let gapFor = (h) => h * STYLE.gapRatio; // replaced per poster size in layout()

  // Higher is better: big letters that fill the area, even line sizes, and no
  // little word stranded in the middle of the stack. A lead-in "THE"/"A" on its
  // own first line is welcome (like "THE / WING / MAN").
  function scorePartition(lines, starts, Wav, Hav, maxL) {
    const r = sizeLines(lines, Wav, Hav, maxL);
    const ch = capH();
    let cov = 0, sumN = 0, nN = 0, minN = Infinity, maxN = 0, pen = 0;
    lines.forEach((t, i) => {
      const w = Math.min(Wav, r.hs[i] / ch * measure(t).ink);
      cov += w * r.hs[i];
      if (!r.small[i]) { sumN += r.hs[i]; nN++; minN = Math.min(minN, r.hs[i]); maxN = Math.max(maxN, r.hs[i]); }
      else if (!starts[i]) pen += 0.35;
      else if (/^(THE|A|AN)$/.test(t)) pen -= 0.08;
    });
    cov /= Wav * Hav;
    const meanN = nN ? sumN / nN / maxL : 0;
    // the originals vary line sizes up to ~1.5x (GREATEST vs TURKEY MOVIE);
    // bigger swings (a huge "THIS" over a tiny "THANKSGIVING") look random
    if (nN > 1) pen += 0.8 * Math.max(0, maxN / minN - 1.6);
    return cov + meanN - pen - 0.01 * lines.length;
  }

  // Enumerate ways to split the words into lines (1-2 words; 3 only if short).
  function chooseLines(segments, Wav, Hav, maxL) {
    const words = [], forced = [];
    segments.forEach(seg => seg.forEach((w, i) => { words.push(w); forced.push(i === seg.length - 1); }));
    const n = words.length;
    const okChunk = (i, j) => {
      for (let k = i; k < j - 1; k++) if (forced[k]) return false;
      const len = words.slice(i, j).join(' ').length;
      if (j - i === 3) return len <= 13;
      if (j - i === 2) return len <= 18;
      return true;
    };
    let best = null, bestScore = -Infinity, count = 0;
    const consider = (ranges) => {
      const lines = ranges.map(([a, b]) => words.slice(a, b).join(' '));
      const starts = ranges.map(([a]) => a === 0 || forced[a - 1]);
      const s = scorePartition(lines, starts, Wav, Hav, maxL);
      if (s > bestScore) { bestScore = s; best = lines; }
    };
    if (n <= MAX_WORDS_ENUM) {
      const cur = [];
      const rec = (i) => {
        if (i === n) { count++; consider(cur); return; }
        for (let j = i + 1; j <= Math.min(n, i + 3); j++) {
          if (!okChunk(i, j)) continue;
          cur.push([i, j]); rec(j); cur.pop();
          if (forced[j - 1]) break;
        }
      };
      rec(0);
    }
    if (n > 10 || !best) {
      // Long captions: 1-2 words per line would make many tiny lines, so also
      // try packing lines up to a range of lengths and keep the best-scoring one.
      for (let budget = 8; budget <= 48; budget += 2) {
        const ranges = [];
        let a = 0;
        for (let i = 0; i < n; i++) {
          const len = words.slice(a, i + 1).join(' ').length;
          if (i > a && len > budget) { ranges.push([a, i]); a = i; }
          if (forced[i]) { ranges.push([a, i + 1]); a = i + 1; }
        }
        if (a < n) ranges.push([a, n]);
        consider(ranges);
      }
    }
    return best;
  }

  // ---------- placement ----------
  function areaPx(poster, W, H) {
    const bands = poster.area.map(b => ({ x0: b.x0 * W, x1: b.x1 * W, y0: b.y0 * H, y1: b.y1 * H }));
    const box = {
      x0: Math.min(...bands.map(b => b.x0)), x1: Math.max(...bands.map(b => b.x1)),
      y0: Math.min(...bands.map(b => b.y0)), y1: Math.max(...bands.map(b => b.y1)),
    };
    return { bands, box };
  }
  function scaleArea(area, s) {
    const cx = (area.box.x0 + area.box.x1) / 2, cy = (area.box.y0 + area.box.y1) / 2;
    const f = (v, c) => c + (v - c) * s;
    const bands = area.bands.map(b => ({ x0: f(b.x0, cx), x1: f(b.x1, cx), y0: f(b.y0, cy), y1: f(b.y1, cy) }));
    return { bands, box: { x0: f(area.box.x0, cx), x1: f(area.box.x1, cx), y0: f(area.box.y0, cy), y1: f(area.box.y1, cy) } };
  }
  function xRangeFor(bands, y0, y1) {
    let lo = -Infinity, hi = Infinity, any = false;
    for (const b of bands) {
      if (b.y1 <= y0 || b.y0 >= y1) continue;
      any = true; lo = Math.max(lo, b.x0); hi = Math.min(hi, b.x1);
    }
    if (!any) { // line pokes outside the bands (rounding): use the nearest band
      const b = bands.reduce((p, q) => (Math.abs((q.y0 + q.y1) / 2 - (y0 + y1) / 2) < Math.abs((p.y0 + p.y1) / 2 - (y0 + y1) / 2) ? q : p));
      lo = b.x0; hi = b.x1;
    }
    return [lo, hi];
  }

  // Lay out `text` on a W x H poster. s < 1 lays it out in a shrunken copy of
  // the caption area (used by fit()).
  function layout(text, poster, W, H, s = 1) {
    useStyle(poster);
    const segments = text.toUpperCase().split(/\n/).map(l => l.trim().split(/\s+/).filter(Boolean)).filter(seg => seg.length);
    const full = areaPx(poster, W, H);
    const area = s === 1 ? full : scaleArea(full, s);
    const result = { lines: [], s, area: full, empty: !segments.length, style: STYLE };
    if (!segments.length) return result;

    gapFor = (h) => Math.max(STYLE.gapMin * H * s, Math.min(STYLE.gapMax * H * s, h * STYLE.gapRatio));
    const Wav = Math.max(...area.bands.map(b => b.x1 - b.x0));
    const Hav = area.box.y1 - area.box.y0;
    const maxL = STYLE.maxLetter * H * s;

    const lines = chooseLines(segments, Wav, Hav, maxL);
    let { hs, gaps, small } = sizeLines(lines, Wav, Hav, maxL);
    const ch = capH();

    // place top-to-bottom; shrink any line that doesn't fit its band, then re-centre
    let placed;
    for (let iter = 0; iter < 4; iter++) {
      const total = hs.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
      let y = area.box.y0 + (Hav - total) / 2;
      placed = [];
      let changed = false;
      lines.forEach((t, i) => {
        const m = measure(t);
        const [lo, hi] = xRangeFor(area.bands, y, y + hs[i]);
        const maxH = (hi - lo) / m.ink * ch;
        if (hs[i] > maxH + 0.5) { hs[i] = maxH; changed = true; }
        placed.push({ text: t, top: y, h: hs[i], lo, hi, small: small[i] });
        y += hs[i] + (gaps[i] || 0);
      });
      if (!changed) break;
      gaps = gaps.map((_, i) => gapFor(Math.min(hs[i], hs[i + 1])));
    }

    let bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    result.lines = placed.map(p => {
      const size = p.h / ch;
      const m = measure(p.text);
      const cx = (p.lo + p.hi) / 2;
      const x = cx - (m.right - m.left) * size / 2; // draw origin so the ink is centred
      const baseline = p.top + capAsc * size;
      const L = { text: p.text, size, h: p.h, top: p.top, baseline, x, small: p.small,
        inkX0: x - m.left * size, inkX1: x + m.right * size };
      bb.x0 = Math.min(bb.x0, L.inkX0); bb.x1 = Math.max(bb.x1, L.inkX1);
      bb.y0 = Math.min(bb.y0, p.top); bb.y1 = Math.max(bb.y1, p.top + p.h);
      return L;
    });
    result.bbox = bb;
    const normals = result.lines.filter(l => !l.small).map(l => l.h);
    result.minLetter = Math.min(...(normals.length ? normals : result.lines.map(l => l.h)));
    return result;
  }

  function offsetLayout(L, dx, dy) {
    if (!dx && !dy) return L;
    return { ...L, lines: L.lines.map(l => ({ ...l, x: l.x + dx, top: l.top + dy, baseline: l.baseline + dy, inkX0: l.inkX0 + dx, inkX1: l.inkX1 + dx })),
      bbox: { x0: L.bbox.x0 + dx, x1: L.bbox.x1 + dx, y0: L.bbox.y0 + dy, y1: L.bbox.y1 + dy }, dx, dy };
  }

  // ---------- overlap with the foreground ----------
  // mask = { data: Uint8 grey alpha, w, h, scale } (downscaled cut-out alpha)
  const octx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function captionCoverageMap(L, mask) {
    const c = octx.canvas;
    if (c.width !== mask.w || c.height !== mask.h) { c.width = mask.w; c.height = mask.h; }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, mask.w, mask.h);
    octx.setTransform(1 / mask.scale, 0, 0, 1 / mask.scale, 0, 0);
    octx.fillStyle = '#fff';
    for (const l of L.lines) { setFont(octx, l.size); octx.fillText(l.text, l.x, l.baseline); }
    const x0 = Math.max(0, Math.floor(L.bbox.x0 / mask.scale) - 1), y0 = Math.max(0, Math.floor(L.bbox.y0 / mask.scale) - 1);
    const x1 = Math.min(mask.w, Math.ceil(L.bbox.x1 / mask.scale) + 2), y1 = Math.min(mask.h, Math.ceil(L.bbox.y1 / mask.scale) + 2);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const img = octx.getImageData(x0, y0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = img[i * 4 + 3];

    // Label every map pixel with its word: each word gets a box (its line's
    // rows, and columns split at the middle of the spaces). Works even when two
    // lines share rows (poster 6's small second word sits beside the first).
    const label = new Int16Array(w * h).fill(-1);
    let nWords = 0;
    L.lines.forEach((l) => {
      const r0 = Math.max(0, Math.floor((l.top - l.h * 0.08) / mask.scale) - y0);
      const r1 = Math.min(h, Math.ceil((l.top + l.h * 1.25) / mask.scale) - y0);
      setFont(mctx, l.size);
      const words = l.text.split(' ');
      const space = mctx.measureText(' ').width;
      const cuts = [l.inkX0 - space];
      for (let k = 1; k < words.length; k++) cuts.push(l.x + mctx.measureText(words.slice(0, k).join(' ') + ' ').width - space / 2);
      cuts.push(l.inkX1 + space);
      words.forEach((_, k) => {
        const c0 = Math.max(0, Math.floor(cuts[k] / mask.scale) - x0), c1 = Math.min(w, Math.ceil(cuts[k + 1] / mask.scale) - x0);
        for (let r = r0; r < r1; r++) for (let cx = c0; cx < c1; cx++) if (label[r * w + cx] < 0) label[r * w + cx] = nWords + k;
      });
      nWords += words.length;
    });
    // Totals don't depend on the offset: precompute them so coverageAt() can
    // stop early once a candidate position is clearly too hidden.
    let total = 0;
    const wordTotal = new Float64Array(nWords);
    for (let i = 0; i < w * h; i++) {
      const v = a[i]; if (!v) continue;
      total += v;
      if (label[i] >= 0) wordTotal[label[i]] += v;
    }
    return { a, x0, y0, w, h, label, nWords, total, wordTotal };
  }
  // Fraction of letter pixels hidden overall and for the most-hidden word,
  // with the caption shifted by (dx, dy) mask px. With limits, returns early
  // (as soon as either limit is certainly exceeded) with ov/worst = Infinity.
  function coverageAt(cm, mask, dx, dy, limitOv = Infinity, limitWord = Infinity) {
    let tot = 0, hid = 0;
    const wt = new Float64Array(cm.nWords), wh = new Float64Array(cm.nWords);
    const md = mask.data, mw = mask.w, mh = mask.h;
    const maxHid = limitOv * cm.total * 255;
    const maxWord = cm.wordTotal.map(t => limitWord * t * 255);
    for (let y = 0; y < cm.h; y++) {
      const my = cm.y0 + y + dy;
      const row = y * cm.w;
      for (let x = 0; x < cm.w; x++) {
        const v = cm.a[row + x]; if (!v) continue;
        const mx = cm.x0 + x + dx;
        const hv = (my >= 0 && my < mh && mx >= 0 && mx < mw) ? v * md[my * mw + mx] : 0;
        tot += v; hid += hv;
        const wi = cm.label[row + x];
        if (wi >= 0) {
          wt[wi] += v; wh[wi] += hv;
          if (wh[wi] > maxWord[wi]) return { ov: Infinity, worst: Infinity };
        }
      }
      if (hid > maxHid) return { ov: Infinity, worst: Infinity };
    }
    let worst = 0;
    for (let i = 0; i < cm.nWords; i++) if (wt[i] > 0) worst = Math.max(worst, wh[i] / (wt[i] * 255));
    return { ov: tot ? hid / (tot * 255) : 0, worst };
  }
  function overlap(L, mask) {
    if (!mask || L.empty) return { ov: 0, worst: 0 };
    return coverageAt(captionCoverageMap(L, mask), mask, 0, 0);
  }

  const prof = { layout: 0, map: 0, cover: 0 }; // timing totals (debugging aid)

  // ---------- template layout (poster 6) ----------
  // Recreates one original caption's exact arrangement instead of the stacked
  // headline. Poster 6's template, measured on "CONTROL YOUR WATTLES.":
  //   word 1: large, ink left edge fixed (x 75), on line 1
  //   word 2: small, on line 1's baseline, a fixed gap after word 1
  //   word 3+: large, lines whose ink right edge is fixed (x 615), going down
  //            (exactly 3 words: see the word 2 / word 3 alignment rule below)
  // Sizes come from the original words' measured ink widths. k scales the whole
  // caption about its anchors (left edge, right edge, top), keeping alignment.
  function splitWords(text) {
    const words = [], forced = [];
    text.toUpperCase().split(/\n/).forEach(l => {
      const seg = l.trim().split(/\s+/).filter(Boolean);
      seg.forEach((w, i) => { words.push(w); forced.push(i === seg.length - 1); });
    });
    return { words, forced };
  }
  function templateMetrics(T, W, H) {
    const u = W / T.ref, v = H / T.ref;
    const m1 = measure(T.first.word), ms = measure(T.second.word), m2 = measure(T.rest.word);
    const size1 = T.first.inkWidth * u / m1.ink, sizeS = T.second.inkWidth * u / ms.ink, size2 = T.rest.inkWidth * u / m2.ink;
    return {
      size1, sizeS, size2,
      top: T.first.top * v,
      b1: T.first.bottom * v - m1.desc * size1,
      bS: T.second.bottom * v - ms.desc * sizeS,
      b2: T.rest.bottom * v - m2.desc * size2,
      gap: (T.second.x0 - (T.first.x0 + T.first.inkWidth)) * u,
      xL: T.first.x0 * u, xR: T.rest.x1 * u,
      // how far word 3's right edge sits past word 2's (WATTLES. vs YOUR: ~81px)
      endOffset: (T.rest.x1 - (T.second.x0 + T.second.inkWidth)) * u,
    };
  }
  // opts.realign: apply the 3-word word 2 / word 3 rule; opts.shiftX: move the
  // whole caption right by this many px (used when the realigned row would
  // otherwise run into a bird).
  function templateLayout(words, forced, TM, k, wrapW, opts = { realign: true, shiftX: 0 }) {
    const ch = capH();
    const at = (y) => TM.top + (y - TM.top) * k; // scale vertically about the top
    const entry = (text, size, anchor, align, baseline, small) => {
      const m = measure(text);
      const x = align === 'left' ? anchor + m.left * size : anchor - m.right * size;
      return { text, size, x, baseline, top: baseline - capAsc * size, h: ch * size, small,
        inkX0: x - m.left * size, inkX1: x + m.right * size };
    };
    const lines = [];
    const n = words.length;
    let i = 0;
    lines.push(entry(words[0], TM.size1 * k, TM.xL, 'left', at(TM.b1), false)); i = 1;
    if (n > 1 && !forced[0]) {
      lines.push(entry(words[1], TM.sizeS * k, lines[0].inkX1 + TM.gap * k, 'left', at(TM.bS), true)); i = 2;
    }
    const pitch = (TM.b2 - TM.b1) * k;
    let row = 0, cur = [];
    const flush = () => {
      if (!cur.length) return;
      lines.push(entry(cur.join(' '), TM.size2 * k, TM.xR, 'right', at(TM.b2) + row * pitch, false));
      row++; cur = [];
    };
    for (; i < n; i++) {
      if (cur.length && measure([...cur, words[i]].join(' ')).ink * TM.size2 * k > wrapW) flush();
      cur.push(words[i]);
      if (forced[i]) flush();
    }
    flush();
    // Exactly three words (word 2 small beside word 1, word 3 alone below): if
    // words 2 and 3 don't overlap horizontally, slide word 3's row so its right
    // edge sits the original's distance past word 2's (like YOUR / WATTLES.).
    let realigned = false;
    if (opts.realign && n === 3 && lines.length === 3 && lines[1].small) {
      const w2 = lines[1], w3 = lines[2];
      const overlapX = w2.inkX0 < w3.inkX1 && w3.inkX0 < w2.inkX1;
      if (!overlapX) {
        const dx = (w2.inkX1 + TM.endOffset * k) - w3.inkX1;
        w3.x += dx; w3.inkX0 += dx; w3.inkX1 += dx;
        realigned = true;
      }
    }
    if (opts.shiftX) for (const l of lines) { l.x += opts.shiftX; l.inkX0 += opts.shiftX; l.inkX1 += opts.shiftX; }
    const bbox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const l of lines) {
      bbox.x0 = Math.min(bbox.x0, l.inkX0); bbox.x1 = Math.max(bbox.x1, l.inkX1);
      bbox.y0 = Math.min(bbox.y0, l.top); bbox.y1 = Math.max(bbox.y1, l.top + l.h);
    }
    const normals = lines.filter(l => !l.small).map(l => l.h);
    return { lines, bbox, s: k, empty: false, style: STYLE, minLetter: Math.min(...normals), realigned };
  }

  // Template fit: keep the original's size and placement whenever the caption
  // fits there without the birds covering it; for longer captions try several
  // line widths (least overlap wins); only if all overlap too much, scale down.
  function fitTemplate(text, poster, W, H, mask) {
    const T = STYLE.template;
    const { words, forced } = splitWords(text);
    const safe = { x0: T.margin * W / T.ref, x1: W - T.margin * W / T.ref, y0: 0, y1: T.maxBottom * H / T.ref };
    const res = { layout: { empty: !words.length, lines: [], style: STYLE, area: { box: safe } },
      overlap: 0, worstWord: 0, hidden: false, small: false, steps: 0 };
    if (!words.length) return res;
    const TM = templateMetrics(T, W, H);
    const limitOv = T.maxHidden, limitWord = words.length <= 3 ? T.maxWordHiddenShort : T.maxWordHidden;
    res.target = limitOv; res.wordTarget = limitWord;
    const kMin = STYLE.minLetter * H / (capH() * Math.min(TM.size1, TM.size2));
    const wraps = [];
    if (words.length >= 3) for (let w = T.wrapMax; w >= T.wrapMin; w -= 25) wraps.push(w * W / T.ref);
    else wraps.push(Infinity);

    // Placement options, in order of preference. For exactly three words:
    // 1) realigned (word 3 tucked under word 2) at the original anchors,
    // 2) realigned and slid right as a whole until it clears the birds,
    // 3) the plain original alignment. Size is only reduced if none fit.
    const variants = [[{ realign: true, shiftX: 0 }]];
    if (words.length === 3) {
      const slides = [];
      for (let sx = T.slideStep; sx <= T.slideMax; sx += T.slideStep) slides.push({ realign: true, shiftX: sx * W / T.ref });
      variants.push(slides, [{ realign: false, shiftX: 0 }]);
    }

    let fallback = null;
    const evaluate = (L, k, step) => {
      const inBounds = L.bbox.x0 >= safe.x0 && L.bbox.x1 <= safe.x1 && L.bbox.y1 <= safe.y1;
      const c = mask ? coverageAt(captionCoverageMap(L, mask), mask, 0, 0) : { ov: 0, worst: 0 };
      const bad = Math.max(c.ov / limitOv, c.worst / limitWord) + (inBounds ? 0 : 100);
      const cand = { L, c, bad, k, step, nLines: L.lines.length, ok: inBounds && c.ov <= limitOv && c.worst <= limitWord };
      if (!fallback || k < fallback.k - 1e-9 || (Math.abs(k - fallback.k) < 1e-9 && bad < fallback.bad)) fallback = cand;
      return cand;
    };
    for (let step = 0; ; step++) {
      const k = Math.max(kMin, Math.pow(0.94, step));
      let pick = null;
      for (const group of variants) {
        for (const opts of group) {
          const seen = new Set();
          for (const wrapW of wraps) {
            const L = templateLayout(words, forced, TM, k, wrapW, opts);
            if (opts.shiftX && !L.realigned) break; // sliding only matters for a realigned caption
            const key = L.lines.map(l => l.text).join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const cand = evaluate(L, k, step);
            // least hidden wins; on a tie, fewer lines
            if (cand.ok && (!pick || cand.c.ov + cand.c.worst < pick.c.ov + pick.c.worst - 1e-4 ||
                (Math.abs(cand.c.ov + cand.c.worst - pick.c.ov - pick.c.worst) <= 1e-4 && cand.nLines < pick.nLines))) pick = cand;
          }
          if (pick) break; // smallest slide that works
        }
        if (pick) break;
      }
      const chosen = pick || (k <= kMin + 1e-9 ? fallback : null);
      if (chosen) {
        applyTemplateCandidate(res, chosen, safe);
        res.hidden = !pick;
        res.small = !pick && k <= kMin + 1e-9;
        return res;
      }
    }
  }
  function applyTemplateCandidate(res, cand, safe) {
    res.layout = { ...cand.L, area: { box: safe } };
    res.overlap = cand.c.ov; res.worstWord = cand.c.worst;
    res.steps = cand.step;
  }

  // Lay out, then shrink/move until the caption is no more hidden than the
  // original caption was (plus a small tolerance). Two checks:
  //   - overall: fraction of all letter pixels hidden (vs the original's)
  //   - per word: no single word may be much more hidden than the original's
  //     worst word, so every word stays readable.
  // baseline = { ov, worst } measured on the poster's original caption.
  function fit(text, poster, W, H, mask, baseline) {
    if (useStyle(poster).template) return fitTemplate(text, poster, W, H, mask);
    const L1 = layout(text, poster, W, H, 1);
    const res = { layout: L1, overlap: 0, worstWord: 0, hidden: false, small: false, steps: 0 };
    if (L1.empty) return res;
    useStyle(poster);
    const minLetter = STYLE.minLetter * H;
    res.small = L1.minLetter < minLetter * 0.999;
    if (!mask) return res;
    const target = baseline.ov + Math.max(0.02, baseline.ov * 0.5);
    const wordTarget = Math.min(0.15, Math.max(0.10, baseline.worst + 0.04));
    res.target = target; res.wordTarget = wordTarget;
    const passes = (c) => c.ov <= target && c.worst <= wordTarget;
    const badness = (c) => Math.max(c.ov / target, c.worst / wordTarget);

    const box = L1.area.box;
    let best = null, pendingSide = null;
    const accept = (L, p) => {
      res.layout = offsetLayout(L, p.dx * mask.scale, p.dy * mask.scale);
      res.overlap = p.c.ov; res.worstWord = p.c.worst;
      return res;
    };
    for (let step = 0; step < 40; step++) {
      const s = Math.pow(0.94, step);
      let t = performance.now();
      const L = step === 0 ? L1 : layout(text, poster, W, H, s);
      prof.layout += performance.now() - t;
      if (step > 0 && L.minLetter < minLetter) break;
      t = performance.now();
      const cm = captionCoverageMap(L, mask);
      prof.map += performance.now() - t;
      t = performance.now();
      // candidate offsets that keep the block inside the caption area (centre first)
      const sx0 = (box.x0 - L.bbox.x0) / mask.scale, sx1 = (box.x1 - L.bbox.x1) / mask.scale;
      const sy0 = (box.y0 - L.bbox.y0) / mask.scale, sy1 = (box.y1 - L.bbox.y1) / mask.scale;
      const fr = [0, -1 / 3, 1 / 3, -2 / 3, 2 / 3, -1, 1];
      // pickV: stays horizontally centred (may move up/down); pickS: moves sideways
      let pickV = null, pickS = null, stepBest = null;
      const tryOffsets = (xs) => {
        for (const fy of fr) for (const fx of xs) {
          const dx = Math.round(fx < 0 ? -fx * sx0 : fx * sx1), dy = Math.round(fy < 0 ? -fy * sy0 : fy * sy1);
          if (sx0 > sx1 + 0.5 && dx) continue; // no horizontal room
          if (sy0 > sy1 + 0.5 && dy) continue;
          // the very first (centred, full-size) check is measured fully for the
          // readout; later checks stop early once they clearly fail
          const exact = step === 0 && !dx && !dy;
          let c = exact ? coverageAt(cm, mask, dx, dy) : coverageAt(cm, mask, dx, dy, target, wordTarget);
          if (!isFinite(c.ov) && !stepBest) c = coverageAt(cm, mask, dx, dy);
          const dist = Math.hypot(fx, fy);
          if (passes(c)) {
            if (!dx) { if (!pickV || dist < pickV.dist) pickV = { dx, dy, c, dist }; }
            else if (!pickS || dist < pickS.dist) pickS = { dx, dy, c, dist };
          }
          if (!stepBest || badness(c) < badness(stepBest.c)) stepBest = { L, dx, dy, c };
          if (step === 0 && !dx && !dy) { res.overlap = c.ov; res.worstWord = c.worst; }
        }
      };
      tryOffsets([0]);                                    // centred columns first (cheap)
      if (!pickV && !pendingSide) tryOffsets(fr.slice(1)); // sideways only when needed
      // least-hidden option at the smallest size reached so far (measured fully)
      if (stepBest && !isFinite(stepBest.c.ov)) stepBest.c = coverageAt(cm, mask, stepBest.dx, stepBest.dy);
      prof.cover += performance.now() - t;
      best = stepBest;
      res.steps = step;
      if (pickV) return accept(L, pickV);
      // A sideways move is only used if staying centred would cost 2+ more shrink steps.
      if (pickS && !pendingSide) pendingSide = { L, p: pickS, step };
      if (pendingSide && step >= pendingSide.step + 2) { res.steps = pendingSide.step; return accept(pendingSide.L, pendingSide.p); }
    }
    if (pendingSide) { res.steps = pendingSide.step; return accept(pendingSide.L, pendingSide.p); }
    // Still too hidden at the minimum size: keep the minimum size, least-hidden spot.
    if (best) accept(best.L, best);
    res.hidden = true;
    return res;
  }

  // ---------- rendering ----------
  function hueOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 10) return null; // no usable hue
    let h;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / mx };
  }
  // Shadow = the sampled background hue at ~37% brightness. If the sample's hue
  // is far from the poster's reference shadow (it caught a glow or a character),
  // the sample is treated as failed and the reference colour is used.
  function shadowColour(bgHex, fallback) {
    if (!bgHex) return fallback;
    const hs = hueOf(bgHex), ref = hueOf(fallback);
    if (!hs) return fallback;
    const dh = ref ? Math.abs(((hs.h - ref.h + 540) % 360) - 180) : 0;
    if (dh > 12) return fallback;
    const h = hs.h;
    const sat = Math.min(0.92, Math.max(0.75, hs.s * 1.05));
    const v = BASE_STYLE.shadowBrightness;
    const c = v * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r1, g1, b1].map(u => Math.round((u + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  const shadowCanvas = document.createElement('canvas');
  function drawCaption(ctx, L, W, H, shadowHex) {
    if (L.empty || !L.lines.length) return;
    STYLE = L.style || BASE_STYLE;
    const px = H; // style lengths are fractions of poster height
    const off = STYLE.shadowOffset * px, blur = STYLE.shadowBlur * px, bevel = STYLE.bevel * px;

    // 1. soft shadow on its own layer, then multiplied onto the poster
    if (shadowCanvas.width !== W || shadowCanvas.height !== H) { shadowCanvas.width = W; shadowCanvas.height = H; }
    const s = shadowCanvas.getContext('2d');
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, W, H);
    const far = W * 3; // draw letters off-canvas so only their shadow lands on it
    s.fillStyle = '#000';
    // faint shadow up-left
    if (STYLE.shadowFaint > 0) {
      s.shadowColor = hexA(shadowHex, STYLE.shadowFaint); s.shadowBlur = blur * 0.7;
      s.shadowOffsetX = far - off * 0.25; s.shadowOffsetY = -off * 0.25;
      for (const l of L.lines) { setFont(s, l.size); s.fillText(l.text, l.x - far, l.baseline); }
    }
    // main shadow down-right: letter shape spread a little (stroke), offset, blurred,
    // so it is darkest right at the letter edge and fades into the background
    s.shadowColor = shadowHex; s.shadowBlur = blur;
    s.shadowOffsetX = far + off; s.shadowOffsetY = off;
    s.lineJoin = 'round'; s.lineWidth = STYLE.shadowSpread * px * 2; s.strokeStyle = '#000';
    for (const l of L.lines) {
      setFont(s, l.size);
      s.fillText(l.text, l.x - far, l.baseline);
      s.strokeText(l.text, l.x - far, l.baseline);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = STYLE.shadowOpacity;
    ctx.drawImage(shadowCanvas, 0, 0);
    ctx.restore();

    // 2. bevel: thin light-grey edge on the right and bottom (darker outermost)
    ctx.save();
    if (bevel > 0) {
      for (const [k, col] of [[1, STYLE.bevelDark], [0.5, STYLE.bevelLight]]) {
        ctx.fillStyle = col;
        for (const l of L.lines) { setFont(ctx, l.size); ctx.fillText(l.text, l.x + bevel * k, l.baseline + bevel * k); }
      }
    }
    // 3. letters: one colour, or a colour per word (counted across the whole
    //    caption; the last listed colour repeats for every word after it)
    const colors = STYLE.wordColors;
    if (!colors) {
      ctx.fillStyle = STYLE.textColor;
      for (const l of L.lines) { setFont(ctx, l.size); ctx.fillText(l.text, l.x, l.baseline); }
    } else {
      let wi = 0;
      for (const l of L.lines) {
        setFont(ctx, l.size);
        const words = l.text.split(' ');
        words.forEach((w, k) => {
          const prefix = k ? words.slice(0, k).join(' ') + ' ' : '';
          ctx.fillStyle = colors[Math.min(wi++, colors.length - 1)];
          ctx.fillText(w, l.x + (k ? ctx.measureText(prefix).width : 0), l.baseline);
        });
      }
    }
    ctx.restore();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // poster -> caption -> foreground cut-out
  function render(ctx, posterImg, fgImg, L, shadowHex) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(posterImg, 0, 0, W, H);
    drawCaption(ctx, L, W, H, shadowHex);
    if (fgImg) ctx.drawImage(fgImg, 0, 0, W, H);
    ctx.restore();
  }

  root.CaptionEngine = { init, layout, fit, overlap, render, shadowColour, FONT, prof };
})(typeof window !== 'undefined' ? window : globalThis);
