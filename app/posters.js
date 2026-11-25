// Poster configuration shared by the caption maker and the cut-out builder.
//
// All geometry is written in pixels of a reference poster (1395x2000 for the
// tall posters, 900x900 for the square poster 6) and converted to fractions of
// width/height, so every number scales to the poster's real size.
(function (root) {
  const REF_W = 1395, REF_H = 2000;
  const fx = (px) => px / REF_W;
  const fy = (px) => px / REF_H;

  // A caption area is a list of horizontal bands (fractions). Most posters use
  // one rectangle; posters 2, 4 and 6 step in at some heights to clear a head.
  const band = (x0, x1, y0, y1, rw = REF_W, rh = REF_H) => ({ x0: x0 / rw, x1: x1 / rw, y0: y0 / rh, y1: y1 / rh });
  const sq = (px) => px / 900; // poster 6 (900x900) lengths as fractions of its height

  const POSTERS = [
    {
      id: 1,
      name: 'Tuff Puffs',
      file: 'Captionless Posters/freebirds-1-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-1-fg.png',
      original: 'TUFF PUFFS',
      area: [band(308, 1125, 134, 704)],
      shadowFallback: '#5A1050',
      baselineFallback: 0.05,
    },
    {
      id: 2,
      name: 'You want a piece of me?',
      file: 'Captionless Posters/freebirds-2-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-2-fg.png',
      original: 'YOU WANT A PIECE OF ME?',
      area: [band(560, 1246, 129, 600), band(515, 1246, 600, 1100)],
      shadowFallback: '#4A5A08',
      baselineFallback: 0.02,
    },
    {
      id: 3,
      name: 'Hello, hot wings',
      file: 'Captionless Posters/freebirds-3-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-3-fg.png',
      original: 'HELLO, HOT WINGS',
      area: [band(128, 935, 579, 1351)],
      shadowFallback: '#0A2A5A',
      baselineFallback: 0.01,
    },
    {
      id: 4,
      name: 'The wing man',
      file: 'Captionless Posters/freebirds-4-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-4-fg.png',
      original: 'THE WING MAN',
      area: [band(670, 1270, 457, 640), band(490, 1270, 640, 1254)],
      shadowFallback: '#623A19',
      baselineFallback: 0.03,
    },
    {
      id: 5,
      name: 'The greatest turkey movie',
      file: 'Captionless Posters/freebirds-5-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-5-fg.png',
      original: 'THE GREATEST TURKEY MOVIE OF ALL TIME.',
      // Top raised from 143 to 60: this captionless version has no tagline at
      // the top, and its turkeys sit higher than in the original poster.
      area: [band(118, 1283, 60, 832)],
      shadowFallback: '#623A19',
      baselineFallback: 0.03,
    },
    {
      id: 6,
      name: 'Control your wattles',
      file: 'Captionless Posters/freebirds-6-no-caption.png',
      fg: 'Captionless Posters/masks/freebirds-6-fg.png',
      original: 'CONTROL YOUR WATTLES.',
      // 900x900 square. Measured on the original: CONTROL x 75-404 y 62-132,
      // WATTLES. x 280-615 y 142-214. The lower band steps right to clear the
      // red turkey's head and stops short of the blue turkey's beak.
      area: [band(70, 640, 55, 138, 900, 900), band(240, 625, 138, 222, 900, 900)],
      shadowFallback: '#5A2608',
      baselineFallback: 0.02,
      // Its own caption style: flat coloured letters (first three words red,
      // orange, yellow; the rest yellow), no bevel, and a thin dark halo all
      // round. Lengths are fractions of the poster height (px / 900).
      style: {
        wordColors: ['#E61213', '#F7681C', '#FDAB06'],
        // Keep the original poster's exact arrangement (see templateLayout in
        // caption-engine.js). Ink boxes measured on the original, in px of 900:
        //   CONTROL  x 75-404, y 62-132   (word 1, left edge fixed)
        //   YOUR     x 417-533, bottom 131 (word 2, small, beside word 1)
        //   WATTLES. x 280-615, bottom 214 (words 3+, right edge fixed)
        template: {
          ref: 900,
          first: { word: 'CONTROL', x0: 75, top: 62, bottom: 132, inkWidth: 330 },
          second: { word: 'YOUR', x0: 417, bottom: 131, inkWidth: 117 },
          rest: { word: 'WATTLES.', x1: 615, bottom: 214, inkWidth: 336 },
          margin: 15,             // keep ink this far inside the poster edges
          maxBottom: 780,         // never below this (logo starts ~820)
          maxHidden: 0.015,       // max share of all letter pixels behind birds
          maxWordHiddenShort: 0.03, // max for any one word, 1-3 word captions
          maxWordHidden: 0.05,    // max for any one word, 4+ word captions
          wrapMin: 200, wrapMax: 600, // line widths tried for words 3+
          slideStep: 15, slideMax: 300, // 3-word realignment: slide right in 15px steps if a bird is in the way
        },
        maxLetter: sq(80),
        minLetter: sq(28),
        gapMin: sq(6), gapMax: sq(16),
        bevel: 0,
        shadowOffset: sq(1),
        shadowSpread: sq(2.5),
        shadowBlur: sq(5),
        shadowFaint: 0,
        shadowOpacity: 0.8,
      },
    },
  ];

  // Caption style. Lengths are fractions of poster height (px / 2000). A poster
  // can override any of these with its own `style` object (see poster 6).
  const STYLE = {
    textColor: '#FFFFFF',
    wordColors: null,       // per-word fill colours; the last one repeats
    shadowFaint: 0.25,      // strength of the faint up-left shadow
    maxLetter: fy(292),     // tallest line (cap height, top to bottom of "H")
    minLetter: fy(60),      // never shrink below this to dodge characters
    smallLineRatio: 0.72,   // "THE", "A", "OF" lines vs the other lines
    equalizeRatio: 1.25,    // neighbouring lines closer than this get one size
    gapRatio: 0.11,         // gap between lines vs the smaller line's height
    gapMin: fy(10), gapMax: fy(40),
    tracking: 0.02,         // letter spacing in em (very tight)
    bevel: fy(2),
    bevelLight: '#DEDCDA', bevelDark: '#B5B1B0',
    // Drop shadow: offset 4px, ~11px soft falloff. Measured on the originals the
    // shadow is darkest ~4px out from the letter edge and gone by ~12px, which is
    // the letter shape spread by 3.5px, offset (4,4) and blurred with sigma ~3.
    shadowOffset: fy(4),
    shadowSpread: fy(3.5),
    shadowBlur: fy(6),      // canvas shadowBlur units (= 2 x Gaussian sigma)
    shadowOpacity: 0.85,
    shadowBrightness: 0.37, // shadow = background hue at ~37% brightness
  };

  root.FB_CONFIG = { REF_W, REF_H, POSTERS, STYLE };
})(typeof window !== 'undefined' ? window : globalThis);
