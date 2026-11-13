
// ===================== Photoshop side =====================
// How to use: keep the original page as a layer named "Raw" and the cleaned page as a layer named "Clean"
// (without those names: the lowest full-page layer is taken as the original, the next one up as the cleaned page).
// Select your translated text layer(s) and run StyleMatch. Each text gets the original text's look
// (colour or gradient, outlines, glow, see-through fill), sized to your text. One Ctrl+Z undoes it.
// Tip: if your text sits far from where the original text was, draw a marquee around the original text first.
var SETTINGS = {
  margin: 0.45,        // how far around your text to look for the original text (in text heights)
  minMargin: 24,       // ... at least this many pixels
  context: 160,        // extra area (px) used to find where the Clean layer sits against the original
  scaleToText: true,   // make outlines/glow thinner or thicker to suit your font's thickness
  applyFilters: true,  // grain found on the original letters: make the text a Smart Object and add Filter > Add Noise
  autoMotionBlur: false, // true: also add the Motion Blur StyleMatch suggests (off: it is only written in the notes)
  screentone: true,    // dot screentone in the original letters: add a layer of matching dots clipped to the text
  details: true,       // lines / highlights drawn inside the original letters: rebuild them on the new letters (Solid Color layer + mask, clipped)
  fadeMask: true,      // original text fades toward one side: add a gradient layer mask to the new text
  occlusionMask: true, // art (a hand, a character) in front of the original text: the new text goes behind it (layer mask)
  colourGlowLayer: true, // a glow whose colour changes along the word: an extra layer under the text (the glow baked in a Smart Object + Gradient Overlay)
  radialBlurCopy: 'auto', // 'auto': add a Radial Blur copy (Smart Object above the text) when the original shows streaks from one centre;
                         // 'always': always add it (your Raw 13 recipe); 'off': never. Or put #radial in one text layer's name.
  radialAmount: 22,      // Radial Blur Amount used with 'always' when nothing was measured
  notes: true,         // keep a hidden text layer "StyleMatch notes" with the recipe for each text (how the original was made)
  houseOutlinePx: [3, 6], // v2.4.2 house style: a light (white-ish) outer outline snaps to the nearest of these widths (px) instead of the raw's
                       // scaled width (your edits: 3 px white, 6 px on small labels). [] = keep the measured width. #keepwidth in a layer name skips it.
  houseGradient: 0.12, // v2.4.2 house style: coloured letters with one flat colour get a soft 2-colour vertical gradient (top 12% lighter,
                       // bottom 12% darker), like your edits. 0 = off. Black and white letters are left flat.
  showSetupErrors: true
};
var PS = require('photoshop');
var app = PS.app, core = PS.core, action = PS.action, imaging = PS.imaging, constants = PS.constants;
function bp(d) { return action.batchPlay(Array.isArray(d) ? d : [d], {}); }
function isText(L) { return L.kind === constants.LayerKind.TEXT || L.kind === 'text'; }
function isSO(L) { return L.kind === constants.LayerKind.SMARTOBJECT || L.kind === 'smartObject'; }
function isGroup(L) { return L.kind === constants.LayerKind.GROUP || L.kind === 'group'; }
function walk(layers, out) { for (var i = 0; i < layers.length; i++) { var L = layers[i]; if (isGroup(L)) walk(L.layers, out); else out.push(L); } return out; }
function findLayer(all, re) { for (var i = 0; i < all.length; i++) if (re.test(all[i].name.trim())) return all[i]; return null; }

// RGB of one layer inside bounds b (white where the layer is empty)
async function layerRGB(doc, L, b) {
  var w = b.right - b.left, h = b.bottom - b.top, out = new Uint8Array(w * h * 3).fill(255), alpha = new Uint8Array(w * h);
  var res = await imaging.getPixels({ documentID: doc.id, layerID: L.id, sourceBounds: b, componentSize: 8, colorSpace: 'RGB' });
  var im = res.imageData, raw = await im.getData({ chunky: true }), iw = im.width, ih = im.height, c = im.components; im.dispose();
  var sb = res.sourceBounds || b, ox = (sb.left || 0) - b.left, oy = (sb.top || 0) - b.top;
  for (var y = 0; y < ih; y++) { var ty = y + oy; if (ty < 0 || ty >= h) continue;
    for (var x = 0; x < iw; x++) { var tx = x + ox; if (tx < 0 || tx >= w) continue;
      var s = (y * iw + x) * c, t = ty * w + tx, a = c === 4 ? raw[s + 3] / 255 : 1;
      out[3 * t] = Math.round(raw[s] * a + 255 * (1 - a)); out[3 * t + 1] = Math.round(raw[s + 1] * a + 255 * (1 - a)); out[3 * t + 2] = Math.round(raw[s + 2] * a + 255 * (1 - a)); alpha[t] = Math.round(a * 255); } }
  return { rgb: out, alpha: alpha, w: w, h: h };
}
function rgbDesc(c) { return { _obj: 'RGBColor', red: c[0], grain: c[1], blue: c[2] }; }
function pct(v) { return { _unit: 'percentUnit', _value: v }; }
function px(v) { return { _unit: 'pixelsUnit', _value: v }; }

// thickness of the new text's letters (to scale effect sizes)
function thickness(mask, w, h) {
  var d = FX.edt(mask, w, h), th = [];
  for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var i = y * w + x, v = d[i]; if (v < 1) continue;
    if (v >= d[i - 1] && v >= d[i + 1] && v >= d[i - w] && v >= d[i + w]) th.push(v); }
  th.sort(function (a, b) { return a - b; }); return th.length ? 2 * th[th.length >> 1] : 0;
}

