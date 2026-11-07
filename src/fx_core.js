// ===================== StyleMatch core (pure JavaScript) =====================
// Reads the original text's look from RAW vs CLEAN pixels and turns it into Photoshop layer-style settings.
'use strict';
var FX = {};

function dt1(f, n, d, v, z) {
  var k = 0; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (var q = 1; q < n; q++) {
    var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; var dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
// distance (px) from every pixel with mask=1 to the nearest mask=0 pixel
FX.edt = function (mask, w, h) {
  var INF = 1e20, n = Math.max(w, h);
  var f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  var tmp = new Float64Array(w * h), out = new Float32Array(w * h), x, y;
  for (x = 0; x < w; x++) { for (y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0; dt1(f, h, d, v, z); for (y = 0; y < h; y++) tmp[y * w + x] = d[y]; }
  for (y = 0; y < h; y++) { var row = y * w; for (x = 0; x < w; x++) f[x] = tmp[row + x]; dt1(f, w, d, v, z); for (x = 0; x < w; x++) out[row + x] = Math.sqrt(d[x]); }
  return out;
};
// typical letter-stroke width (px) of a mask; small gaps (brush streaks, halftone dots) are closed first
FX.thick = function (mask, w, h) {
  var n = w * h, i, inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
  var dO = FX.edt(inv, w, h), D2 = new Uint8Array(n); for (i = 0; i < n; i++) D2[i] = dO[i] <= 2 ? 1 : 0;   // dilate 2
  var dB = FX.edt(D2, w, h), Cm = new Uint8Array(n);
  for (i = 0; i < n; i++) Cm[i] = (mask[i] || dB[i] > 2) ? 1 : 0;   // erode 2 = closed mask (never thinner than the mask itself)
  var d = FX.edt(Cm, w, h), th = [];
  for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var q = y * w + x, v = d[q]; if (v < 1) continue; if (v >= d[q - 1] && v >= d[q + 1] && v >= d[q - w] && v >= d[q + w]) th.push(v); }
  th.sort(function (a, b) { return a - b; }); return th.length ? 2 * th[th.length >> 1] : 0;
};
function median(arr) { if (!arr.length) return 0; var a = arr.slice().sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }
var _h256 = new Int32Array(256);
function med8(arr) { var n = arr.length; if (!n) return 0; if (n < 64) return median(arr); _h256.fill(0); for (var i = 0; i < n; i++) _h256[arr[i]]++; var half = n >> 1, c = 0; for (var v = 0; v < 256; v++) { c += _h256[v]; if (c > half) return v; } return 255; }
function cdist(a, b) { var r = a[0] - b[0], g = a[1] - b[1], bl = a[2] - b[2]; return Math.sqrt(r * r + g * g + bl * bl); }
FX.lum = function (c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };

// k-means on colours of the given pixel list (few iterations, deterministic init)
function kmeans(R, idx, k, iters) {
  var n = idx.length, cents = [], i, j, c;
  // init: spread over luminance order
  var order = idx.slice().sort(function (a, b) { return (R[3 * a] + R[3 * a + 1] + R[3 * a + 2]) - (R[3 * b] + R[3 * b + 1] + R[3 * b + 2]); });
  for (c = 0; c < k; c++) { var p = order[Math.min(n - 1, Math.floor((c + 0.5) * n / k))]; cents.push([R[3 * p], R[3 * p + 1], R[3 * p + 2]]); }
  var lab = new Int32Array(n);
  for (var it = 0; it < (iters || 8); it++) {
    var sums = [], cnt = new Int32Array(k); for (c = 0; c < k; c++) sums.push([0, 0, 0]);
    for (i = 0; i < n; i++) {
      var q = idx[i], best = 0, bd = 1e9;
      for (c = 0; c < k; c++) { var dr = R[3 * q] - cents[c][0], dg = R[3 * q + 1] - cents[c][1], db = R[3 * q + 2] - cents[c][2], dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = c; } }
      lab[i] = best; cnt[best]++; sums[best][0] += R[3 * q]; sums[best][1] += R[3 * q + 1]; sums[best][2] += R[3 * q + 2];
    }
    for (c = 0; c < k; c++) if (cnt[c]) cents[c] = [sums[c][0] / cnt[c], sums[c][1] / cnt[c], sums[c][2] / cnt[c]];
  }
  return { cents: cents, lab: lab };
}

// glow falloff (distance from the glyph edge, px) - shape of Photoshop's "Softer" outer glow
FX.glowF = function (d, size, spread) {
  // measured from Photoshop renders (Outer Glow, technique Softer): plateau of size*spread%, then a squared fall-off
  var e = d - 0.5, p = size * spread / 100; if (e <= p) return 1;
  var t = (e - p) / Math.max(0.5, size - p); if (t >= 1) return 0;
  var u = 1 - t; return u * u;
};

// line the CLEAN layer up with the RAW one and match its colours, so only the text differs.
// Cleans are often placed by hand (moved several px, scaled ~1-2%): find a global shift, then local shifts on tiles,
// fit a smooth (affine) map through them and resample the clean with it.
// where does the clean sit relative to the original? (global shift + smooth affine map, found on a wide area)
FX.alignModel = function (R, C, w, h) {
  var n = w * h, i, x, y, Lr = new Float32Array(n), Lc = new Float32Array(n);
  for (i = 0; i < n; i++) { Lr[i] = 0.299 * R[3 * i] + 0.587 * R[3 * i + 1] + 0.114 * R[3 * i + 2]; Lc[i] = 0.299 * C[3 * i] + 0.587 * C[3 * i + 1] + 0.114 * C[3 * i + 2]; }
  // half-size copies for a wide, fast first search
  var w2 = w >> 1, h2 = h >> 1, Lr2 = new Float32Array(w2 * h2), Lc2 = new Float32Array(w2 * h2);
  for (y = 0; y < h2; y++) for (x = 0; x < w2; x++) { var q0 = 2 * y * w + 2 * x; Lr2[y * w2 + x] = (Lr[q0] + Lr[q0 + 1] + Lr[q0 + w] + Lr[q0 + w + 1]) / 4; Lc2[y * w2 + x] = (Lc[q0] + Lc[q0 + 1] + Lc[q0 + w] + Lc[q0 + w + 1]) / 4; }
  function cost(A1, B1, ww, hh, x0, y0, x1, y1, dx, dy, st) {   // mean capped |difference| with the clean moved by (dx,dy)
    var e = 0, m = 0; for (var yy = y0; yy < y1; yy += st) { var sy = yy + dy; if (sy < 0 || sy >= hh) continue;
      for (var xx = x0; xx < x1; xx += st) { var sx = xx + dx; if (sx < 0 || sx >= ww) continue; var d = A1[yy * ww + xx] - B1[sy * ww + sx]; d = d < 0 ? -d : d; e += d > 30 ? 30 : d; m++; } }
    return m > 20 ? e / m : 1e9; }
  // coarse (half size, +-range) then fine (full size, +-1); margin = how clearly the best beats its neighbours
  function bestShift(x0, y0, x1, y1, cx, cy, range, stF) {
    var b = null, X0 = x0 >> 1, Y0 = y0 >> 1, X1 = x1 >> 1, Y1 = y1 >> 1, st2 = Math.max(1, Math.floor(Math.sqrt((X1 - X0) * (Y1 - Y0) / 6000))), dx, dy, hx = Math.round(cx / 2), hy = Math.round(cy / 2);
    for (dy = hy - range; dy <= hy + range; dy++) for (dx = hx - range; dx <= hx + range; dx++) { var e = cost(Lr2, Lc2, w2, h2, X0, Y0, X1, Y1, dx, dy, st2) + 0.02 * (Math.abs(dx) + Math.abs(dy)); if (!b || e < b.e) b = { e: e, dx: dx, dy: dy }; }
    var f = null, all = [];
    for (dy = 2 * b.dy - 2; dy <= 2 * b.dy + 2; dy++) for (dx = 2 * b.dx - 2; dx <= 2 * b.dx + 2; dx++) { var e2 = cost(Lr, Lc, w, h, x0, y0, x1, y1, dx, dy, stF); all.push({ e: e2, dx: dx, dy: dy }); if (!f || e2 < f.e) f = { e: e2, dx: dx, dy: dy }; }
    var sec = 1e18; all.forEach(function (o) { if ((o.dx !== f.dx || o.dy !== f.dy) && Math.abs(o.dx - f.dx) + Math.abs(o.dy - f.dy) >= 2 && o.e < sec) sec = o.e; });
    var ex0 = cost(Lr, Lc, w, h, x0, y0, x1, y1, f.dx - 1, f.dy, stF), ex1 = cost(Lr, Lc, w, h, x0, y0, x1, y1, f.dx + 1, f.dy, stF), ey0 = cost(Lr, Lc, w, h, x0, y0, x1, y1, f.dx, f.dy - 1, stF), ey1 = cost(Lr, Lc, w, h, x0, y0, x1, y1, f.dx, f.dy + 1, stF);
    var sx = (ex0 + ex1 - 2 * f.e) > 1e-6 ? 0.5 * (ex0 - ex1) / (ex0 + ex1 - 2 * f.e) : 0, sy = (ey0 + ey1 - 2 * f.e) > 1e-6 ? 0.5 * (ey0 - ey1) / (ey0 + ey1 - 2 * f.e) : 0;
    return { e: f.e, dx: f.dx, dy: f.dy, fx: f.dx + Math.max(-0.5, Math.min(0.5, sx)), fy: f.dy + Math.max(-0.5, Math.min(0.5, sy)), margin: sec - f.e, curv: Math.min(ex0 + ex1 - 2 * f.e, ey0 + ey1 - 2 * f.e) };
  }
  var g = bestShift(8, 8, w - 8, h - 8, 0, 0, 12, Math.max(1, Math.floor(Math.sqrt(n / 15000))));   // +-24 px
  // local shifts on overlapping textured tiles (each may differ from the global one by up to +-12 px), then a robust affine fit
  var T = Math.max(80, Math.min(260, Math.round(Math.min(w, h) / 3))), pts = [];
  for (var ty = 0; ty + T <= h || ty === 0; ty += T >> 1) { for (var tx = 0; tx + T <= w || tx === 0; tx += T >> 1) {
      var x0 = tx, y0 = ty, x1 = Math.min(w, tx + T), y1 = Math.min(h, ty + T), tex = 0, tn = 0;
      for (y = y0 + 1; y < y1; y += 2) for (x = x0 + 1; x < x1; x += 2) { var q = y * w + x; tex += Math.abs(Lc[q] - Lc[q - 1]) + Math.abs(Lc[q] - Lc[q - w]); tn++; }
      if (tn && tex / tn >= 1.2) { var bt = bestShift(x0, y0, x1, y1, g.dx, g.dy, 6, 2);
        if (bt.margin > 0.3 && bt.curv > 0.15) pts.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, dx: bt.fx, dy: bt.fy, wt: 1 / (1 + bt.e) }); }
      if (tx + T >= w) break; }
    if (ty + T >= h) break; }
  var A = null;   // dx = a0 + a1 u + a2 v ; dy = b0 + b1 u + b2 v   (u,v = position from the centre, in 100 px)
  if (pts.length >= 4) {
    var cx = w / 2, cy = h / 2;
    for (var it = 0; it < 5; it++) {
      var M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vx = [0, 0, 0], vy = [0, 0, 0];
      pts.forEach(function (p) { var f = [1, (p.x - cx) / 100, (p.y - cy) / 100], ww = p.wt * (p.rw === undefined ? 1 : p.rw);
        for (var r = 0; r < 3; r++) { for (var c = 0; c < 3; c++) M[r][c] += ww * f[r] * f[c]; vx[r] += ww * f[r] * p.dx; vy[r] += ww * f[r] * p.dy; } });
      var sx3 = solve3(M, vx), sy3 = solve3(M, vy); if (!sx3 || !sy3) { A = null; break; }
      A = { ax: sx3, ay: sy3, cx: cx, cy: cy };
      pts.forEach(function (p) { var f1 = (p.x - cx) / 100, f2 = (p.y - cy) / 100, rx = p.dx - (sx3[0] + sx3[1] * f1 + sx3[2] * f2), ry = p.dy - (sy3[0] + sy3[1] * f1 + sy3[2] * f2); p.rw = 1 / (1 + rx * rx + ry * ry); });
    }
    if (A && (Math.abs(A.ax[1]) > 4 || Math.abs(A.ax[2]) > 4 || Math.abs(A.ay[1]) > 4 || Math.abs(A.ay[2]) > 4)) A = null;   // more than 4% stretch: not trusted
  } else if (pts.length >= 1) {   // a few good tiles: their median shift beats an ambiguous global one (stripes, speed lines)
    var mx2 = median(pts.map(function (p) { return p.dx; })), my2 = median(pts.map(function (p) { return p.dy; }));
    A = { ax: [mx2, 0, 0], ay: [my2, 0, 0], cx: w / 2, cy: h / 2 };
  }
  return { dx: g.dx, dy: g.dy, A: A, tiles: pts.length, w: w, h: h };
};
FX.align = function (R, C, w, h, big) {
  var n = w * h, i, x, y;
  // model from a wider area when given (big = {R, C, w, h, ox, oy}: region placed at ox,oy inside it)
  var src = big || { R: R, C: C, w: w, h: h, ox: 0, oy: 0 }, md = src.model || FX.alignModel(src.R, src.C, src.w, src.h), A = md.A, BC = src.C, bw = src.w, bh = src.h;
  var Cs = new Uint8Array(3 * n);
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var X = x + src.ox, Y = y + src.oy, ddx = md.dx, ddy = md.dy;
    if (A) { var u = (X - A.cx) / 100, v = (Y - A.cy) / 100; ddx = A.ax[0] + A.ax[1] * u + A.ax[2] * v; ddy = A.ay[0] + A.ay[1] * u + A.ay[2] * v; }
    var fx2 = Math.min(bw - 1.001, Math.max(0, X + ddx)), fy2 = Math.min(bh - 1.001, Math.max(0, Y + ddy)), ix = Math.floor(fx2), iy = Math.floor(fy2), ax = fx2 - ix, ay = fy2 - iy;
    var p00 = 3 * (iy * bw + ix), p10 = p00 + 3, p01 = p00 + 3 * bw, p11 = p01 + 3, o = 3 * (y * w + x);
    for (var ch0 = 0; ch0 < 3; ch0++) Cs[o + ch0] = Math.round((BC[p00 + ch0] * (1 - ax) + BC[p10 + ch0] * ax) * (1 - ay) + (BC[p01 + ch0] * (1 - ax) + BC[p11 + ch0] * ax) * ay);
  }
  // a sharper clean (cleaned from a better copy) than the original: soften it to the original's sharpness
  var blurS = 0;
  (function () {
    function blurred(src, sg) { var r = Math.ceil(2 * sg), k = [], ks = 0, j, t; for (j = -r; j <= r; j++) { t = Math.exp(-j * j / (2 * sg * sg)); k.push(t); ks += t; } k = k.map(function (v) { return v / ks; });
      var tmp = new Float32Array(3 * n), out = new Uint8Array(3 * n), x1, y1, c1, acc;
      for (y1 = 0; y1 < h; y1++) for (x1 = 0; x1 < w; x1++) for (c1 = 0; c1 < 3; c1++) { acc = 0; for (j = -r; j <= r; j++) { var xx = Math.min(w - 1, Math.max(0, x1 + j)); acc += k[j + r] * src[3 * (y1 * w + xx) + c1]; } tmp[3 * (y1 * w + x1) + c1] = acc; }
      for (y1 = 0; y1 < h; y1++) for (x1 = 0; x1 < w; x1++) for (c1 = 0; c1 < 3; c1++) { acc = 0; for (j = -r; j <= r; j++) { var yy = Math.min(h - 1, Math.max(0, y1 + j)); acc += k[j + r] * tmp[3 * (yy * w + x1) + c1]; } out[3 * (y1 * w + x1) + c1] = Math.round(acc); }
      return out; }
    function err(src) { var e = 0, m = 0, st = Math.max(1, Math.floor(Math.sqrt(n / 20000))); for (var q = 0; q < n; q += st) { var d = Math.abs(R[3 * q] - src[3 * q]) + Math.abs(R[3 * q + 1] - src[3 * q + 1]) + Math.abs(R[3 * q + 2] - src[3 * q + 2]); e += d > 90 ? 90 : d; m++; } return e / m; }
    var best = err(Cs), bc = Cs;
    [0.8, 1.5, 2.5].forEach(function (sg) { var b2 = blurred(Cs, sg), e2 = err(b2); if (e2 < 0.9 * best) { best = e2; bc = b2; blurS = sg; } });
    Cs = bc;
  })();
  // per-channel gain/offset from pixels that already agree (robust: two passes)
  var step = Math.max(1, Math.floor(Math.sqrt(n / 40000))), gain = [1, 1, 1], off = [0, 0, 0];
  for (var pass = 0; pass < 2; pass++) for (var ch = 0; ch < 3; ch++) {
    var sx2 = 0, sy2 = 0, sxx = 0, sxy = 0, m = 0;
    for (i = 0; i < n; i += step) { var c = Cs[3 * i + ch], r = R[3 * i + ch], pr = gain[ch] * c + off[ch]; if (Math.abs(pr - r) > (pass ? 18 : 40)) continue; sx2 += c; sy2 += r; sxx += c * c; sxy += c * r; m++; }
    if (m > 50) { var den = m * sxx - sx2 * sx2; if (Math.abs(den) > 1e-6) { var gg = (m * sxy - sx2 * sy2) / den; if (gg > 0.6 && gg < 1.6) { gain[ch] = gg; off[ch] = (sy2 - gg * sx2) / m; } } }
  }
  var Cn = new Uint8Array(3 * n);
  for (i = 0; i < n; i++) for (ch = 0; ch < 3; ch++) { var vv = gain[ch] * Cs[3 * i + ch] + off[ch]; Cn[3 * i + ch] = vv < 0 ? 0 : vv > 255 ? 255 : Math.round(vv); }
  return { C: Cn, dx: md.dx, dy: md.dy, affine: A ? [A.ax.map(function (t) { return +t.toFixed(2); }), A.ay.map(function (t) { return +t.toFixed(2); })] : null, tiles: md.tiles, blur: blurS, gain: gain, off: off };
};
function solve3(M, v) {
  var a = M.map(function (r, i) { return r.concat([v[i]]); }), i, j, k;
  for (i = 0; i < 3; i++) { var p = i; for (j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j; if (Math.abs(a[p][i]) < 1e-9) return null; var t = a[i]; a[i] = a[p]; a[p] = t;
    for (j = i + 1; j < 3; j++) { var f = a[j][i] / a[i][i]; for (k = i; k < 4; k++) a[j][k] -= f * a[i][k]; } }
  var x = [0, 0, 0]; for (i = 2; i >= 0; i--) { var s0 = a[i][3]; for (j = i + 1; j < 3; j++) s0 -= a[i][j] * x[j]; x[i] = s0 / a[i][i]; } return x;
}

// ---------- step 1: what changed between RAW and CLEAN (the original text with all its effects) ----------
FX.prepare = function (R, C0, w, h, opt) {
  opt = opt || {};
  var n = w * h, i, k, x, y;
  var al = opt.aligned ? { C: C0, dx: 0, dy: 0, affine: null, tiles: 0, blur: 0, gain: [1, 1, 1], off: [0, 0, 0] } : FX.align(R, C0, w, h, opt.big), C = al.C;
  var D = new Uint8Array(n);
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var p = 3 * (y * w + x), best = 765;
    for (var yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (var xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
      var q = 3 * (yy * w + xx), d0 = Math.abs(R[p] - C[q]), d1 = Math.abs(R[p + 1] - C[q + 1]), d2 = Math.abs(R[p + 2] - C[q + 2]);
      var dm = d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2); if (dm < best) best = dm;
    }
    D[y * w + x] = best;
  }
  var dl = []; for (i = 0; i < n; i += 7) dl.push(D[i]); var noise = median(dl);
  var tD = Math.max(opt.tD || 14, 3 * noise + 6), M = new Uint8Array(n), mi = [];
  if (opt.focus && !opt.region) { // keep only the changed areas that reach the new text's box (other texts nearby stay out)
    var M0 = new Uint8Array(n), f = opt.focus; for (i = 0; i < n; i++) M0[i] = D[i] > tD ? 0 : 1;
    var dm0 = FX.edt(M0, w, h), Md = new Uint8Array(n); for (i = 0; i < n; i++) Md[i] = dm0[i] <= 8 ? 1 : 0;
    var keep = new Uint8Array(n), kept = 0, bestC = null, bestIn = 0;
    FX.components(Md, w, h, 1).forEach(function (c) { var inB = 0, all = 0, j;   // a text mostly inside the box belongs to it; a long line that only grazes it doesn't
      for (j = 0; j < c.length; j++) { if (D[c[j]] <= tD) continue; all++; var xq = c[j] % w, yq = (c[j] - xq) / w; if (xq >= f.x0 && xq < f.x1 && yq >= f.y0 && yq < f.y1) inB++; }
      if (inB > bestIn) { bestIn = inB; bestC = c; }
      if (inB >= 20 && inB >= 0.3 * all) { for (j = 0; j < c.length; j++) keep[c[j]] = 1; kept += c.length; } });
    if (!kept && bestC) { for (var j2 = 0; j2 < bestC.length; j2++) keep[bestC[j2]] = 1; kept = bestC.length; }
    if (kept > 50) { var ik = new Uint8Array(n); for (i = 0; i < n; i++) ik[i] = keep[i] ? 0 : 1; var dk = FX.edt(ik, w, h), reg = new Uint8Array(n); for (i = 0; i < n; i++) reg[i] = dk[i] <= 30 ? 1 : 0; opt.region = reg; }
  }
  for (i = 0; i < n; i++) if (D[i] > tD && (!opt.region || opt.region[i])) M[i] = 1;
  var comps = FX.components(M, w, h, 1);
  comps.forEach(function (c) { if (c.length < 12) for (var j = 0; j < c.length; j++) M[c[j]] = 0; });
  for (i = 0; i < n; i++) if (M[i]) mi.push(i);
  if (mi.length < 30) return null;
  var depth = FX.edt(M, w, h);
  var K = 5, km = kmeans(R, mi, K, 10), cnt = [], dl2 = [];
  for (k = 0; k < K; k++) { cnt.push(0); dl2.push([]); }
  for (i = 0; i < mi.length; i++) { cnt[km.lab[i]]++; dl2[km.lab[i]].push(depth[mi[i]]); }
  // holes: unchanged pixels fully enclosed by the text (letters whose fill = background colour, e.g. white on white)
  var inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = M[i] ? 0 : 1;
  var dM = FX.edt(inv, w, h);
  function holesAt(r) { // close gaps up to 2r px, keep enclosed unchanged areas, then give the r px back
    var invc = new Uint8Array(n), H0 = new Uint8Array(n), hN = 0, out = [];
    for (i = 0; i < n; i++) invc[i] = dM[i] <= r ? 0 : 1;
    FX.components(invc, w, h, 1).forEach(function (c) { if (!c.touch && c.length >= 20) for (var j = 0; j < c.length; j++) { H0[c[j]] = 1; hN++; } });
    if (!hN) return out;
    var hi = new Uint8Array(n); for (i = 0; i < n; i++) hi[i] = H0[i] ? 0 : 1;
    var dH = FX.edt(hi, w, h); for (i = 0; i < n; i++) if (H0[i] || (!M[i] && dH[i] <= r + 0.5)) out.push(i);
    return out;
  }
  var holes = holesAt(2), holes5 = holesAt(5);
  // pixels used to score a candidate: the text plus a margin
  var near = new Uint8Array(n), dOutM = FX.edt(inv, w, h), ev = [];
  var fb = opt.focus, fm = fb ? Math.max(20, 0.15 * Math.max(fb.x1 - fb.x0, fb.y1 - fb.y0)) : 0;   // judge the look where the new text sits
  for (i = 0; i < n; i++) if (dOutM[i] <= 4 && (!opt.region || opt.region[i])) { if (fb) { var xf = i % w, yf = (i - xf) / w; if (xf < fb.x0 - fm || xf >= fb.x1 + fm || yf < fb.y0 - fm || yf >= fb.y1 + fm) continue; } near[i] = 1; }
  var cntNear = 0; for (i = 0; i < n; i++) if (near[i]) cntNear++;
  var stp = Math.max(1, Math.floor(cntNear / 25000));
  for (i = 0, k = 0; i < n; i++) if (near[i]) { if (k % stp === 0) ev.push(i); k++; }
  return { R: R, C: C, w: w, h: h, D: D, M: M, mi: mi, depth: depth, km: km, K: K, cnt: cnt, dl2: dl2, holes: holes, holes5: holes5, ev: ev, noise: noise, tD: tD, align: al, opt: opt };
};

// connected components (4-neighbour) of mask==val; each list gets .touch = touches the image border
FX.components = function (mask, w, h, val) {
  var n = w * h, lab = new Int32Array(n).fill(-1), out = [], st = [], i;
  for (i = 0; i < n; i++) if ((mask[i] ? 1 : 0) === val && lab[i] < 0) {
    var list = [i], touch = false; lab[i] = out.length; st.length = 0; st.push(i);
    while (st.length) {
      var c = st.pop(), x = c % w, y = (c - x) / w; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true;
      if (x > 0 && (mask[c - 1] ? 1 : 0) === val && lab[c - 1] < 0) { lab[c - 1] = out.length; st.push(c - 1); list.push(c - 1); }
      if (x < w - 1 && (mask[c + 1] ? 1 : 0) === val && lab[c + 1] < 0) { lab[c + 1] = out.length; st.push(c + 1); list.push(c + 1); }
      if (y > 0 && (mask[c - w] ? 1 : 0) === val && lab[c - w] < 0) { lab[c - w] = out.length; st.push(c - w); list.push(c - w); }
      if (y < h - 1 && (mask[c + w] ? 1 : 0) === val && lab[c + w] < 0) { lab[c + w] = out.length; st.push(c + w); list.push(c + w); }
    }
    list.touch = touch; out.push(list);
  }
  return out;
};


// rows of text: [[top, bottom], ...] from a 0/1 or 0..255 mask (Arabic dots and marks stay with their line)
FX.textLines = function (M, w, h, thr) {
  var rows = new Float32Array(h), x, y, mx = 0, t = thr || 0.5, top = 0, i0;
  for (i0 = 0; i0 < w * h; i0++) if (M[i0] > top) top = M[i0];
  var tv = top > 1.5 ? t * 255 : t;   // 0/1 masks, 0..1 alpha and 0..255 alpha
  for (y = 0; y < h; y++) { var s = 0; for (x = 0; x < w; x++) if (M[y * w + x] > tv) s++; rows[y] = s; if (s > mx) mx = s; }
  if (!mx) return [];
  var runs = [], y0 = -1; for (y = 0; y <= h; y++) { var on = y < h && rows[y] > 0.04 * mx; if (on && y0 < 0) y0 = y; if (!on && y0 >= 0) { runs.push([y0, y - 1]); y0 = -1; } }
  if (!runs.length) return [];
  var hs = runs.map(function (r) { return r[1] - r[0] + 1; }).sort(function (a, b) { return b - a; }), big = hs[0];
  // marks and dots: small runs join the nearest line; small gaps are not line breaks
  var out = []; runs.forEach(function (r) { var hh = r[1] - r[0] + 1, last = out[out.length - 1];
    if (last && (r[0] - last[1] < 0.12 * big || hh < 0.3 * big)) { last[1] = Math.max(last[1], r[1]); return; }
    if (!last || hh >= 0.3 * big) out.push([r[0], r[1]]); else last[1] = r[1]; });
  // a small first run (marks above the first line) joins the line below it
  if (out.length > 1 && out[0][1] - out[0][0] + 1 < 0.3 * big) { out[1][0] = out[0][0]; out.shift(); }
  return out;
};
// where a row falls in the letter colour ramp (0 top .. 1 bottom): along the whole text, or inside its own line
FX.gradT = function (g, y) {
  if (g.perLine && g.lines && g.lines.length) { var L = g.lines[0], best = 1e9;
    for (var j = 0; j < g.lines.length; j++) { var l = g.lines[j], d = y < l.top ? l.top - y : y > l.bot ? y - l.bot : 0; if (d < best) { best = d; L = l; } }
    return Math.max(0, Math.min(1, (y - L.a) / Math.max(1, L.b - L.a))); }
  return Math.max(0, Math.min(1, (y - g.y0) / Math.max(1, g.y1 - g.y0)));
};

