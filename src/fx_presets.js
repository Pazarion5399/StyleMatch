// ===================== StyleMatch looks library (the Design Shack "Photoshop text effects" list, rebuilt from scratch) =====================
// Paid PSD kits are not needed: each family below is the layer-style / filter stack those kits are built from.
// Sizes are per 100 px of text height (scaled to your text). Put  #preset <name>  in a text layer's name and run StyleMatch:
// that layer gets the look (no Raw/Clean needed). 'covers' = the Design Shack items (by number) the family stands for.
var C3 = function (h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
function G(ax, list) { return { ax: ax || 'y', lo: 0, hi: 1, stops: list.map(function (s) { return { t: s[0], c: C3(s[1]) }; }) }; }
var BEVEL = function (o) { return Object.assign({ style: 'innerBevel', tech: 'softMatte', depth: 100, size: 6, soften: 0, angle: 120, alt: 30, hi: '#FFFFFF', hiOp: 75, hiMode: 'screen', sh: '#000000', shOp: 75, shMode: 'multiply' }, o); };
var PRESETS = {
  chrome: { family: 'Metal / chrome', covers: [14, 20, 31, 57], look: 'mirror metal: light-dark-light bands, sharp highlight line, dark outline',
    st: { fillAcross: G('y', [[0, '#F4F7FA'], [0.45, '#8A9099'], [0.5, '#2E3238'], [0.62, '#C9CED6'], [1, '#FFFFFF']]), strokes: [{ size: 1.5, color: C3('#1B1E22') }], shadow: { mode: 'multiply', color: C3('#000000'), opacity: 0.55, size: 5, spread: 0, dx: 0, dy: 3 } },
    bevel: BEVEL({ size: 5, depth: 250, alt: 40, hiOp: 90 }) },
  goldMetal: { family: 'Metal / gold, Mad Max metal', covers: [23, 47, 54], look: 'gold/brass faces, bevelled edges, dark 3D side',
    st: { fillAcross: G('y', [[0, '#FFF2B0'], [0.48, '#C8902A'], [0.52, '#7A4E12'], [1, '#F7D06A']]), strokes: [{ size: 2, color: C3('#3B2306') }], extrude: { ux: 0, uy: 1, len: 6, layers: [{ size: 2, color: C3('#5A3A0E'), far: C3('#2A1A05') }] } },
    bevel: BEVEL({ size: 4, depth: 200 }) },
  stone: { family: 'Cinematic stone / ruby / carved', covers: [21, 50, 65], look: 'gem or stone face, deep bevel, dark rim, faint glow',
    st: { fillAcross: G('y', [[0, '#FF5A6E'], [0.5, '#A3001B'], [1, '#4A000C']]), innerGlow: { mode: 'multiply', color: C3('#300008'), opacity: 0.6, size: 8, choke: 0 }, glow: { mode: 'screen', color: C3('#FF2A40'), opacity: 0.35, size: 14, spread: 0 } },
    bevel: BEVEL({ style: 'innerBevel', tech: 'preciseMatte', size: 6, depth: 300, hiOp: 85 }) },
  neon: { family: 'Neon / 80s / synthwave sign', covers: [24, 39, 51, 66, 68], look: 'white core, coloured tube rim, strong coloured glow on dark art',
    st: { fill: C3('#FFFFFF'), inner: { size: 2, color: C3('#FF2BD6') }, glow: { mode: 'screen', color: C3('#FF2BD6'), opacity: 0.9, size: 18, spread: 5 }, shadow: { mode: 'screen', color: C3('#7A3CFF'), opacity: 0.6, size: 40, spread: 0, dx: 0, dy: 0 } } },
  retroChrome80s: { family: '80s retro chrome title (Turbo / Cyberpunk)', covers: [10, 28, 66, 68], look: 'sunset gradient or chrome with horizon line, pink outline, purple 3D side',
    st: { fillAcross: G('y', [[0, '#FFFFFF'], [0.48, '#7FD8FF'], [0.5, '#2A0E5C'], [0.55, '#FF5FC8'], [1, '#FFE27A']]), strokes: [{ size: 2, color: C3('#FF2BD6') }], extrude: { ux: 0.3, uy: 0.95, len: 7, layers: [{ size: 2, color: C3('#3A0C6B'), far: C3('#16052B') }] }, glow: { mode: 'screen', color: C3('#FF2BD6'), opacity: 0.5, size: 16, spread: 0 } } },
  cartoon3D: { family: '3D cartoon / game title / mobile game', covers: [32, 36, 41, 42, 46, 55, 61, 62, 70], look: 'bright gradient face, thick dark outline, solid 3D side, white highlight rim',
    st: { fillAcross: G('y', [[0, '#FFE873'], [1, '#FF9A1F']]), inner: { size: 2, color: C3('#FFF6C4') }, strokes: [{ size: 5, color: C3('#5B2A00') }], extrude: { ux: 0, uy: 1, len: 8, layers: [{ size: 5, color: C3('#8A3F00'), far: C3('#4A1F00') }] }, shadow: { mode: 'multiply', color: C3('#000000'), opacity: 0.35, size: 6, spread: 0, dx: 0, dy: 12 } } },
  comicVintage: { family: 'Vintage comic / pop art', covers: [22, 35, 48, 53], look: 'flat colour, black outline, offset hard shadow, halftone dots, worn print',
    st: { fill: C3('#FFD23F'), strokes: [{ size: 3, color: C3('#111111') }, { size: 6, color: C3('#FFFFFF') }], moreShadows: [{ mode: 'normal', color: C3('#E8403A'), opacity: 1, size: 6, spread: 100, dx: 6, dy: 6 }] },
    noise: 6, note: 'add dots: Filter > Pixelate > Color Halftone on a clipped copy, or let StyleMatch copy dots from a raw' },
  retroLayered: { family: 'Retro layered / groovy / 70s', covers: [6, 15, 16, 27, 37, 56, 58, 67], look: 'stacked offset copies in 2-4 colours, cream face',
    st: { fill: C3('#FFF1D6'), strokes: [{ size: 2, color: C3('#3A2A1A') }], moreShadows: [{ mode: 'normal', color: C3('#E94F37'), opacity: 1, size: 2, spread: 100, dx: 4, dy: 4 }, { mode: 'normal', color: C3('#F6AE2D'), opacity: 1, size: 2, spread: 100, dx: 8, dy: 8 }, { mode: 'normal', color: C3('#2F9C95'), opacity: 1, size: 2, spread: 100, dx: 12, dy: 12 }] }, noise: 4 },
  rainbow: { family: 'Rainbow / pride / colourful blur', covers: [17, 37, 59], look: 'colours change letter by letter, soft glow in the same colours',
    st: { fillAcross: G('x', [[0, '#FF3B3B'], [0.25, '#FFB800'], [0.5, '#3BD16F'], [0.75, '#2F7BFF'], [1, '#B04BFF']]), glow: { mode: 'screen', color: C3('#FFFFFF'), opacity: 0.6, size: 20, spread: 0, across: G('x', [[0, '#FF3B3B'], [0.25, '#FFB800'], [0.5, '#3BD16F'], [0.75, '#2F7BFF'], [1, '#B04BFF']]) } } },
  holographic: { family: 'Holographic / holochrome / liquid foil', covers: [9, 33, 63, 72, 25], look: 'pastel iridescent gradient (pink-mint-lilac), glossy bevel, soft light',
    st: { fillAcross: G('x', [[0, '#FFC6E8'], [0.3, '#B8F3FF'], [0.55, '#E0C3FF'], [0.8, '#C9FFE2'], [1, '#FFE3B8']]), innerGlow: { mode: 'screen', color: C3('#FFFFFF'), opacity: 0.6, size: 6, choke: 0 }, glow: { mode: 'screen', color: C3('#C9B6FF'), opacity: 0.4, size: 14, spread: 0 } },
    bevel: BEVEL({ size: 8, depth: 120, soften: 4, alt: 50, hiOp: 85, shOp: 25 }) },
  glitch: { family: 'Glitch / VHS / RGB split', covers: [12, 49, 52], look: 'red/green/blue copies moved apart, white where they overlap, scan lines',
    st: { fill: C3('#FFFFFF'), fillOpacity: 0, split: [{ dx: -4, dy: 0, color: [255, 0, 0] }, { dx: 0, dy: 0, color: [0, 255, 0] }, { dx: 4, dy: 1, color: [0, 0, 255] }] }, noise: 5, note: 'VHS: add Filter > Distort > Wave (small, horizontal) on a Smart Object copy' },
  grungePrint: { family: 'Grunge / dirty / retro print / xerox', covers: [1, 7, 8, 18, 19, 43], look: 'ink colour with worn holes, grain, slightly soft edges',
    st: { fill: C3('#1E1E1E'), fillOpacity: 0.92, innerGlow: { mode: 'screen', color: C3('#F2E8D5'), opacity: 0.35, size: 3, choke: 0 } }, noise: 14, note: 'worn holes: a layer mask filled with Filter > Render > Clouds + Threshold, or a grunge texture as Pattern Overlay' },
  ink: { family: 'Ink / splatter / smudge / leaking colours', covers: [2, 7, 44], look: 'rough ink edges, drips, soft bleed of the colour',
    st: { fill: C3('#141414'), glow: { mode: 'multiply', color: C3('#141414'), opacity: 0.35, size: 6, spread: 20 } }, noise: 8, note: 'edges: Filter > Distort > Ripple (small) on the Smart Object; drips are drawn (brush) on a clipped layer' },
  halftone: { family: 'Halftone print', covers: [3, 22], look: 'letters made of dots that grow toward one side',
    st: { fill: C3('#E8403A'), strokes: [{ size: 2, color: C3('#111111') }] }, note: 'dots: Smart Object copy, Filter > Pixelate > Color Halftone (radius 6-10), clipped over the text' },
  cosmicBlur: { family: 'Cosmic / soft blur / dreamy', covers: [4, 17, 45], look: 'soft glowing letters, colour haze, sharp copy on top',
    st: { fill: C3('#FFFFFF'), glow: { mode: 'screen', color: C3('#8C5BFF'), opacity: 0.8, size: 30, spread: 0 }, shadow: { mode: 'screen', color: C3('#3FD0FF'), opacity: 0.5, size: 55, spread: 0, dx: 0, dy: 0 } }, gauss: 1.2 },
  fire: { family: 'Lava / fire / molten', covers: [30], look: 'yellow-orange-red face, dark crust edge, orange glow',
    st: { fillAcross: G('y', [[0, '#FFF27A'], [0.4, '#FF9A1A'], [1, '#C21A00']]), innerGlow: { mode: 'multiply', color: C3('#3A0A00'), opacity: 0.7, size: 5, choke: 10 }, glow: { mode: 'screen', color: C3('#FF5A00'), opacity: 0.85, size: 22, spread: 5 } }, noise: 4 },
  ice: { family: 'Ice / underwater / glass', covers: [26, 5], look: 'pale cyan see-through face, bright rim, cool glow',
    st: { fill: C3('#BFF4FF'), fillOpacity: 0.55, inner: { size: 2, color: C3('#FFFFFF') }, glow: { mode: 'screen', color: C3('#48C8FF'), opacity: 0.6, size: 16, spread: 0 } },
    bevel: BEVEL({ size: 6, depth: 150, soften: 3, hiOp: 90, shOp: 30 }) },
  horror: { family: 'Horror / spooky / dark magic', covers: [43, 64, 32], look: 'blood-red or pale face, dark rough edge, dark haze',
    st: { fill: C3('#B3000F'), innerGlow: { mode: 'multiply', color: C3('#2A0004'), opacity: 0.8, size: 6, choke: 0 }, glow: { mode: 'multiply', color: C3('#000000'), opacity: 0.7, size: 20, spread: 10 } }, noise: 10, note: 'drips and cracks: drawn layer clipped to the text' },
  broken: { family: 'Broken / cracked / dissolving / crash distortion', covers: [11, 13, 29], look: 'pieces missing or shifted, cracks, edges eaten away',
    st: { fill: C3('#E9E9E9'), strokes: [{ size: 2, color: C3('#202020') }], shadow: { mode: 'multiply', color: C3('#000000'), opacity: 0.5, size: 4, spread: 0, dx: 3, dy: 3 } }, note: 'cracks/missing parts: layer mask with hand-drawn shards; dissolve: Filter > Stylize > Diffuse or a spatter brush on the mask; crash distortion: Edit > Transform > Warp on the Smart Object' },
  sketch: { family: 'Pencil sketch / outline only / graffiti', covers: [38, 40, 60], look: 'no fill or pale fill, drawn outline, rough strokes',
    st: { fill: C3('#FFFFFF'), fillOpacity: 0, strokes: [{ size: 2, color: C3('#2B2B2B') }] }, noise: 8, note: 'graffiti: add a thick contrasting outline + drop shadow (cartoon3D values) and spray dots on a clipped layer' },
  glitter: { family: 'Glitter / foil balloon / Christmas sparkle', covers: [25, 69, 71], look: 'sparkly speckled metal, bright bevel highlights',
    st: { fillAcross: G('y', [[0, '#FFD1F0'], [0.5, '#E0559F'], [1, '#FFC7E8']]), innerGlow: { mode: 'screen', color: C3('#FFFFFF'), opacity: 0.4, size: 4, choke: 0 } }, noise: 25,
    bevel: BEVEL({ size: 7, depth: 180, soften: 2, hiOp: 95 }) },
  elegant: { family: 'Elegant / fashion / gold line', covers: [45, 34], look: 'thin gold rim, soft shadow, light gradient face',
    st: { fill: C3('#FFFFFF'), strokes: [{ size: 1.5, color: C3('#C9A44C') }], shadow: { mode: 'multiply', color: C3('#3A2A10'), opacity: 0.35, size: 10, spread: 0, dx: 0, dy: 4 } } }
};
// which family a measured original looks like (named in the notes, so you know which preset to start from)
function nearestLook(st) {
  var sat = function (c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); };
  if (st.split) return 'glitch';
  if (st.fillAcross && st.fillAcross.ax === 'x' && st.fillAcross.stops.length >= 3) return 'rainbow';
  if (st.extrude) return st.strokes.length ? 'cartoon3D' : 'goldMetal';
  if (st.glow && st.glow.mode === 'screen' && sat(st.glow.color) > 90 && st.glow.size >= 10) return 'neon';
  if (st.dots) return 'comicVintage';
  if (st.moreShadows && st.moreShadows.length >= 2) return 'retroLayered';
  if ((st.filters || []).some(function (f) { return f.type === 'noise'; })) return 'grungePrint';
  if (st.fillAcross && st.fillAcross.ax === 'y' && st.fillAcross.stops.some(function (s) { return sat(s.c) < 25; }) && st.fillAcross.stops.length >= 3) return 'chrome';
  return null;
}