// a gradient for Photoshop from colours measured along the word: t = 0..1 over the letters' box (x: left to right, angle 0;
// y: top to bottom, angle 90 runs from the bottom, so the locations are turned round)
function gradDesc(stops, ax, name) {
  var cs = stops.map(function (z) { return { _obj: 'colorStop', color: rgbDesc(z.c.map(function (v) { return Math.round(v); })), type: { _enum: 'colorStopType', _value: 'userStop' }, location: Math.max(0, Math.min(4096, Math.round(4096 * (ax === 'y' ? 1 - z.t : z.t)))), midpoint: 50 }; });
  cs.sort(function (p1, p2) { return p1.location - p2.location; });
  return { _obj: 'gradientClassEvent', name: name, gradientForm: { _enum: 'gradientForm', _value: 'customStops' }, interfaceIconFrameDimmed: 4096, colors: cs,
    transparency: [{ _obj: 'transferSpec', opacity: pct(100), location: 0, midpoint: 50 }, { _obj: 'transferSpec', opacity: pct(100), location: 4096, midpoint: 50 }] };
}
function gradParts(a) { return { angle: { _unit: 'angleUnit', _value: a.ax === 'y' ? 90 : 0 }, type: { _enum: 'gradientType', _value: 'linear' }, reverse: false, dither: false, scale: pct(100), align: true, offset: { _obj: 'paint', horizontal: pct(0), vertical: pct(0) } }; }
function effectsFor(st, k, noGradGlow) {
  var fx = { _obj: 'layerEffects', scale: pct(100) };
  // house style: flat coloured letters -> soft two-colour vertical gradient (lighter top, darker bottom)
  if (SETTINGS.houseGradient > 0 && !st.keepWidth && !st.fillAcross && !st.gradient && st.fill) {
    var f0 = st.fill, mx = Math.max(f0[0], f0[1], f0[2]), mn = Math.min(f0[0], f0[1], f0[2]), lu = 0.299 * f0[0] + 0.587 * f0[1] + 0.114 * f0[2];
    if (mx - mn > 35 && lu > 25 && lu < 235) {
      var g = SETTINGS.houseGradient, cl = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
      st.gradient = { top: f0.map(function (v) { return cl(v + (255 - v) * g); }), bottom: f0.map(function (v) { return cl(v * (1 - g)); }), locTop: 4011, locBot: 85, house: true };
    }
  }
  var base = { enabled: true, present: true, showInDialog: true };
  if (st.fillAcross) fx.gradientFill = Object.assign({ _obj: 'gradientFill', mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), gradient: gradDesc(st.fillAcross.stops, st.fillAcross.ax, 'StyleMatch letters') }, gradParts(st.fillAcross), base);
  else if (st.gradient) {
    fx.gradientFill = Object.assign({ _obj: 'gradientFill', mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), align: true, angle: { _unit: 'angleUnit', _value: 90 }, dither: false, reverse: false,
      type: { _enum: 'gradientType', _value: 'linear' }, scale: pct(100), offset: { _obj: 'paint', horizontal: pct(0), vertical: pct(0) },
      gradient: { _obj: 'gradientClassEvent', name: 'StyleMatch', gradientForm: { _enum: 'gradientForm', _value: 'customStops' }, interfaceIconFrameDimmed: 4096,
        colors: st.gradient.stops ? st.gradient.stops.map(function (z) { return { _obj: 'colorStop', color: rgbDesc(z.c), type: { _enum: 'colorStopType', _value: 'userStop' }, location: z.loc, midpoint: 50 }; }) :
                [{ _obj: 'colorStop', color: rgbDesc(st.gradient.bottom), type: { _enum: 'colorStopType', _value: 'userStop' }, location: Math.max(0, Math.min(4096, st.gradient.locBot || 0)), midpoint: 50 },
                 { _obj: 'colorStop', color: rgbDesc(st.gradient.top), type: { _enum: 'colorStopType', _value: 'userStop' }, location: Math.max(0, Math.min(4096, st.gradient.locTop || 4096)), midpoint: 50 }],
        transparency: [{ _obj: 'transferSpec', opacity: pct(100), location: 0, midpoint: 50 }, { _obj: 'transferSpec', opacity: pct(100), location: 4096, midpoint: 50 }] } }, base);
  } else fx.solidFill = Object.assign({ _obj: 'solidFill', mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), color: rgbDesc(st.fill) }, base);
  // outlines: one colour, or a gradient along the word (Stroke > Fill Type: Gradient, aligned with the layer)
  function frame(style, size, color, across) { var f = { _obj: 'frameFX', style: { _enum: 'frameStyle', _value: style }, mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), size: px(Math.max(1, Math.round(size * k))), overprint: false };
    if (across) { f.paintType = { _enum: 'frameFill', _value: 'gradientFill' }; f.gradient = gradDesc(across.stops, across.ax, 'StyleMatch outline'); Object.assign(f, gradParts(across)); }
    else { f.paintType = { _enum: 'frameFill', _value: 'solidColor' }; f.color = rgbDesc(color); }
    return Object.assign(f, base); }
  var frames = [];
  // house style: the outermost light outline gets the house width (exact px, not scaled to the letters)
  var HW = SETTINGS.houseOutlinePx; if (typeof HW === 'number') HW = HW > 0 ? [HW] : [];
  if (HW.length && !st.keepWidth && st.strokes.length) {
    var o = st.strokes[st.strokes.length - 1], oc = o.color || [0, 0, 0];
    if (!o.across && (0.299 * oc[0] + 0.587 * oc[1] + 0.114 * oc[2]) > 200) {
      if (o.size0 === undefined) o.size0 = o.size;
      var meas = o.size0 * (k || 1), best = HW[0]; HW.forEach(function (wv) { if (Math.abs(wv - meas) < Math.abs(best - meas)) best = wv; });
      o.size = best / (k || 1); st.houseOutline = best;
    }
  }
  if (st.inner) frames.push(frame('insetFrame', st.inner.size, st.inner.color, st.inner.across));
  st.strokes.forEach(function (s) { frames.push(frame('outsetFrame', s.size, s.color, s.across)); });
  if (frames.length) fx.frameFXMulti = frames;
  if (st.innerGlow) { var ig = st.innerGlow; fx.innerGlow = Object.assign({ _obj: 'innerGlow', mode: { _enum: 'blendMode', _value: ig.mode }, opacity: pct(Math.round(ig.opacity * 100)), color: rgbDesc(ig.color),
    glowTechnique: { _enum: 'matteTechnique', _value: 'softMatte' }, chokeMatte: px(ig.choke), blur: px(Math.max(1, Math.round(ig.size * k))), noise: pct(0), shadingNoise: pct(0), antiAlias: false, inputRange: pct(50),
    innerGlowSource: { _enum: 'innerGlowSourceType', _value: 'edgeGlow' }, transferSpec: { _obj: 'shapeCurveType', name: 'Linear' } }, base); }
  // everything moved to one side is a Drop Shadow; several go into one list (the first is drawn on top)
  var shs = [];
  function shadow(mode, color, opacity, dx, dy, spread, size, conceals) { var d = Math.round(Math.sqrt(dx * dx + dy * dy));
    return Object.assign({ _obj: 'dropShadow', mode: { _enum: 'blendMode', _value: mode }, color: rgbDesc(color.map(function (v) { return Math.round(v); })), opacity: pct(Math.round(opacity * 100)),
      useGlobalAngle: false, localLightingAngle: { _unit: 'angleUnit', _value: d ? Math.round(Math.atan2(dy, -dx) * 180 / Math.PI) : 90 }, distance: px(d),
      chokeMatte: px(spread), blur: px(size), noise: pct(0), antiAlias: false, transferSpec: { _obj: 'shapeCurveType', name: 'Linear' }, layerConceals: conceals !== false }, base); }
  if (st.glow && (st.glow.dx || st.glow.dy)) shs.push(shadow(st.glow.mode, st.glow.color, st.glow.opacity, st.glow.dx * k, st.glow.dy * k, st.glow.spread, Math.max(1, Math.round(st.glow.size * k))));
  if (st.shadow) shs.push(shadow(st.shadow.mode, st.shadow.color, st.shadow.opacity, (st.shadow.dx || 0) * k, (st.shadow.dy || 0) * k, st.shadow.spread, Math.max(1, Math.round(st.shadow.size * k))));
  (st.moreShadows || []).forEach(function (s) { shs.push(shadow(s.mode, s.color, s.opacity, s.dx * k, s.dy * k, s.spread, Math.max(1, Math.round(s.size * k)))); });
  // RGB split: hard copies (size 0) in Screen; with the letters hidden (Fill 0%) the copies must also show under them
  (st.split || []).forEach(function (s) { shs.push(shadow('screen', s.color, 1, s.dx * k, s.dy * k, 0, 0, !!st.splitUnder)); });
  // 3D depth: hard copies of the outlined letters (spread 100%, size = the outline) stepping along the depth; inner copies on top
  if (st.extrude) { var e = st.extrude, budget = Math.max(e.layers.length, 10 - shs.length), per = Math.max(1, Math.floor(budget / e.layers.length));
    for (var li = e.layers.length - 1; li >= 0; li--) { var Ly = e.layers[li], m = Math.min(per, e.len);
      for (var q = 1; q <= m; q++) { var t = Math.round(q * e.len / m), f = (t - 1) / Math.max(1, e.len - 1), col = Ly.far ? Ly.color.map(function (v, c) { return v + f * (Ly.far[c] - v); }) : Ly.color;
        shs.push(shadow('normal', col, 1, e.ux * t * k, e.uy * t * k, 100, Math.max(0, Math.round(Ly.size * k)))); } } }
  if (shs.length === 1) fx.dropShadow = shs[0]; else if (shs.length > 1) fx.dropShadowMulti = shs;
  if (st.glow && !(st.glow.dx || st.glow.dy) && !(st.glow.across && SETTINGS.colourGlowLayer)) { fx.outerGlow = Object.assign({ _obj: 'outerGlow', mode: { _enum: 'blendMode', _value: st.glow.mode }, opacity: pct(Math.round(st.glow.opacity * 100)),
    glowTechnique: { _enum: 'matteTechnique', _value: 'softMatte' }, chokeMatte: px(st.glow.spread), blur: px(Math.max(1, Math.round(st.glow.size * k))), noise: pct(0), shadingNoise: pct(0), antiAlias: false, inputRange: pct(50),
    transferSpec: { _obj: 'shapeCurveType', name: 'Linear' } }, base);
    // gradient glow: colour from the letter edge (left stop) to the glow's outer end (right stop); the fade comes from the opacity stops
    if (st.glow.grad && !noGradGlow) fx.outerGlow.gradient = { _obj: 'gradientClassEvent', name: 'StyleMatch glow', gradientForm: { _enum: 'gradientForm', _value: 'customStops' }, interfaceIconFrameDimmed: 4096,
      colors: [{ _obj: 'colorStop', color: rgbDesc(st.glow.grad.inner), type: { _enum: 'colorStopType', _value: 'userStop' }, location: 0, midpoint: 50 }, { _obj: 'colorStop', color: rgbDesc(st.glow.grad.outer), type: { _enum: 'colorStopType', _value: 'userStop' }, location: 4096, midpoint: 50 }],
      transparency: [{ _obj: 'transferSpec', opacity: pct(100), location: 0, midpoint: 50 }, { _obj: 'transferSpec', opacity: pct(0), location: 4096, midpoint: 50 }] };
    else fx.outerGlow.color = rgbDesc(st.glow.across ? st.glow.across.stops[st.glow.across.stops.length >> 1].c.map(Math.round) : st.glow.color); }
  if (st.bevel) { var bv = st.bevel; fx.bevelEmboss = Object.assign({ _obj: 'bevelEmboss', highlightMode: { _enum: 'blendMode', _value: bv.hiMode }, highlightColor: rgbDesc(C3(bv.hi)), highlightOpacity: pct(bv.hiOp),
    shadowMode: { _enum: 'blendMode', _value: bv.shMode }, shadowColor: rgbDesc(C3(bv.sh)), shadowOpacity: pct(bv.shOp), bevelTechnique: { _enum: 'bevelTechnique', _value: bv.tech }, bevelStyle: { _enum: 'bevelEmbossStyle', _value: bv.style },
    useGlobalAngle: false, localLightingAngle: { _unit: 'angleUnit', _value: bv.angle }, localLightingAltitude: { _unit: 'angleUnit', _value: bv.alt }, strengthRatio: pct(bv.depth), blur: px(Math.max(1, Math.round(bv.size * k))),
    bevelDirection: { _enum: 'bevelEmbossStampStyle', _value: 'stampIn' }, transferSpec: { _obj: 'shapeCurveType', name: 'Linear' }, antialiasGloss: false, softness: px(Math.round(bv.soften * k)), useShape: false, useTexture: false }, base); }
  return fx;
}
async function glowColourLayer(doc, baseId, tb, st, k, nm, log) {
  try {
      await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: baseId }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'duplicate', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], version: 5, _options: { dialogOptions: 'dontDisplay' } });
      var gl = st.glow, gfx = { _obj: 'layerEffects', scale: pct(100), outerGlow: { _obj: 'outerGlow', enabled: true, present: true, showInDialog: true, mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), color: rgbDesc([255, 255, 255]),
        glowTechnique: { _enum: 'matteTechnique', _value: 'softMatte' }, chokeMatte: px(gl.spread), blur: px(Math.max(1, Math.round(gl.size * k))), noise: pct(0), shadingNoise: pct(0), antiAlias: false, inputRange: pct(50), transferSpec: { _obj: 'shapeCurveType', name: 'Linear' } } };
      await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: gfx, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', fillOpacity: pct(0), opacity: pct(100) }, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } });
      var GL = doc.activeLayers[0], sb = GL.bounds, ga = gl.across, lo = ga.ax === 'y' ? tb.top : tb.left, hi = ga.ax === 'y' ? tb.bottom : tb.right, s0b = ga.ax === 'y' ? sb.top : sb.left, s1b = ga.ax === 'y' ? sb.bottom : sb.right;
      // the stops were measured over the letters; the Smart Object is wider (it holds the glow): move them onto its box
      var gst = ga.stops.map(function (z) { return { t: (lo + z.t * (hi - lo) - s0b) / Math.max(1, s1b - s0b), c: z.c }; });
      var ov = { _obj: 'layerEffects', scale: pct(100), gradientFill: Object.assign({ _obj: 'gradientFill', enabled: true, present: true, showInDialog: true, mode: { _enum: 'blendMode', _value: 'normal' }, opacity: pct(100), gradient: gradDesc(gst, ga.ax, 'StyleMatch glow colours') }, gradParts(ga)) };
      await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _id: GL.id }, { _ref: 'document', _id: doc.id }], to: ov, _options: { dialogOptions: 'dontDisplay' } });
      try { GL.name = nm.slice(0, 30) + ' - glow colours (StyleMatch)'; } catch (e) { }
      // blend mode and opacity on their own call (set together with the name, Photoshop 2025 kept only the name - tested)
      await bp({ _obj: 'set', _target: [{ _ref: 'layer', _id: GL.id }, { _ref: 'document', _id: doc.id }], to: { _obj: 'layer', mode: { _enum: 'blendMode', _value: gl.mode }, opacity: pct(Math.round(gl.opacity * 100)) }, _options: { dialogOptions: 'dontDisplay' } });
      try { var wantOp = Math.round(gl.opacity * 100); if (Math.abs(GL.opacity - wantOp) > 1) GL.opacity = wantOp; if (gl.mode === 'screen' && GL.blendMode !== constants.BlendMode.SCREEN) GL.blendMode = constants.BlendMode.SCREEN; } catch (e) { }
      await bp({ _obj: 'move', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _ref: 'layer', _enum: 'ordinal', _value: 'previous' }, _options: { dialogOptions: 'dontDisplay' } });
      log.push(nm + ': glow colours change along the word (' + ga.stops.length + ' stops): glow copy as a Smart Object + Gradient Overlay, under the text'); }
    catch (e) { log.push(nm + ': glow colour layer not added (' + e.message + ')'); }
}