// ---------- step 2: given where the letters are, work out fill, outlines and glow ----------
FX.fitStyle = function (P, G, quick) {
  var R = P.R, C = P.C, w = P.w, h = P.h, n = w * h, i, k, ch, x, y, opt = P.opt;
  var dIn = FX.edt(G, w, h), inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = G[i] ? 0 : 1;
  var dOut = FX.edt(inv, w, h);
  // fill colour / gradient / opacity
  var fr = [], fg = [], fb = [], fy = [], sC = 0, sC2 = 0, nf = 0;
  for (var pass = 0; pass < 2 && nf < 10; pass++) for (i = 0; i < n; i++) if (G[i] && (pass || dIn[i] >= 1.5)) { fr.push(R[3 * i]); fg.push(R[3 * i + 1]); fb.push(R[3 * i + 2]); fy.push(Math.floor(i / w)); var cl0 = FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]); sC += cl0; sC2 += cl0 * cl0; nf++; }
  if (!nf) return null;
  var fill = [med8(fr), med8(fg), med8(fb)];
  (function () { // thin letters: take the colour along the letter centre lines
    var rid = []; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) { var xr = i % w; if (xr > 0 && xr < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) rid.push(i); }
    if (rid.length < 30) return; var dm = median(rid.map(function (q) { return dIn[q]; })); if (dm > 4) return;
    rid.sort(function (p1, p2) { return (Math.abs(R[3 * p2] - C[3 * p2]) + Math.abs(R[3 * p2 + 1] - C[3 * p2 + 1]) + Math.abs(R[3 * p2 + 2] - C[3 * p2 + 2])) - (Math.abs(R[3 * p1] - C[3 * p1]) + Math.abs(R[3 * p1 + 1] - C[3 * p1 + 1]) + Math.abs(R[3 * p1 + 2] - C[3 * p1 + 2])); });
    rid = rid.slice(0, Math.max(30, Math.floor(rid.length * 0.3)));   // edges of thin letters are mixed with what's around them
    var c3 = [[], [], []]; rid.forEach(function (q) { c3[0].push(R[3 * q]); c3[1].push(R[3 * q + 1]); c3[2].push(R[3 * q + 2]); });
    fill = [med8(c3[0]), med8(c3[1]), med8(c3[2])]; G.__core = true;
  })();
  (function () { // refine: the half of letter pixels that stand out most from the background
    if (G.__core) return;
    var arr = [], j; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) arr.push([Math.abs(R[3 * i] - C[3 * i]) + Math.abs(R[3 * i + 1] - C[3 * i + 1]) + Math.abs(R[3 * i + 2] - C[3 * i + 2]), i]);
    if (arr.length < 20) return; arr.sort(function (a, b) { return b[0] - a[0]; }); var top2 = arr.slice(0, Math.max(10, Math.floor(arr.length / 2))), r3 = [[], [], []];
    for (j = 0; j < top2.length; j++) { var q6 = top2[j][1]; r3[0].push(R[3 * q6]); r3[1].push(R[3 * q6 + 1]); r3[2].push(R[3 * q6 + 2]); }
    fill = [med8(r3[0]), med8(r3[1]), med8(r3[2])];
  })();
  var ys = fy.slice().sort(function (a, b) { return a - b; }), yq1 = ys[Math.floor(ys.length * 0.2)], yq3 = ys[Math.floor(ys.length * 0.8)];
  var yMin = ys[0], yMax = ys[ys.length - 1], yH = Math.max(1, yMax - yMin);
  // the colour of a band of rows, read where the letters are 'solid': centre lines of thin letters, else the half that stands out most
  var thinL = (function () { var rd = []; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) { var xr = i % w; if (xr > 0 && xr < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) rd.push(dIn[i]); } return rd.length >= 30 && median(rd) <= 4; })();
  function bandColour(sel) { var arr = [];
    for (i = 0; i < n; i++) { if (!G[i] || !sel(i)) continue; if (thinL) { var xr2 = i % w; if (!(dIn[i] >= 1 && xr2 > 0 && xr2 < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w])) continue; } else if (dIn[i] < 1) continue;
      arr.push([Math.abs(R[3 * i] - C[3 * i]) + Math.abs(R[3 * i + 1] - C[3 * i + 1]) + Math.abs(R[3 * i + 2] - C[3 * i + 2]), i]); }
    if (arr.length < 8) return null; arr.sort(function (a, b) { return b[0] - a[0]; }); arr = arr.slice(0, Math.max(6, Math.floor(arr.length * (thinL ? 0.5 : 0.5))));
    var c3 = [[], [], []]; arr.forEach(function (q) { c3[0].push(R[3 * q[1]]); c3[1].push(R[3 * q[1] + 1]); c3[2].push(R[3 * q[1] + 2]); }); return [med8(c3[0]), med8(c3[1]), med8(c3[2])]; }
  var gl = FX.textLines(G, w, h).map(function (r) { var rr = []; for (i = 0; i < fy.length; i++) if (fy[i] >= r[0] && fy[i] <= r[1]) rr.push(fy[i]); rr.sort(function (a, b) { return a - b; });
    return rr.length ? { top: r[0], bot: r[1], a: rr[Math.floor(rr.length * 0.2)], b: rr[Math.floor(rr.length * 0.8)] } : null; }).filter(function (z) { return z; });
  var perLine = gl.length >= 1, gB = { y0: yq1, y1: yq3 }, gP = { perLine: true, lines: gl };
  function tOf(g, y) { return FX.gradT(g, y); }
  // the ramp read inside each line (one-line originals: the ramp spans the line) and across the whole block; keep the one that fits
  function fitRamp(g) { var cT = bandColour(function (q) { return tOf(g, Math.floor(q / w)) <= 0.0001; }), cB = bandColour(function (q) { return tOf(g, Math.floor(q / w)) >= 0.9999; });
    if (!cT || !cB) return null; var e = 0, j; for (j = 0; j < fy.length; j += 3) { var t2 = tOf(g, fy[j]); e += Math.pow(fr[j] - (cT[0] + t2 * (cB[0] - cT[0])), 2) + Math.pow(fg[j] - (cT[1] + t2 * (cB[1] - cT[1])), 2) + Math.pow(fb[j] - (cT[2] + t2 * (cB[2] - cT[2])), 2); }
    return { top: cT, bottom: cB, err: e }; }
  var rB = fitRamp(gB), rP = gl.length >= 2 ? fitRamp(gP) : null, useP = gl.length === 1 || (rP && rB && rP.err < 0.85 * rB.err), rr2 = useP && gl.length >= 2 ? rP : rB;
  var cTop = rr2 ? rr2.top : fill, cBot = rr2 ? rr2.bottom : fill;
  var gradient = cdist(cTop, cBot) > 45 ? { top: cTop, bottom: cBot, y0: yq1, y1: yq3, locTop: Math.round(4096 * (1 - (yq1 - yMin) / yH)), locBot: Math.round(4096 * (1 - (yq3 - yMin) / yH)), perLine: !!useP, lines: gl } : null;
  if (gradient && gl.length) { var L0 = gl[0], lh0 = Math.max(1, L0.bot - L0.top); gradient.fTop = (L0.a - L0.top) / lh0; gradient.fBot = (L0.b - L0.top) / lh0; }
  if (gradient) { var eS = 0, eG = 0, sm = fill;
    // judged where the letters are solid (centre lines of thin letters, else 2+ px inside): soft edges would favour a darker flat colour
    for (i = 0; i < n; i++) { if (!G[i]) continue; if (thinL) { var xr3 = i % w; if (!(dIn[i] >= 1 && xr3 > 0 && xr3 < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w])) continue; } else if (dIn[i] < 2) continue;
      var tg = FX.gradT(gradient, Math.floor(i / w));
      for (ch = 0; ch < 3; ch++) { var gc3 = cTop[ch] + tg * (cBot[ch] - cTop[ch]), d1 = R[3 * i + ch] - sm[ch], d2 = R[3 * i + ch] - gc3; eS += d1 * d1; eG += d2 * d2; } }
    if (eG > 0.7 * eS) gradient = null; }
  // inner outline: a band of one colour just inside the letter edge, different from the letter face
  var inner = null;
  (function () {
    var rings = [], k7, maxIn = 0; for (k7 = 0; k7 <= 24; k7++) rings.push([[], [], []]);
    for (i = 0; i < n; i++) if (G[i]) { var di = Math.ceil(dIn[i]); if (di > maxIn) maxIn = di; if (di >= 1 && di <= 24) { rings[di][0].push(R[3 * i]); rings[di][1].push(R[3 * i + 1]); rings[di][2].push(R[3 * i + 2]); } }
    if (maxIn < 6) return;
    var med = function (k8) { return [med8(rings[k8][0]), med8(rings[k8][1]), med8(rings[k8][2])]; };
    var deepA = [[], [], []]; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= Math.max(4, maxIn * 0.5)) { deepA[0].push(R[3 * i]); deepA[1].push(R[3 * i + 1]); deepA[2].push(R[3 * i + 2]); }
    if (deepA[0].length < 20) return;
    var deep = [med8(deepA[0]), med8(deepA[1]), med8(deepA[2])], ref = med(2);
    if (cdist(ref, deep) < 35) return;
    var end = 2; for (k7 = 3; k7 < Math.min(24, maxIn); k7++) { if (!rings[k7][0].length || cdist(med(k7), ref) > 28) break; end = k7; }
    if (end > 0.6 * maxIn) return;
    var th0 = []; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) { var x0 = i % w; if (x0 > 0 && x0 < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) th0.push(dIn[i]); }
    var mt = median(th0); if (mt < 3 || end > 0.6 * mt) return;   // an inside outline must leave a visible face (thin letters can't have one)
    inner = { size: end, color: ref }; fill = deep; gradient = null;
  })();
  var fillOpacity = 1, varC = sC2 / nf - (sC / nf) * (sC / nf);
  if (varC > 80) {
    var sx = 0, sy = 0, sxx = 0, sxy = 0, m2 = 0;
    for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1.5) { var lc = FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]), lr = FX.lum([R[3 * i], R[3 * i + 1], R[3 * i + 2]]); sx += lc; sy += lr; sxx += lc * lc; sxy += lc * lr; m2++; }
    var slope = m2 > 10 ? (m2 * sxy - sx * sy) / Math.max(1e-6, m2 * sxx - sx * sx) : 0, syy = 0;
    for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1.5) { var lr2 = FX.lum([R[3 * i], R[3 * i + 1], R[3 * i + 2]]); syy += lr2 * lr2; }
    var corr = m2 > 10 ? (m2 * sxy - sx * sy) / Math.sqrt(Math.max(1e-6, (m2 * sxx - sx * sx) * (m2 * syy - sy * sy))) : 0;
    // fine detail (not just slow shading, which a redrawn clean or a gradient can fake) must show through
    var hp = (function () { var LR = new Float32Array(n), LC = new Float32Array(n), q2; for (q2 = 0; q2 < n; q2++) { LR[q2] = FX.lum([R[3 * q2], R[3 * q2 + 1], R[3 * q2 + 2]]); LC[q2] = FX.lum([C[3 * q2], C[3 * q2 + 1], C[3 * q2 + 2]]); }
      function box(L) { var o = new Float32Array(n), t = new Float32Array(n), rr = 3, xx, yy, acc; for (yy = 0; yy < h; yy++) { acc = 0; for (xx = -rr; xx <= rr; xx++) acc += L[yy * w + Math.min(w - 1, Math.max(0, xx))];
          for (xx = 0; xx < w; xx++) { t[yy * w + xx] = acc / (2 * rr + 1); acc += L[yy * w + Math.min(w - 1, xx + rr + 1)] - L[yy * w + Math.max(0, xx - rr)]; } }
        for (xx = 0; xx < w; xx++) { acc = 0; for (yy = -rr; yy <= rr; yy++) acc += t[Math.min(h - 1, Math.max(0, yy)) * w + xx];
          for (yy = 0; yy < h; yy++) { o[yy * w + xx] = acc / (2 * rr + 1); acc += t[Math.min(h - 1, yy + rr + 1) * w + xx] - t[Math.max(0, yy - rr) * w + xx]; } } return o; }
      var bR = box(LR), bC = box(LC), sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, mm = 0;
      for (q2 = 0; q2 < n; q2++) if (G[q2] && dIn[q2] >= 1.5) { var u1 = LR[q2] - bR[q2], v1 = LC[q2] - bC[q2]; sa += u1; sb += v1; saa += u1 * u1; sbb += v1 * v1; sab += u1 * v1; mm++; }
      if (mm < 20) return 0; var cv = (mm * sab - sa * sb), dv = Math.sqrt(Math.max(1e-9, (mm * saa - sa * sa) * (mm * sbb - sb * sb))); return { r: cv / dv, detail: Math.sqrt(Math.max(0, sbb / mm - (sb / mm) * (sb / mm))) }; })();
    var shows = hp && ((hp.detail > 3 && hp.r > 0.35) || (hp.detail <= 3 && corr > 0.85));
    fillOpacity = (corr > 0.5 && shows) ? Math.max(0.2, Math.min(1, 1 - slope)) : 1;
    if (fillOpacity < 0.95) { var mC = [0, 0, 0], mR = [0, 0, 0]; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1.5) for (ch = 0; ch < 3; ch++) { mC[ch] += C[3 * i + ch] / m2; mR[ch] += R[3 * i + ch] / m2; }
      var tFill = mR.map(function (v, c4) { return Math.max(0, Math.min(255, (v - (1 - fillOpacity) * mC[c4]) / fillOpacity)); });
      // compare inside the letters: see-through solid colour vs. opaque fill (a gradient can look like see-through)
      var eT = 0, eO = 0, y4, f4, t4;
      for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1.5) { y4 = Math.floor(i / w);
        f4 = gradient ? (t4 = FX.gradT(gradient, y4), [0, 1, 2].map(function (cc) { return gradient.top[cc] + t4 * (gradient.bottom[cc] - gradient.top[cc]); })) : fill;
        for (ch = 0; ch < 3; ch++) { var pt = C[3 * i + ch] + fillOpacity * (tFill[ch] - C[3 * i + ch]) - R[3 * i + ch], po = f4[ch] - R[3 * i + ch]; eT += pt * pt; eO += po * po; } }
      if (eT < 0.85 * eO) { fill = tFill; gradient = null; } else fillOpacity = 1; }
    else fillOpacity = 1;
  }
  // rings outside the letters
  var KMAX = opt.kmax || 50, ring = [];
  for (k = 0; k <= KMAX; k++) ring.push([]);
  for (i = 0; i < n; i++) { if (G[i]) continue; var dd = dOut[i]; if (dd <= 0 || dd > KMAX) continue; if (opt.region && !opt.region[i]) continue; ring[Math.ceil(dd)].push(i); }
  var stats = [];
  for (k = 1; k <= KMAX; k++) { var a = ring[k], r = [[], [], []], b = [[], [], []], dsum = 0; for (var j = 0; j < a.length; j++) { var q = a[j]; r[0].push(R[3 * q]); r[1].push(R[3 * q + 1]); r[2].push(R[3 * q + 2]); b[0].push(C[3 * q]); b[1].push(C[3 * q + 1]); b[2].push(C[3 * q + 2]); dsum += P.D[q]; }
    stats[k] = { n: a.length, r: [med8(r[0]), med8(r[1]), med8(r[2])], b: [med8(b[0]), med8(b[1]), med8(b[2])], d: a.length ? dsum / a.length : 0 }; }
  function closeShare(kk, ref) { var a2 = ring[kk], cl = 0; if (!a2 || !a2.length) return 0; for (var j2 = 0; j2 < a2.length; j2++) { var q4 = a2[j2]; if (cdist([R[3 * q4], R[3 * q4 + 1], R[3 * q4 + 2]], ref) < 40) cl++; } return cl / a2.length; }
  // solid outlines: rings painted with one colour, then that colour stops.
  // Each ring gets a coverage 0..1 = how far its pixels moved from the background toward the outline colour
  // (only pixels whose background differs from that colour count, so white outlines on light pages are measured too).
  var Dv = P.D, tDv = P.tD, thR = [];
  for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) { var xr2 = i % w; if (xr2 > 0 && xr2 < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) thR.push(dIn[i]); }
  function ringAlpha(kk, ref) {
    var a2 = ring[kk]; if (!a2 || !a2.length) return { a: 0, ok: false };
    var al = [], cl = 0;
    for (var j2 = 0; j2 < a2.length; j2++) { var q4 = a2[j2], c0 = C[3 * q4], c1 = C[3 * q4 + 1], c2 = C[3 * q4 + 2], v0 = ref[0] - c0, v1 = ref[1] - c1, v2 = ref[2] - c2, L2 = v0 * v0 + v1 * v1 + v2 * v2;
      if (cdist([R[3 * q4], R[3 * q4 + 1], R[3 * q4 + 2]], ref) < 45) cl++;
      if (L2 < 625) continue;
      var t = ((R[3 * q4] - c0) * v0 + (R[3 * q4 + 1] - c1) * v1 + (R[3 * q4 + 2] - c2) * v2) / L2; al.push(t < -0.5 ? -0.5 : t > 1.5 ? 1.5 : t); }
    if (al.length >= Math.max(12, 0.08 * a2.length)) return { a: median(al), ok: true };
    return { a: cl / a2.length, ok: false };   // background is already the outline colour here: no evidence either way
  }
  function changedMedian(k1, k2) { var r = [[], [], []]; for (var kq = k1; kq <= k2; kq++) { var a2 = ring[kq]; if (!a2) continue; for (var j2 = 0; j2 < a2.length; j2++) { var q4 = a2[j2]; if (Dv[q4] > tDv) { r[0].push(R[3 * q4]); r[1].push(R[3 * q4 + 1]); r[2].push(R[3 * q4 + 2]); } } }
    return r[0].length >= 15 ? [med8(r[0]), med8(r[1]), med8(r[2])] : null; }
  function findStrokes() {
    var out = [], kk = 1;
    for (var sIdx = 0; sIdx < 3 && kk < KMAX - 3; sIdx++) {
      var rk = Math.min(KMAX, kk + 1), base = sIdx ? out[sIdx - 1].color : fill, ref = null;
      // outline colour: of the next two rings, the one that differs most from what's inside it (the other is usually a soft edge)
      [changedMedian(rk, rk), changedMedian(rk + 1, rk + 1)].forEach(function (c6) { if (c6 && (!ref || cdist(c6, base) > cdist(ref, base))) ref = c6; });
      if (!ref) break;
      if (cdist(ref, base) <= 30) break;
      var sum = 0, end = kk - 1, start = kk;
      // soft edge rings (colours between the inside and the outline) belong to the outline's start
      while (start < kk + 2 && ringAlpha(start, ref).a < 0.35) {
        var rc = stats[start] ? stats[start].r : null; if (!rc) break;
        var vb = [ref[0] - base[0], ref[1] - base[1], ref[2] - base[2]], L2b = vb[0] * vb[0] + vb[1] * vb[1] + vb[2] * vb[2], tq = ((rc[0] - base[0]) * vb[0] + (rc[1] - base[1]) * vb[1] + (rc[2] - base[2]) * vb[2]) / Math.max(1, L2b);
        var px6 = [base[0] + tq * vb[0], base[1] + tq * vb[1], base[2] + tq * vb[2]];
        if (tq > 0.02 && tq < 0.98 && cdist(rc, px6) < 45) { start++; sum++; end = start - 1; } else break;
      }
      var r0 = ringAlpha(start, ref); if (r0.a < 0.35 || !r0.ok) break;   // an outline must show against what's behind it, right at the letters
      var blind = 0;
      for (k = start; k <= KMAX; k++) { var ra = ringAlpha(k, ref); if (!ra.ok) { if (++blind > 2) break; } else blind = 0;
        if (k > start && ra.a < 0.5) { if (ra.a > 0.15) sum += ra.a; break; } sum += Math.min(1, Math.max(0, ra.a)); end = k; }
      if (end < rk || end - kk + 1 > 30 || end >= KMAX - 2) break;
      if (end - start >= 2) { var aS = ringAlpha(start, ref).a, aE = ringAlpha(end, ref).a; if (aE > 0 && aS / aE > 1.8) break; }   // strength keeps falling across the band: a glow
      if (ringAlpha(end + 2, ref).a > 0.5) break;   // an outline stops; a fade that keeps going is a glow
      var size = Math.max(1, Math.round(kk - 1 + sum - 0.5));
      var thG = 2 * median(thR); if (thG > 0 && size > Math.max(6, 4 * thG)) break;
      out.push({ size: size, color: ref }); kk = size + 1;
    }
    return out;
  }
  function dAt(q, sx, sy) { if (!sx && !sy) return dOut[q]; var qx = q % w - sx, qy = (q - q % w) / w - sy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) return 1e3; return dOut[qy * w + qx]; }
  // X (optional): fit on prepared data instead of raw-minus-clean - X.D = the change still to explain, X.Cb = the colour the effect
  // blends with, X.W = how much of the effect shows (another effect on top lets only part of it through); all 0..1, 3 per pixel
  function fitGlow(sEnd, sx, sy, X) {
    sx = sx || 0; sy = sy || 0;
    // every ring pixel beyond the outlines, summarised per 1/4-px distance bin (the soft shape only depends on distance)
    var NB = (KMAX + 2) * 4, B = new Float64Array(NB * 18), k2, j4, ch2, q5, base = 0, npts = 0;
    for (k2 = sEnd + 2; k2 <= KMAX; k2++) { var a3 = ring[k2]; for (j4 = 0; j4 < a3.length; j4++) { q5 = a3[j4]; var dd3 = dAt(q5, sx, sy), bi = Math.min(NB - 1, Math.floor(dd3 * 4)) * 18; npts++;
      for (ch2 = 0; ch2 < 3; ch2++) { var o = bi + ch2 * 6, cv, dv, wv = 1;
          if (X) { cv = X.Cb[3 * q5 + ch2]; dv = X.D[3 * q5 + ch2]; wv = X.W[3 * q5 + ch2]; } else { cv = C[3 * q5 + ch2] / 255; dv = R[3 * q5 + ch2] / 255 - cv; }
          B[o] += wv * wv; B[o + 1] += wv * wv * cv; B[o + 2] += wv * wv * cv * cv; B[o + 3] += wv * dv; B[o + 4] += dv * dv; B[o + 5] += wv * cv * dv; base += dv * dv; } } }
    // a glow must change pixels a few px away from the letters (not just their soft edge)
    var meanD = 0; for (k2 = sEnd + 3; k2 <= Math.min(KMAX, sEnd + 5); k2++) meanD += (stats[k2] ? stats[k2].d : 0) / 3;
    if (npts < 50 || (!X && meanD <= Math.max(8, 2 * P.noise + 4))) return null;
    var bins = []; for (var bb = 0; bb < NB; bb++) if (B[bb * 18]) bins.push(bb);
    var glow = null, bestErr = 1e18, sizes = [], spreads = quick ? [0, 30] : [0, 15, 30, 45, 60];
    if (quick) sizes = [3, 6, 10, 16, 24, 34, 46]; else for (var sz0 = 3; sz0 <= KMAX; sz0 += (sz0 < 12 ? 1 : 2)) sizes.push(sz0);
    var fb = new Float64Array(NB);
    for (var si0 = 0; si0 < sizes.length; si0++) for (var sp0 = 0; sp0 < spreads.length; sp0++) {
      var size = sizes[si0], spread = spreads[sp0], j, o2, f, ff;
      for (j = 0; j < bins.length; j++) fb[bins[j]] = FX.glowF((bins[j] + 0.5) / 4, size, spread);
      for (var mode = 0; mode < 2; mode++) {
        var op, col = [0, 0, 0], err = 0;
        if (mode === 0) { // normal: R-C = f*op*(col - C)  ->  linear in (op*col, op)
          var A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bv = [0, 0, 0, 0];
          for (j = 0; j < bins.length; j++) { f = fb[bins[j]]; if (!f) continue; ff = f * f; for (ch2 = 0; ch2 < 3; ch2++) { o2 = bins[j] * 18 + ch2 * 6;
            A[ch2][ch2] += ff * B[o2]; A[ch2][3] -= ff * B[o2 + 1]; A[3][ch2] -= ff * B[o2 + 1]; A[3][3] += ff * B[o2 + 2]; bv[ch2] += f * B[o2 + 3]; bv[3] -= f * B[o2 + 5]; } }
          // plain background under the glow: colour and opacity can't be told apart - keep the shift, use ~85% opacity
          var wN = 0, wC = [0, 0, 0], wCC = [0, 0, 0], gS = [0, 0, 0], fS = 0;
          for (j = 0; j < bins.length; j++) { f = fb[bins[j]]; if (!f) continue; ff = f * f; for (ch2 = 0; ch2 < 3; ch2++) { o2 = bins[j] * 18 + ch2 * 6; if (!ch2) { wN += ff * B[o2]; fS += ff * B[o2]; } wC[ch2] += ff * B[o2 + 1]; wCC[ch2] += ff * B[o2 + 2]; gS[ch2] += f * B[o2 + 3]; } }
          var flat = wN > 0 && [0, 1, 2].every(function (c5) { var m5 = wC[c5] / wN; return wCC[c5] / wN - m5 * m5 < 0.0016; });
          if (flat) {
            var c0 = [wC[0] / wN, wC[1] / wN, wC[2] / wN], g4 = [gS[0] / fS, gS[1] / fS, gS[2] / fS], opMin = 0.05;
            for (ch2 = 0; ch2 < 3; ch2++) opMin = Math.max(opMin, g4[ch2] < 0 ? -g4[ch2] / Math.max(0.02, c0[ch2]) : g4[ch2] / Math.max(0.02, 1 - c0[ch2]));
            op = Math.min(1, Math.max(0.85, opMin)); for (ch2 = 0; ch2 < 3; ch2++) col[ch2] = Math.max(0, Math.min(1, c0[ch2] + g4[ch2] / op));
          } else {
            var sol = solve4(A, bv); if (!sol) continue;
            op = Math.max(0.05, Math.min(1, sol[3])); for (ch2 = 0; ch2 < 3; ch2++) col[ch2] = Math.max(0, Math.min(1, sol[ch2] / op));
          }
          // error: sum (dv - f*op*(col - c))^2
          for (j = 0; j < bins.length; j++) { f = fb[bins[j]] * op; for (ch2 = 0; ch2 < 3; ch2++) { o2 = bins[j] * 18 + ch2 * 6; var nn = B[o2], Sc = B[o2 + 1], Scc = B[o2 + 2], Sd = B[o2 + 3], Sdd = B[o2 + 4], Scd = B[o2 + 5], cc = col[ch2];
            err += Sdd - 2 * f * (cc * Sd - Scd) + f * f * (cc * cc * nn - 2 * cc * Sc + Scc); } }
        } else { // screen: R-C = (1-C)*f*op*col
          var g3 = [0, 0, 0], S3 = [0, 0, 0], T3 = [0, 0, 0];
          for (j = 0; j < bins.length; j++) { f = fb[bins[j]]; if (!f) continue; for (ch2 = 0; ch2 < 3; ch2++) { o2 = bins[j] * 18 + ch2 * 6; S3[ch2] += f * f * (B[o2] - 2 * B[o2 + 1] + B[o2 + 2]); T3[ch2] += f * (B[o2 + 3] - B[o2 + 5]); } }
          for (ch2 = 0; ch2 < 3; ch2++) g3[ch2] = T3[ch2] / (S3[ch2] || 1);
          var mx = Math.max(g3[0], g3[1], g3[2]); if (mx <= 0) continue;
          op = Math.max(0.05, Math.min(1, mx)); for (ch2 = 0; ch2 < 3; ch2++) col[ch2] = Math.max(0, Math.min(1, g3[ch2] / op));
          for (j = 0; j < bins.length; j++) { f = fb[bins[j]] * op; for (ch2 = 0; ch2 < 3; ch2++) { o2 = bins[j] * 18 + ch2 * 6; var gg = f * col[ch2], S1c = B[o2] - B[o2 + 1], Sdd2 = B[o2 + 4], Sd1c = B[o2 + 3] - B[o2 + 5], S1c2 = B[o2] - 2 * B[o2 + 1] + B[o2 + 2];
            err += Sdd2 - 2 * gg * Sd1c + gg * gg * S1c2; } }
        }
        if (err < bestErr) { bestErr = err; glow = { mode: mode === 0 ? 'normal' : 'screen', size: size, spread: spread, opacity: op, color: col.map(function (v) { return Math.round(v * 255); }), dx: sx, dy: sy }; }
      }
    }
    if (!glow) return null;
    // judge the glow where it reaches (far-away changes - other art, other text - say nothing about it)
    var eL = 0, bL = 0, reach = (glow.size + 2) * 4;
    for (var j9 = 0; j9 < bins.length; j9++) { if (bins[j9] > reach) continue; var f9 = FX.glowF((bins[j9] + 0.5) / 4, glow.size, glow.spread) * glow.opacity;
      for (ch2 = 0; ch2 < 3; ch2++) { var o9 = bins[j9] * 18 + ch2 * 6, nn9 = B[o9], Sc9 = B[o9 + 1], Scc9 = B[o9 + 2], Sd9 = B[o9 + 3], Sdd9 = B[o9 + 4], Scd9 = B[o9 + 5], cc9 = glow.color[ch2] / 255;
        bL += Sdd9;
        if (glow.mode === 'normal') eL += Sdd9 - 2 * f9 * (cc9 * Sd9 - Scd9) + f9 * f9 * (cc9 * cc9 * nn9 - 2 * cc9 * Sc9 + Scc9);
        else { var gg9 = f9 * cc9; eL += Sdd9 - 2 * gg9 * (Sd9 - Scd9) + gg9 * gg9 * (nn9 - 2 * Sc9 + Scc9); } } }
    if (eL > (X ? 0.92 : 0.75) * bL) return null;   // a second effect only has to explain part of what the first one left
    glow.err = eL / Math.max(1e-9, bL);
    return glow;
  }
  // where does the soft shape sit? try moved copies of the letters against the changed pixels outside them
  function shadowShifts(sEnd) {
    var E = []; for (i = 0; i < n; i++) if (!G[i] && dOut[i] > sEnd + 1 && dOut[i] <= KMAX && (!opt.region || opt.region[i])) E.push(i);
    if (E.length < 80) return [];
    var stp = Math.max(1, Math.floor(E.length / 5000)), res = [];
    for (var sy = -24; sy <= 24; sy += 3) for (var sx = -24; sx <= 24; sx += 3) { if (!sx && !sy) continue; var sc = 0;
      for (var j = 0; j < E.length; j += stp) { var q = E[j]; if (dAt(q, sx, sy) <= 1) sc += Dv[q] > tDv ? 1 : -1; }
      res.push({ sx: sx, sy: sy, sc: sc }); }
    res.sort(function (p1, p2) { return p2.sc - p1.sc; });
    return res.slice(0, 2).filter(function (r) { return r.sc > 0; });
  }
  var th = []; for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1) { x = i % w; if (x > 0 && x < w - 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) th.push(dIn[i]); }
  var common = { fill: fill, fillOpacity: fillOpacity, gradient: gradient, inner: inner, thick: 2 * median(th), G: G, dOut: dOut, dIn: dIn, stats: stats };
  var sk = findStrokes(), variants = [];
  function mk(strokesV) { var v = {}; for (var key in common) v[key] = common[key]; v.strokes = strokesV; var sEnd = strokesV.length ? strokesV[strokesV.length - 1].size : 0;
    v.glow = fitGlow(sEnd, 0, 0);
    if (!opt.noShadow && !quick) shadowShifts(sEnd).forEach(function (s0) { var g2 = fitGlow(sEnd, s0.sx, s0.sy); if (g2 && (!v.glow || g2.err < 0.85 * v.glow.err)) v.glow = g2; });
    v.err = FX.score(P, v);
    if (v.glow) { var g0 = v.glow; v.glow = null; var e0 = FX.score(P, v); if (v.err < 0.96 * e0) v.glow = g0; else v.err = e0; }   // a glow must clearly help
    v.cost = v.err * (1 + 0.03 * strokesV.length + (v.glow ? (v.glow.dx || v.glow.dy ? 0.08 : 0.06) : 0) + (strokesV.length < sk.length ? 0.02 : 0)); return v; }
  variants.push(mk(sk));
  if (sk.length) variants.push(mk([]));
  if (sk.length > 1) variants.push(mk([sk[0]]));
  var st = variants[0]; variants.forEach(function (v) { if (v.cost < st.cost) st = v; });
  if (!quick) (function () {
    function costOf(v) { return v.err * (1 + 0.03 * v.strokes.length + (v.glow ? (v.glow.dx || v.glow.dy ? 0.08 : 0.06) : 0) + (v.strokes.length < sk.length ? 0.02 : 0)); }
    function copy(v, strokesV, glow) { var o = {}; for (var key in v) o[key] = v[key]; o.strokes = strokesV; o.glow = glow; return o; }
    // a 'glow' that is solid with only a short soft edge is an outline: a Stroke keeps it crisp (the glow would look blurry).
    // Hand-drawn outlines change width along the letters, which a soft glow fits 'on average' - so look at the edge itself:
    // how fast the outline colour gives way to the background, pixel by pixel.
    var g0 = st.glow;
    function edgeSharp(ref, from, to) {
      var t = new Float32Array(n).fill(-9), j, x9, y9, gs = [];
      for (j = 0; j < n; j++) { if (G[j] || dOut[j] < from || dOut[j] > to + 2) continue; var v0 = ref[0] - C[3 * j], v1 = ref[1] - C[3 * j + 1], v2 = ref[2] - C[3 * j + 2], L2 = v0 * v0 + v1 * v1 + v2 * v2; if (L2 < 1600) continue;
        t[j] = ((R[3 * j] - C[3 * j]) * v0 + (R[3 * j + 1] - C[3 * j + 1]) * v1 + (R[3 * j + 2] - C[3 * j + 2]) * v2) / L2; }
      var cross = [];
      // distance from the letters as the raw shows them (pixels of the letter colour), not from the fitted mask, which can be a bit thin
      if (!dFill) { var nf = new Uint8Array(n); for (var j2 = 0; j2 < n; j2++) nf[j2] = cdist([R[3 * j2], R[3 * j2 + 1], R[3 * j2 + 2]], FX.fillAt(st, j2, w)) < 45 ? 0 : 1; dFill = FX.edt(nf, w, h); }
      for (y9 = 1; y9 < h - 1; y9++) for (x9 = 1; x9 < w - 1; x9++) { j = y9 * w + x9; var a1 = t[j - 1], a2 = t[j + 1], b1 = t[j - w], b2 = t[j + w];
        // where the outline ends: inside >= 0.5, a neighbour below 0.5 (a halo beyond it stays below 0.5)
        if (t[j] >= 0.5 && ((a1 > -5 && a1 < 0.5) || (a2 > -5 && a2 < 0.5) || (b1 > -5 && b1 < 0.5) || (b2 > -5 && b2 < 0.5))) cross.push(Math.min(dOut[j], dFill[j]));
        if (t[j] < 0.3 || t[j] > 0.7 || a1 < -5 || a2 < -5 || b1 < -5 || b2 < -5) continue;
        gs.push(Math.sqrt((a2 - a1) * (a2 - a1) + (b2 - b1) * (b2 - b1)) / 2); }
      edgeAt = cross.length >= 40 ? median(cross) : null;
      return gs.length >= 40 ? median(gs) : null; }
    var edgeAt = null, dFill = null;
    // outlines are drawn crisp and a 1 px miss reads as a soft edge: try the outer outline 1 px thinner / thicker
    if (st.strokes.length) { var last = st.strokes.length - 1;
      [-1, 1].forEach(function (dv) { var sz = st.strokes[last].size + dv; if (sz < 1 || (last && sz <= st.strokes[last - 1].size)) return;
        var ns = st.strokes.map(function (z) { return { size: z.size, color: z.color }; }); ns[last].size = sz; var v2 = copy(st, ns, st.glow); v2.err = FX.score(P, v2); v2.cost = costOf(v2); if (v2.err < st.err) st = v2; });
      // a sharp outline edge well inside the fitted width: the rest is a halo (art glow) - outline where the edge is, halo as a soft glow
      var so = st.strokes[last], prev = last ? st.strokes[last - 1].size : 0, sh = edgeSharp(so.color, prev + 1, so.size + 3);
      if (sh !== null && sh >= 0.3 && edgeAt !== null && edgeAt < so.size - 1.5) { var e0 = Math.round(edgeAt), bestH = null;
        [e0 - 1, e0, e0 + 1].forEach(function (sz) { if (sz <= prev) return; var ns2 = st.strokes.map(function (z) { return { size: z.size, color: z.color }; }); ns2[last].size = sz;
          var hg3 = st.glow && (st.glow.dx || st.glow.dy) ? st.glow : fitGlow(sz, 0, 0); if (hg3 && !(hg3.dx || hg3.dy) && hg3.spread > 30) hg3 = null;
          var v6 = copy(st, ns2, hg3 || null); v6.err = FX.score(P, v6); v6.cost = costOf(v6); if (!bestH || v6.err < bestH.err) bestH = v6; });
        if (bestH && bestH.err <= st.err) { bestH.edgeSharp = sh; st = bestH; } } }
    if (g0 && !g0.dx && !g0.dy && g0.spread >= 45 && g0.opacity >= 0.85 && g0.size * (1 - g0.spread / 100) <= 6) {
      var in0 = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, sz0 = Math.max(in0 + 1, Math.round(g0.size * g0.spread / 100 + 0.5 * g0.size * (1 - g0.spread / 100))), bestV = null;
      var crisp = edgeSharp(g0.color, in0 + 1, g0.size + 1);
      if (crisp !== null && crisp >= 0.3 && edgeAt !== null) sz0 = Math.max(in0 + 1, Math.round(edgeAt));   // sharp edge: the outline is as wide as where its edge sits
      [sz0 - 1, sz0, sz0 + 1].forEach(function (sz) { if (sz <= in0) return; var v3 = copy(st, st.strokes.concat([{ size: sz, color: g0.color }]), null); v3.err = FX.score(P, v3); v3.cost = costOf(v3); if (!bestV || v3.cost < bestV.cost) bestV = v3; });
      var core = Math.round(g0.size * g0.spread / 100);
      [core - 1, core].forEach(function (sz) { if (sz <= in0 || sz < 1) return; var hg2 = fitGlow(sz, 0, 0); if (!hg2 || hg2.spread > 30) return;   // a halo is soft; a solid band would be another outline
        var v5 = copy(st, st.strokes.concat([{ size: sz, color: g0.color }]), hg2); v5.err = FX.score(P, v5); v5.cost = costOf(v5); if (!bestV || v5.cost < bestV.cost) bestV = v5; });
      // crisp edges: the outline wins unless clearly worse; soft edges: only if it fits at least as well
      if (bestV && bestV.err <= (crisp !== null && crisp >= 0.3 ? 1.3 : g0.size * (1 - g0.spread / 100) <= 4.5 ? 1.08 : 1.0) * st.err) {
        bestV.crispFromGlow = true; bestV.edgeSharp = crisp;
        // a faint halo beyond the outline (art glow, lightning light) can stay as a real glow
        if (!bestV.glow) { var hg = fitGlow(bestV.strokes[bestV.strokes.length - 1].size, 0, 0);
          if (hg && hg.spread <= 30) { var v4 = copy(bestV, bestV.strokes, hg); v4.err = FX.score(P, v4); if (v4.err < 0.96 * bestV.err) { v4.cost = costOf(v4); bestV = v4; } } }
        st = bestV; }
    }
  })();
  if (!quick) (function () {
    function costOf(v) { return v.err * (1 + 0.03 * v.strokes.length + (v.glow ? (v.glow.dx || v.glow.dy ? 0.08 : 0.06) : 0) + (v.strokes.length < sk.length ? 0.02 : 0)); }
    function copy(v, strokesV, glow) { var o = {}; for (var key in v) o[key] = v[key]; o.strokes = strokesV; o.glow = glow; return o; }
    var g0 = st.glow; if (!g0 || g0.dx || g0.dy) return;
    var s0 = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, j, kk;
    function ringMed(k1, k2) { var c3 = [[], [], []]; for (j = 0; j < n; j++) if (!G[j] && dOut[j] > k1 && dOut[j] <= k2) { c3[0].push(R[3 * j]); c3[1].push(R[3 * j + 1]); c3[2].push(R[3 * j + 2]); } return c3[0].length > 30 ? [med8(c3[0]), med8(c3[1]), med8(c3[2])] : null; }
    // how far the glow really reaches (a one-colour fit stops early when the far part has another colour)
    function reach(sE) { var e = sE; for (var kr = sE + 1; kr <= Math.min(KMAX, sE + 60); kr++) { var dv = []; for (j = 0; j < n; j++) if (!G[j] && Math.ceil(dOut[j]) === kr) dv.push(Math.abs(R[3 * j] - C[3 * j]) + Math.abs(R[3 * j + 1] - C[3 * j + 1]) + Math.abs(R[3 * j + 2] - C[3 * j + 2])); if (dv.length < 20 || median(dv) < 12) break; e = kr; } return e; }
    // a glow (size S counted from the letters, like Photoshop) whose colour may change with distance: fit the inner and outer colours
    // and the opacity together by least squares over the glow pixels outside the outlines (normal and screen glows)
    function solveN(A, bv) { var m = bv.length, M = A.map(function (r, i2) { return r.concat([bv[i2]]); }), r2, c2, k2;
      for (c2 = 0; c2 < m; c2++) { var pv = c2; for (r2 = c2 + 1; r2 < m; r2++) if (Math.abs(M[r2][c2]) > Math.abs(M[pv][c2])) pv = r2; if (Math.abs(M[pv][c2]) < 1e-9) return null; var tmp = M[c2]; M[c2] = M[pv]; M[pv] = tmp;
        for (r2 = 0; r2 < m; r2++) { if (r2 === c2) continue; var fct = M[r2][c2] / M[c2][c2]; for (k2 = c2; k2 <= m; k2++) M[r2][k2] -= fct * M[c2][k2]; } }
      return M.map(function (r, i2) { return r[m] / r[i2]; }); }
    function gradGlow(strokesV, sE, mode, S) { var nu = mode === 'screen' ? 6 : 7, AtA = [], Atb = [], q, u, cnt = 0;
      for (q = 0; q < nu; q++) { AtA.push(new Array(nu).fill(0)); Atb.push(0); }
      for (j = 0; j < n; j += 1) { if (G[j] || dOut[j] <= sE) continue; var shp = FX.glowF(dOut[j], S, 0); if (shp < 0.03) continue; var t = 1 - shp;
        for (var c = 0; c < 3; c++) { var cv = C[3 * j + c] / 255, rv = R[3 * j + c] / 255, y, row = new Array(nu).fill(0);
          if (mode === 'screen') { if (cv > 0.97) continue; y = 1 - (1 - rv) / (1 - cv); } else { y = rv - cv; row[6] = -shp * cv; }
          row[c] = shp * (1 - t); row[3 + c] = shp * t;
          for (q = 0; q < nu; q++) { if (!row[q]) continue; Atb[q] += row[q] * y; for (u = 0; u < nu; u++) AtA[q][u] += row[q] * row[u]; } } cnt++; }
      if (cnt < 80) return null; for (q = 0; q < nu; q++) AtA[q][q] += 1e-6;
      var sol = solveN(AtA, Atb); if (!sol) return null;
      var al = mode === 'screen' ? Math.max(0.05, Math.max.apply(null, sol.slice(0, 6)), 1e-3) : Math.max(0.05, Math.min(1, sol[6]));
      if (mode === 'screen') al = Math.min(1, al);
      var inner = [0, 1, 2].map(function (c) { return Math.max(0, Math.min(255, Math.round(255 * sol[c] / al))); }), outer = [0, 1, 2].map(function (c) { return Math.max(0, Math.min(255, Math.round(255 * sol[3 + c] / al))); });
      var v = copy(st, strokesV, { mode: mode, size: S, spread: 0, opacity: al, color: inner, dx: 0, dy: 0 });
      if (cdist(inner, outer) > 40) v.glow.grad = { inner: inner, outer: outer };
      v.err = FX.score(P, v); v.cost = costOf(v) / (v.glow.grad ? 0.97 : 1); return v; }
    function gradTries(strokesV, sE, base) { var out = null, ext = reach(sE), sizes = {};
      [base.size, ext, Math.round(1.25 * ext), Math.round(1.5 * ext), Math.round(2 * ext)].forEach(function (S) { if (S > sE + 1) sizes[S] = 1; });
      Object.keys(sizes).forEach(function (S) { ['normal', 'screen'].forEach(function (md) { var v = gradGlow(strokesV, sE, md, +S); if (v && (!out || v.cost < out.cost)) out = v; }); });
      if (out) { var S0 = out.glow.size, md0 = out.glow.mode; [-2, -1, 1, 2].forEach(function (dS) { if (S0 + dS <= sE + 1) return; var v = gradGlow(strokesV, sE, md0, S0 + dS); if (v && v.cost < out.cost) out = v; }); }
      return out; }
    var cands = [st];
    // (a) a solid band right outside the letters, then a softer fade: Stroke + Outer Glow - two effects, never one
    var bestRing = null, bestD = -1; for (kk = 1; kk <= 3; kk++) { var rc2 = ringMed(s0 + kk - 1, s0 + kk); if (!rc2) continue; var dd = 0, cnt = 0; for (j = 0; j < n; j++) if (!G[j] && dOut[j] > s0 + kk - 1 && dOut[j] <= s0 + kk) { dd += Math.abs(R[3 * j] - C[3 * j]) + Math.abs(R[3 * j + 1] - C[3 * j + 1]) + Math.abs(R[3 * j + 2] - C[3 * j + 2]); cnt++; } if (cnt && dd / cnt > bestD) { bestD = dd / cnt; bestRing = rc2; } }
    if (bestRing) { var ref = bestRing, prof = [];
      for (kk = 1; kk <= 8; kk++) { var vs = []; for (j = 0; j < n; j++) { if (G[j] || dOut[j] <= s0 + kk - 1 || dOut[j] > s0 + kk) continue; var u0 = ref[0] - C[3 * j], u1 = ref[1] - C[3 * j + 1], u2 = ref[2] - C[3 * j + 2], L2 = u0 * u0 + u1 * u1 + u2 * u2; if (L2 < 1600) continue;
          vs.push(((R[3 * j] - C[3 * j]) * u0 + (R[3 * j + 1] - C[3 * j + 1]) * u1 + (R[3 * j + 2] - C[3 * j + 2]) * u2) / L2); } prof.push(vs.length > 20 ? median(vs) : null); }
      // ring 1 is partly the letter edge itself (anti-aliasing): the band may start at ring 2
      var plat = 0, k0 = 0; while (k0 < 2 && prof[k0] !== null && prof[k0] < 0.9) k0++;
      for (kk = k0; kk < prof.length && prof[kk] !== null && prof[kk] >= 0.9; kk++) plat = kk + 1;
      if (plat > k0 && plat < 7 && prof[plat] !== null && prof[plat] < 0.9) {
        [plat, plat + 1].forEach(function (sz) { var ns = st.strokes.concat([{ size: s0 + sz, color: ref }]), hg = fitGlow(s0 + sz, 0, 0);
          var v = copy(st, ns, hg || null); v.err = FX.score(P, v); v.cost = costOf(v); v.splitFromGlow = true; cands.push(v);
          var vg = gradTries(ns, s0 + sz, hg || g0); if (vg) { vg.splitFromGlow = true; cands.push(vg); } });
        // the letters' own colour reaches a little past the found letter edge: a fill-coloured band (a Stroke in the fill colour) first
        if (k0 >= 1 && !st.strokes.length && !st.gradient) { var fbd = [{ size: k0, color: st.fill.slice() }];
          [fbd, fbd.concat([{ size: plat, color: ref }])].forEach(function (ns) { var e2 = ns[ns.length - 1].size, hg = fitGlow(e2, 0, 0);
            var v = copy(st, ns, hg || null); v.err = FX.score(P, v); v.cost = costOf(v); v.fillBand = k0; cands.push(v);
            var vg = gradTries(ns, e2, hg || g0); if (vg) { vg.fillBand = k0; cands.push(vg); } }); } } }
    // (b) the glow alone, its colour changing with distance: Outer Glow with a gradient
    var vg2 = gradTries(st.strokes, s0, g0); if (vg2) cands.push(vg2);
    var best = st; cands.forEach(function (v) { if (v.cost < best.cost) best = v; }); st = best;
  })();
  // (c) two soft effects that are not one: an Outer Glow all around plus a Drop Shadow (moved to one side - or not moved, which is
  // how Photoshop stacks a second glow). Fitted in turns, each on what the other leaves: never merged into one effect.
  if (!quick && !opt.noShadow) (function () {
    var sE = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, g0 = st.glow; if (!g0) return;
    function costOf(v) { return v.err * (1 + 0.03 * v.strokes.length + (v.glow ? (v.glow.dx || v.glow.dy ? 0.08 : 0.06) : 0) + (v.shadow ? 0.07 : 0) + (v.strokes.length < sk.length ? 0.02 : 0)); }
    var X = { D: new Float32Array(3 * n), Cb: new Float32Array(3 * n), W: new Float32Array(3 * n) }, jj, cc, cands = [];
    function softAt(g, j) { var d = (g.dx || g.dy) ? dAt(j, g.dx, g.dy) : dOut[j], sh = FX.glowF(d, g.size, g.spread); return [sh * g.opacity, FX.glowColour(g, sh)]; }
    // the Drop Shadow under a known glow: what is left = raw - (glow over clean); the shadow shows only through the part the glow lets through
    function forShadow(g) { for (jj = 0; jj < n; jj++) { if (G[jj]) continue; var sa = softAt(g, jj), a = sa[0];
        for (cc = 0; cc < 3; cc++) { var cv = C[3 * jj + cc] / 255, gc = sa[1][cc] / 255, top, wt;
          if (g.mode === 'screen') { top = 1 - (1 - cv) * (1 - a * gc); wt = 1 - a * gc; } else { top = cv + a * (gc - cv); wt = 1 - a; }
          X.D[3 * jj + cc] = R[3 * jj + cc] / 255 - top; X.Cb[3 * jj + cc] = cv; X.W[3 * jj + cc] = wt; } } return X; }
    // the Outer Glow over a known shadow: it blends with (shadow over clean)
    function forGlow(g) { for (jj = 0; jj < n; jj++) { if (G[jj]) continue; var sa = softAt(g, jj), a = sa[0];
        for (cc = 0; cc < 3; cc++) { var cv = C[3 * jj + cc] / 255, gc = sa[1][cc] / 255, sv = g.mode === 'screen' ? 1 - (1 - cv) * (1 - a * gc) : cv + a * (gc - cv);
          X.D[3 * jj + cc] = R[3 * jj + cc] / 255 - sv; X.Cb[3 * jj + cc] = sv; X.W[3 * jj + cc] = 1; } } return X; }
    function shadowNear(gl, sx, sy, rad) { forShadow(gl); var b2 = null; for (var ey = -rad; ey <= rad; ey++) for (var ex = -rad; ex <= rad; ex++) { var g2 = fitGlow(sE, sx + ex, sy + ey, X); if (g2 && (!b2 || g2.err < b2.err)) b2 = g2; } return b2; }
    function polish(gl, sh) { for (var it = 0; it < 3; it++) { var g1 = fitGlow(sE, 0, 0, forGlow(sh)); if (!g1) break; gl = g1; var s2 = shadowNear(gl, sh.dx, sh.dy, 1); if (!s2) break; sh = s2; } return [gl, sh]; }
    function keep(gl, sh, how) { if (!gl || gl.dx || gl.dy || !sh || sh.opacity < 0.2) return;   /* a barely visible extra effect is not worth a second effect */ var v = {}; for (var key in st) v[key] = st[key]; v.glow = gl; v.shadow = sh; v.err = FX.score(P, v); v.cost = costOf(v); cands.push(v); }
    var offs = (g0.dx || g0.dy) ? [{ sx: g0.dx, sy: g0.dy }] : shadowShifts(sE); offs = offs.concat([{ sx: 0, sy: 0 }]);
    offs.forEach(function (o) {
      // (1) keep the glow found so far, fit the shadow under it; (2) shadow first on its own, then the glow over it - then polish both in turns
      if (!g0.dx && !g0.dy) { var s1 = shadowNear(g0, o.sx, o.sy, o.sx || o.sy ? 2 : 1); if (s1) { var pr = polish(g0, s1); keep(pr[0], pr[1], 'glow-first'); } }
      if (o.sx || o.sy) { var s0 = (g0.dx || g0.dy) ? g0 : fitGlow(sE, o.sx, o.sy); if (s0) { var g1 = fitGlow(sE, 0, 0, forGlow(s0)); if (g1) { var pr2 = polish(g1, s0); keep(pr2[0], pr2[1], 'shadow-first'); } } }
    });
    var best = st; cands.forEach(function (v) { if (v.cost < best.cost) best = v; }); st = best;
  })();
  // (d) more moved copies in other colours (an RGB-split look: red, cyan, yellow copies around white letters): each further copy is
  // fitted on what the effects found so far leave, under them. Photoshop: more Drop Shadow instances (up to 10 on one layer).
  if (!quick && !opt.noShadow && opt.moreShadows !== false && (st.shadow || (st.glow && (st.glow.dx || st.glow.dy)))) (function () {
    var sE = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, X = { D: new Float32Array(3 * n), Cb: new Float32Array(3 * n), W: new Float32Array(3 * n) }, jj, cc, res = new Float32Array(n);
    function softA(g, j) { return FX.glowF((g.dx || g.dy) ? dAt(j, g.dx, g.dy) : dOut[j], g.size, g.spread) * g.opacity; }
    for (var rnd = 0; rnd < 2; rnd++) {
      var soft = (st.moreShadows || []).concat(st.shadow ? [st.shadow] : []).concat(st.glow ? [st.glow] : []);
      for (jj = 0; jj < n; jj++) { res[jj] = 0; if (G[jj]) continue; var m = FX.pixel(P, st, jj), wt = 1, rr = 0; for (var s9 = 0; s9 < soft.length; s9++) wt *= 1 - softA(soft[s9], jj);
        for (cc = 0; cc < 3; cc++) { var dv = R[3 * jj + cc] / 255 - m[cc]; X.D[3 * jj + cc] = dv; X.Cb[3 * jj + cc] = C[3 * jj + cc] / 255; X.W[3 * jj + cc] = wt; rr += Math.abs(dv); } res[jj] = rr * 85; }
      var E = []; for (jj = 0; jj < n; jj++) if (!G[jj] && dOut[jj] > sE + 1 && dOut[jj] <= KMAX) E.push(jj);
      if (E.length < 80) return;
      var stp = Math.max(1, Math.floor(E.length / 5000)), sc = [], thr = Math.max(14, 3 * (P.noise || 0));
      for (var sy = -24; sy <= 24; sy += 2) for (var sx = -24; sx <= 24; sx += 2) { if (!sx && !sy) continue; var s1 = 0;
        for (var j5 = 0; j5 < E.length; j5 += stp) { var q = E[j5]; if (dAt(q, sx, sy) <= 1) s1 += res[q] > thr ? 1 : -1; }
        sc.push({ sx: sx, sy: sy, sc: s1 }); }
      sc.sort(function (a, b) { return b.sc - a.sc; });
      var bestV = null;
      sc.slice(0, 3).forEach(function (o) { if (o.sc <= 20) return;
        for (var ey = -1; ey <= 1; ey++) for (var ex = -1; ex <= 1; ex++) { var g2 = fitGlow(sE, o.sx + ex, o.sy + ey, X); if (!g2 || g2.opacity < 0.2) continue; delete g2.grad;
          var v = {}; for (var key in st) v[key] = st[key]; v.moreShadows = [g2].concat(st.moreShadows || []); v.err = FX.score(P, v); if (!bestV || v.err < bestV.err) bestV = v; } });
      if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  more copies? round', rnd, JSON.stringify(sc.slice(0, 3)), bestV ? bestV.err : null, 'was', st.err);
      if (!bestV || bestV.err > 0.95 * st.err) return;
      bestV.cost = st.cost * (bestV.err / st.err) * 1.04; st = bestV; }
  })();
  // letters that swallowed their own outline/glow: many 'letter' pixels look like what surrounds them
  var oc = changedMedian(1, 2);
  if (oc && cdist(oc, st.fill) > 60) { var sw = 0, gt = 0; for (i = 0; i < n; i += 2) if (G[i]) { gt++; if (cdist([R[3 * i], R[3 * i + 1], R[3 * i + 2]], oc) < 35) sw++; }
    st.swallow = gt ? sw / gt : 0; if (st.swallow > 0.2) { st.cost *= 1 + (st.swallow - 0.2); }
    if (st.gradient && (cdist(st.gradient.top, oc) < 40 || cdist(st.gradient.bottom, oc) < 40)) { st.gradient = null; } }
  if (st.inner && st.strokes.length) { var ins = st.inner.size, nst = [{ size: ins, color: st.inner.color }];
    st.strokes.forEach(function (s7) { nst.push({ size: s7.size + ins, color: s7.color }); });
    st.strokes = nst.slice(0, 3); st.inner = null; st.innerMoved = true; }
  return st;
};