// your settings in the layer name:  #preset neon color=#00FFAA glow=#FF00FF depth=8 intensity=1.3
function presetOptions(st, o) {
  var hx = function (v) { return /^#?[0-9a-f]{6}$/i.test(v || '') ? C3(v[0] === '#' ? v : '#' + v) : null; }, mix = function (c, t, f) { return c.map(function (v, i) { return Math.round(v + f * (t[i] - v)); }); };
  var col = hx(o.color), glw = hx(o.glow), dep = parseFloat(o.depth), inten = parseFloat(o.intensity);
  if (col) { st.fill = col; if (st.fillAcross) st.fillAcross = { ax: st.fillAcross.ax, lo: 0, hi: 1, stops: [{ t: 0, c: mix(col, [255, 255, 255], 0.55) }, { t: 0.5, c: col }, { t: 1, c: mix(col, [0, 0, 0], 0.45) }] };
    if (st.extrude) st.extrude.layers.forEach(function (Ly) { Ly.color = mix(col, [0, 0, 0], 0.55); Ly.far = mix(col, [0, 0, 0], 0.8); }); }
  if (glw) { if (st.glow) { st.glow.color = glw; delete st.glow.across; } if (st.inner && st.glow) st.inner.color = glw; if (st.shadow && st.shadow.mode === 'screen') st.shadow.color = glw; }
  if (dep >= 0) { if (st.extrude) st.extrude.len = Math.round(dep); (st.moreShadows || []).forEach(function (m, i) { var f = dep / 4 / (i + 1) * (i + 1); m.dx = Math.sign(m.dx) * Math.round(f * (i + 1)); m.dy = Math.sign(m.dy) * Math.round(f * (i + 1)); }); }
  if (inten > 0) { [st.glow, st.shadow, st.innerGlow].forEach(function (e) { if (e) { e.opacity = Math.min(1, e.opacity * inten); e.size = e.size * Math.sqrt(inten); } }); }
}
// a look from the library on one text layer (layer name contains  #preset <name>); no Raw/Clean needed
async function applyPreset(doc, L, name, log) {
  var p = PRESETS[name]; if (!p) { log.push(L.name + ': no look called "' + name + '" - looks: ' + Object.keys(PRESETS).join(', ')); return; }
  var nb = L.boundsNoEffects, tb = { left: nb.left, top: nb.top, right: nb.right, bottom: nb.bottom }, k = Math.max(0.2, (tb.bottom - tb.top) / 100);
  var st = JSON.parse(JSON.stringify(p.st)), opt = {}; (L.name.match(/(\w+)=([#\w.]+)/g) || []).forEach(function (kv) { var q = kv.split('='); opt[q[0].toLowerCase()] = q[1]; });
  presetOptions(st, opt); st.keepWidth = true; st.fill = st.fill || [255, 255, 255]; st.fillOpacity = st.fillOpacity === undefined ? 1 : st.fillOpacity; st.strokes = st.strokes || []; st.bevel = p.bevel || null;
  if (st.glow) { st.glow.dx = st.glow.dx || 0; st.glow.dy = st.glow.dy || 0; }
  var fx = effectsFor(st, k);
  try { await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: fx, _options: { dialogOptions: 'dontDisplay' } }); }
  catch (e) { if (!st.bevel) throw e; st.bevel = null; log.push(L.name + ': Bevel & Emboss refused (' + e.message + ') - look applied without it');
    await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: effectsFor(st, k), _options: { dialogOptions: 'dontDisplay' } }); }
  await bp({ _obj: 'set', _target: [{ _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: { _obj: 'layer', opacity: pct(100), fillOpacity: pct(Math.round(st.fillOpacity * 100)), blendInterior: true }, _options: { dialogOptions: 'dontDisplay' } });
  var baseId = L.id;
  if (st.glow && st.glow.across && SETTINGS.colourGlowLayer) await glowColourLayer(doc, baseId, tb, st, k, L.name, log);
  var flt = []; if (p.noise) flt.push(KB.addNoise.bp({ amount: p.noise, mono: true })); if (p.gauss) flt.push({ _obj: 'gaussianBlur', radius: px(Math.max(0.3, +(p.gauss * k).toFixed(1))) });
  if (flt.length) { try { await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } }); for (var i = 0; i < flt.length; i++) { flt[i]._options = { dialogOptions: 'dontDisplay' }; await bp(flt[i]); } }
    catch (e) { log.push(L.name + ': filter not added (' + e.message + ')'); } }
  log.push(L.name + ': look "' + name + '" (' + p.family + ') applied, sizes scaled to your text (x' + k.toFixed(2) + ')' + (p.note ? ' | to finish by hand: ' + p.note : ''));
  NOTES.push('[' + L.name.slice(0, 40) + ']\rLook: ' + p.family + ' - ' + p.look + (p.note ? '\rBy hand: ' + p.note : ''));
}

async function matchOne(doc, L, raw, clean, log, selB) {
  var nm = L.name, nb = L.boundsNoEffects, tb = { left: nb.left, top: nb.top, right: nb.right, bottom: nb.bottom };
  var t0 = Date.now();
  var tbb = { left: Math.max(0, Math.floor(tb.left)), top: Math.max(0, Math.floor(tb.top)), right: Math.min(doc.width, Math.ceil(tb.right)), bottom: Math.min(doc.height, Math.ceil(tb.bottom)) };
  async function newThick() { var T = await layerRGB(doc, L, tbb), mask = new Uint8Array(T.w * T.h); for (var i = 0; i < mask.length; i++) mask[i] = T.alpha[i] > 127 ? 1 : 0; return FX.thick(mask, T.w, T.h); }
  var tn = 0; try { tn = await newThick(); } catch (e) { }
  // read the raw and the clean around the text (mg px of room) and analyse the original text there
  async function analyzeWith(mg) {
    var bb = selB ? selB : { left: tb.left - mg, top: tb.top - mg, right: tb.right + mg, bottom: tb.bottom + mg };
    bb = { left: Math.max(0, Math.floor(bb.left)), top: Math.max(0, Math.floor(bb.top)), right: Math.min(doc.width, Math.ceil(bb.right)), bottom: Math.min(doc.height, Math.ceil(bb.bottom)) };
    var R2 = await layerRGB(doc, raw, bb), C2 = await layerRGB(doc, clean, bb);
    // a wider area around it, only to find where the Clean layer sits (hand-placed cleans are often moved or resized a little)
    var cb = { left: Math.max(0, bb.left - SETTINGS.context), top: Math.max(0, bb.top - SETTINGS.context), right: Math.min(doc.width, bb.right + SETTINGS.context), bottom: Math.min(doc.height, bb.bottom + SETTINGS.context) };
    var BR = await layerRGB(doc, raw, cb), BC = await layerRGB(doc, clean, cb);
    for (var bi = 0; bi < BC.alpha.length; bi++) { var ba = BC.alpha[bi] / 255; if (ba >= 1) continue; for (var bc2 = 0; bc2 < 3; bc2++) BC.rgb[3 * bi + bc2] = Math.max(0, Math.min(255, Math.round(BC.rgb[3 * bi + bc2] - 255 * (1 - ba) + BR.rgb[3 * bi + bc2] * (1 - ba)))); }
    // a clean layer that only patches parts of the page (e.g. "TypeR Clean") sits on top of the original
    for (var pi = 0; pi < C2.alpha.length; pi++) { var pa = C2.alpha[pi] / 255; if (pa >= 1) continue;
      for (var pc = 0; pc < 3; pc++) C2.rgb[3 * pi + pc] = Math.max(0, Math.min(255, Math.round(C2.rgb[3 * pi + pc] - 255 * (1 - pa) + R2.rgb[3 * pi + pc] * (1 - pa)))); }
    var opts = { userThick: tn, big: { R: BR.rgb, C: BC.rgb, w: BR.w, h: BR.h, ox: bb.left - cb.left, oy: bb.top - cb.top } };   // without a marquee: look at the original text under/around the new text only
    if (!selB) opts.focus = { x0: Math.max(0, tb.left - bb.left), y0: Math.max(0, tb.top - bb.top), x1: Math.min(R2.w, tb.right - bb.left), y1: Math.min(R2.h, tb.bottom - bb.top) };
    return { b: bb, R: R2, C: C2, st: FX.analyze(R2.rgb, C2.rgb, R2.w, R2.h, opts) };
  }
  var mg0 = Math.max(SETTINGS.minMargin, SETTINGS.margin * (tb.bottom - tb.top)), AN = await analyzeWith(mg0);
  // a big glow or shadow needs room to be measured: when the original's effects reach the edge of the area looked at, look again with more room
  if (!selB && AN.st) { var s0 = AN.st, rf = Math.max(s0.glow ? 1.3 * s0.glow.size + Math.abs(s0.glow.dx || 0) + Math.abs(s0.glow.dy || 0) : 0, s0.shadow ? 1.3 * s0.shadow.size + Math.abs(s0.shadow.dx) + Math.abs(s0.shadow.dy) : 0, s0.extrude ? s0.extrude.len + 10 : 0, s0.match && s0.match.zone ? s0.match.zone : 0);
    if (rf + 8 > mg0 && mg0 < 200) { var AN2 = await analyzeWith(Math.min(200, Math.max(60, Math.round(1.6 * rf)))); if (AN2.st) { AN = AN2; log.push(nm + ': its glow/shadow reaches far - looked again with more room around the text'); } } }
  var b = AN.b, R = AN.R, C = AN.C, st = AN.st;
  if (!st) { log.push(nm + ': no original text found around it'); return; }
  st.keepWidth = /#keepwidth/i.test(nm);
  // remove the layer's old style first
  var hasFx = false; try { var ab = L.bounds; hasFx = ab.left !== nb.left || ab.top !== nb.top || ab.right !== nb.right || ab.bottom !== nb.bottom; } catch (e) { }
  if (hasFx) { try { await bp({ _obj: 'disableLayerStyle', _target: [{ _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], _options: { dialogOptions: 'dontDisplay' } }); tn = await newThick(); } catch (e) { } }
  // the original colour ramp runs inside each line: repeat it in every line of the new text (stops of one Gradient Overlay)
  if (st.gradient && st.gradient.perLine) { try { var TA = await layerRGB(doc, L, tbb), lns = FX.textLines(TA.alpha, TA.w, TA.h, 0.5);
      if (lns.length >= 2) { var Hh = Math.max(1, TA.h), fT = st.gradient.fTop === undefined ? 0.2 : st.gradient.fTop, fB = st.gradient.fBot === undefined ? 0.8 : st.gradient.fBot, gs = [];
        lns.forEach(function (ln) { var lh = ln[1] - ln[0]; gs.push({ c: st.gradient.top, loc: Math.round(4096 * (1 - (ln[0] + fT * lh) / Hh)) }, { c: st.gradient.bottom, loc: Math.round(4096 * (1 - (ln[0] + fB * lh) / Hh)) }); });
        gs.forEach(function (z) { z.loc = Math.max(0, Math.min(4096, z.loc)); }); gs.sort(function (p1, p2) { return p1.loc - p2.loc; }); st.gradient.stops = gs; st.gradient.nLines = lns.length; } } catch (e) { } }
  var UA = null; if ((st.details && SETTINGS.details) || (st.fade && SETTINGS.fadeMask)) { try { UA = await layerRGB(doc, L, b); } catch (e) { UA = null; } }
  var clipped = (st.dots && SETTINGS.screentone) || (st.details && SETTINGS.details && UA);
  var k = 1;
  if (SETTINGS.scaleToText && st.thick > 0 && tn > 0) {
    k = Math.max(0.85, Math.min(1.15, Math.sqrt(tn / st.thick)));   // outlines/glow follow the letter weight, but gently (heavy outlines look blunt)
    log.push(nm + ': letter thickness raw ' + st.thick.toFixed(1) + ' new ' + tn.toFixed(1) + ' -> scale ' + k.toFixed(2));
  }
  var fx = effectsFor(st, k);   // (with a clipped dot layer, 'Blend Clipped Layers as Group' is turned off, or the colour overlay would cover the dots - tested in Photoshop 2025)
  try { await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: fx, _options: { dialogOptions: 'dontDisplay' } }); }
  catch (e) { if (!(st.glow && st.glow.grad)) throw e; log.push(nm + ': gradient glow refused by Photoshop (' + e.message + ') - one-colour glow used');
    await bp({ _obj: 'set', _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: effectsFor(st, k, true), _options: { dialogOptions: 'dontDisplay' } }); }
  await bp({ _obj: 'set', _target: [{ _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], to: { _obj: 'layer', opacity: pct(100), fillOpacity: pct(st.split && !st.splitUnder ? 0 : Math.round(st.fillOpacity * 100)), blendInterior: true, blendClipped: !clipped }, _options: { dialogOptions: 'dontDisplay' } });
  var hex = function (c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('').toUpperCase(); };
  // filters (grain, optional motion blur) need a Smart Object: the styled text goes inside it, the filter goes on top (still editable)
  var flt = []; (st.filters || []).forEach(function (f) { if (f.type === 'noise' && SETTINGS.applyFilters) flt.push(KB.addNoise.bp({ amount: Math.max(1, Math.min(60, Math.round(f.sigma / 255 * 100 * NOISE_K))), mono: f.mono })); });
  if (SETTINGS.autoMotionBlur && st.suggest && st.suggest.type === 'motion') flt.push(KB.motionBlur.bp({ angle: st.suggest.angle, dist: Math.max(1, Math.round(st.suggest.dist * k)) }));
  var baseId = L.id;
  if (flt.length) { try {
      await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: L.id }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } });
      try { baseId = doc.activeLayers[0].id; } catch (e) { }
      for (var fi = 0; fi < flt.length; fi++) { var fd = flt[fi]; fd._options = { dialogOptions: 'dontDisplay' }; await bp(fd); }
      log.push(nm + ': made a Smart Object and added ' + flt.map(function (f) { return f._obj; }).join(' + '));
    } catch (e) { log.push(nm + ': filter not added (' + e.message + ')'); } }
  // on the letter faces: dots, then drawn details - each an editable colour layer whose mask holds the shapes, clipped to the text
  if (st.dots && SETTINGS.screentone) { try {
      var pad = Math.round(0.6 * Math.max(tb.right - tb.left, tb.bottom - tb.top)), db = clampBox(doc, { left: tb.left - pad, top: tb.top - pad, right: tb.right + pad, bottom: tb.bottom + pad });
      var dw = db.right - db.left, dh = db.bottom - db.top, dm = new Uint8Array(dw * dh);
      for (var dy = 0; dy < dh; dy++) for (var dx = 0; dx < dw; dx++) dm[dy * dw + dx] = Math.round(255 * FX.dotAlpha(st.dots, dx + db.left - b.left, dy + db.top - b.top));
      var how = await addMaskedFill(doc, baseId, st.dots.dot, dm, db, 'Screentone dots (StyleMatch)');
      log.push(nm + ': screentone dots ' + hex(st.dots.dot) + ' every ' + Math.sqrt(st.dots.ax * st.dots.ax + st.dots.ay * st.dots.ay).toFixed(1) + ' px, size ' + (2 * st.dots.r).toFixed(1) + ' px (' + how + ')'); }
    catch (e) { log.push(nm + ': dots not added (' + e.message + ')'); } }
  if (st.details && SETTINGS.details && UA) { try {
      var A = new Float32Array(UA.w * UA.h); for (var ai = 0; ai < A.length; ai++) A[ai] = UA.alpha[ai] / 255;
      var du = FX.detailsFor(st.details, A, UA.w, UA.h), dmk = new Uint8Array(du.length), any = 0;
      for (var di = 0; di < du.length; di++) { dmk[di] = Math.round(255 * du[di]); if (dmk[di] > 60) any++; }
      if (any > 20) { var how2 = await addMaskedFill(doc, baseId, st.details.color, dmk, b, 'Drawn details (StyleMatch)');
        log.push(nm + ': ' + st.details.marks + ' drawn marks ' + hex(st.details.color) + ' placed into the new letters (' + how2 + ')'); }
      else log.push(nm + ': drawn marks found but none fit the new letters'); }
    catch (e) { log.push(nm + ': details not added (' + e.message + ')'); } }
  // one layer mask can hold both: the fade (gradient) and the art in front of the text (where the new text must go behind it)
  var useFade = st.fade && SETTINGS.fadeMask, useOcc = st.occluder && SETTINGS.occlusionMask;
  if (useFade || useOcc) { try {
      var fp = Math.round(0.5 * Math.max(tb.right - tb.left, tb.bottom - tb.top)) + 40 + (st.glow ? Math.round(1.2 * st.glow.size * k) : 0) + (st.shadow ? Math.round(1.2 * st.shadow.size * k + Math.abs(st.shadow.dx) + Math.abs(st.shadow.dy)) : 0);
      var fb = clampBox(doc, { left: Math.min(tb.left - fp, b.left), top: Math.min(tb.top - fp, b.top), right: Math.max(tb.right + fp, b.right), bottom: Math.max(tb.bottom + fp, b.bottom) });
      var fw = fb.right - fb.left, fh = fb.bottom - fb.top, fm = new Uint8Array(fw * fh), box = [tb.left, tb.top, tb.right, tb.bottom], ow = R.w, oh = R.h;
      for (var fy = 0; fy < fh; fy++) for (var fx2 = 0; fx2 < fw; fx2++) { var X = fx2 + fb.left, Y = fy + fb.top, v = 1;
        if (useFade) v *= FX.fadeMaskAt(st.fade, box, X, Y);
        if (useOcc) { var ox = X - b.left, oy = Y - b.top; if (ox >= 0 && oy >= 0 && ox < ow && oy < oh) v *= 1 - st.occluder.mask[oy * ow + ox]; }
        fm[fy * fw + fx2] = Math.round(255 * v); }
      await addLayerMask(doc, baseId, fm, fb);
      if (useFade) log.push(nm + ': fades from ' + Math.round(st.fade.vHi * 100) + '% to ' + Math.round(st.fade.vLo * 100) + '% (gradient layer mask)');
      if (useOcc) log.push(nm + ': art in front of the original text (' + st.occluder.area + ' px, cuts ' + st.occluder.cutEdge + ' px of letter edge): the new text goes behind it - layer mask, Layer Mask Hides Effects on'); }
    catch (e) { log.push(nm + ': layer mask not added (' + e.message + ')'); } }
  // a glow whose colour changes along the word: Outer Glow can't (its gradient only runs outward), so a copy of the text keeps only
  // its glow in white, becomes a Smart Object, and a Gradient Overlay on that colours the glow along the word; it sits under the text
  if (st.glow && st.glow.across && !(st.glow.dx || st.glow.dy) && SETTINGS.colourGlowLayer) await glowColourLayer(doc, baseId, tb, st, k, nm, log);
  // Radial Blur copy (the Raw 13 recipe): the styled text duplicated above itself, made a Smart Object, Filter > Blur > Radial Blur
  // (a text layer whose name contains #radial always gets it - your own choice for one text, e.g. the Raw 13 look)
  var rbOn = SETTINGS.radialBlurCopy === 'always' || /#radial/i.test(nm) || (SETTINGS.radialBlurCopy !== 'off' && st.radial);
  if (rbOn) { try {
      var rb = st.radial || { method: 'zoom', amount: SETTINGS.radialAmount, cxRel: 0, cyRel: 0 };
      await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: baseId }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'duplicate', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], version: 5, _options: { dialogOptions: 'dontDisplay' } });
      await bp({ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } });
      var RL = doc.activeLayers[0], amt = Math.max(1, Math.min(100, Math.round(rb.amount)));
      await bp({ _obj: 'radialBlur', amount: amt, blurMethod: { _enum: 'blurMethod', _value: rb.method === 'spin' ? 'spin' : 'zoom' }, blurQuality: { _enum: 'blurQuality', _value: 'good' }, _options: { dialogOptions: 'dontDisplay' } });
      try { RL.name = nm.slice(0, 30) + ' - radial blur copy (StyleMatch)'; } catch (e) { }
      // centre off the middle / one-sided streaks: Photoshop's Radial Blur centre is set by hand, so the copy fades out on the short side (layer mask)
      var offC = Math.abs(rb.cxRel || 0) > 0.08 || Math.abs(rb.cyRel || 0) > 0.08 || rb.side;
      if (offC) { var vx = -(rb.cxRel || 0), vy = -(rb.cyRel || 0); if (rb.side && !vx && !vy) vx = 1; var vl = Math.sqrt(vx * vx + vy * vy) || 1; vx /= vl; vy /= vl;
        var rp = Math.round(0.5 * Math.max(tb.right - tb.left, tb.bottom - tb.top)) + 60, rbx = clampBox(doc, { left: tb.left - rp, top: tb.top - rp, right: tb.right + rp, bottom: tb.bottom + rp }), rw = rbx.right - rbx.left, rh = rbx.bottom - rbx.top, rm = new Uint8Array(rw * rh), mx = (tb.left + tb.right) / 2, my = (tb.top + tb.bottom) / 2, half = Math.max(1, Math.abs(vx) * (tb.right - tb.left) / 2 + Math.abs(vy) * (tb.bottom - tb.top) / 2);
        for (var ry = 0; ry < rh; ry++) for (var rx = 0; rx < rw; rx++) { var u = ((rx + rbx.left - mx) * vx + (ry + rbx.top - my) * vy) / half; rm[ry * rw + rx] = Math.round(255 * Math.max(0.15, Math.min(1, 0.5 + 0.5 * u))); }
        await addLayerMask(doc, RL.id, rm, rbx); }
      log.push(nm + ': Radial Blur copy above the text - Smart Object, ' + (rb.method === 'spin' ? 'Spin' : 'Zoom') + ' Amount ' + amt + ', Good' + (offC ? ', faded on the short side (layer mask)' : '') + (st.radial ? ' (streaks measured: ' + Math.round(rb.gain * 100) + '% better fit)' : ' (your setting)')); }
    catch (e) { log.push(nm + ': radial blur copy not added (' + e.message + ')'); } }
  if (st.cleanNote) log.push(nm + ': ' + st.cleanNote);
  var nl = null; try { nl = nearestLook(st); } catch (e) { }
  if (SETTINGS.notes) NOTES.push('[' + nm.slice(0, 40) + ']\r' + recipe(st, k, hex).join('\r') + (nl ? '\rClosest look in the library: ' + nl + ' (' + PRESETS[nl].family + ') - name a layer "#preset ' + nl + '" to try it' : ''));
  log.push(nm + ': fill ' + (st.gradient ? hex(st.gradient.top) + '->' + hex(st.gradient.bottom) : hex(st.fill)) + ' ' + Math.round(st.fillOpacity * 100) + '%' +
    st.strokes.map(function (s) { return ' stroke ' + Math.round(s.size * k) + 'px ' + hex(s.color); }).join('') + (st.inner ? ' inner ' + Math.round(st.inner.size * k) + 'px ' + hex(st.inner.color) : '') +
    (st.glow ? ((st.glow.dx || st.glow.dy) ? ' shadow ' + st.glow.dx + ',' + st.glow.dy : ' glow') + ' ' + st.glow.mode + ' ' + (st.glow.grad ? 'gradient ' + hex(st.glow.grad.inner) + '->' + hex(st.glow.grad.outer) : hex(st.glow.color)) + ' ' + Math.round(st.glow.opacity * 100) + '% size ' + Math.round(st.glow.size * k) + ' spread ' + st.glow.spread : '') +
    (st.shadow ? ' + drop shadow ' + st.shadow.mode + ' ' + hex(st.shadow.color) + ' ' + Math.round(st.shadow.opacity * 100) + '% size ' + Math.round(st.shadow.size * k) + ' distance ' + Math.round(Math.sqrt(st.shadow.dx * st.shadow.dx + st.shadow.dy * st.shadow.dy) * k) : '') +
    (st.gradient && st.gradient.stops ? ' (colour ramp repeated in ' + st.gradient.nLines + ' lines)' : '') +
    (st.fillAcross ? ' | letter colours along the word: ' + st.fillAcross.stops.map(function (z) { return hex(z.c); }).join(' ') : '') + (st.strokes.some(function (z) { return z.across; }) || (st.inner && st.inner.across) ? ' | outline colours along the word' : '') +
    (st.innerGlow ? ' | inner glow ' + st.innerGlow.mode + ' ' + hex(st.innerGlow.color) + ' ' + Math.round(st.innerGlow.opacity * 100) + '% size ' + Math.round(st.innerGlow.size * k) : '') +
    (st.moreShadows ? ' | +' + st.moreShadows.length + ' more moved copies' : '') + (st.split ? ' | RGB split: ' + st.split.map(function (z) { return hex(z.color) + ' ' + Math.round(z.dx * k) + ',' + Math.round(z.dy * k); }).join(' / ') : '') +
    (st.extrude ? ' | 3D depth ' + Math.round(st.extrude.len * k) + ' px at ' + Math.round(Math.atan2(-st.extrude.uy, st.extrude.ux) * 180 / Math.PI) + ' deg (' + st.extrude.layers.length + ' layer' + (st.extrude.layers.length > 1 ? 's' : '') + ')' : '') + (st.match ? ' | match ' + st.match.score + '/100' : '') + ' (' + (Date.now() - t0) + ' ms, ' + st.cand + ')');
}