FX.innerAt = function (st, i, w) { if (!st.inner.across) return st.inner.color; var xa = i % w; return FX.acrossAt(st.inner.across, xa, (i - xa) / w); };
FX.fillAt = function (st, i, w) { return st.inner ? FX.innerAt(st, i, w) : FX.faceAt(st, i, w); };   // colour at the letter edge
FX.faceAt = function (st, i, w) {   // colour of the letter face
  if (st.fillAcross) { var xa = i % w; return FX.acrossAt(st.fillAcross, xa, (i - xa) / w); }
  if (st.gradient) { var t = FX.gradT(st.gradient, Math.floor(i / w)); return [0, 1, 2].map(function (cc) { return st.gradient.top[cc] + t * (st.gradient.bottom[cc] - st.gradient.top[cc]); }); }
  return st.fill;
};
// colour of the redrawn text at pixel i (0..1 floats)
// colour of the glow at a point: one colour, or a gradient mapped from the letter edge (shape 1) to the glow's outer end (shape 0)
FX.glowColour = function (g, shape) { if (!g.grad) return g.color; var t = 1 - shape, a = g.grad.inner, b = g.grad.outer; return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; };
FX.pixel = function (P, st, i) {
  var C = P.C, ch, c = [C[3 * i] / 255, C[3 * i + 1] / 255, C[3 * i + 2] / 255], G = st.G, dOut = st.dOut, w = P.w;
  if (!G[i]) {
    if (st.extrude) { var ex = FX.extrudeAt(P, st, i); if (ex) c = [ex[0] / 255, ex[1] / 255, ex[2] / 255]; }
    if (st.moreShadows) for (var mi = 0; mi < st.moreShadows.length; mi++) { var s3 = st.moreShadows[mi], qx3 = i % w - s3.dx, qy3 = (i - i % w) / w - s3.dy, d3 = (qx3 < 0 || qy3 < 0 || qx3 >= w || qy3 >= P.h) ? 1e3 : dOut[qy3 * w + qx3];
      var sh3 = FX.glowF(d3, s3.size, s3.spread), f3 = sh3 * s3.opacity, gc3 = s3.color;
      for (ch = 0; ch < 3; ch++) c[ch] = s3.mode === 'screen' ? 1 - (1 - c[ch]) * (1 - f3 * gc3[ch] / 255) : c[ch] + f3 * (gc3[ch] / 255 - c[ch]); }
    if (st.shadow) { var s2 = st.shadow, d2 = dOut[i];
      if (s2.dx || s2.dy) { var qx2 = i % w - s2.dx, qy2 = (i - i % w) / w - s2.dy; d2 = (qx2 < 0 || qy2 < 0 || qx2 >= w || qy2 >= P.h) ? 1e3 : dOut[qy2 * w + qx2]; }
      var sh2 = FX.glowF(d2, s2.size, s2.spread), f2 = sh2 * s2.opacity, gc2 = FX.glowColour(s2, sh2);
      for (ch = 0; ch < 3; ch++) c[ch] = s2.mode === 'screen' ? 1 - (1 - c[ch]) * (1 - f2 * gc2[ch] / 255) : c[ch] + f2 * (gc2[ch] / 255 - c[ch]); }
    if (st.glow) { var gx = st.glow.dx || 0, gy = st.glow.dy || 0, dg = dOut[i];
      if (gx || gy) { var qx = i % w - gx, qy = (i - i % w) / w - gy; dg = (qx < 0 || qy < 0 || qx >= w || qy >= P.h) ? 1e3 : dOut[qy * w + qx]; }
      var sh = FX.glowF(dg, st.glow.size, st.glow.spread), f = sh * st.glow.opacity, gc = st.glow.across ? FX.acrossAt(st.glow.across, i % w, (i - i % w) / w) : FX.glowColour(st.glow, sh);
      for (ch = 0; ch < 3; ch++) c[ch] = st.glow.mode === 'screen' ? 1 - (1 - c[ch]) * (1 - f * gc[ch] / 255) : c[ch] + f * (gc[ch] / 255 - c[ch]); }
    for (var si = st.strokes.length - 1; si >= 0; si--) { var sk = st.strokes[si], a = Math.max(0, Math.min(1, sk.size + 1 - dOut[i])); if (a > 0) { var skc = sk.across ? FX.acrossAt(sk.across, i % w, (i - i % w) / w) : sk.color; for (ch = 0; ch < 3; ch++) c[ch] = c[ch] + a * (skc[ch] / 255 - c[ch]); } }
    if (dOut[i] <= 1 && (!st.split || st.splitUnder)) { var fe = FX.fillAt(st, i, w); for (ch = 0; ch < 3; ch++) c[ch] = c[ch] + 0.4 * st.fillOpacity * (fe[ch] / 255 - c[ch]); }   // soft letter edge
  } else if (!st.split || st.splitUnder) {
    var fc = st.fill;
    if (st.inner && st.dIn[i] <= st.inner.size + 0.5) fc = FX.innerAt(st, i, w);
    else { if (st.gradient || st.fillAcross) fc = FX.faceAt(st, i, w); if (st.innerGlow) fc = FX.innerGlowOn(st.innerGlow, fc, st.dIn[i]); }
    for (ch = 0; ch < 3; ch++) c[ch] = c[ch] + st.fillOpacity * (fc[ch] / 255 - c[ch]);
  }
  if (st.split && !(st.splitUnder && (G[i] || dOut[i] <= 1))) c = FX.splitAt(P, st, i, c);
  return c;
};
FX.score = function (P, st) {
  var e = 0, R = P.R;
  for (var j = 0; j < P.ev.length; j++) { var i = P.ev[j], c = FX.pixel(P, st, i); for (var ch = 0; ch < 3; ch++) { var d = c[ch] - R[3 * i + ch] / 255; d = d * d; e += d < 0.09 ? d : 0.09; } }   // robust: unexplained pixels cost the same for every candidate
  return e / Math.max(1, P.ev.length);
};