function clampBox(doc, r) { return { left: Math.max(0, Math.floor(r.left)), top: Math.max(0, Math.floor(r.top)), right: Math.min(doc.width, Math.ceil(r.right)), bottom: Math.min(doc.height, Math.ceil(r.bottom)) }; }
async function deselect() { await bp({ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'none' }, _options: { dialogOptions: 'dontDisplay' } }); }
// a grey mask (0..255, one byte per pixel) for an area of the page becomes the document selection
async function maskToSelection(doc, m, box) {
  var img = await imaging.createImageDataFromBuffer(m, { width: box.right - box.left, height: box.bottom - box.top, components: 1, chunky: true, colorSpace: 'Grayscale' });
  try { await imaging.putSelection({ documentID: doc.id, imageData: img, targetBounds: { left: box.left, top: box.top } }); } finally { img.dispose(); }
}
// shapes on the letter faces (dots, drawn marks): a Solid Color layer whose mask holds the shapes, clipped to the text.
// Change the colour with a double-click; repaint the mask to change the shapes. Falls back to a plain clipped pixel layer.
async function addMaskedFill(doc, baseId, color, m, box, name) {
  await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: baseId }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
  var how = 'colour layer + mask, clipped';
  try {
    await maskToSelection(doc, m, box);
    await bp({ _obj: 'make', _target: [{ _ref: 'contentLayer' }], using: { _obj: 'contentLayer', type: { _obj: 'solidColorLayer', color: rgbDesc(color) } }, _options: { dialogOptions: 'dontDisplay' } });
    await deselect();
  } catch (e) {
    try { await deselect(); } catch (e2) { }
    how = 'pixel layer, clipped (' + e.message + ')';
    await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: baseId }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
    await bp({ _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'layer', name: name }, _options: { dialogOptions: 'dontDisplay' } });
    var w = box.right - box.left, h = box.bottom - box.top, buf = new Uint8Array(w * h * 4);
    for (var i = 0; i < w * h; i++) { buf[4 * i] = color[0]; buf[4 * i + 1] = color[1]; buf[4 * i + 2] = color[2]; buf[4 * i + 3] = m[i]; }
    var img = await imaging.createImageDataFromBuffer(buf, { width: w, height: h, components: 4, chunky: true, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1' });
    try { await imaging.putPixels({ documentID: doc.id, layerID: doc.activeLayers[0].id, imageData: img, targetBounds: { left: box.left, top: box.top } }); } finally { img.dispose(); }
  }
  try { doc.activeLayers[0].name = name; } catch (e) { }
  await bp({ _obj: 'groupEvent', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], _options: { dialogOptions: 'dontDisplay' } });
  return how;
}
// a layer mask on the text (fades): the area outside the mask box is hidden, so the box is made larger than the text and its effects
async function addLayerMask(doc, id, m, box) {
  await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: id }, { _ref: 'document', _id: doc.id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } });
  // a layer holds one layer mask: if it already has one (yours, or from an earlier run), it is left exactly as it is
  var hm = false; try { var gr = await bp({ _obj: 'get', _target: [{ _property: 'hasUserMask' }, { _ref: 'layer', _id: id }, { _ref: 'document', _id: doc.id }] }); hm = !!(gr && gr[0] && gr[0].hasUserMask); } catch (e) { }
  if (hm) throw new Error('the layer already has a layer mask - kept it as it is (delete it and run StyleMatch again for the new mask)');
  await maskToSelection(doc, m, box);
  try { var mr = await bp({ _obj: 'make', new: { _class: 'channel' }, at: { _ref: 'channel', _enum: 'channel', _value: 'mask' }, using: { _enum: 'userMaskEnabled', _value: 'revealSelection' }, _options: { dialogOptions: 'dontDisplay' } });
    if (mr && mr[0] && mr[0]._obj === 'error') throw new Error(mr[0].message || 'mask not made'); }
  finally { try { await deselect(); } catch (e) { } }
  // 'Layer Mask Hides Effects': the outline fades with the letters (otherwise the Stroke grows into the faded letters)
  await bp({ _obj: 'set', _target: [{ _ref: 'layer', _id: id }, { _ref: 'document', _id: doc.id }], to: { _obj: 'layer', layerMaskAsGlobalMask: true }, _options: { dialogOptions: 'dontDisplay' } });
}