// ---------- colours that change ACROSS the word: rainbow letters, an outline or a glow that turns from one colour to the next along
// the word. Photoshop: Gradient Overlay (letters), Stroke filled with a gradient (outline), the glow baked into a Smart Object with a
// Gradient Overlay on it (glow). a = { ax: 'x' | 'y', lo, hi (the letters' extent on that axis, px), stops: [{ t (0..1 from lo to hi), c }] }
FX.acrossAt = function (a, x, y) {
  var p = ((a.ax === 'y' ? y : x) - a.lo) / Math.max(1, a.hi - a.lo), s = a.stops, k;
  if (p <= s[0].t) return s[0].c;
  for (k = 1; k < s.length; k++) if (p <= s[k].t) { var A = s[k - 1].c, B = s[k].c, u = (p - s[k - 1].t) / Math.max(1e-6, s[k].t - s[k - 1].t); return [A[0] + u * (B[0] - A[0]), A[1] + u * (B[1] - A[1]), A[2] + u * (B[2] - A[2])]; }
  return s[s.length - 1].c;
};
FX.acrossFit = function (P, st) {
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dOut = st.dOut, dIn = st.dIn, i, k, ch;
  var x0 = w, y0 = h, x1 = -1, y1 = -1; for (i = 0; i < n; i++) if (G[i]) { var xg = i % w, yg = (i - xg) / w; if (xg < x0) x0 = xg; if (xg > x1) x1 = xg; if (yg < y0) y0 = yg; if (yg > y1) y1 = yg; }
  if (x1 - x0 < 24 && y1 - y0 < 24) return null;
  function c8(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  // one part's colour along one axis: its pixels binned along the axis (median colour per bin), then as few stops as keep within ~12 levels
  function along(pts, ax, flatAt) {   // pts: [pixel, r, g, b, pixel, r, g, b, ...]
    var lo = ax === 'y' ? y0 : x0, hi = ax === 'y' ? y1 : x1, span = hi - lo, j; if (span < 24) return null;
    var NB = Math.max(6, Math.min(40, Math.round(span / 5))), bins = []; for (k = 0; k < NB; k++) bins.push([[], [], []]);
    for (j = 0; j < pts.length; j += 4) { var q = pts[j], pos = ax === 'y' ? (q - q % w) / w : q % w, b = Math.max(0, Math.min(NB - 1, Math.floor((pos - lo) / span * NB))); for (ch = 0; ch < 3; ch++) bins[b][ch].push(pts[j + 1 + ch]); }
    var seq = []; for (k = 0; k < NB; k++) if (bins[k][0].length >= 8) seq.push({ t: (k + 0.5) / NB, c: [med8(bins[k][0]), med8(bins[k][1]), med8(bins[k][2])] });
    if (seq.length < 3) return null;
    // fewest stops: keep the bins that a straight blend between the kept neighbours misses by more than tol (Douglas-Peucker in colour)
    function simplify(tol) { var keep = [0, seq.length - 1];
      (function rec(a, b) { var worst = -1, wd = tol; for (var m = a + 1; m < b; m++) { var u = (seq[m].t - seq[a].t) / (seq[b].t - seq[a].t), A = seq[a].c, B = seq[b].c, d = cdist([A[0] + u * (B[0] - A[0]), A[1] + u * (B[1] - A[1]), A[2] + u * (B[2] - A[2])], seq[m].c); if (d > wd) { wd = d; worst = m; } }
        if (worst >= 0) { keep.push(worst); rec(a, worst); rec(worst, b); } })(0, seq.length - 1);
      keep.sort(function (p1, p2) { return p1 - p2; }); return keep.map(function (m) { return { t: +seq[m].t.toFixed(4), c: seq[m].c.slice() }; }); }
    var tol = 12, stops = simplify(tol); while (stops.length > 10) { tol += 4; stops = simplify(tol); }
    var a = { ax: ax, lo: lo, hi: hi, stops: stops }, eA = 0, eF = 0, range = 0;
    for (j = 0; j < pts.length; j += 8) { var q2 = pts[j], xq = q2 % w, yq = (q2 - xq) / w, cq = [pts[j + 1], pts[j + 2], pts[j + 3]], d1 = Math.min(80, cdist(cq, FX.acrossAt(a, xq, yq))), d2 = Math.min(80, cdist(cq, flatAt(q2))); eA += d1 * d1; eF += d2 * d2; }
    for (j = 0; j < stops.length; j++) for (k = j + 1; k < stops.length; k++) range = Math.max(range, cdist(stops[j].c, stops[k].c));
    a.gain = eF > 0 ? +(1 - eA / eF).toFixed(3) : 0; a.range = Math.round(range); return a; }
  function best2(pts, flatAt) { if (pts.length < 4 * 150) return null; var b = null, AL = [along(pts, 'x', flatAt), along(pts, 'y', flatAt)];
    if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('    along', pts.length / 4, JSON.stringify(AL.map(function (a) { return a && [a.ax, a.gain, a.range, a.stops.length]; })));
    AL.forEach(function (a) { if (a && ((a.gain >= 0.45 && a.range >= 45) || (a.gain >= 0.25 && a.range >= 100)) && (!b || a.gain > b.gain)) b = a; }); return b; }
  var parts = {}, pf = [], fo = st.fillOpacity === undefined ? 1 : st.fillOpacity, flatFill = { fill: st.fill, gradient: st.gradient };
  // the letter faces (past the edge and any inner outline)
  for (i = 0; i < n; i++) { if (!G[i] || dIn[i] < 2 || (st.inner && dIn[i] <= st.inner.size + 1.5)) continue;
    pf.push(i); for (ch = 0; ch < 3; ch++) pf.push(c8(fo >= 0.95 ? R[3 * i + ch] : C[3 * i + ch] + (R[3 * i + ch] - C[3 * i + ch]) / Math.max(0.2, fo))); }
  var thickOK = !(st.thick > 0) || st.thick >= 4;   // small text: too few face pixels to read colours along the word (noise would make stripes)
  parts.fill = thickOK ? best2(pf, function (q) { return FX.faceAt(flatFill, q, w); }) : null;
  // an 'inner outline' found on rainbow letters is often just their colours averaged at the edge: also try the whole face, no inner outline
  if (st.inner && thickOK) { var pf2 = []; for (i = 0; i < n; i++) { if (!G[i] || dIn[i] < 1.5) continue; pf2.push(i); for (ch = 0; ch < 3; ch++) pf2.push(c8(fo >= 0.95 ? R[3 * i + ch] : C[3 * i + ch] + (R[3 * i + ch] - C[3 * i + ch]) / Math.max(0.2, fo))); }
    parts.fillAll = best2(pf2, function (q) { return FX.faceAt(flatFill, q, w); }); }
  // an inner outline (inside the letter edge)
  if (st.inner && thickOK) { var pi2 = [], is = st.inner.size; for (i = 0; i < n; i++) { if (!G[i] || dIn[i] < (is >= 2 ? 1 : 0.5) || dIn[i] > is + (is >= 2 ? 0 : 0.5)) continue; pi2.push(i, R[3 * i], R[3 * i + 1], R[3 * i + 2]); }
    parts.inner = best2(pi2, function () { return st.inner.color; }); }
  // each outline, where it alone shows
  var prev = 0; parts.strokes = st.strokes.map(function (sk) { var lo2 = prev, ps = [], a0 = sk.size - lo2 >= 2 ? lo2 + 1 : lo2 + 0.5, a1 = sk.size - lo2 >= 2 ? sk.size : sk.size + 0.5; prev = sk.size;
    for (i = 0; i < n; i++) { if (G[i] || dOut[i] <= a0 || dOut[i] > a1) continue; ps.push(i, R[3 * i], R[3 * i + 1], R[3 * i + 2]); }
    return best2(ps, function () { return sk.color; }); });
  // the glow: its colour at each pixel, read back through how much of it shows there (only where it shows well)
  parts.glow = null;
  if (st.glow && !st.glow.dx && !st.glow.dy) { var g = st.glow, sE = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, sn = {}, pg = [];
    for (var key in st) sn[key] = st[key]; sn.glow = null;
    for (i = 0; i < n; i++) { if (G[i] || dOut[i] <= sE + 1) continue; var f = FX.glowF(dOut[i], g.size, g.spread) * g.opacity; if (f < 0.25) continue;
      var U = FX.pixel(P, sn, i), gc = [0, 0, 0], ok = true;
      for (ch = 0; ch < 3; ch++) { var r = R[3 * i + ch] / 255, u = U[ch], v;
        if (g.mode === 'screen') { if (u > 0.97) { ok = false; break; } v = (1 - (1 - r) / (1 - u)) / f; } else v = u + (r - u) / f;
        gc[ch] = c8(255 * v); }
      if (ok) pg.push(i, gc[0], gc[1], gc[2]); }
    parts.glow = best2(pg, function (q) { return FX.glowColour(g, FX.glowF(dOut[q], g.size, g.spread)); }); }
  var anyS = parts.strokes.some(Boolean) || !!parts.inner, nP = (parts.fill || parts.fillAll ? 1 : 0) + (anyS ? 1 : 0) + (parts.glow ? 1 : 0);
  if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  across?', JSON.stringify({ inner: parts.inner && [parts.inner.ax, parts.inner.gain, parts.inner.range], fill: parts.fill && [parts.fill.ax, parts.fill.gain, parts.fill.range, parts.fill.stops.length], strokes: parts.strokes.map(function (a) { return a && [a.ax, a.gain, a.range, a.stops.length]; }), glow: parts.glow && [parts.glow.ax, parts.glow.gain, parts.glow.range, parts.glow.stops.length] }));
  if (!nP) return null;
  function withParts(useF, useS, useG) { var v = {}; for (var k3 in st) v[k3] = st[k3];
    if (useF && parts.fill) v.fillAcross = parts.fill;
    if (useS && anyS) { v.strokes = st.strokes.map(function (sk, si) { var o = { size: sk.size, color: sk.color }; if (parts.strokes[si]) o.across = parts.strokes[si]; return o; });
      if (parts.inner) v.inner = { size: st.inner.size, color: st.inner.color, across: parts.inner }; }
    if (useG && parts.glow) { v.glow = {}; for (var k4 in st.glow) v.glow[k4] = st.glow[k4]; v.glow.across = parts.glow; delete v.glow.grad; }
    v.err = FX.score(P, v); return v; }
  var cands = parts.fill || !parts.fillAll ? [withParts(true, true, true)] : [];
  if (parts.fillAll) { var vA = withParts(false, true, true); vA.inner = null; vA.fillAcross = parts.fillAll; vA.err = FX.score(P, vA); cands.push(vA); }
  if (nP > 1) { if (parts.fill) cands.push(withParts(true, false, false)); if (anyS) cands.push(withParts(false, true, false)); if (parts.glow) cands.push(withParts(false, false, true)); }
  var best = null; cands.forEach(function (v) { if (!best || v.err < best.err) best = v; });
  if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  across err', best.err, 'was', st.err);
  return best.err < 0.97 * st.err ? best : null;
};

// ---------- soft shading inside the letters (a tube / rounded look, darker or lighter toward the edges): Photoshop's Inner Glow
// (source: Edge) over the letter face, under any inner outline. st.innerGlow = { mode: 'normal' | 'multiply' | 'screen', size, choke, opacity, color }
FX.innerGlowOn = function (ig, fc, d) {
  var f = FX.glowF(d, ig.size, ig.choke) * ig.opacity, c = ig.color;
  if (f <= 0) return fc;
  if (ig.mode === 'multiply') return [fc[0] * (1 - f + f * c[0] / 255), fc[1] * (1 - f + f * c[1] / 255), fc[2] * (1 - f + f * c[2] / 255)];
  if (ig.mode === 'screen') return [255 - (255 - fc[0]) * (1 - f * c[0] / 255), 255 - (255 - fc[1]) * (1 - f * c[1] / 255), 255 - (255 - fc[2]) * (1 - f * c[2] / 255)];
  return [fc[0] + f * (c[0] - fc[0]), fc[1] + f * (c[1] - fc[1]), fc[2] + f * (c[2] - fc[2])];
};
FX.innerGlowFit = function (P, st) {
  var w = P.w, n = w * P.h, R = P.R, G = st.G, dIn = st.dIn, i, j, ch;
  var half = Math.max(3, st.thick ? st.thick / 2 : 6), best = null;
  function attempt(noInner) {
    var s0 = {}; for (var key in st) s0[key] = st[key]; if (noInner) s0.inner = null; s0.innerGlow = null;
    var pts = [], F = []; for (i = 0; i < n; i += 2) { if (!G[i] || dIn[i] < 1 || (s0.inner && dIn[i] <= s0.inner.size + 0.5)) continue; pts.push(i); var fc = FX.faceAt(s0, i, w); F.push(fc[0] / 255, fc[1] / 255, fc[2] / 255); }
    if (pts.length < 150) return;
    var sizes = []; for (var sz = 1; sz <= Math.min(40, Math.round(1.6 * half)); sz += (sz < 8 ? 1 : 2)) sizes.push(sz);
    sizes.forEach(function (size) { [0, 25, 50].forEach(function (choke) {
      var fv = pts.map(function (q) { return FX.glowF(dIn[q], size, choke); });
      ['normal', 'multiply', 'screen'].forEach(function (mode) {
        var A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bv = [0, 0, 0, 0], S = [0, 0, 0], T = [0, 0, 0];
        for (j = 0; j < pts.length; j++) { var f = fv[j]; if (f < 0.01) continue; var q = pts[j];
          for (ch = 0; ch < 3; ch++) { var Fc = F[3 * j + ch], y = R[3 * q + ch] / 255 - Fc;
            if (mode === 'screen') { var a1 = (1 - Fc) * f; S[ch] += a1 * a1; T[ch] += a1 * y; continue; }
            var gk = mode === 'multiply' ? f * Fc : f, ok = mode === 'multiply' ? -f * Fc : -f * Fc;   // y = gk*(op*col) + ok*op
            A[ch][ch] += gk * gk; A[ch][3] += gk * ok; A[3][ch] += gk * ok; A[3][3] += ok * ok; bv[ch] += gk * y; bv[3] += ok * y; } }
        var op, col = [0, 0, 0];
        if (mode === 'screen') { var g3 = [0, 1, 2].map(function (c) { return S[c] ? T[c] / S[c] : 0; }), mx = Math.max(g3[0], g3[1], g3[2]); if (mx <= 0.02) return; op = Math.min(1, mx); col = g3.map(function (v) { return Math.max(0, Math.min(1, v / op)); }); }
        else { A[3][3] += 1e-9; var sol = solve4(A, bv); if (!sol) return; op = Math.max(0, Math.min(1, sol[3])); if (op < 0.05) return; col = [0, 1, 2].map(function (c) { return Math.max(0, Math.min(1, sol[c] / op)); }); }
        var e = 0; for (j = 0; j < pts.length; j++) { var q2 = pts[j], fc2 = [255 * F[3 * j], 255 * F[3 * j + 1], 255 * F[3 * j + 2]], m = FX.innerGlowOn({ mode: mode, size: size, choke: choke, opacity: op, color: [255 * col[0], 255 * col[1], 255 * col[2]] }, fc2, dIn[q2]);
          for (ch = 0; ch < 3; ch++) { var dd = (m[ch] - R[3 * q2 + ch]) / 255; dd *= dd; e += dd < 0.09 ? dd : 0.09; } }
        if (!best || e / pts.length < best.e) best = { e: e / pts.length, noInner: noInner, ig: { mode: mode, size: size, choke: choke, opacity: +op.toFixed(2), color: col.map(function (v) { return Math.round(255 * v); }) } }; }); }); }); }
  attempt(false); if (st.inner) attempt(true);
  if (!best) return null;
  var v = {}; for (var k2 in st) v[k2] = st[k2]; v.innerGlow = best.ig; if (best.noInner) v.inner = null; v.err = FX.score(P, v);
  if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  inner glow?', JSON.stringify(best.ig), 'no inner outline', best.noInner, 'err', v.err, 'was', st.err);
  return v.err < 0.97 * st.err ? v : null;
};

// ---------- RGB split: colour copies of the word moved apart and screen-blended (white where they all overlap, coloured fringes
// where they don't). Photoshop: the text's Fill at 0%, one Drop Shadow per copy (Screen, size 0, 'Layer Knocks Out Drop Shadow' off).
// st.split = [{ dx, dy, color }] (offsets from the letters' own place, which is the middle of the copies)
FX.splitAt = function (P, st, i, c) {
  var w = P.w, x = i % w, y = (i - x) / w, G = st.G, dOut = st.dOut;
  for (var k = 0; k < st.split.length; k++) { var s = st.split[k], qx = x - s.dx, qy = y - s.dy; if (qx < 0 || qy < 0 || qx >= w || qy >= P.h) continue;
    var q = qy * w + qx, a = G[q] ? 1 : dOut[q] <= 1 ? 0.4 : 0; if (!a) continue;
    for (var ch = 0; ch < 3; ch++) c[ch] = 1 - (1 - c[ch]) * (1 - a * s.color[ch] / 255); }
  return c;
};
FX.splitFit = function (P, st) {
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dOut = st.dOut, i, ch, j;
  // each colour channel's own shape: where that channel got much brighter than the background
  var Mk = [0, 1, 2].map(function (c) { var m = new Uint8Array(n), cnt = 0; for (var q = 0; q < n; q++) { if (!G[q] && dOut[q] > 14) continue; if (R[3 * q + c] - C[3 * q + c] > 60 && R[3 * q + c] > 150) { m[q] = 1; cnt++; } } m.cnt = cnt; return m; });
  if (Mk.some(function (m) { return m.cnt < 200; })) return null;
  var ref = 0; for (ch = 1; ch < 3; ch++) if (Mk[ch].cnt < Mk[ref].cnt) ref = ch;   // the smallest shape has the least glow in it
  var Rf = Mk[ref], pts = []; for (i = 0; i < n; i++) if (Rf[i]) pts.push(i);
  function iou(m, sx, sy) { var inter = 0; for (var j2 = 0; j2 < pts.length; j2++) { var q = pts[j2], x = q % w + sx, y = (q - q % w) / w + sy; if (x >= 0 && y >= 0 && x < w && y < h && m[y * w + x]) inter++; } return inter / (pts.length + m.cnt - inter); }
  var offs = Mk.map(function (m, c) { if (c === ref) return { dx: 0, dy: 0, iou: 1 }; var b = null;
    for (var sy = -12; sy <= 12; sy++) for (var sx = -12; sx <= 12; sx++) { var v = iou(m, sx, sy); if (!b || v > b.iou) b = { dx: sx, dy: sy, iou: v }; } return b; });
  var spread = 0; for (ch = 0; ch < 3; ch++) for (j = ch + 1; j < 3; j++) spread = Math.max(spread, Math.hypot(offs[ch].dx - offs[j].dx, offs[ch].dy - offs[j].dy));
  if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  split?', JSON.stringify(offs), 'spread', spread.toFixed(1));
  if (spread < 2 || offs.some(function (o) { return o.iou < 0.55; })) return null;
  // copies: channels that moved together are one copy (red + cyan, or red / green / blue)
  var copies = []; offs.forEach(function (o, c) { var cp = null; copies.forEach(function (k) { if (Math.abs(k.dx - o.dx) <= 1 && Math.abs(k.dy - o.dy) <= 1) cp = k; });
    if (!cp) { cp = { dx: o.dx, dy: o.dy, color: [0, 0, 0] }; copies.push(cp); } cp.color[c] = 255; });
  var mx = Math.round(offs.reduce(function (a, o) { return a + o.dx; }, 0) / 3), my = Math.round(offs.reduce(function (a, o) { return a + o.dy; }, 0) / 3);
  var G2 = new Uint8Array(n); for (j = 0; j < pts.length; j++) { var q = pts[j], x = q % w + mx, y = (q - q % w) / w + my; if (x >= 0 && y >= 0 && x < w && y < h) G2[y * w + x] = 1; }
  FX.components(G2, w, h, 0).forEach(function (hc) { if (!hc.touch && hc.length < 60) for (var j3 = 0; j3 < hc.length; j3++) G2[hc[j3]] = 1; });
  var inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = G2[i] ? 0 : 1;
  var base = {}; for (var key in st) base[key] = st[key];
  base.G = G2; base.dIn = FX.edt(G2, w, h); base.dOut = FX.edt(inv, w, h); base.strokes = []; base.inner = null; base.innerGlow = null; base.fillAcross = null; base.gradient = null;
  base.shadow = null; base.moreShadows = null; base.extrude = null; base.fillOpacity = 0; base.split = copies.map(function (k) { return { dx: k.dx - mx, dy: k.dy - my, color: k.color }; });
  // (b) letters on top in their own colour (white), the coloured copies only show around them: the letters are where all channels are bright
  var baseB = {}; for (var kb in base) baseB[kb] = base[kb];
  var G3 = new Uint8Array(n); for (i = 0; i < n; i++) if (Mk[0][i] && Mk[1][i] && Mk[2][i]) G3[i] = 1;
  FX.components(G3, w, h, 0).forEach(function (hc) { if (!hc.touch && hc.length < 60) for (var j4 = 0; j4 < hc.length; j4++) G3[hc[j4]] = 1; });
  var inv3 = new Uint8Array(n); for (i = 0; i < n; i++) inv3[i] = G3[i] ? 0 : 1;
  baseB.G = G3; baseB.dIn = FX.edt(G3, w, h); baseB.dOut = FX.edt(inv3, w, h); baseB.fillOpacity = st.fillOpacity; baseB.fill = st.fill; baseB.splitUnder = true;
  var best = null;
  [base, baseB].forEach(function (bs) { [1, 0.6, 0.3, 0].forEach(function (f) { if (!st.glow && f) return; var v = {}; for (var k2 in bs) v[k2] = bs[k2];
    if (st.glow && f) { v.glow = {}; for (var k3 in st.glow) v.glow[k3] = st.glow[k3]; v.glow.opacity = st.glow.opacity * f; v.glow.dx = 0; v.glow.dy = 0; } else v.glow = null;
    v.err = FX.score(P, v); if (!best || v.err < best.err) best = v; }); });
  if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  split err', best.err, 'was', st.err, JSON.stringify(best.split));
  return best.err < 0.93 * st.err ? best : null;
};

// ---------- 3D extrusion: the outlined letters swept along one direction (the depth), drawn behind them ----------
// e = { ux, uy (unit direction, image y down), len (px), layers: [{ size (outline size it copies, 0 = the letters), color, far (colour at full depth) }] outer first }
FX.extrudeAt = function (P, st, i) {
  var e = st.extrude, w = P.w, h = P.h, x = i % w, y = (i - x) / w, dOut = st.dOut, G = st.G;
  for (var li = e.layers.length - 1; li >= 0; li--) { var Ly = e.layers[li];   // inner copies lie on top of outer ones
    for (var t = 1; t <= e.len; t++) { var qx = Math.round(x - t * e.ux), qy = Math.round(y - t * e.uy); if (qx < 0 || qy < 0 || qx >= w || qy >= h) break; var q = qy * w + qx;
      if (G[q] || dOut[q] <= Ly.size + 0.5) { var c = Ly.color; if (Ly.far) { var f = (t - 1) / Math.max(1, e.len - 1); c = [c[0] + f * (Ly.far[0] - c[0]), c[1] + f * (Ly.far[1] - c[1]), c[2] + f * (Ly.far[2] - c[2])]; } return c; } } }
  return null;
};
// Finds a solid band that sticks out on ONE side of the outlined letters (in the outline's colours): the letters' 3D depth.
FX.extrusionFit = function (P, st) {
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dOut = st.dOut, i, k;
  var strokes = st.strokes || [], sEnd = strokes.length ? strokes[strokes.length - 1].size : 0;
  function chg(q) { return (Math.abs(R[3 * q] - C[3 * q]) + Math.abs(R[3 * q + 1] - C[3 * q + 1]) + Math.abs(R[3 * q + 2] - C[3 * q + 2])) / 3; }
  var F = new Uint8Array(n), bd = [];
  for (i = 0; i < n; i++) F[i] = (G[i] || dOut[i] <= sEnd + 0.5) ? 1 : 0;
  for (i = 0; i < n; i++) { if (!F[i]) continue; var x = i % w, y = (i - x) / w; if ((x > 0 && !F[i - 1]) || (x < w - 1 && !F[i + 1]) || (y > 0 && !F[i - w]) || (y < h - 1 && !F[i + w])) bd.push(i); }
  if (bd.length < 40) return null;
  // evidence just outside: changed and in an outline colour (or any clear change when there is no outline) = +1, unchanged = -1.5
  var cols = strokes.map(function (z) { return z.color; }), ev = new Float32Array(n);
  for (i = 0; i < n; i++) { if (F[i] || dOut[i] > sEnd + 48) continue; var cg = chg(i); if (cg < 12) { ev[i] = -1.5; continue; } if (cg < 25) continue;
    if (!cols.length) { ev[i] = 1; continue; } var c3 = [R[3 * i], R[3 * i + 1], R[3 * i + 2]]; for (k = 0; k < cols.length; k++) if (cdist(c3, cols[k]) < 70) { ev[i] = 1; break; } }
  // (1) depth hidden inside the outline: the outline is thicker on one side only. Its thickness is measured along the letter-edge
  // normals in every direction: thin side = the real outline, the extra on the thick side = the depth.
  if (strokes.length) (function () {
    var inner = strokes[0].color, bins = []; for (k = 0; k < 24; k++) bins.push([]);
    for (i = 0; i < n; i++) { if (!G[i]) continue; var x = i % w, y = (i - x) / w; if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      if (G[i - 1] && G[i + 1] && G[i - w] && G[i + w]) continue;
      var gx = 0, gy = 0; for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) if (G[i + dy * w + dx]) { gx += dx; gy += dy; }
      var gl = Math.sqrt(gx * gx + gy * gy); if (gl < 3) continue; var nx = -gx / gl, ny = -gy / gl, last = 0, inRun = false, gap = 0;
      for (var s5 = 0.5; s5 <= 30; s5 += 0.5) { var qx = Math.round(x + nx * s5), qy = Math.round(y + ny * s5); if (qx < 0 || qy < 0 || qx >= w || qy >= h) break; var q = qy * w + qx;
        if (G[q]) { if (inRun) break; continue; }
        if (cdist([R[3 * q], R[3 * q + 1], R[3 * q + 2]], inner) < 60) { inRun = true; last = s5; gap = 0; } else if (inRun && ++gap > 2) break; }
      if (!inRun) continue; var ang = Math.atan2(ny, nx); bins[Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 24) % 24].push(last); }
    var T = bins.map(function (b) { return b.length >= 10 ? median(b) : null; }), vals = T.filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
    if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  outline thickness by direction', JSON.stringify(T.map(function (v) { return v === null ? null : +v.toFixed(1); })));
    if (vals.length < 10) return;
    // T(direction) = outline + depth x cos(angle to the depth direction) on the side facing the depth
    var thin = vals[Math.floor(0.2 * vals.length)], vx = 0, vy = 0;
    for (k = 0; k < 24; k++) { if (T[k] === null) continue; var ph = (k + 0.5) / 24 * 2 * Math.PI - Math.PI, ex = Math.max(0, T[k] - thin); vx += ex * Math.cos(ph); vy += ex * Math.sin(ph); }
    var ang2 = Math.atan2(vy, vx), sc2 = 0, cc2 = 0, oppE = [];
    for (k = 0; k < 24; k++) { if (T[k] === null) continue; var ph2 = (k + 0.5) / 24 * 2 * Math.PI - Math.PI, cs = Math.cos(ph2 - ang2); if (cs > 0) { sc2 += (T[k] - thin) * cs; cc2 += cs * cs; } else if (cs < -0.5) oppE.push(T[k] - thin); }
    var L = cc2 ? sc2 / cc2 : 0;
    if (L < 2.5 || (oppE.length && median(oppE) > 1.5)) return;
    var dlt = strokes[0].size - thin;
    var ns = strokes.map(function (z) { return { size: Math.max(1, Math.round(z.size - Math.max(0, dlt))), color: z.color.slice() }; });
    var lay = ns.slice().reverse().map(function (z) { return { size: z.size, color: z.color.slice() }; });
    var v1 = {}; for (var key in st) v1[key] = st[key]; v1.strokes = ns; v1.extrude = { ux: Math.cos(ang2), uy: Math.sin(ang2), len: Math.round(L), layers: lay, how: 'outline thicker on one side' };
    v1.err = FX.score(P, v1);
    if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  depth-in-outline', JSON.stringify({ T: T.map(function (v) { return v === null ? null : +v.toFixed(1); }), thin: thin, L: L, dir: Math.round(ang2 * 180 / Math.PI), err: v1.err, was: st.err }));
    if (v1.err < 0.97 * st.err || (typeof process !== 'undefined' && process.env && process.env.FORCEX)) st = v1; })();
  if (st.extrude) return st;
  var cov = new Uint8Array(n), res = [];
  for (var dI = 0; dI < 32; dI++) { var a = dI * Math.PI / 16, ux = Math.cos(a), uy = Math.sin(a), sc = 0, hits = 0, miss = 0, bL = 0, bS = 0, bH = 0, bM = 0; cov.fill(0);
    for (var t = 1; t <= 40; t++) { var ox = Math.round(t * ux), oy = Math.round(t * uy);
      for (var b = 0; b < bd.length; b++) { var bx = bd[b] % w, by = (bd[b] - bx) / w, qx = bx + ox, qy = by + oy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; var q = qy * w + qx;
        if (F[q] || cov[q]) continue; cov[q] = 1; sc += ev[q]; if (ev[q] > 0) hits++; else if (ev[q] < 0) miss++; }
      if (sc > bS) { bS = sc; bL = t; bH = hits; bM = miss; } }
    res.push({ ux: ux, uy: uy, len: bL, sc: bS, hits: bH, miss: bM }); }
  // (2) depth sticking out past the outline: the best sweep directions are tried as real candidates (judged by the fit, with and
  // without a soft shadow that may only have imitated the depth)
  res.sort(function (r1, r2) { return r2.sc - r1.sc; });
  var layers0 = strokes.length ? strokes.slice().reverse().map(function (z) { return { size: z.size, color: z.color.slice() }; }) : [{ size: 0, color: st.fill.slice() }];
  function colourise(e) {   // which copy shows at each depth pixel (inner copies on top), its colour near and far
    var bins = e.layers.map(function () { return [[[], [], []], [[], [], []]]; });
    for (i = 0; i < n; i++) { if (F[i] || ev[i] <= 0) continue; var xi = i % w, yi = (i - xi) / w, found = false;
      for (var li = e.layers.length - 1; li >= 0 && !found; li--) for (var t2 = 1; t2 <= e.len; t2++) { var qx2 = Math.round(xi - t2 * e.ux), qy2 = Math.round(yi - t2 * e.uy); if (qx2 < 0 || qy2 < 0 || qx2 >= w || qy2 >= h) break; var q2 = qy2 * w + qx2;
        if (G[q2] || dOut[q2] <= e.layers[li].size + 0.5) { var bb = bins[li][t2 > e.len / 2 ? 1 : 0]; for (k = 0; k < 3; k++) bb[k].push(R[3 * i + k]); found = true; break; } } }
    var keep = [];
    e.layers.forEach(function (Ly, li) { var nr = bins[li][0], fr = bins[li][1]; if (nr[0].length + fr[0].length < 20) return;
      Ly.color = [med8(nr[0].concat(fr[0])), med8(nr[1].concat(fr[1])), med8(nr[2].concat(fr[2]))];
      if (nr[0].length >= 15 && fr[0].length >= 15) { var cn = [med8(nr[0]), med8(nr[1]), med8(nr[2])], cf = [med8(fr[0]), med8(fr[1]), med8(fr[2])]; if (cdist(cn, cf) > 30) { Ly.color = cn; Ly.far = cf; } }
      keep.push(Ly); });
    e.layers = keep; return keep.length ? e : null; }
  var bestV = null;
  res.slice(0, 3).forEach(function (r) { if (r.len < 2 || r.hits < Math.max(40, 0.05 * bd.length)) return;
    [0, 1, -1, 2].forEach(function (dl) { var L2 = r.len + dl; if (L2 < 2) return;
      var e = colourise({ ux: r.ux, uy: r.uy, len: L2, layers: layers0.map(function (z) { return { size: z.size, color: z.color.slice() }; }), how: 'depth past the outline' }); if (!e) return;
      [false, true].forEach(function (dropSoft) { var v = {}; for (var key in st) v[key] = st[key]; v.extrude = e;
        if (dropSoft) { if (st.shadow) v.shadow = null; else if (st.glow && (st.glow.dx || st.glow.dy)) v.glow = null; else return; }
        v.err = FX.score(P, v); if (!bestV || v.err < bestV.err) bestV = v; }); }); });
  if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  depth sweep', JSON.stringify(res.slice(0, 3).map(function (r) { return [Math.round(Math.atan2(r.uy, r.ux) * 180 / Math.PI), r.len, r.hits, r.miss, +r.sc.toFixed(0)]; })), 'best err', bestV ? bestV.err : null, 'was', st.err);
  return bestV && bestV.err < 0.95 * st.err ? bestV : null;
};

// ---------- Radial Blur copy (the user's method): text + Outer Glow, a duplicate above it as a Smart Object with
// Filter > Blur > Radial Blur (Zoom or Spin) as a Smart Filter. Gives soft streaks pointing away from (or around) one centre. ----------
// the text layer alone (glow, outlines, letters) as premultiplied colour + alpha, 0..1
FX.layerRGBA = function (P, st) {
  var w = P.w, n = w * P.h, G = st.G, dOut = st.dOut, rgb = new Float32Array(3 * n), al = new Float32Array(n), i, ch;
  for (i = 0; i < n; i++) { var cr = 0, cg = 0, cb = 0, a = 0, t;
    if (st.glow && !G[i]) { var gx = st.glow.dx || 0, gy = st.glow.dy || 0, dg = dOut[i];
      if (gx || gy) { var qx = i % w - gx, qy = (i - i % w) / w - gy; dg = (qx < 0 || qy < 0 || qx >= w || qy >= P.h) ? 1e3 : dOut[qy * w + qx]; }
      var sh = FX.glowF(dg, st.glow.size, st.glow.spread); if (sh > 0) { var gc = st.glow.across ? FX.acrossAt(st.glow.across, i % w, (i - i % w) / w) : FX.glowColour(st.glow, sh); a = sh * st.glow.opacity; cr = a * gc[0] / 255; cg = a * gc[1] / 255; cb = a * gc[2] / 255; } }
    if (!G[i]) for (var si = st.strokes.length - 1; si >= 0; si--) { var sk = st.strokes[si]; t = Math.max(0, Math.min(1, sk.size + 1 - dOut[i])); if (t > 0) { var kc = sk.across ? FX.acrossAt(sk.across, i % w, (i - i % w) / w) : sk.color; cr = t * kc[0] / 255 + cr * (1 - t); cg = t * kc[1] / 255 + cg * (1 - t); cb = t * kc[2] / 255 + cb * (1 - t); a = t + a * (1 - t); } }
    if (G[i]) { var inIn = st.inner && st.dIn[i] <= st.inner.size + 0.5, fc = inIn ? FX.innerAt(st, i, w) : FX.faceAt(st, i, w); if (st.innerGlow && !inIn) fc = FX.innerGlowOn(st.innerGlow, fc, st.dIn[i]); t = st.fillOpacity === undefined ? 1 : st.fillOpacity;
      cr = t * fc[0] / 255 + cr * (1 - t); cg = t * fc[1] / 255 + cg * (1 - t); cb = t * fc[2] / 255 + cb * (1 - t); a = t + a * (1 - t); }
    rgb[3 * i] = cr; rgb[3 * i + 1] = cg; rgb[3 * i + 2] = cb; al[i] = a; }
  return { rgb: rgb, a: al };
};
// one pixel of the radially blurred layer: the average along the line through the centre (zoom) or the arc around it (spin)
FX.radialAt = function (L, w, h, x, y, rb, N) {
  var dx = x - rb.cx, dy = y - rb.cy, r = 0, g = 0, b = 0, a = 0, m = 0;
  for (var s = 0; s < N; s++) { var u = (s + 0.5) / N - 0.5, px, py; if (rb.side) u = rb.side * (u + 0.5);   // one-sided: only outward (+1) or inward (-1) along the ray
    if (rb.method === 'spin') { var th = u * rb.k, cs = Math.cos(th), sn = Math.sin(th); px = rb.cx + dx * cs - dy * sn; py = rb.cy + dx * sn + dy * cs; }
    else { px = rb.cx + dx * (1 + u * rb.k); py = rb.cy + dy * (1 + u * rb.k); }
    var qx = Math.round(px), qy = Math.round(py); m++; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; var q = qy * w + qx;
    r += L.rgb[3 * q]; g += L.rgb[3 * q + 1]; b += L.rgb[3 * q + 2]; a += L.a[q]; }
  return [r / m, g / m, b / m, a / m];
};
// the whole model (base text over the clean, then the blurred copy over it) at pixel i
FX.pixelRadial = function (P, st, L, i, N) {
  var c = FX.pixel(P, st, i), x = i % P.w, y = (i - x) / P.w, z = FX.radialAt(L, P.w, P.h, x, y, st.radial, N || 24), o = st.radial.opacity === undefined ? 1 : st.radial.opacity;
  return [c[0] * (1 - o * z[3]) + o * z[0], c[1] * (1 - o * z[3]) + o * z[1], c[2] * (1 - o * z[3]) + o * z[2]];
};
FX.RADIAL_K22S = 0.36;   // spin: arc (radians) of Amount 22 - measured in Photoshop 2025 on dots (0.36-0.39 rad at 100-250 px)
FX.RADIAL_K22 = 0.10;   // zoom: streak length / distance from the centre at Amount 22 - measured in Photoshop 2025 on dots (0.10 at 100-250 px)
FX.radialFit = function (P, st) {
  var w = P.w, h = P.h, n = w * h, R = P.R, G = st.G, dOut = st.dOut, i;
  var ext = Math.max(st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, st.glow ? st.glow.size * 1.3 : 0, 6) + 30, pts = [];
  var x0 = w, y0 = h, x1 = 0, y1 = 0; for (i = 0; i < n; i++) if (G[i]) { var xg = i % w, yg = (i - xg) / w; if (xg < x0) x0 = xg; if (xg > x1) x1 = xg; if (yg < y0) y0 = yg; if (yg > y1) y1 = yg; }
  if (x1 <= x0) return null;
  for (var yy = 0; yy < h; yy += 3) for (var xx = 0; xx < w; xx += 3) { var q = yy * w + xx; if (G[q] || dOut[q] <= ext) pts.push(q); }
  if (pts.length < 200) return null;
  function baseOf(s2) { var bs = new Float32Array(3 * pts.length); pts.forEach(function (q, j) { var c = FX.pixel(P, s2, q); bs[3 * j] = c[0]; bs[3 * j + 1] = c[1]; bs[3 * j + 2] = c[2]; }); return bs; }
  function errOf(bs, L, rb) { var e = 0; for (var j = 0; j < pts.length; j++) { var q = pts[j], x = q % w, y = (q - x) / w, z = rb ? FX.radialAt(L, w, h, x, y, rb, 12) : null;
      for (var ch = 0; ch < 3; ch++) { var v = z ? bs[3 * j + ch] * (1 - z[3]) + z[ch] : bs[3 * j + ch], d = v - R[3 * q + ch] / 255; d = d * d; e += d < 0.09 ? d : 0.09; } } return e / pts.length; }
  var e0 = errOf(baseOf(st), null, null), cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2, best = null;
  // the base glow is fitted together with the copy: the copy doubles the glow, so the base one is usually weaker or smaller
  var gvs = [[1, 1], [0.6, 1], [0.6, 0.7], [0.35, 1], [0.35, 0.7], [0.35, 0.5], [0.15, 0.7], [0, 0]];
  gvs.forEach(function (gv) { if (!st.glow && gv[0] !== 1) return; var s2 = {}; for (var key in st) s2[key] = st[key];
    if (st.glow) { if (gv[0] === 0) s2.glow = null; else { s2.glow = {}; for (var k2 in st.glow) s2.glow[k2] = st.glow[k2]; s2.glow.opacity = st.glow.opacity * gv[0]; s2.glow.size = Math.max(2, Math.round(st.glow.size * gv[1])); } }
    var bs = baseOf(s2), L = FX.layerRGBA(P, s2);
    [['zoom', 0], ['zoom', 1], ['zoom', -1], ['spin', 0]].forEach(function (md) { var method = md[0], ks = method === 'zoom' ? [0.06, 0.12, 0.2, 0.3, 0.45] : [0.05, 0.1, 0.2, 0.35];
      [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25]].forEach(function (o) { var cx = cx0 + o[0] * (x1 - x0), cy = cy0 + o[1] * (y1 - y0);
        ks.forEach(function (k) { var rb = { method: method, side: md[1], k: k, cx: cx, cy: cy }, e = errOf(bs, L, rb); if (!best || e < best.e) best = { rb: rb, e: e, s2: s2, bs: bs, L: L }; }); }); }); });
  if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  radial?', JSON.stringify({ e0: e0, best: best && { e: best.e, m: best.rb.method, side: best.rb.side, k: best.rb.k, cx: Math.round(best.rb.cx - cx0), cy: Math.round(best.rb.cy - cy0), glow: best.s2.glow && [best.s2.glow.opacity, best.s2.glow.size] }, pts: pts.length }));
  if (!best || best.e > 0.85 * e0) return null;
  // refine the strength and the centre
  [0.75, 0.9, 1.1, 1.3].forEach(function (f) { var rb = { method: best.rb.method, side: best.rb.side, k: best.rb.k * f, cx: best.rb.cx, cy: best.rb.cy }, e = errOf(best.bs, best.L, rb); if (e < best.e) { best.rb = rb; best.e = e; } });
  [[-0.08, 0], [0.08, 0], [0, -0.08], [0, 0.08]].forEach(function (o) { var rb = { method: best.rb.method, side: best.rb.side, k: best.rb.k, cx: best.rb.cx + o[0] * (x1 - x0), cy: best.rb.cy + o[1] * (y1 - y0) }, e = errOf(best.bs, best.L, rb); if (e < best.e) { best.rb = rb; best.e = e; } });
  var rb = best.rb; rb.amount = Math.max(1, Math.min(100, Math.round(22 * rb.k / (rb.method === 'spin' ? FX.RADIAL_K22S : FX.RADIAL_K22))));
  rb.cxRel = (rb.cx - cx0) / Math.max(1, x1 - x0); rb.cyRel = (rb.cy - cy0) / Math.max(1, y1 - y0); rb.gain = 1 - best.e / e0; rb.cx0 = cx0; rb.cy0 = cy0;
  return { rb: rb, glow: best.s2.glow };
};

// grow letter pixels from seeds through similar colours inside the changed area
FX.grow = function (P, seeds, cents) {
  var R = P.R, w = P.w, n = w * P.h, G = new Uint8Array(n), stack = [], i;
  for (i = 0; i < seeds.length; i++) { G[seeds[i]] = 1; stack.push(seeds[i]); }
  while (stack.length) {
    var pp = stack.pop(), px = pp % w, pc = [R[3 * pp], R[3 * pp + 1], R[3 * pp + 2]];
    var nbs = [px > 0 ? pp - 1 : -1, px < w - 1 ? pp + 1 : -1, pp - w, pp + w];
    for (var t = 0; t < 4; t++) {
      var qq = nbs[t]; if (qq < 0 || qq >= n || G[qq] || !P.M[qq]) continue;
      var qc = [R[3 * qq], R[3 * qq + 1], R[3 * qq + 2]], gd = 1e9;
      for (var c = 0; c < cents.length; c++) { var d5 = cdist(qc, cents[c]); if (d5 < gd) gd = d5; }
      if (cdist(qc, pc) < 26 && gd < 70) { G[qq] = 1; stack.push(qq); }
    }
  }
  // close small holes inside letters (dots, texture)
  FX.components(G, w, P.h, 0).forEach(function (c) { if (!c.touch && c.length < 80) for (var j = 0; j < c.length; j++) G[c[j]] = 1; });
  return G;
};