async function selectionBounds(doc) {
  try { var r = await bp({ _obj: 'get', _target: [{ _property: 'selection' }, { _ref: 'document', _id: doc.id }] }); var s = r && r[0] && r[0].selection;
    if (s && s.left !== undefined) return { left: s.left._value !== undefined ? s.left._value : s.left, top: s.top._value !== undefined ? s.top._value : s.top, right: s.right._value !== undefined ? s.right._value : s.right, bottom: s.bottom._value !== undefined ? s.bottom._value : s.bottom }; } catch (e) { }
  return null;
}

async function runDoc(doc, log, onlySelected) {
  var pre = (onlySelected ? (doc.activeLayers || []) : walk(doc.layers, [])).filter(function (o) { return !isGroup(o) && /#preset\s+\w+/i.test(o.name); });
  for (var pi = 0; pi < pre.length; pi++) { try { await applyPreset(doc, pre[pi], pre[pi].name.match(/#preset\s+(\w+)/i)[1], log); } catch (e) { log.push(pre[pi].name + ' error: ' + e.message); } }
  if (pre.length && onlySelected && pre.length === (doc.activeLayers || []).length) return true;
  var all = walk(doc.layers, []), clean = findLayer(all, /^clean\b|^clean$/i) || findLayer(all, /clean/i), raw = findLayer(all, /^raw\b|^raw$/i) || findLayer(all, /raw/i);
  // layers not named Raw / Clean: the original is the lowest full-page picture layer, the cleaned page the next one up
  function fullPage(o) { if (isText(o) || isGroup(o)) return false; var ob = o.boundsNoEffects || o.bounds; return ob && ob.left <= 0 && ob.top <= 0 && ob.right >= doc.width && ob.bottom >= doc.height; }
  if (!raw || !clean) { var pages = []; for (var q = all.length - 1; q >= 0; q--) if (fullPage(all[q]) && (!clean || all[q].id !== clean.id) && (!raw || all[q].id !== raw.id)) pages.push(all[q]);
    if (!raw && pages.length) raw = pages.shift();
    if (!clean && pages.length) clean = pages.shift(); }
  if (!raw || !clean) { log.push('need layers named "Raw" and "Clean" in ' + doc.title); return false; }
  var targets = [];
  if (onlySelected) { var sel = (doc.activeLayers || []).filter(function (o) { return !/#preset\s+\w+/i.test(o.name); }); for (var i = 0; i < sel.length; i++) if (sel[i].id !== raw.id && sel[i].id !== clean.id && !isGroup(sel[i])) targets.push(sel[i]); }
  else { all.forEach(function (L) { if (isText(L) && L.visible) targets.push(L); });
    if (!targets.length) all.forEach(function (L) { if (isSO(L) && L.visible) targets.push(L); }); }
  targets = targets.filter(function (o) { return !/#preset\s+\w+/i.test(o.name); });
  if (!targets.length) { log.push('no text layer selected'); return false; }
  var selB = onlySelected ? await selectionBounds(doc) : null;
  for (var j = 0; j < targets.length; j++) {
    // v2.4.2: work on one layer at a time (with several layers selected Photoshop refuses some 'set' commands: "Set is not currently available")
    try { await bp({ _obj: 'select', _target: [{ _ref: 'layer', _id: targets[j].id }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } }); } catch (e) { }
    try { await matchOne(doc, targets[j], raw, clean, log, selB); } catch (e) { log.push(targets[j].name + ' error: ' + e.message); } }
  return true;
}

var NOTES = [], NOISE_K = 1.0, NOTES_ERR = '';   // NOISE_K: measured in Photoshop 2025 - Add Noise (Gaussian, mono) gives a spread of ~2.6 levels per 1% (measured)
async function writeNotes(doc) {
  if (!SETTINGS.notes || !NOTES.length) return;
  var txt = 'StyleMatch notes - how each original text was made (Photoshop steps). Hide or delete this layer any time.\r\r' + NOTES.join('\r\r');
  var L = null; try { walk(doc.layers, []).forEach(function (o) { if (o.name === 'StyleMatch notes') L = o; }); } catch (e) { }
  try {
    if (!L) {
      try { L = await doc.createTextLayer({ name: 'StyleMatch notes', contents: 'notes', fontSize: 14, position: { x: 20, y: 40 } }); } catch (e) { L = null; }
      if (!L) { await bp({ _obj: 'make', _target: [{ _ref: 'textLayer' }], using: { _obj: 'textLayer', textKey: 'notes', textClickPoint: { _obj: 'paint', horizontal: { _unit: 'percentUnit', _value: 2 }, vertical: { _unit: 'percentUnit', _value: 2 } } }, _options: { dialogOptions: 'dontDisplay' } });
        L = doc.activeLayers[0]; }
      L.name = 'StyleMatch notes'; try { await L.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE); } catch (e) { } }
    L.textItem.contents = txt; L.visible = false;
  } catch (e) { NOTES_ERR = e.message; }
}
async function writeLog(doc, log) {
  var L = null; try { walk(doc.layers, []).forEach(function (o) { if (o.name === '__SM_LOG__') L = o; }); } catch (e) { }
  if (L) { try { L.textItem.contents = log.join('\r'); } catch (e) { } }
}

var __log = [];
try {
  await core.executeAsModal(async function (ctx) {
    var doc = app.activeDocument; if (!doc) return;
    // v2.4.2: selection tools (Magic Wand, Marquee, Lasso...) and painting tools make Photoshop refuse 'set' / 'transform'
    // ("The command Set is not currently available"). Work with the Move tool and give the user's tool back at the end.
    // (A marquee you drew around the original text is kept - StyleMatch uses it.)
    var toolWas = null; try { toolWas = app.currentTool && app.currentTool.id ? String(app.currentTool.id) : null; } catch (e) { }
    try { if (toolWas !== 'moveTool') await bp({ _obj: 'select', _target: [{ _ref: 'moveTool' }] }); } catch (e) { }
    var testMode = /^FXT_/.test(doc.title || doc.name || '');
    var docs = testMode ? app.documents.filter(function (d) { return /^FXT_/.test(d.title || d.name || ''); }) : [doc];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i]; try { if (app.activeDocument.id !== d.id) app.activeDocument = d; } catch (e) { }
      var hid = await ctx.hostControl.suspendHistory({ documentID: d.id, name: 'StyleMatch' }), log = [];
      NOTES = []; NOTES_ERR = ''; var keepSel = []; try { keepSel = (d.activeLayers || []).map(function (o) { return o.id; }); } catch (e) { }
      try { await runDoc(d, log, !testMode); } catch (e) { log.push('ERROR ' + e.message); }
      await writeNotes(d); if (NOTES_ERR) log.push('notes layer: ' + NOTES_ERR); await writeLog(d, log); __log = __log.concat(log);
      // give back the layer selection
      if (keepSel.length) { try { await bp({ _obj: 'select', _target: keepSel.map(function (id) { return { _ref: 'layer', _id: id }; }).concat([{ _ref: 'document', _id: d.id }]), makeVisible: false, _options: { dialogOptions: 'dontDisplay' } }); } catch (e) { } }
      await ctx.hostControl.resumeHistory(hid);
    }
    try { if (toolWas && toolWas !== 'moveTool') await bp({ _obj: 'select', _target: [{ _ref: toolWas }] }); } catch (e) { }
  }, { commandName: 'StyleMatch' });
} catch (e) { __log.push('ERROR ' + e.message); }
if (SETTINGS.showSetupErrors && __log.some(function (l) { return /^need layers|^no text layer/.test(l); })) app.showAlert('StyleMatch: ' + __log.filter(function (l) { return /^need layers|^no text layer/.test(l); })[0]);