FX.analyzeCore = function (R, C0, w, h, opt) {
  var P = FX.prepare(R, C0, w, h, opt); if (!P) return null;
  var cands = [], k, i;
  // candidate A..: each colour group (and its neighbours in colour, for gradients) as the letter fill
  for (k = 0; k < P.K; k++) {
    if (P.cnt[k] < 0.03 * P.mi.length) continue;
    var ds = P.dl2[k].slice().sort(function (a, b) { return a - b; }), sd = 0.5 * ds[Math.floor(ds.length * 0.9)], seeds = [];
    for (i = 0; i < P.mi.length; i++) if (P.km.lab[i] === k && P.depth[P.mi[i]] >= sd) seeds.push(P.mi[i]);
    cands.push({ name: 'group' + k, G: FX.grow(P, seeds, [P.km.cents[k]]) });
  }
  // candidate F..: an outline group plus everything it encloses (letters whose face looks like the background)
  cands.slice().forEach(function (c) {
    var inv2 = new Uint8Array(w * h), gN = 0, j; for (i = 0; i < w * h; i++) { inv2[i] = c.G[i] ? 0 : 1; gN += c.G[i]; }
    var dd2 = FX.edt(inv2, w, h), Gd = new Uint8Array(w * h); for (i = 0; i < w * h; i++) Gd[i] = dd2[i] <= 2 ? 1 : 0;
    var GF = new Uint8Array(w * h), hA = 0; for (i = 0; i < w * h; i++) GF[i] = c.G[i];
    FX.components(Gd, w, h, 0).forEach(function (hc) { if (hc.touch) return; hA += hc.length; for (j = 0; j < hc.length; j++) GF[hc[j]] = 1; });
    if (hA > 0.6 * gN) { for (i = 0; i < w * h; i++) if (Gd[i] && !c.G[i]) { var x6 = i % w, nb = 0; /* keep closed gaps */ GF[i] = GF[i] || 0; } cands.push({ name: c.name + '+inside', G: GF }); }
  });
  // candidate I..: the face an outline colour goes around (gradient / textured faces inside a coloured outline)
  [2.5, 6].forEach(function (RC) { for (k = 0; k < P.K; k++) {
    if (P.cnt[k] < 0.03 * P.mi.length) continue;
    var gm = new Uint8Array(w * h), gN2 = 0; for (i = 0; i < P.mi.length; i++) if (P.km.lab[i] === k) { gm[P.mi[i]] = 1; gN2++; }
    var ig = new Uint8Array(w * h); for (i = 0; i < w * h; i++) ig[i] = gm[i] ? 0 : 1;
    var dg2 = FX.edt(ig, w, h), Gc = new Uint8Array(w * h); for (i = 0; i < w * h; i++) Gc[i] = dg2[i] <= RC ? 1 : 0;   // close gaps in the outline
    var I0 = new Uint8Array(w * h), iN = 0;
    FX.components(Gc, w, h, 0).forEach(function (hc) { if (hc.touch || hc.length < 30) return; var mN = 0, j; for (j = 0; j < hc.length; j++) if (P.M[hc[j]]) mN++;
      if (mN < 0.6 * hc.length) return; for (j = 0; j < hc.length; j++) I0[hc[j]] = 1; iN += hc.length; });   // letter counters (mostly background) stay out
    if (iN < 0.5 * gN2) continue;
    var iv = new Uint8Array(w * h); for (i = 0; i < w * h; i++) iv[i] = I0[i] ? 0 : 1;
    var di2 = FX.edt(iv, w, h), GI = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) if (I0[i] || (!gm[i] && di2[i] <= RC + 0.5)) GI[i] = 1;
    cands.push({ name: (RC > 3 ? 'insideW' : 'inside') + k, G: GI });
  } });
  // candidate P..: peel colour groups from the outside in (outline colours first); what is left is the letter face
  (function () {
    var n = w * h, Mf = new Uint8Array(n), j;
    for (i = 0; i < n; i++) Mf[i] = P.M[i];
    FX.components(P.M, w, h, 0).forEach(function (hc) { if (!hc.touch && hc.length < 150) for (j = 0; j < hc.length; j++) Mf[hc[j]] = 1; });   // halftone gaps
    var dF = FX.edt(Mf, w, h), gd = [];
    for (k = 0; k < P.K; k++) gd.push([]);
    for (i = 0; i < P.mi.length; i++) gd[P.km.lab[i]].push(dF[P.mi[i]]);
    var order = []; for (k = 0; k < P.K; k++) if (P.cnt[k] >= 0.03 * P.mi.length) order.push({ k: k, d: median(gd[k]) });
    order.sort(function (a, b) { return a.d - b.d; });
    for (var jj = 1; jj < order.length; jj++) {
      var keep = {}; for (var q = jj; q < order.length; q++) keep[order[q].k] = 1;
      var GP = new Uint8Array(n), gn = 0; for (i = 0; i < P.mi.length; i++) if (keep[P.km.lab[i]]) { GP[P.mi[i]] = 1; gn++; }
      if (gn < 0.05 * P.mi.length) break;
      FX.components(GP, w, h, 0).forEach(function (hc) { if (!hc.touch && hc.length < 150) { var mN = 0; for (j = 0; j < hc.length; j++) if (Mf[hc[j]]) mN++; if (mN > 0.5 * hc.length) for (j = 0; j < hc.length; j++) GP[hc[j]] = 1; } });
      FX.components(GP, w, h, 1).forEach(function (c2) { if (c2.length < 30) for (j = 0; j < c2.length; j++) GP[c2[j]] = 0; });
      cands.push({ name: 'peel' + jj, G: GP });
    }
  })();
  // candidate S: the strongly changed pixels themselves (letters of many colours - a rainbow - fall apart into colour groups)
  if (opt.onlyCand && /^strong/.test(opt.onlyCand)) (function () {   // only asked for by the rainbow check (as a general candidate it swallows outlines into the letters) var n = w * h, vals = [], j; for (i = 0; i < P.mi.length; i++) vals.push(P.D[P.mi[i]]); if (vals.length < 200) return; vals.sort(function (a, b) { return a - b; });
    var hi = vals[Math.floor(0.9 * vals.length)];
    [0.5, 0.35].forEach(function (fr, fi) { var thr = Math.max(1.5 * P.tD, fr * hi), GS = new Uint8Array(n), gn = 0; for (i = 0; i < P.mi.length; i++) { var q = P.mi[i]; if (P.D[q] >= thr) { GS[q] = 1; gn++; } }
      if (gn < 0.05 * P.mi.length) return;
      FX.components(GS, w, h, 0).forEach(function (hc) { if (!hc.touch && hc.length < 150) for (j = 0; j < hc.length; j++) GS[hc[j]] = 1; });
      FX.components(GS, w, h, 1).forEach(function (c2) { if (c2.length < 30) for (j = 0; j < c2.length; j++) GS[c2[j]] = 0; });
      cands.push({ name: 'strong' + fi, G: GS }); }); })();
  // candidate H: letters are the enclosed unchanged areas (fill = background colour, e.g. white on white)
  if (P.holes.length > 0.05 * P.mi.length) { var GH = new Uint8Array(w * h); P.holes.forEach(function (q) { GH[q] = 1; }); cands.push({ name: 'holes', G: GH }); }
  if (P.holes5.length > 1.15 * P.holes.length && P.holes5.length > 0.05 * P.mi.length) { var GH5 = new Uint8Array(w * h); P.holes5.forEach(function (q) { GH5[q] = 1; }); cands.push({ name: 'holes5', G: GH5 }); }
  if (opt.onlyCand) cands = cands.filter(function (c) { return c.name === opt.onlyCand; });
  var best = null;
  function judge(c, quick) {
    var st = FX.fitStyle(P, c.G, quick); if (!st) return null;
    // an outline is not a fill: if the candidate letters enclose other changed pixels, they are an outline around the real letters
    var gN = 0, inM = 0; for (i = 0; i < w * h; i++) if (c.G[i]) gN++;
    var sTot = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0;   // changed pixels inside letter holes that the outlines don't explain
    var inU = 0;
    FX.components(c.G, w, h, 0).forEach(function (hc) { if (hc.touch) return; for (var j = 0; j < hc.length; j++) if (!P.M[hc[j]]) inU++; });
    FX.components(c.G, w, h, 0).forEach(function (hc) { if (hc.touch) return; for (var j = 0; j < hc.length; j++) if (P.M[hc[j]] && st.dOut[hc[j]] > sTot + 2) inM++; });
    st.encU = inU / Math.max(1, gN);
    st.enclosed = inM / Math.max(1, gN); if (st.enclosed > 0.3) st.cost *= 1 + Math.min(1, st.enclosed);
    // the translated text's letters should be roughly as thick as the original letters (an outline is much thinner than its letters)
    if (opt.userThick >= 3 && st.thick > 0) { var lr = Math.abs(Math.log(opt.userThick / st.thick)); if (lr > Math.log(2.5)) st.cost *= 1 + 0.6 * (lr - Math.log(2.5)); }
    return st;
  }
  cands.forEach(function (c) { c.st = judge(c, true); });
  var ranked = cands.filter(function (c) { return c.st; }).sort(function (a, b) { return a.st.cost - b.st.cost; });
  ranked.slice(0, opt.finalists || 3).concat(ranked.filter(function (c) { return opt.forceFinal && c.name === opt.forceFinal; })).forEach(function (c) { var st = judge(c, false); if (st) c.st = st; if (!best || c.st.cost < best.st.cost) best = c; });
  if (!best) return null;
  function areaOf(c) { var a = 0; for (var q = 0; q < w * h; q++) if (c.G[q]) a++; return a; }
  var bestA = areaOf(best); ranked.slice(0, opt.finalists || 3).forEach(function (c) { if (c === best || !c.st || c.st.cost > 1.05 * best.st.cost || cdist(c.st.fill, best.st.fill) < 60) return; var a = areaOf(c); if (a >= 1.4 * bestA) { best = c; bestA = a; } });
  var out = best.st; out.cand = best.name; out.cands = cands.map(function (c) { return c.name + ':' + (c.st ? c.st.err.toFixed(4) : '-'); });
  out.P = P; out.C = P.C; out.align = { dx: P.align.dx, dy: P.align.dy }; out.noise = P.noise; out.tD = P.tD;
  out.clusters = P.km.cents.map(function (c6, ci) { return { c: c6.map(Math.round), n: P.cnt[ci], depth: 0 }; }); out.fillCl = []; out.levels = [];
  return out;
};

function solve4(A, b) {
  var M = A.map(function (r, i) { return r.concat([b[i]]); }), n = 4, i, j, k;
  for (i = 0; i < n; i++) {
    var p = i; for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    if (Math.abs(M[p][i]) < 1e-9) return null; var t = M[i]; M[i] = M[p]; M[p] = t;
    for (j = i + 1; j < n; j++) { var f = M[j][i] / M[i][i]; for (k = i; k <= n; k++) M[j][k] -= f * M[i][k]; }
  }
  var x = [0, 0, 0, 0]; for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
};

// re-draw the original text from its letter mask with the estimated style (to check the estimate)
FX.render = function (C0, w, h, an) {
  var n = w * h, out = new Uint8ClampedArray(3 * n);
  for (var i = 0; i < n; i++) { var c = FX.pixel(an.P, an, i); out[3 * i] = Math.round(c[0] * 255); out[3 * i + 1] = Math.round(c[1] * 255); out[3 * i + 2] = Math.round(c[2] * 255); }
  return out;
};


// ===================== filters (blur / noise) on the original text =====================
// blur a single-channel float image with a filter kernel: motion (PS angle, distance) or gaussian (sigma)
FX.kernelApply = function (src, w, h, k) {
  var n = w * h, out = new Float32Array(n), x, y, i;
  if (k.type === 'gauss') {
    var sg = k.sigma, r = Math.max(1, Math.ceil(3 * sg)), ker = [], ks = 0, j; for (j = -r; j <= r; j++) { var t = Math.exp(-j * j / (2 * sg * sg)); ker.push(t); ks += t; } ker = ker.map(function (v) { return v / ks; });
    var tmp = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var a = 0; for (j = -r; j <= r; j++) a += ker[j + r] * src[y * w + Math.min(w - 1, Math.max(0, x + j))]; tmp[y * w + x] = a; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var b = 0; for (j = -r; j <= r; j++) b += ker[j + r] * tmp[Math.min(h - 1, Math.max(0, y + j)) * w + x]; out[y * w + x] = b; }
    return out;
  }
  // motion: average along a line of length 'dist' (Photoshop angle: counter-clockwise from horizontal)
  var th = k.angle * Math.PI / 180, ux = Math.cos(th), uy = -Math.sin(th), S = Math.max(2, Math.round(k.dist * 2)), st = k.dist / S;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var acc = 0;
    for (var q = 0; q <= S; q++) { var tt = -k.dist / 2 + q * st, fx = Math.min(w - 1.001, Math.max(0, x + tt * ux)), fy = Math.min(h - 1.001, Math.max(0, y + tt * uy)), ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, p = iy * w + ix;
      acc += (src[p] * (1 - ax) + src[p + 1] * ax) * (1 - ay) + (src[p + w] * (1 - ax) + src[p + w + 1] * ax) * ay; }
    out[y * w + x] = acc / (S + 1); }
  return out;
};
// edge widths of a single-channel change map D (only where near=1): per 15-degree direction bin, plus the blur direction
FX.edgeWidths = function (D, w, h, near) {
  var n = w * h, i, x, y, gx = new Float32Array(n), gy = new Float32Array(n), gm = new Float32Array(n);
  for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; if (!near[i]) continue;
    gx[i] = (D[i + 1] - D[i - 1] + 0.5 * (D[i - w + 1] - D[i - w - 1] + D[i + w + 1] - D[i + w - 1])) / 4; gy[i] = (D[i + w] - D[i - w] + 0.5 * (D[i + w - 1] - D[i - w - 1] + D[i + w + 1] - D[i - w + 1])) / 4; gm[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]); }
  function at(fx, fy) { if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return null; var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, p = iy * w + ix; return (D[p] * (1 - ax) + D[p + 1] * ax) * (1 - ay) + (D[p + w] * (1 - ax) + D[p + w + 1] * ax) * ay; }
  var bins = []; for (var b = 0; b < 12; b++) bins.push([]); var all = [], step = Math.max(1, Math.floor(Math.sqrt(n / 60000)));
  for (y = 2; y < h - 2; y += step) for (x = 2; x < w - 2; x += step) { i = y * w + x; var g = gm[i]; if (!near[i] || g < 4) continue;
    var ux = gx[i] / g, uy = gy[i] / g, ga = gm[Math.round(y + uy) * w + Math.round(x + ux)], gb = gm[Math.round(y - uy) * w + Math.round(x - ux)]; if (g < ga || g < gb) continue;   // edge centre
    var lo = D[i], hi = D[i], prev = D[i], quiet = 0, v, t;
    for (t = 1; t <= 45; t++) { v = at(x + ux * t, y + uy * t); if (v === null) break; if (Math.abs(v - prev) < 0.2 * g) { if (++quiet >= 2) break; } else quiet = 0; prev = v; hi = v; }
    prev = D[i]; quiet = 0;
    for (t = 1; t <= 45; t++) { v = at(x - ux * t, y - uy * t); if (v === null) break; if (Math.abs(v - prev) < 0.2 * g) { if (++quiet >= 2) break; } else quiet = 0; prev = v; lo = v; }
    var A = Math.abs(hi - lo); if (A < 25) continue;
    var ang = Math.atan2(-uy, ux) * 180 / Math.PI; ang = ((ang % 180) + 180) % 180;
    bins[Math.min(11, Math.floor(ang / 15))].push(A / g); all.push(A / g); }
  var Sxx = 0, Syy = 0, Sxy = 0; for (i = 0; i < n; i++) if (near[i]) { Sxx += gx[i] * gx[i]; Syy += gy[i] * gy[i]; Sxy += gx[i] * gy[i]; }
  var tr = Sxx + Syy, dt = Math.sqrt(Math.max(0, (Sxx - Syy) * (Sxx - Syy) / 4 + Sxy * Sxy)), l1 = tr / 2 + dt, l2 = tr / 2 - dt, vx = Sxy, vy = l2 - Sxx;
  if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = Sxx < Syy ? 1 : 0; vy = Sxx < Syy ? 0 : 1; }
  var thB = Math.atan2(-vy, vx) * 180 / Math.PI; thB = ((thB % 180) + 180) % 180;
  function near2(dir, tol) { var a = []; bins.forEach(function (arr, bi) { var c = (bi + 0.5) * 15, dd = Math.abs(((c - dir) % 180 + 270) % 180 - 90); if (dd <= tol) a = a.concat(arr); }); return a.length >= 12 ? median(a) : 0; }
  return { bins: bins, all: all, dir: thB, aniso: l2 / Math.max(1e-9, l1), along: near2 };
};
// how far does each text edge take to rise from the background to the letter, in each direction?
// sharp text: 1-2 px everywhere; motion blur: long rises along one direction, short across it.
FX.blurEstimate = function (R, C, w, h, M) {
  var n = w * h, i, x, y, D0 = new Float32Array(n);
  for (i = 0; i < n; i++) D0[i] = Math.abs(FX.lum([R[3 * i], R[3 * i + 1], R[3 * i + 2]]) - FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]));
  var D = FX.kernelApply(D0, w, h, { type: 'gauss', sigma: 0.7 }), inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = M[i] ? 0 : 1;
  var dM = FX.edt(inv, w, h), pts = [];
  for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) { i = y * w + x; if (dM[i] > 8) continue; var gx = (D[i + 1] - D[i - 1]) / 2, gy = (D[i + w] - D[i - w]) / 2, g = Math.sqrt(gx * gx + gy * gy); if (g > 3) pts.push([x, y, gx / g, gy / g]); }
  if (pts.length < 60) return null;
  var stp = Math.max(1, Math.floor(pts.length / 1500));
  function at(fx, fy) { if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return -1; var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, p = iy * w + ix; return (D[p] * (1 - ax) + D[p + 1] * ax) * (1 - ay) + (D[p + w] * (1 - ax) + D[p + w + 1] * ax) * ay; }
  function rise(ang) { var th = ang * Math.PI / 180, ux = Math.cos(th), uy = -Math.sin(th), out = [], ct = Math.cos(25 * Math.PI / 180);
    for (var k = 0; k < pts.length; k += stp) { var p = pts[k], c = p[2] * ux + p[3] * uy; if (Math.abs(c) < ct) continue;
      var sx = c > 0 ? ux : -ux, sy = c > 0 ? uy : -uy, prof = [], ok = true, t;   // walk from the background side toward the letter
      for (t = -60; t <= 60; t++) { var v = at(p[0] + sx * t, p[1] + sy * t); if (v < 0) { ok = false; break; } prof.push(v); } if (!ok) continue;
      var lo = 60, hi = 60; while (lo > 0 && prof[lo - 1] < prof[lo] - 0.5) lo--; while (hi < 120 && prof[hi + 1] > prof[hi] + 0.5) hi++;
      var A = prof[hi] - prof[lo]; if (A < 30) continue; var t10 = -1, t90 = -1;
      for (t = lo; t <= hi; t++) { if (t10 < 0 && prof[t] >= prof[lo] + 0.1 * A) t10 = t; if (t90 < 0 && prof[t] >= prof[lo] + 0.9 * A) t90 = t; }
      out.push(t90 - t10); }
    return out.length > 20 ? median(out) : null; }
  var prof = [], best = -1, bestA = 0; for (var a2 = 0; a2 < 180; a2 += 15) { var r = rise(a2); prof.push(r); if (r !== null && r > best) { best = r; bestA = a2; } }
  // direction with the least change (structure tensor of the change map): the blur direction when the smear is strong
  var Sxx = 0, Syy = 0, Sxy = 0; for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; if (dM[i] > 8) continue; var ax = (D[i + 1] - D[i - 1]) / 2, ay = (D[i + w] - D[i - w]) / 2; Sxx += ax * ax; Syy += ay * ay; Sxy += ax * ay; }
  var tr = Sxx + Syy, dt = Math.sqrt(Math.max(0, (Sxx - Syy) * (Sxx - Syy) / 4 + Sxy * Sxy)), l1 = tr / 2 + dt, l2 = tr / 2 - dt, vx = Sxy, vy = l2 - Sxx;
  if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = Sxx < Syy ? 1 : 0; vy = Sxx < Syy ? 0 : 1; }
  var thS = Math.atan2(-vy, vx) * 180 / Math.PI; thS = ((thS % 180) + 180) % 180; var aniso = l2 / Math.max(1e-9, l1);
  var dirs = aniso <= 0.45 ? [Math.round(thS)] : [bestA];   // strongly one-directional change: trust the structure direction
  var pick = null; dirs.forEach(function (d) { var al = rise(d), ac = rise(d + 90); if (al === null || ac === null) return; var ratio = al / Math.max(1, ac); if (!pick || ratio > pick.ratio) pick = { dir: d, along: al, across: ac, ratio: ratio }; });
  var info = { rise: prof.map(function (v) { return v === null ? null : +v.toFixed(1); }), stDir: Math.round(thS), aniso: +aniso.toFixed(2), pick: pick };
  if (pick && pick.along >= 5 && pick.ratio >= 2.5 && aniso <= 0.5) { var a1 = ((pick.dir % 180) + 180) % 180; return { type: 'motion', angle: a1 > 90 ? a1 - 180 : a1, rise: pick.along, info: info }; }
  return { type: 'none', info: info };
};
// --- FFT (radix 2) for fast deblurring ---
function fft1(re, im, inv) {
  var n = re.length, i, j = 0, k, len;
  for (i = 1; i < n; i++) { var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (len = 2; len <= n; len <<= 1) { var ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (i = 0; i < n; i += len) { var cr = 1, ci = 0; for (k = 0; k < len / 2; k++) { var ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi; var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  if (inv) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function fft2(re, im, W, H, inv) {
  var x, y, rr = new Float64Array(W), ri = new Float64Array(W), cr = new Float64Array(H), ci = new Float64Array(H);
  for (y = 0; y < H; y++) { for (x = 0; x < W; x++) { rr[x] = re[y * W + x]; ri[x] = im[y * W + x]; } fft1(rr, ri, inv); for (x = 0; x < W; x++) { re[y * W + x] = rr[x]; im[y * W + x] = ri[x]; } }
  for (x = 0; x < W; x++) { for (y = 0; y < H; y++) { cr[y] = re[y * W + x]; ci[y] = im[y * W + x]; } fft1(cr, ci, inv); for (y = 0; y < H; y++) { re[y * W + x] = cr[y]; im[y * W + x] = ci[y]; } }
}
// undo a known blur on the text's own contribution (raw - clean) with a Wiener filter
FX.deconv = function (R, C, w, h, k, lam) {
  lam = lam || 0.01; var W2 = 1, H2 = 1, pad = Math.ceil((k.dist || 6 * (k.sigma || 1)) + 8); while (W2 < w + 2 * pad) W2 <<= 1; while (H2 < h + 2 * pad) H2 <<= 1;
  var N = W2 * H2, i, x, y, kr = new Float64Array(N), ki = new Float64Array(N), imp = new Float32Array(N);
  // the kernel's response: blur a single centred point, then move it to the origin
  var cx = W2 >> 1, cy = H2 >> 1; imp[cy * W2 + cx] = 1; var kb = FX.kernelApply(imp, W2, H2, k);
  for (y = 0; y < H2; y++) for (x = 0; x < W2; x++) { var v = kb[y * W2 + x]; if (!v) continue; kr[((y - cy + H2) % H2) * W2 + ((x - cx + W2) % W2)] = v; }
  fft2(kr, ki, W2, H2, false);
  var out = new Uint8Array(3 * w * h);
  for (var ch = 0; ch < 3; ch++) {
    var dr = new Float64Array(N), di = new Float64Array(N);
    for (y = 0; y < H2; y++) for (x = 0; x < W2; x++) { var sx = Math.min(w - 1, Math.max(0, x - pad)), sy = Math.min(h - 1, Math.max(0, y - pad)), q = sy * w + sx; dr[y * W2 + x] = R[3 * q + ch] - C[3 * q + ch]; }
    fft2(dr, di, W2, H2, false);
    for (i = 0; i < N; i++) { var a = kr[i], b = ki[i], den = a * a + b * b + lam, xr = (dr[i] * a + di[i] * b) / den, xi = (di[i] * a - dr[i] * b) / den; dr[i] = xr; di[i] = xi; }
    fft2(dr, di, W2, H2, true);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var q2 = y * w + x, o = C[3 * q2 + ch] + dr[(y + pad) * W2 + x + pad]; out[3 * q2 + ch] = o < 0 ? 0 : o > 255 ? 255 : Math.round(o); }
  }
  return out;
};
// error of a style with a filter applied, against the real original (same robust loss as FX.score)
FX.scoreFiltered = function (P0, st, k) {
  var w = P0.w, h = P0.h, n = w * h, C = P0.C, R = P0.R, ch, i, Ds = [];
  var Mo = new Float32Array(3 * n); for (i = 0; i < n; i++) { var c = FX.pixel(st.P, st, i); Mo[3 * i] = c[0] * 255; Mo[3 * i + 1] = c[1] * 255; Mo[3 * i + 2] = c[2] * 255; }
  for (ch = 0; ch < 3; ch++) { var d = new Float32Array(n); for (i = 0; i < n; i++) d[i] = Mo[3 * i + ch] - C[3 * i + ch]; Ds.push(k ? FX.kernelApply(d, w, h, k) : d); }
  var e = 0; for (var j = 0; j < P0.ev.length; j++) { i = P0.ev[j]; for (ch = 0; ch < 3; ch++) { var q = (C[3 * i + ch] + Ds[ch][i] - R[3 * i + ch]) / 255; q = q * q; e += q < 0.09 ? q : 0.09; } }
  return e / Math.max(1, P0.ev.length);
};
// grain on the letters: fine random variation inside the fill that the background doesn't have
// letter-face pixels for texture tests: deep inside the letters and away from any edge (edges are not grain or dots)
FX.faceMask = function (P, st, depth, sg, gt) {
  var w = P.w, h = P.h, n = w * h, R = P.R, G = st.G, dIn = st.dIn, i, x, y, L = new Float32Array(n);
  for (i = 0; i < n; i++) L[i] = FX.lum([R[3 * i], R[3 * i + 1], R[3 * i + 2]]);
  var S = FX.kernelApply(L, w, h, { type: 'gauss', sigma: sg || 1.2 }), flat = new Uint8Array(n).fill(1);
  for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; var gx = (S[i + 1] - S[i - 1]) / 2, gy = (S[i + w] - S[i - w]) / 2; if (gx * gx + gy * gy > (gt || 15) * (gt || 15)) flat[i] = 0; }
  var dE = FX.edt(flat, w, h), M = new Uint8Array(n), cnt = 0;   // distance to the nearest edge pixel
  for (i = 0; i < n; i++) if (G[i] && dIn[i] >= depth && dE[i] >= 2.5) { M[i] = 1; cnt++; }
  return { M: M, L: L, cnt: cnt };
};
function robustSd(a) { if (a.length < 2) return 0; var b = a.slice().sort(function (p, q) { return p - q; }), m = b[b.length >> 1]; for (var i = 0; i < b.length; i++) b[i] = Math.abs(b[i] - m); b.sort(function (p, q) { return p - q; }); return 1.4826 * b[b.length >> 1]; }
FX.noiseEstimate = function (P, st) {
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dIn = st.dIn, i, ch, vals = [[], [], []], bgv = [[], [], []];
  var F = FX.faceMask(P, st, 2.5); if (F.cnt < 200) return null;
  for (i = w + 1; i < n - w - 1; i++) { if (!F.M[i]) continue;
    for (ch = 0; ch < 3; ch++) { var hp = R[3 * i + ch] - (R[3 * (i - 1) + ch] + R[3 * (i + 1) + ch] + R[3 * (i - w) + ch] + R[3 * (i + w) + ch]) / 4, hc = C[3 * i + ch] - (C[3 * (i - 1) + ch] + C[3 * (i + 1) + ch] + C[3 * (i - w) + ch] + C[3 * (i + w) + ch]) / 4; vals[ch].push(hp); bgv[ch].push(hc); } }
  if (vals[0].length < 200) return null;
  var s = vals.map(robustSd), sb = bgv.map(robustSd), sl = (s[0] + s[1] + s[2]) / 3, sbl = (sb[0] + sb[1] + sb[2]) / 3;
  var rid = []; for (i = w + 1; i < n - w - 1; i++) if (G[i] && dIn[i] >= 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) rid.push(dIn[i]);
  if (2 * median(rid) < 6) return null;   // letters too thin to see grain inside them
  // grain shows on mid-tone faces; a pure black or pure white face only shows it as one-sided specks
  var lm = 0, ln = 0; for (i = 0; i < n; i++) if (F.M[i]) { lm += F.L[i]; ln++; } lm /= Math.max(1, ln);
  var lim = (lm < 25 || lm > 230) ? 14 : 8;
  if (sl < lim || sl < 2 * sbl + 3) return null;
  var cm = 0, cn = 0; for (i = 0; i < vals[0].length; i++) { cm += vals[0][i] * vals[1][i]; cn += vals[0][i] * vals[0][i]; } var corr = cm / Math.max(1e-9, Math.sqrt(cn * vals[1].reduce(function (a2, b2) { return a2 + b2 * b2; }, 0)));
  // high-pass of independent pixel noise keeps sqrt(1 + 1/4) of its spread
  return { type: 'noise', sigma: +(Math.sqrt(Math.max(0, sl * sl - sbl * sbl)) / 1.118).toFixed(1), mono: corr > 0.7 };
};
FX.halftoneEstimate = function (P, st) {
  var w = P.w, h = P.h, n = w * h, i, x, y, v = new Float32Array(n), cnt = 0;
  var F = FX.faceMask(P, st, 2, 3, 6), msk = F.M;   // smoothed hard so the dots themselves do not count as edges
  cnt = F.cnt; if (cnt < 800) return null;
  // a screentone needs both light and dark inside the faces
  var lv = []; for (i = 0; i < n; i++) if (msk[i]) lv.push(F.L[i]); lv.sort(function (p, q) { return p - q; });
  if (lv[Math.floor(lv.length * 0.9)] - lv[Math.floor(lv.length * 0.1)] < 40) return null;
  for (i = 0; i < n; i++) v[i] = F.L[i];
  var bx = FX.kernelApply(v, w, h, { type: 'gauss', sigma: 4 }), e0 = 0;   // keep only the fine texture (dots), not slow shading
  for (i = 0; i < n; i++) { v[i] -= bx[i]; if (msk[i]) e0 += v[i] * v[i]; } if (e0 / cnt < 40) return null;   // too flat to hold dots
  var best = null, all = [], stp = Math.max(1, Math.floor(Math.sqrt(cnt / 20000)));
  for (var dy = 0; dy <= 18; dy++) for (var dx = -18; dx <= 18; dx++) { var r2 = dx * dx + dy * dy; if (r2 < 9 || r2 > 324 || (dy === 0 && dx < 0)) continue; var sab = 0, saa = 0, sbb = 0;
    for (y = 0; y < h - dy; y += stp) for (x = Math.max(0, -dx); x < Math.min(w, w - dx); x += stp) { i = y * w + x; var j = i + dy * w + dx; if (!msk[i] || !msk[j]) continue; sab += v[i] * v[j]; saa += v[i] * v[i]; sbb += v[j] * v[j]; }
    var r = sab / Math.max(1e-9, Math.sqrt(saa * sbb)); all.push({ r: r, dx: dx, dy: dy, r2: r2 }); if (!best || r > best.r) best = { r: r, dx: dx, dy: dy }; }
  if (!best || best.r < 0.4) return null;
  // the strongest repeat can be two or three dots away: take the nearest one that is almost as strong (one dot step)
  all.forEach(function (o) { if (o.r >= 0.85 * best.r && o.r2 < best.dx * best.dx + best.dy * best.dy) best = { r: o.r, dx: o.dx, dy: o.dy }; });
  // dots repeat: somewhere inside one dot step (the middle of the cell) the pattern is in opposite phase
  var b2 = best.dx * best.dx + best.dy * best.dy, minR = 1; all.forEach(function (o) { if (o.r2 <= b2 && o.r < minR) minR = o.r; });
  if (minR > -0.2) return null;
  // the letters must be wide enough to hold a few dots across, and the repeat must go both ways (a grid of dots, not stripes or rows of letters)
  var rid = [], G = st.G, dIn = st.dIn; for (i = w + 1; i < n - w - 1; i++) if (G[i] && dIn[i] >= 1 && dIn[i] >= dIn[i - 1] && dIn[i] >= dIn[i + 1] && dIn[i] >= dIn[i - w] && dIn[i] >= dIn[i + w]) rid.push(dIn[i]);
  if (2 * median(rid) < 2.2 * Math.sqrt(best.dx * best.dx + best.dy * best.dy)) return null;
  var out = { type: 'halftone', period: +Math.sqrt(best.dx * best.dx + best.dy * best.dy).toFixed(1), angle: Math.round(Math.atan2(-best.dy, best.dx) * 180 / Math.PI), strength: +best.r.toFixed(2) };
  // --- the dot grid itself, so it can be rebuilt: exact step (sub-pixel), where the dots sit, their size and colour ---
  function corrAt(dx, dy) { var sa = 0, sa2 = 0, sb2 = 0; for (y = Math.max(0, -dy); y < Math.min(h, h - dy); y += stp) for (x = Math.max(0, -dx); x < Math.min(w, w - dx); x += stp) { i = y * w + x; var j3 = i + dy * w + dx; if (!msk[i] || !msk[j3]) continue; sa += v[i] * v[j3]; sa2 += v[i] * v[i]; sb2 += v[j3] * v[j3]; } return sa / Math.max(1e-9, Math.sqrt(sa2 * sb2)); }
  function para(m, z, q) { var d = 2 * (2 * z - m - q); return d > 1e-6 ? Math.max(-0.5, Math.min(0.5, (q - m) / d)) : 0; }
  var ax = best.dx + para(corrAt(best.dx - 1, best.dy), best.r, corrAt(best.dx + 1, best.dy)), ay = best.dy + para(corrAt(best.dx, best.dy - 1), best.r, corrAt(best.dx, best.dy + 1));
  var rb = corrAt(-best.dy, best.dx);   // the other direction of a dot grid (square grid)
  if (rb < 0.6 * best.r) return null;   // stripes or rows, not a dot screen
  var p2 = ax * ax + ay * ay, pp = Math.sqrt(p2);
  // which way the dots go: a few bright peaks (light dots) or a few dark ones
  var m3 = 0, m2 = 0, vs = []; for (i = 0; i < n; i++) if (msk[i]) { m2 += v[i] * v[i]; m3 += v[i] * v[i] * v[i]; vs.push(v[i]); }
  var sg = m3 >= 0 ? 1 : -1; vs = vs.map(function (q) { return q * sg; }).sort(function (q1, q2) { return q1 - q2; });
  var lo = vs[Math.floor(vs.length * 0.05)], hi = vs[Math.floor(vs.length * 0.95)], thr = (lo + hi) / 2, above = 0;
  for (i = 0; i < vs.length; i++) if (vs[i] > thr) above++;
  var cov = above / vs.length, NB = 12, acc = new Float64Array(NB * NB), num = new Float64Array(NB * NB), dotC = [0, 0, 0], dn = 0, faceC = [0, 0, 0], fn = 0, R = P.R;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; if (!msk[i]) continue;
    var u = (x * ax + y * ay) / p2, t = (-x * ay + y * ax) / p2, bu = Math.floor((u - Math.floor(u)) * NB) % NB, bt = Math.floor((t - Math.floor(t)) * NB) % NB;
    acc[bt * NB + bu] += v[i] * sg; num[bt * NB + bu]++;
    var vv = v[i] * sg; if (vv >= 0.8 * hi) { dotC[0] += R[3 * i]; dotC[1] += R[3 * i + 1]; dotC[2] += R[3 * i + 2]; dn++; } else if (vv <= lo + 0.2 * (hi - lo)) { faceC[0] += R[3 * i]; faceC[1] += R[3 * i + 1]; faceC[2] += R[3 * i + 2]; fn++; } }
  var bestB = -1, bestV = -1e9; for (var b1 = 0; b1 < NB * NB; b1++) { var su = 0, sn = 0, bx1 = b1 % NB, by1 = (b1 - bx1) / NB;
    for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) { var q = ((by1 + oy + NB) % NB) * NB + (bx1 + ox + NB) % NB; su += acc[q]; sn += num[q]; }
    var mv = su / Math.max(1, sn); if (mv > bestV) { bestV = mv; bestB = b1; } }
  if (!dn || !fn) return out;
  out.grid = { ax: +ax.toFixed(3), ay: +ay.toFixed(3), pu: ((bestB % NB) + 0.5) / NB, pt: (Math.floor(bestB / NB) + 0.5) / NB,
    r: +Math.min(0.48 * pp, pp * Math.sqrt(cov / Math.PI)).toFixed(2), cover: +cov.toFixed(3), light: sg > 0,
    dot: dotC.map(function (c) { return Math.round(c / dn); }), face: faceC.map(function (c) { return Math.round(c / fn); }), other: +rb.toFixed(2) };
  return out;
};
// alpha (0..1) of the rebuilt dot grid at a point (same coordinates as the analysis area)
FX.dotAlpha = function (g, x, y) {
  var p2 = g.ax * g.ax + g.ay * g.ay, u = (x * g.ax + y * g.ay) / p2 - g.pu, t = (-x * g.ay + y * g.ax) / p2 - g.pt;
  var du = u - Math.round(u), dt = t - Math.round(t), d = Math.sqrt((du * du + dt * dt) * p2);
  return Math.max(0, Math.min(1, g.r + 0.5 - d));
};

// ---------- details drawn inside the letters: lines, highlights, cracks, small shapes on the letter faces ----------
// The letter colour is known from the fit; whatever inside the letter shapes is clearly not that colour is a detail.
// Thin cuts (a streak that reaches the letter edge first looks like 'outside') are closed before looking.
FX.innerDetails = function (P, st) {
  if (!st || !st.G || st.dots || st.halftone || st.fillOpacity < 0.95) return null;
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, i, x, y;
  var sOut = st.strokes && st.strokes.length ? st.strokes[0].size : 0, rc = sOut ? Math.min(3.5, 0.9 * sOut) : 3.5;
  var dil = new Uint8Array(n); for (i = 0; i < n; i++) dil[i] = (G[i] || st.dOut[i] <= rc) ? 1 : 0;
  var dE = FX.edt(dil, w, h), B = new Uint8Array(n), nb = 0;
  for (i = 0; i < n; i++) if (dil[i] && dE[i] > rc) { if (G[i] || cdist([R[3 * i], R[3 * i + 1], R[3 * i + 2]], [C[3 * i], C[3 * i + 1], C[3 * i + 2]]) > 40) { B[i] = 1; nb++; } }
  if (nb < 200) return null;
  var dB = FX.edt(B, w, h), skin = st.inner ? st.inner.size + 1 : 0, face = [], cand = [];
  for (i = 0; i < n; i++) if (B[i] && dB[i] >= 1.5 + skin) { face.push(i); var F = FX.fillAt(st, i, w), e = cdist([R[3 * i], R[3 * i + 1], R[3 * i + 2]], F); if (e > 45) cand.push([e, i]); }
  if (face.length < 150 || cand.length < Math.max(40, 0.015 * face.length)) return null;
  cand.sort(function (a, b) { return b[0] - a[0]; });
  var top = cand.slice(0, Math.max(20, Math.floor(cand.length * 0.4))), c3 = [[], [], []];
  top.forEach(function (q) { c3[0].push(R[3 * q[1]]); c3[1].push(R[3 * q[1] + 1]); c3[2].push(R[3 * q[1] + 2]); });
  var D = [med8(c3[0]), med8(c3[1]), med8(c3[2])], a = new Float32Array(n);
  if (cdist(D, st.gradient ? st.gradient.top : st.fill) < 50 && cdist(D, st.gradient ? st.gradient.bottom : st.fill) < 50) return null;
  face.forEach(function (q) { var F = FX.fillAt(st, q, w), v0 = D[0] - F[0], v1 = D[1] - F[1], v2 = D[2] - F[2], L2 = v0 * v0 + v1 * v1 + v2 * v2; if (L2 < 900) return;
    var t = ((R[3 * q] - F[0]) * v0 + (R[3 * q + 1] - F[1]) * v1 + (R[3 * q + 2] - F[2]) * v2) / L2;
    // the pixel must also look like the detail colour, not just 'not the letter colour'
    var px = [F[0] + t * v0, F[1] + t * v1, F[2] + t * v2]; if (cdist([R[3 * q], R[3 * q + 1], R[3 * q + 2]], px) > 50) return;
    a[q] = t < 0.15 ? 0 : t > 1 ? 1 : t; });
  // drop specks (grain, JPEG noise): keep pieces of at least 8 px
  var lab = new Int32Array(n).fill(-1), sizes = [], stack = [];
  for (i = 0; i < n; i++) { if (a[i] < 0.4 || lab[i] >= 0) continue; var id = sizes.length, cnt = 0; lab[i] = id; stack.push(i);
    while (stack.length) { var q = stack.pop(); cnt++; x = q % w; y = (q - x) / w;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var r2 = yy * w + xx; if (a[r2] >= 0.4 && lab[r2] < 0) { lab[r2] = id; stack.push(r2); } } }
    sizes.push(cnt); }
  var area = 0; for (i = 0; i < n; i++) { if (!a[i]) continue; if (lab[i] < 0 || sizes[lab[i]] < 8) { a[i] = 0; continue; } area += a[i]; }
  if (area < Math.max(30, 0.01 * face.length)) return null;
  // marks are drawn ON letters: the letters must be thick enough to carry them (in thin text, gaps between strokes look the same),
  // each mark thinner than the letter strokes, and together they cover a minority of the faces (else it is shading, not marks)
  var rid = []; for (i = w + 1; i < n - w - 1; i++) if (B[i] && dB[i] >= 1 && dB[i] >= dB[i - 1] && dB[i] >= dB[i + 1] && dB[i] >= dB[i - w] && dB[i] >= dB[i + w]) rid.push(dB[i]);
  var letterW = 2 * median(rid); if (letterW < 10 || 2 * rc > 0.5 * letterW) return null;
  var mk = new Uint8Array(n); for (i = 0; i < n; i++) mk[i] = a[i] >= 0.4 ? 1 : 0; var dM = FX.edt(mk, w, h), mThick = {};
  for (i = 0; i < n; i++) if (mk[i] && lab[i] >= 0) { var tk = 2 * dM[i]; if (!(mThick[lab[i]] > tk)) mThick[lab[i]] = tk; }
  area = 0; for (i = 0; i < n; i++) { if (!a[i]) continue; if (lab[i] >= 0 && mThick[lab[i]] > 0.6 * letterW) { a[i] = 0; continue; } area += a[i]; }
  if (area < Math.max(30, 0.01 * face.length) || area > 0.18 * face.length) return null;
  // the letters themselves, one by one, to carry their details over to the new letters
  var lb = new Int32Array(n).fill(-1), boxes = [];
  for (i = 0; i < n; i++) { if (!B[i] || lb[i] >= 0) continue; var id2 = boxes.length, bx = { x0: w, y0: h, x1: 0, y1: 0, n: 0, id: id2 }; lb[i] = id2; stack.push(i);
    while (stack.length) { var q2 = stack.pop(), x2 = q2 % w, y2 = (q2 - x2) / w; bx.n++; if (x2 < bx.x0) bx.x0 = x2; if (x2 > bx.x1) bx.x1 = x2; if (y2 < bx.y0) bx.y0 = y2; if (y2 > bx.y1) bx.y1 = y2;
      for (var ey = -1; ey <= 1; ey++) for (var ex = -1; ex <= 1; ex++) { var x3 = x2 + ex, y3 = y2 + ey; if (x3 < 0 || y3 < 0 || x3 >= w || y3 >= h) continue; var r3 = y3 * w + x3; if (B[r3] && lb[r3] < 0) { lb[r3] = id2; stack.push(r3); } } }
    boxes.push(bx); }
  var mx = Math.max.apply(null, boxes.map(function (z) { return z.n; })), big = boxes.filter(function (b2) { return b2.n >= 0.15 * mx; }), bigId = {}, bodyN = 0;
  big.forEach(function (b2) { bigId[b2.id] = b2; bodyN += b2.n; });
  var lh = big.map(function (b2) { return b2.y1 - b2.y0 + 1; }).sort(function (p1, p2) { return p1 - p2; }), letterH = lh[lh.length >> 1];
  // each mark (line, crack, highlight): its pixels around its centre, and where it sits in its letter
  var sl = new Int32Array(n).fill(-1), sprites = [];
  for (i = 0; i < n; i++) { if (a[i] < 0.25 || sl[i] >= 0) continue; var pix = [], sid = sprites.length; sl[i] = sid; stack.push(i);
    while (stack.length) { var q3 = stack.pop(), x4 = q3 % w, y4 = (q3 - x4) / w; pix.push(q3);
      for (var fy = -1; fy <= 1; fy++) for (var fx = -1; fx <= 1; fx++) { var x5 = x4 + fx, y5 = y4 + fy; if (x5 < 0 || y5 < 0 || x5 >= w || y5 >= h) continue; var r5 = y5 * w + x5; if (a[r5] >= 0.25 && sl[r5] < 0) { sl[r5] = sid; stack.push(r5); } } }
    var cxs = 0, cys = 0, wsum = 0; pix.forEach(function (q4) { cxs += (q4 % w) * a[q4]; cys += Math.floor(q4 / w) * a[q4]; wsum += a[q4]; });
    if (wsum < 6) { sprites.push(null); continue; }
    var cx = cxs / wsum, cy = cys / wsum, par = bigId[lb[Math.round(cy) * w + Math.round(cx)]] || null;
    if (!par) { var votes = {}; pix.forEach(function (q4) { var L4 = lb[q4]; if (bigId[L4]) votes[L4] = (votes[L4] || 0) + 1; }); var bestL = null; for (var key in votes) if (!bestL || votes[key] > votes[bestL]) bestL = key; par = bestL !== null ? bigId[bestL] : null; }
    if (!par) { sprites.push(null); continue; }
    sprites.push({ p: pix.map(function (q4) { return [q4 % w - cx, Math.floor(q4 / w) - cy, a[q4]]; }), rx: (cx - par.x0) / Math.max(1, par.x1 - par.x0), ry: (cy - par.y0) / Math.max(1, par.y1 - par.y0), area: wsum }); }
  sprites = sprites.filter(function (z) { return z; });
  if (!sprites.length || !bodyN) return null;
  return { color: D, alpha: a, sprites: sprites, density: sprites.length / bodyN, letterH: letterH, w: w, h: h, cover: +(area / face.length).toFixed(3), marks: sprites.length };
};
// carry the details over to the new text the way an artist would: the same marks (each line, crack or highlight keeps its own
// shape and angle), the same number of marks per letter, each placed inside a new letter where it fits (deterministic).
// A: the new text's alpha (0..1) in the same area as the analysis.
FX.detailsFor = function (det, A, w, h) {
  var n = w * h, i, x, y, out = new Float32Array(n), lab = new Int32Array(n).fill(-1), comps = [], stack = [];
  for (i = 0; i < n; i++) { if (A[i] < 0.5 || lab[i] >= 0) continue; var id = comps.length, b = { x0: w, y0: h, x1: 0, y1: 0, n: 0, id: id, px: [] }; lab[i] = id; stack.push(i);
    while (stack.length) { var q = stack.pop(); x = q % w; y = (q - x) / w; b.n++; b.px.push(q); if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var r = yy * w + xx; if (A[r] >= 0.5 && lab[r] < 0) { lab[r] = id; stack.push(r); } } }
    comps.push(b); }
  if (!comps.length || !det.sprites.length) return out;
  var hs = comps.map(function (c) { return c.y1 - c.y0 + 1; }).sort(function (p, q) { return p - q; }), hMed = hs[hs.length >> 1];
  comps = comps.filter(function (c) { return c.y1 - c.y0 + 1 >= 0.35 * hMed; });   // dots and small marks stay plain
  var sc = Math.max(0.5, Math.min(2, hMed / det.letterH));   // new letters vs original letters
  var used = new Float32Array(n), S = det.sprites, si = 0, seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  comps.sort(function (p, q) { return p.x0 - q.x0; }).forEach(function (c) {
    var want = Math.max(1, Math.round(det.density * c.n / (sc * sc)));
    for (var k = 0; k < want; k++) { var sp = S[si++ % S.length], best = null;
      // the mark's own place in its letter first, then nearby spots, then anywhere in the letter
      var tx0 = c.x0 + sp.rx * (c.x1 - c.x0), ty0 = c.y0 + sp.ry * (c.y1 - c.y0);
      for (var tr = 0; tr < 60; tr++) { var tx = tr ? (tr < 25 ? tx0 + (rnd() - 0.5) * 0.5 * (c.x1 - c.x0) : c.x0 + rnd() * (c.x1 - c.x0)) : tx0, ty = tr ? (tr < 25 ? ty0 + (rnd() - 0.5) * 0.5 * (c.y1 - c.y0) : c.y0 + rnd() * (c.y1 - c.y0)) : ty0;
        var inside = 0, tot = 0, ov = 0;
        for (var j = 0; j < sp.p.length; j += 2) { var px = Math.round(tx + sp.p[j][0] * sc), py = Math.round(ty + sp.p[j][1] * sc); tot++; if (px < 0 || py < 0 || px >= w || py >= h) continue; var r2 = py * w + px; if (lab[r2] === c.id) inside++; if (used[r2] > 0.3) ov++; }
        var fit = inside / Math.max(1, tot) - 0.5 * ov / Math.max(1, tot);
        if (!best || fit > best.fit) best = { fit: fit, x: tx, y: ty }; if (fit > 0.9) break; }
      if (!best || best.fit < 0.6) continue;
      // draw the mark (scaled), filling the gaps a scale-up would leave
      var rr = Math.max(1, Math.ceil(sc));
      sp.p.forEach(function (pt) { for (var oy = 0; oy < rr; oy++) for (var ox = 0; ox < rr; ox++) { var px2 = Math.round(best.x + pt[0] * sc + ox), py2 = Math.round(best.y + pt[1] * sc + oy); if (px2 < 0 || py2 < 0 || px2 >= w || py2 >= h) continue; var r3 = py2 * w + px2; if (pt[2] > out[r3]) out[r3] = pt[2]; used[r3] = 1; } });
    } });
  return out;
};
// ---------- text that fades out (toward one side): a gradient layer mask is the right tool ----------
// How strongly the letter colour shows over what's behind, fitted as a straight ramp across the text.
FX.fadeEstimate = function (P, st) {
  if (!st || !st.G || st.inner) return null;
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dIn = st.dIn, i, pts = [];
  // the colour the letters have where they are fully shown: the fill, or the gradient end that stands out most from what is behind
  var F0 = st.fill;
  if (st.gradient) { var mc = [0, 0, 0], mn = 0; for (i = 0; i < n; i++) if (G[i]) { mc[0] += C[3 * i]; mc[1] += C[3 * i + 1]; mc[2] += C[3 * i + 2]; mn++; }
    mc = mc.map(function (v) { return v / Math.max(1, mn); }); F0 = cdist(st.gradient.top, mc) >= cdist(st.gradient.bottom, mc) ? st.gradient.top : st.gradient.bottom; }
  for (i = 0; i < n; i++) if (G[i] && dIn[i] >= 1.5) { var v0 = F0[0] - C[3 * i], v1 = F0[1] - C[3 * i + 1], v2 = F0[2] - C[3 * i + 2], L2 = v0 * v0 + v1 * v1 + v2 * v2; if (L2 < 3600) continue;
    pts.push([i % w, Math.floor(i / w), ((R[3 * i] - C[3 * i]) * v0 + (R[3 * i + 1] - C[3 * i + 1]) * v1 + (R[3 * i + 2] - C[3 * i + 2]) * v2) / L2, i]); }
  if (pts.length < 300) return null;
  var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0], m = 0, vv = 0;
  pts.forEach(function (p) { var r = [1, p[0], p[1]]; for (var a2 = 0; a2 < 3; a2++) { bv[a2] += r[a2] * p[2]; for (var b2 = 0; b2 < 3; b2++) S[a2][b2] += r[a2] * r[b2]; } m += p[2]; vv += p[2] * p[2]; });
  var sol = solve3(S, bv); if (!sol) return null;
  var x0 = w, x1 = 0, y0 = h, y1 = 0; pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
  var corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(function (c) { return sol[0] + sol[1] * c[0] + sol[2] * c[1]; });
  var vHi = Math.max.apply(null, corners), vLo = Math.min.apply(null, corners);
  var mean = m / pts.length, sst = vv - pts.length * mean * mean, sse = 0; pts.forEach(function (p) { var e = p[2] - (sol[0] + sol[1] * p[0] + sol[2] * p[1]); sse += e * e; });
  var r2 = sst > 1e-9 ? 1 - sse / sst : 0;
  if (!(vHi > 0.8 && vLo < 0.6 && vHi - vLo >= 0.3 && r2 > 0.6)) return null;   // a real fade is a smooth ramp: it explains most of the change (two different texts side by side do not)
  // a fade lets the picture behind show through more and more; a colour ramp does not - compare both explanations
  var ef = 0, eg = 0; pts.forEach(function (p) { var q = p[3], vh = Math.max(0, Math.min(1, sol[0] + sol[1] * p[0] + sol[2] * p[1])), F = FX.fillAt(st, q, w);
    for (var c = 0; c < 3; c++) { var mf = vh * F0[c] + (1 - vh) * C[3 * q + c] - R[3 * q + c], mg = F[c] - R[3 * q + c]; ef += mf * mf; eg += mg * mg; } });
  if (ef > 0.75 * eg) return null;
  var gx = sol[1], gy = sol[2], gl = Math.sqrt(gx * gx + gy * gy); if (gl < 1e-6) return null;
  // a real fade takes the outline with it: the outline must be weaker on the faded side too
  if (st.strokes && st.strokes.length) { var oc = st.strokes[st.strokes.length - 1].color, sz = st.strokes[st.strokes.length - 1].size, hiS = [], loS = [], mid = (x0 + x1) / 2 * gx + (y0 + y1) / 2 * gy;
    for (i = 0; i < n; i++) { if (G[i] || st.dOut[i] < 1 || st.dOut[i] > sz - 0.5) continue; var u0 = oc[0] - C[3 * i], u1 = oc[1] - C[3 * i + 1], u2 = oc[2] - C[3 * i + 2], M2 = u0 * u0 + u1 * u1 + u2 * u2; if (M2 < 3600) continue;
      var vs = ((R[3 * i] - C[3 * i]) * u0 + (R[3 * i + 1] - C[3 * i + 1]) * u1 + (R[3 * i + 2] - C[3 * i + 2]) * u2) / M2, pos = (i % w) * gx + Math.floor(i / w) * gy;
      (pos > mid ? hiS : loS).push(vs); }
    if (hiS.length < 50 || loS.length < 50 || median(loS) > 0.75 * median(hiS)) return null; }
  return { dir: [-gx / gl, -gy / gl], vHi: Math.min(1, +vHi.toFixed(2)), vLo: Math.max(0, +vLo.toFixed(2)), r2: +r2.toFixed(2), box: [x0, y0, x1, y1], lin: sol, gain: +(eg / Math.max(1e-9, ef)).toFixed(1) };
};
// the text as it would look without the fade (to read its real colours and outline)
FX.defade = function (P, fd) {
  var w = P.w, h = P.h, R = P.R, C = P.C, out = new Uint8Array(R.length), x, y, c;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var i = y * w + x, v = Math.max(0.2, Math.min(1, fd.lin[0] + fd.lin[1] * x + fd.lin[2] * y));
    for (c = 0; c < 3; c++) { var o = C[3 * i + c] + (R[3 * i + c] - C[3 * i + c]) / v; out[3 * i + c] = o < 0 ? 0 : o > 255 ? 255 : Math.round(o); } }
  return out;
};
// the fade mask for the new text: 0..1 per pixel over a box (doc or region coordinates), same direction and strength
FX.fadeMaskAt = function (fd, box, x, y) {
  var cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, hw = (box[2] - box[0]) / 2, hh = (box[3] - box[1]) / 2;
  var ext = Math.abs(fd.dir[0]) * hw + Math.abs(fd.dir[1]) * hh, t = ext > 0 ? ((x - cx) * fd.dir[0] + (y - cy) * fd.dir[1]) / ext : 0;   // -1 .. 1 along the fade
  var v = fd.vHi + (fd.vLo - fd.vHi) * (t + 1) / 2; return v < 0 ? 0 : v > 1 ? 1 : v;
};
// ---------- when the Clean layer is not a cleaned copy of this page (another picture, another crop) ----------
// The background behind the original text is estimated from the raw itself: letters are thin, so a wide median removes them.
FX.pseudoClean = function (R, w, h, rad) {
  var f = Math.max(1, Math.round(rad / 6)), sw = Math.ceil(w / f), sh = Math.ceil(h / f), sm = new Float32Array(sw * sh * 3), x, y, c, i, buf = [];
  function med(a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }
  for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) for (c = 0; c < 3; c++) { buf.length = 0;
    for (var yy = y * f; yy < Math.min(h, (y + 1) * f); yy++) for (var xx = x * f; xx < Math.min(w, (x + 1) * f); xx++) buf.push(R[3 * (yy * w + xx) + c]);
    sm[3 * (y * sw + x) + c] = med(buf.slice()); }
  var r2 = Math.max(2, Math.round(rad / f)), md = new Float32Array(sw * sh * 3);
  for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) for (c = 0; c < 3; c++) { buf.length = 0;
    for (var dy = -r2; dy <= r2; dy++) for (var dx = -r2; dx <= r2; dx++) { var x2 = x + dx, y2 = y + dy; if (x2 < 0 || y2 < 0 || x2 >= sw || y2 >= sh || dx * dx + dy * dy > r2 * r2) continue; buf.push(sm[3 * (y2 * sw + x2) + c]); }
    md[3 * (y * sw + x) + c] = med(buf.slice()); }
  var out = new Uint8Array(w * h * 3);
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var fx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / f - 0.5)), fy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / f - 0.5)), ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, ix2 = Math.min(sw - 1, ix + 1), iy2 = Math.min(sh - 1, iy + 1);
    for (c = 0; c < 3; c++) out[3 * (y * w + x) + c] = Math.round(md[3 * (iy * sw + ix) + c] * (1 - ax) * (1 - ay) + md[3 * (iy * sw + ix2) + c] * ax * (1 - ay) + md[3 * (iy2 * sw + ix) + c] * (1 - ax) * ay + md[3 * (iy2 * sw + ix2) + c] * ax * ay); }
  return out;
};
// ---------- art in front of the original text (a hand, a character): where the text must go BEHIND ----------
// Where the rebuilt text would clearly change the picture (its outline, its glow) but the raw shows exactly the clean, something
// is in front of the text. That something is traced in the Clean layer from those spots (smooth colour steps, its own colours,
// stopped by line-art) and becomes a layer mask: the new text goes behind it.
FX.occluder = function (P, st) {
  if (!st || !st.G || st.cleanNote) return null;
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, i, x, y, k, j;
  // solid letter parts only: thin streaks or specks taken as 'letter' (background bits in the letters' colour) would fake an outline that seems hidden
  var gTot = 0; for (i = 0; i < n; i++) if (G[i]) gTot++;
  var Gs = new Uint8Array(n); FX.components(G, w, h, 1).forEach(function (c) { var mx = 0; for (var q = 0; q < c.length; q++) if (st.dIn[c[q]] > mx) mx = st.dIn[c[q]];
    if (c.length >= 0.005 * gTot && mx >= 2.5) for (q = 0; q < c.length; q++) Gs[c[q]] = 1; });
  // and an opening (2.5 px): thin streaks stuck to the letters go, the letters stay
  var invE = new Uint8Array(n); for (i = 0; i < n; i++) invE[i] = Gs[i] && st.dIn[i] >= 2.5 ? 0 : 1; var dE = FX.edt(invE, w, h);
  for (i = 0; i < n; i++) if (Gs[i] && invE[i] && dE[i] > 2.6) Gs[i] = 0;
  var invS = new Uint8Array(n); for (i = 0; i < n; i++) invS[i] = Gs[i] ? 0 : 1;
  var dOut = FX.edt(invS, w, h), stS = {}; for (var key in st) stS[key] = st[key]; stS.G = Gs; stS.dOut = dOut; stS.dIn = FX.edt(Gs, w, h);
  // only where the text surely shows: its outline and the strong inner part of its glow (a fitted glow's faint tail can be a bit off)
  // (the outline's last pixel is skipped: a size off by one there would look 'hidden')
  var sEnd = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, zone = sEnd >= 3 ? sEnd - 1 : Math.max(2, st.glow ? 0.4 * st.glow.size : 0);
  var keyCols = [st.fill].concat(st.strokes.map(function (s) { return s.color; })); if (st.gradient) keyCols.push(st.gradient.top, st.gradient.bottom);
  var reg = P.opt && P.opt.region;
  function chg(q) { return (Math.abs(R[3 * q] - C[3 * q]) + Math.abs(R[3 * q + 1] - C[3 * q + 1]) + Math.abs(R[3 * q + 2] - C[3 * q + 2])) / 3; }
  // 1. spots where the text should show clearly but the raw is the clean
  var hidS = new Uint8Array(n), expN = 0, hid = 0;
  for (i = 0; i < n; i++) { if (G[i] || dOut[i] < 1 || dOut[i] > zone || (reg && !reg[i])) continue;
    var mc = FX.pixel(P, stS, i), e = (Math.abs(255 * mc[0] - C[3 * i]) + Math.abs(255 * mc[1] - C[3 * i + 1]) + Math.abs(255 * mc[2] - C[3 * i + 2])) / 3;
    if (e < 45) continue; expN++; if (chg(i) > 12) continue;
    var c3 = [C[3 * i], C[3 * i + 1], C[3 * i + 2]], left = false; for (k = 0; k < keyCols.length; k++) if (cdist(c3, keyCols[k]) < 45) left = true;
    if (left) continue;   // the clean still has the text's own colour here: a leftover of the cleaning, not an object
    hidS[i] = 1; hid++; }
  if (hid < 60 || hid < 0.03 * expN) return null;
  // the plain background around the text (beyond its effects, raw = clean there): spots that look just like it are not an object -
  // only the text's effect being weaker there than the redraw assumed
  var outer = Math.max(sEnd + 6, st.glow ? st.glow.size * 1.1 : 0);
  function bgSample(away) { var pts3 = []; for (i = 0; i < n; i += 3) if (!G[i] && dOut[i] > outer && dOut[i] <= outer + 10 && (!away || away[i] > 40) && chg(i) <= 12 && (!reg || reg[i])) pts3.push(i);
    return pts3.length >= 40 ? kmeans(C, pts3, 4, 6).cents : []; }
  var bgC = bgSample(null);
  function bgLike(q) { var c4 = [C[3 * q], C[3 * q + 1], C[3 * q + 2]]; for (var b5 = 0; b5 < bgC.length; b5++) if (cdist(c4, bgC[b5]) < 30) return true; return false; }
  // keep solid groups only (8-connected, >= 30 px): specks are noise
  var occ = new Uint8Array(n), stack = [], kept = 0, lab = new Uint8Array(n);
  for (i = 0; i < n; i++) { if (!hidS[i] || lab[i]) continue; var comp = []; lab[i] = 1; stack.push(i);
    while (stack.length) { var q = stack.pop(); comp.push(q); x = q % w; y = (q - x) / w;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var r2 = yy * w + xx; if (hidS[r2] && !lab[r2]) { lab[r2] = 1; stack.push(r2); } } }
    if (typeof process !== 'undefined' && process.env && process.env.DBGO && comp.length >= 30) { var bx = [w, h, 0, 0]; comp.forEach(function (q9) { var x9 = q9 % w, y9 = (q9 - x9) / w; bx[0] = Math.min(bx[0], x9); bx[1] = Math.min(bx[1], y9); bx[2] = Math.max(bx[2], x9); bx[3] = Math.max(bx[3], y9); }); console.log('   hidden group', comp.length, 'box', bx.join(','), 'clean', [C[3 * comp[0]], C[3 * comp[0] + 1], C[3 * comp[0] + 2]].join(','), 'dOut', dOut[comp[0]].toFixed(1)); }
    var nb = 0; for (j = 0; j < comp.length; j++) if (bgLike(comp[j])) nb++;
    if (comp.length >= 30 && nb < 0.6 * comp.length) { for (j = 0; j < comp.length; j++) occ[comp[j]] = 1; kept += comp.length; } }
  if (kept < 60) return null;
  // the object's own colours (not its line-art): up to 3 groups
  var pts = []; for (i = 0; i < n; i++) if (occ[i] && FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]) >= 70) pts.push(i);
  if (pts.length < 20) for (i = 0; i < n; i++) if (occ[i]) pts.push(i);
  var cents = kmeans(C, pts, Math.min(3, Math.max(1, Math.floor(pts.length / 40))), 6).cents || [];
  if (!cents.length) { var sm = [[], [], []]; pts.forEach(function (q5) { sm[0].push(C[3 * q5]); sm[1].push(C[3 * q5 + 1]); sm[2].push(C[3 * q5 + 2]); }); cents = [[med8(sm[0]), med8(sm[1]), med8(sm[2])]]; }
  // 2. grow through the object in the clean: small colour steps, near its colours, raw = clean there, stopped by line-art and the text;
  // then its line-art (the text goes behind the hand's outline too); then across thin inner lines (finger lines) into more of its colours
  var area = kept;
  // its line-art colour (dark spots among the first ones): the trace only takes dark pixels of that colour as its outline
  var ik = [[], [], []]; for (i = 0; i < n; i++) if (occ[i] && FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]) < 80) { ik[0].push(C[3 * i]); ik[1].push(C[3 * i + 1]); ik[2].push(C[3 * i + 2]); }
  var inkC = ik[0].length >= 15 ? [med8(ik[0]), med8(ik[1]), med8(ik[2])] : null;
  function isInk(q) { var c6 = [C[3 * q], C[3 * q + 1], C[3 * q + 2]]; return FX.lum(c6) < 80 && (!inkC || cdist(c6, inkC) <= 45); }
  function nearCol(cc) { var nr = 1e9; for (var j2 = 0; j2 < cents.length; j2++) nr = Math.min(nr, cdist(cc, cents[j2])); return nr; }
  function grow(tight) { for (i = 0; i < n; i++) if (occ[i]) stack.push(i);
    while (stack.length) { var p3 = stack.pop(); x = p3 % w; y = (p3 - x) / w; var pc = [C[3 * p3], C[3 * p3 + 1], C[3 * p3 + 2]], fromInk = isInk(p3);
      for (k = 0; k < 4; k++) { var x2 = x + (k === 0 ? 1 : k === 1 ? -1 : 0), y2 = y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue; var r4 = y2 * w + x2;
        if (occ[r4] || G[r4] || (reg && !reg[r4])) continue; var cc = [C[3 * r4], C[3 * r4 + 1], C[3 * r4 + 2]];
        if (FX.lum(cc) < 60 || chg(r4) > 20) continue;
        var ok = !fromInk && cdist(cc, pc) <= 22 && nearCol(cc) <= 55;   // a smooth step inside one colour area
        if (!ok && tight) ok = nearCol(cc) <= 25;   // across a hard shading edge or a thin inner line: only into the object's own colours
        if (!ok) continue;
        occ[r4] = 1; area++; stack.push(r4); } } }
  function inkPass(deep) { for (var pass = 0; pass < deep; pass++) { var add = [];
      for (i = 0; i < n; i++) { if (occ[i] || G[i] || !isInk(i) || chg(i) > 20) continue; x = i % w; y = (i - x) / w;
        if ((x > 0 && occ[i - 1]) || (x < w - 1 && occ[i + 1]) || (y > 0 && occ[i - w]) || (y < h - 1 && occ[i + w])) add.push(i); }
      add.forEach(function (q4) { occ[q4] = 1; area++; }); } }
  // from here on the background is sampled away from the object (it usually reaches out beyond the text too)
  var invK = new Uint8Array(n); for (i = 0; i < n; i++) invK[i] = occ[i] ? 0 : 1; bgC = bgSample(FX.edt(invK, w, h));
  grow(false);
  // the object's colours again, now from all of it (the first spots were mostly near its edge)
  var pts2 = []; for (i = 0; i < n; i += 2) if (occ[i] && FX.lum([C[3 * i], C[3 * i + 1], C[3 * i + 2]]) >= 70) pts2.push(i);
  if (pts2.length >= 60) { var c2 = kmeans(C, pts2, 4, 6).cents; if (c2 && c2.length) cents = c2; }
  inkPass(5); grow(true); inkPass(5); grow(true); inkPass(3);
  if (area < 150) return null;
  // how much of the letters' visible edge it cuts (letter pixels touching it)
  var cut = 0; for (i = 0; i < n; i++) { if (!Gs[i]) continue; x = i % w; y = (i - x) / w;
    if ((x > 1 && occ[i - 2]) || (x < w - 2 && occ[i + 2]) || (y > 1 && occ[i - 2 * w]) || (y < h - 2 && occ[i + 2 * w]) || (x > 0 && occ[i - 1]) || (x < w - 1 && occ[i + 1]) || (y > 0 && occ[i - w]) || (y < h - 1 && occ[i + w])) cut++; }
  var inv = new Uint8Array(n); for (i = 0; i < n; i++) inv[i] = occ[i] ? 0 : 1; var dO = FX.edt(inv, w, h);
  var m = new Float32Array(n); for (i = 0; i < n; i++) m[i] = occ[i] ? 1 : Math.max(0, 1 - dO[i]);   // 1 px soft edge, like the art's own anti-aliasing
  var big = cents[0]; return { mask: m, area: area, seedColour: big.map(function (v) { return Math.round(v); }), cutEdge: cut, hidden: kept };
};
// ---------- match score: the rebuilt style drawn on the ORIGINAL letters, compared with the original ----------
// 100 = the original text looks exactly reproduced; 0 = no better than no text at all. Points lost are split by where they are lost.
FX.matchScore = function (P, st) {
  var LR = st.radial ? FX.layerRGBA(P, st) : null;   // with a Radial Blur copy the whole model is drawn (base + blurred copy)
  var w = P.w, h = P.h, n = w * h, R = P.R, C = P.C, G = st.G, dOut = st.dOut, dIn = st.dIn, i;
  var sEnd = st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0, gEnd = st.glow ? (st.glow.dx || st.glow.dy ? st.glow.size + Math.sqrt(st.glow.dx * st.glow.dx + st.glow.dy * st.glow.dy) : st.glow.size * 1.2) : 0;
  var shEnd = 0; (st.moreShadows || []).concat(st.shadow ? [st.shadow] : []).forEach(function (s) { shEnd = Math.max(shEnd, s.size * 1.2 + Math.sqrt(s.dx * s.dx + s.dy * s.dy)); });
  if (st.extrude) shEnd = Math.max(shEnd, st.extrude.len + (st.strokes.length ? st.strokes[st.strokes.length - 1].size : 0) + 1);
  // the zone also covers everything the raw changed around the letters (an effect the redraw misses must cost too, not fall outside)
  var rings = [], kr, rawReach = 0; for (kr = 0; kr <= 80; kr++) rings.push([]);
  for (i = 0; i < n; i += 2) { if (G[i] || dOut[i] > 80 || (P.opt && P.opt.region && !P.opt.region[i])) continue; rings[Math.ceil(dOut[i])].push(Math.abs(R[3 * i] - C[3 * i]) + Math.abs(R[3 * i + 1] - C[3 * i + 1]) + Math.abs(R[3 * i + 2] - C[3 * i + 2])); }
  // (a Clean layer that differs everywhere - other screentone, a tint - is not the text's effect: compare with the far rings' level)
  var kMax = 0; for (kr = 1; kr <= 80; kr++) if (rings[kr].length >= 20) kMax = kr;
  var far = []; for (kr = Math.max(1, kMax - 8); kr <= kMax; kr++) far = far.concat(rings[kr]); var bgLev = far.length ? median(far) : 0;
  for (kr = 1; kr <= 80; kr++) { if (rings[kr].length < 20 || median(rings[kr]) < Math.max(12, 1.5 * bgLev + 6)) break; rawReach = kr; }
  var ext = Math.max(sEnd, gEnd, shEnd, rawReach, 3) + 2, base = 0, lost = { fill: 0, edges: 0, outline: 0, glow: 0 };
  for (i = 0; i < n; i++) { if (P.opt && P.opt.region && !P.opt.region[i]) continue; if (!G[i] && dOut[i] > ext) continue;
    var c = (LR ? FX.pixelRadial(P, st, LR, i) : FX.pixel(P, st, i)), e = (Math.abs(R[3 * i] - 255 * c[0]) + Math.abs(R[3 * i + 1] - 255 * c[1]) + Math.abs(R[3 * i + 2] - 255 * c[2])) / 3,
      b = (Math.abs(R[3 * i] - C[3 * i]) + Math.abs(R[3 * i + 1] - C[3 * i + 1]) + Math.abs(R[3 * i + 2] - C[3 * i + 2])) / 3;
    base += b;
    if (G[i]) lost[dIn[i] >= 1.5 ? 'fill' : 'edges'] += e; else lost[dOut[i] <= 1.5 ? 'edges' : dOut[i] <= sEnd ? 'outline' : 'glow'] += e; }
  if (base <= 0) return null;
  var out = { score: 0, lost: {}, zone: Math.round(ext) }, tot = 0; for (var key in lost) { out.lost[key] = Math.round(100 * lost[key] / base * 10) / 10; tot += lost[key]; }
  out.score = Math.max(0, Math.min(100, Math.round(100 * (1 - tot / base))));
  return out;
};
FX.analyze = function (R, C0, w, h, opt) {
  opt = opt || {};
  var st = FX.analyzeCore(R, C0, w, h, opt);
  // the original text is explained badly: maybe the Clean layer here is a different picture - compare with a background made from the raw
  var cleanFits = false;
  // (judged on the outer band of the area, outside what changed: there a right Clean layer is the raw itself; a different picture differs nearly everywhere)
  if (st && st.P) { var PPc = st.P.C, PM = st.P.M, bwd = Math.max(4, Math.round(0.12 * Math.min(w, h))), bv = [], bN = 0;
    for (var yb = 0; yb < h; yb += 2) for (var xb = 0; xb < w; xb += 2) { if (xb >= bwd && xb < w - bwd && yb >= bwd && yb < h - bwd) continue; var qb = yb * w + xb; bN++; if (PM[qb]) continue;
      bv.push((Math.abs(R[3 * qb] - PPc[3 * qb]) + Math.abs(R[3 * qb + 1] - PPc[3 * qb + 1]) + Math.abs(R[3 * qb + 2] - PPc[3 * qb + 2])) / 3); }
    bv.sort(function (p1, p2) { return p1 - p2; });
    cleanFits = bv.length > 50 && bv.length >= 0.3 * bN && bv[Math.floor(0.75 * bv.length)] <= 6; }
  if (opt.pseudo !== false && !cleanFits && (!st || st.err > 0.05)) {
    var o4 = {}; for (var k4 in opt) o4[k4] = opt[k4]; delete o4.big; o4.pseudo = false; o4.aligned = true;
    var PC = FX.pseudoClean(R, w, h, Math.max(8, 1.6 * (opt.userThick || 10))), s4 = FX.analyzeCore(R, PC, w, h, o4);
    if (s4 && (!st || s4.err < 0.75 * st.err)) { s4.cleanNote = 'the Clean layer does not match the original page here - used a background estimated from the raw' + (st ? ' (fit ' + st.err.toFixed(3) + ' -> ' + s4.err.toFixed(3) + ')' : ''); st = s4; }
  }
  if (!st) return null;
  st.filters = []; st.notes = [];
  if (opt.noFilters) return st;
  var P = st.P, kb = FX.blurEstimate(P.R, P.C, w, h, P.M);
  st.blurInfo = kb ? kb.info : null;
  if (kb && kb.type === 'motion') st.suggest = { type: 'motion', angle: kb.angle, dist: Math.round(2.5 * kb.rise), why: kb.info };
  if (opt.autoBlur && kb && (kb.type === 'motion' || kb.type === 'gauss')) {
    var e0 = FX.scoreFiltered(P, st, null), best = null;
    var seen = {}, tries = kb.type === 'motion' ? [1.3, 2.2, 3.2, 4.5].map(function (f) { return { type: 'motion', angle: kb.angle, dist: Math.min(90, Math.max(3, Math.round(kb.rise * f))) }; }).filter(function (k) { if (seen[k.dist]) return false; seen[k.dist] = 1; return true; })
      : [0.75, 1, 1.3].map(function (f) { return { type: 'gauss', sigma: Math.max(0.6, +(kb.sigma * f).toFixed(1)) }; });
    var stop = false;
    tries.forEach(function (k) { if (stop) return;
      var Rs = FX.deconv(P.R, P.C, w, h, k, 0.08), o2 = {}; for (var key in opt) o2[key] = opt[key]; o2.aligned = true; o2.noFilters = true; o2.focus = opt.focus; o2.region = P.opt.region;
      var s2 = FX.analyzeCore(Rs, P.C, w, h, o2); if (!s2) return;
      var e2 = FX.scoreFiltered(P, s2, k); if (typeof process !== 'undefined' && process.env && process.env.DBGF) console.log('  filter try', JSON.stringify(k), 'err', e2.toFixed(4), 'vs none', e0.toFixed(4)); if (!best || e2 < best.e) best = { e: e2, st: s2, k: k }; if (e2 > 1.15 * e0 && best.e > 1.05 * e0) stop = true;
    });
    if (best && best.e < 0.9 * e0) {
      var keep = best.st; keep.filters = [best.k]; keep.notes = []; keep.blurInfo = kb.info; keep.errNoFilter = e0; keep.errFilter = best.e;
      keep.P0 = P; st = keep;
    }
  }
  // a text that fades out: take the fade away, read the style of the full-strength text, keep the fade as a gradient mask
  var Pd = null;
  if (opt.fade !== false) { var Pq = st.P0 || P, fd = FX.fadeEstimate(Pq, st);
    if (fd) { var Rf = FX.defade(Pq, fd), o3 = {}; for (var key3 in opt) o3[key3] = opt[key3]; o3.aligned = true; o3.noFilters = true; o3.region = Pq.opt.region;
      var s3 = FX.analyzeCore(Rf, Pq.C, w, h, o3);
      if (s3) { s3.filters = st.filters; s3.notes = st.notes; s3.suggest = st.suggest; s3.blurInfo = st.blurInfo; s3.P0 = Pq; Pd = s3.P; st = s3; }
      st.fade = fd; } }
  var nz = FX.noiseEstimate(st.P0 || P, st); if (nz) st.filters.push(nz);
  var ht = FX.halftoneEstimate(Pd || st.P0 || P, st); if (ht) st.halftone = ht;
  // a clear dot screen in the letter faces: rebuild it (a layer of dots clipped to the text), and take the dots out of the face colour
  if (ht && ht.grid && opt.dots !== false && ht.strength >= 0.6 && ht.grid.cover > 0.03 && ht.grid.cover < 0.6) { var g = ht.grid; st.dots = g;
    var unmix = function (c) { return c.map(function (v, j) { return Math.max(0, Math.min(255, Math.round((v - g.cover * g.dot[j]) / (1 - g.cover)))); }); };
    if (st.gradient) { st.gradient.top = unmix(st.gradient.top); st.gradient.bottom = unmix(st.gradient.bottom); } else st.fill = unmix(st.fill); }
  if (opt.details !== false) { var det = FX.innerDetails(Pd || st.P0 || P, st); if (det) st.details = det; }
  if (opt.extrude !== false) { try { var xv = FX.extrusionFit(st.P, st); if (xv && xv.extrude) st = xv; } catch (e) { if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  extrude error', e.message); } }
  if (opt.across !== false) { try { var av = FX.acrossFit(st.P, st); if (av) st = av;
      // rainbow letters: colour groups cut them apart, so the letters may be better found as 'everything that clearly changed'
      var stIG = null;
      if (st.fillAcross && st.fillAcross.range >= 100 && !opt.onlyCand) ['strong0', 'strong1'].forEach(function (nm) { if (st.cand === nm) return;
        if (!stIG) stIG = (opt.innerGlow !== false ? FX.innerGlowFit(st.P, st) : null) || st;   // both sides judged with their soft inner shading
        var o5 = {}; for (var k5 in opt) o5[k5] = opt[k5]; o5.onlyCand = nm; o5.aligned = true; o5.noFilters = true; delete o5.big;
        var s5 = FX.analyzeCore(st.P.R, st.P.C, w, h, o5); if (!s5) return; s5 = FX.acrossFit(s5.P, s5) || s5; if (opt.innerGlow !== false) s5 = FX.innerGlowFit(s5.P, s5) || s5; var e5 = FX.score(st.P, s5);
        if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  rainbow letters as', nm, 'err', e5, 'vs', st.err);
        if (e5 < 0.95 * stIG.err) { ['filters', 'notes', 'suggest', 'blurInfo', 'P0', 'fade', 'halftone', 'dots', 'details', 'cleanNote', 'extrude'].forEach(function (k6) { if (st[k6] !== undefined) s5[k6] = st[k6]; }); s5.P = st.P; s5.err = e5; st = s5; } });
    } catch (e) { if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  across error', e.message); } }
  if (opt.split !== false) { try { var spv = FX.splitFit(st.P, st); if (spv) st = spv; } catch (e) { if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  split error', e.message); } }
  if (opt.innerGlow !== false && !st.split) { try { var igv = FX.innerGlowFit(st.P, st); if (igv) st = igv; } catch (e) { if (typeof process !== 'undefined' && process.env && process.env.DBGA) console.log('  inner glow error', e.message); } }
  if (opt.radial !== false) { try { var rbf = FX.radialFit(st.P, st); if (rbf) { st.radial = rbf.rb; st.glow = rbf.glow; } } catch (e) { if (typeof process !== 'undefined' && process.env && process.env.DBGX) console.log('  radial error', e.message); } }
  if (opt.occlusion !== false) { try { var oc = FX.occluder(st.P, st); if (oc) st.occluder = oc; } catch (e) { } }
  try { st.match = FX.matchScore(st.P, st); } catch (e) { st.match = null; }
  return st;
};
if (typeof module !== 'undefined') module.exports = FX;
