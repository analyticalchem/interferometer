/* FTIR Interferometer: line charts on canvas. One canvas can hold several panels stacked on a shared
 * width. Long curves (thousands of points) are drawn one pixel column at a time, from the lowest to the
 * highest value in that column, so fast fringes show as a solid band instead of aliasing.
 * Colours and sizes come from the CSS tokens (refresh). Exposes window.Charts.
 */
(function (root) {
  'use strict';

  var MINUS = '−';
  var tok = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Re-read colours and drawing sizes; call after a theme or presentation change. */
  function refresh() {
    tok = {
      surface: cssVar('--surface'), text: cssVar('--text-primary'), text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      font: parseFloat(cssVar('--chart-font')) || 12, fontSmall: parseFloat(cssVar('--chart-font-small')) || 11,
      line: parseFloat(cssVar('--chart-line')) || 2, lineTotal: parseFloat(cssVar('--chart-line-total')) || 2.5,
      marker: parseFloat(cssVar('--chart-marker')) || 5, halo: parseFloat(cssVar('--chart-halo')) || 4,
      family: cssVar('--font') || 'system-ui, sans-serif'
    };
  }

  /** A colour token or a literal; 'var:--series-a' style names are read live. */
  function color(c) {
    if (!c) return tok.text;
    if (c.charAt(0) === '-') return cssVar(c);
    return c;
  }

  function niceStep(span, target) {
    var raw = Math.abs(span) / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
  }

  function fmtTick(v, step) {
    var d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    if (v < 0 && Number(Math.abs(v).toFixed(d)) !== 0) s = MINUS + s;
    return s;
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d'), W = 0, H = 0, dpr = 1, last = null;

    function layout() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      dpr = root.devicePixelRatio || 1;
      var w = Math.round(r.width), h = Math.round(r.height);
      if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) {
        W = w; H = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      return true;
    }

    function haloText(text, x, y, fill) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = tok.halo;
      ctx.strokeStyle = tok.surface;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill || tok.text;
      ctx.fillText(text, x, y);
    }

    /** spec = { panels: [panel], gap }; see drawPanel for a panel's fields. */
    function draw(spec) {
      if (spec) last = spec;
      spec = last;
      if (!spec || !layout()) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = tok.surface;
      ctx.fillRect(0, 0, W, H);
      var panels = spec.panels, gap = spec.gap === undefined ? 10 : spec.gap, total = 0, i;
      for (i = 0; i < panels.length; i++) total += panels[i].weight || 1;
      var y = 0, avail = H - gap * (panels.length - 1);
      for (i = 0; i < panels.length; i++) {
        var h = avail * (panels[i].weight || 1) / total;
        drawPanel(panels[i], y, h);
        y += h + gap;
      }
    }

    /**
     * panel = {
     *   x: { min, max, title, ticks (optional values), fmt(v), top: { title, ticks: [{ at, label }] } },
     *   y: { min, max, title, fmt(v) },
     *   bands: [{ x0, x1, color, label }], hlines: [{ y, color, dash }], vlines: [{ x, color, dash, width }],
     *   series: [{ x0, dx, y (array), xs (array, instead of x0/dx), color, width, dash, fill ('zero', wash colour) }],
     *   markers: [{ x, y, color, hollow }], notes: [{ x, y, text, below }], message,
     *   bars: [{ x, y0, y1, color, label }]   (a wash with an outline from y0 to y1, labelled beside it)
     * }
     */
    function drawPanel(p, top0, h) {
      var hasTop = !!(p.x.top && p.x.top.ticks);
      var m = {
        left: 58, right: W < 420 ? 16 : 24,
        top: hasTop ? tok.fontSmall + tok.font + 18 : 12,
        bottom: p.x.title ? tok.fontSmall + tok.font + 22 : tok.fontSmall + 14
      };
      var L = m.left, R = W - m.right, T = top0 + m.top, B = top0 + h - m.bottom;
      if (B - T < 20 || R - L < 40) return;
      var xmin = p.x.min, xmax = p.x.max, ymin = p.y.min, ymax = p.y.max;
      function X(v) { return L + (v - xmin) / (xmax - xmin) * (R - L); }
      function Y(v) { return B - (v - ymin) / (ymax - ymin) * (B - T); }

      // Bands (washes), then the grid.
      (p.bands || []).forEach(function (b) {
        var x0 = Math.max(Math.min(X(b.x0), X(b.x1)), L), x1 = Math.min(Math.max(X(b.x0), X(b.x1)), R);
        if (x1 <= x0) return;
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color(b.color);
        ctx.fillRect(x0, T, x1 - x0, B - T);
        ctx.restore();
        if (b.label) {
          ctx.font = tok.fontSmall + 'px ' + tok.family;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          haloText(b.label, (x0 + x1) / 2, T + 3, tok.text2);
        }
      });

      ctx.lineWidth = 1;
      ctx.font = tok.fontSmall + 'px ' + tok.family;
      var xstep = niceStep(xmax - xmin, Math.max(2, Math.floor((R - L) / 80)));
      var xt = p.x.ticks || [];
      if (!p.x.ticks) {
        var lo = Math.min(xmin, xmax), hi = Math.max(xmin, xmax);
        for (var v = Math.ceil(lo / xstep) * xstep; v <= hi + xstep * 1e-6; v += xstep) xt.push(Math.abs(v) < xstep * 1e-9 ? 0 : v);
      }
      var ystep = niceStep(ymax - ymin, Math.max(2, Math.floor((B - T) / 40)));
      var yt = [];
      for (var w = Math.ceil(ymin / ystep) * ystep; w <= ymax + ystep * 1e-6; w += ystep) yt.push(Math.abs(w) < ystep * 1e-9 ? 0 : w);

      ctx.strokeStyle = tok.grid;
      ctx.beginPath();
      xt.forEach(function (v) {
        var x = Math.round(X(v)) + 0.5;
        if (x < L - 1 || x > R + 1) return;
        ctx.moveTo(x, T);
        ctx.lineTo(x, B);
      });
      yt.forEach(function (v) { var y = Math.round(Y(v)) + 0.5; ctx.moveTo(L, y); ctx.lineTo(R, y); });
      ctx.stroke();

      (p.hlines || []).forEach(function (l) {
        if (l.y < Math.min(ymin, ymax) || l.y > Math.max(ymin, ymax)) return;
        ctx.save();
        ctx.strokeStyle = color(l.color || '--text-secondary');
        ctx.lineWidth = l.width || 1.5;
        ctx.setLineDash(l.dash || []);
        ctx.beginPath();
        ctx.moveTo(L, Y(l.y));
        ctx.lineTo(R, Y(l.y));
        ctx.stroke();
        ctx.restore();
      });

      // Axes and tick labels.
      ctx.strokeStyle = tok.axis;
      ctx.beginPath();
      ctx.moveTo(L + 0.5, T);
      ctx.lineTo(L + 0.5, B + 0.5);
      ctx.lineTo(R, B + 0.5);
      ctx.stroke();
      ctx.fillStyle = tok.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var xf = p.x.fmt || function (v) { return fmtTick(v, xstep); };
      var placed = [];
      xt.forEach(function (v) {
        var x = X(v), s = xf(v), tw = ctx.measureText(s).width;
        if (x < L - 1 || x > R + 1) return;
        // Skip a label that would collide with one already placed.
        if (placed.some(function (q) { return x - tw / 2 < q[1] + 6 && x + tw / 2 > q[0] - 6; })) return;
        ctx.fillText(s, x, B + 5);
        placed.push([x - tw / 2, x + tw / 2]);
      });
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var yf = p.y.fmt || function (v) { return fmtTick(v, ystep); };
      yt.forEach(function (v) { ctx.fillText(yf(v), L - 6, Y(v)); });

      ctx.font = tok.font + 'px ' + tok.family;
      ctx.fillStyle = tok.text2;
      if (p.x.title) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(p.x.title, (L + R) / 2, B + 5 + tok.fontSmall + 5);
      }
      if (p.y.title) {
        ctx.save();
        ctx.translate(L - 6 - maxWidth(yt.map(yf)) - 8, (T + B) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(p.y.title, 0, 0);
        ctx.restore();
      }
      if (hasTop) {
        ctx.strokeStyle = tok.axis;
        ctx.beginPath();
        ctx.moveTo(L, T - 0.5);
        ctx.lineTo(R, T - 0.5);
        ctx.stroke();
        ctx.font = tok.fontSmall + 'px ' + tok.family;
        ctx.fillStyle = tok.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        var used = [];
        p.x.top.ticks.forEach(function (t) {
          var x = X(t.at);
          if (x < L - 1 || x > R + 1) return;
          var tw = ctx.measureText(t.label).width;
          if (used.some(function (u) { return Math.abs(u - x) < tw + 6; })) return;
          used.push(x);
          ctx.strokeStyle = tok.axis;
          ctx.beginPath();
          ctx.moveTo(x, T);
          ctx.lineTo(x, T - 4);
          ctx.stroke();
          ctx.fillText(t.label, x, T - 5);
        });
        ctx.font = tok.font + 'px ' + tok.family;
        ctx.fillStyle = tok.text2;
        ctx.textBaseline = 'top';
        ctx.fillText(p.x.top.title, (L + R) / 2, top0 + 2);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(L, T - 1, R - L, B - T + 2);
      ctx.clip();

      // Bars go under the series, so a line and marker at the bar's top stay on top of it.
      var barW = Math.max(12, tok.marker * 3);
      (p.bars || []).forEach(function (b) {
        var x = X(b.x), ya = Y(b.y0), yb = Y(b.y1);
        if (!isFinite(ya) || !isFinite(yb) || x < L - barW || x > R + barW) return;
        var top = Math.min(ya, yb), ht = Math.max(1, Math.abs(ya - yb));
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color(b.color);
        ctx.fillRect(x - barW / 2, top, barW, ht);
        ctx.restore();
        ctx.strokeStyle = color(b.color);
        ctx.lineWidth = Math.max(1.5, tok.line * 0.75);
        ctx.setLineDash([]);
        ctx.strokeRect(x - barW / 2, top, barW, ht);
      });

      (p.series || []).forEach(function (s) { drawSeries(s, X, Y, xmin, xmax, L, R); });

      (p.vlines || []).forEach(function (l) {
        var x = X(l.x);
        if (x < L - 1 || x > R + 1) return;
        ctx.strokeStyle = color(l.color || '--text-secondary');
        ctx.lineWidth = l.width || 1.5;
        ctx.setLineDash(l.dash || []);
        ctx.beginPath();
        ctx.moveTo(x, T);
        ctx.lineTo(x, B);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      (p.markers || []).forEach(function (mk) {
        var x = X(mk.x), y = Y(mk.y);
        if (!isFinite(y)) return;
        ctx.beginPath();
        ctx.arc(x, y, tok.marker, 0, 2 * Math.PI);
        ctx.fillStyle = mk.hollow ? tok.surface : color(mk.color);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = mk.hollow ? color(mk.color) : tok.surface;
        ctx.stroke();
      });
      ctx.restore();

      // A bar's label beside it at half its height, on the side with more room.
      (p.bars || []).forEach(function (b) {
        var x = X(b.x), ym = Y((b.y0 + b.y1) / 2);
        if (!b.label || !isFinite(ym) || x < L || x > R) return;
        ctx.font = '600 ' + tok.font + 'px ' + tok.family;
        ctx.textBaseline = 'middle';
        var toRight = x < (L + R) / 2;
        ctx.textAlign = toRight ? 'left' : 'right';
        var y = Math.max(T + tok.font / 2 + 2, Math.min(B - tok.font / 2 - 2, ym));
        haloText(b.label, toRight ? x + barW / 2 + 6 : x - barW / 2 - 6, y, tok.text);
      });

      // Value callouts, larger first, skipping any that would overlap one already placed.
      if (p.notes && p.notes.length) {
        ctx.font = '600 ' + tok.fontSmall + 'px ' + tok.family;
        ctx.textAlign = 'center';
        var boxes = [];
        p.notes.forEach(function (n) {
          var x = X(n.x), y = Y(n.y), tw = ctx.measureText(n.text).width, th = tok.fontSmall + 2;
          if (x < L || x > R) return;
          var ty = n.below ? Math.min(B - 2, y + 6 + th) : Math.max(T + th + 2, y - 6);
          var box = { x0: x - tw / 2 - 2, x1: x + tw / 2 + 2, y0: ty - th, y1: ty };
          if (box.x0 < L) { box.x1 += L - box.x0; x += L - box.x0; box.x0 = L; }
          if (box.x1 > R) { box.x0 -= box.x1 - R; x -= box.x1 - R; box.x1 = R; }
          if (boxes.some(function (b) { return box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0; })) return;
          boxes.push(box);
          ctx.textBaseline = 'bottom';
          haloText(n.text, x, ty, tok.text);
        });
      }

      if (p.message) {
        ctx.font = tok.font + 'px ' + tok.family;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(p.message, (L + R) / 2, (T + B) / 2, Math.min(R - L - 20, 420));
      }
    }

    function maxWidth(labels) {
      var m = 0;
      labels.forEach(function (s) { m = Math.max(m, ctx.measureText(s).width); });
      return m;
    }

    function wrapText(text, x, y, width) {
      var words = text.split(' '), lines = [], line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
      });
      if (line) lines.push(line);
      var lh = tok.font * 1.35, y0 = y - (lines.length - 1) * lh / 2;
      lines.forEach(function (l, i) { haloText(l, x, y0 + i * lh, tok.text2); });
    }

    function drawSeries(s, X, Y, xmin, xmax, L, R) {
      var n = s.xs ? s.xs.length : s.y.length;
      var i0 = 0, i1 = n - 1;
      if (!s.xs) {
        // Only the points inside the axis range (plus one either side).
        var a = (Math.min(xmin, xmax) - s.x0) / s.dx, b = (Math.max(xmin, xmax) - s.x0) / s.dx;
        i0 = Math.max(0, Math.floor(Math.min(a, b)) - 1);
        i1 = Math.min(n - 1, Math.ceil(Math.max(a, b)) + 1);
      }
      if (s.i0 !== undefined) i0 = Math.max(i0, s.i0);
      if (s.i1 !== undefined) i1 = Math.min(i1, s.i1);
      if (!isFinite(i0) || !isFinite(i1) || i1 < i0) return;   // nothing recorded (a scan's retrace)
      var pts = [];               // [px, y] pairs after column binning; null breaks the line
      // Zoomed in, a smooth series is drawn pixel by pixel between its samples (band-limited
      // interpolation, or its own function), instead of as straight lines from sample to sample.
      // Zoomed out, with several samples to a pixel, it is drawn from its samples like any other.
      if (!s.xs && (s.fn || s.smooth) && Math.abs(X(s.x0 + s.dx) - X(s.x0)) > 1.5) {
        smoothPoints(s, i0, i1, X, Y, xmin, xmax, L, R, pts);
        stroke(s, pts, Y);
        return;
      }
      var col = null, cnt = 0, first, mn, mx, lastY, lastX;
      function flush() {
        if (col === null) return;
        if (cnt === 1) pts.push([lastX, first]);
        else { pts.push([col, first]); pts.push([col, mn]); pts.push([col, mx]); pts.push([col, lastY]); }
        col = null; cnt = 0;
      }
      for (var i = i0; i <= i1; i++) {
        var xv = s.xs ? s.xs[i] : s.x0 + i * s.dx, yv = s.y[i];
        if (!isFinite(yv) || !isFinite(xv)) { flush(); pts.push(null); continue; }
        var px = X(xv), py = Y(yv), c = Math.round(px);
        if (c !== col) { flush(); col = c; cnt = 0; first = mn = mx = py; }
        cnt++;
        if (py < mn) mn = py;
        if (py > mx) mx = py;
        lastY = py; lastX = px;
      }
      flush();
      stroke(s, pts, Y);
    }

    /**
     * Points one pixel apart between the first and last sample in view. The interpolation uses all
     * of the series' data, not just what is in view. Where its window would run past the end of the
     * data (the newest readings, beside the mirror), edgeFn, the exact curve, is used if given.
     * resid (the noise in each reading, if any) is interpolated and added to fn or edgeFn.
     */
    function smoothPoints(s, i0, i1, X, Y, xmin, xmax, L, R, pts) {
      var d0 = s.i0 !== undefined ? s.i0 : 0, d1 = s.i1 !== undefined ? s.i1 : s.y.length - 1;
      var xa = s.x0 + i0 * s.dx, xb = s.x0 + i1 * s.dx;
      // Where the exact curve is known (fn or edgeFn), it may run on past the last reading to reach
      // the mirror's exact position (reach), which lies between two readings.
      if ((s.fn || s.edgeFn) && s.reach !== undefined) { xa = Math.min(xa, s.reach); xb = Math.max(xb, s.reach); }
      var pa = X(xa), pb = X(xb);
      var p0 = Math.max(L, Math.min(pa, pb)), p1 = Math.min(R, Math.max(pa, pb));
      if (p1 < p0) return;
      for (var px = p0; ; px = Math.min(p1, px + 1)) {
        var xv = xmin + (px - L) / (R - L) * (xmax - xmin), yv;
        var k0 = Math.floor((xv - s.x0) / s.dx), exact = s.fn || (s.edgeFn && (k0 - d0 + 1 < LZ || d1 - k0 < LZ) ? s.edgeFn : null);
        if (exact) {
          var rn = s.resid ? interp(s.resid, s.x0, s.dx, d0, d1, xv) : 0;
          yv = exact(xv) + (isFinite(rn) ? rn : 0);
        }
        else yv = interp(s.y, s.x0, s.dx, d0, d1, xv);
        pts.push(isFinite(yv) ? [px, Y(yv)] : null);
        if (px >= p1) break;
      }
    }

    function stroke(s, pts, Y) {
      if (s.fill) {
        var y0 = Y(0);
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color(s.fill);
        var open = false, startX = 0, prevX = 0;
        ctx.beginPath();
        pts.forEach(function (p) {
          if (!p) { if (open) { ctx.lineTo(prevX, y0); ctx.lineTo(startX, y0); ctx.closePath(); open = false; } return; }
          if (!open) { ctx.moveTo(p[0], y0); ctx.lineTo(p[0], p[1]); startX = p[0]; open = true; }
          else ctx.lineTo(p[0], p[1]);
          prevX = p[0];
        });
        if (open) { ctx.lineTo(prevX, y0); ctx.lineTo(startX, y0); ctx.closePath(); }
        ctx.fill();
        ctx.restore();
      }

      ctx.strokeStyle = color(s.color);
      ctx.lineWidth = s.width === 'total' ? tok.lineTotal : s.width === 'thin' ? Math.max(1, tok.line * 0.6) : tok.line;
      ctx.setLineDash(s.dash === 'dashed' ? [7, 5] : s.dash === 'dotted' ? [2, 4] : s.dash === 'dashdot' ? [10, 4, 2, 4] : []);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var pen = false;
      pts.forEach(function (p) {
        if (!p) { pen = false; return; }
        if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    return { layout: layout, draw: draw, canvas: canvas };
  }

  // --- smooth curves between samples --------------------------------------------------------------

  var LZ = 6;                          // Lanczos half-width, in samples

  function lanczos(t, a) {
    if (t === 0) return 1;
    if (t <= -a || t >= a) return 0;
    var p = Math.PI * t;
    return a * Math.sin(p) * Math.sin(p / a) / (p * p);
  }

  /**
   * The value at xv of a band-limited signal sampled every dx from x0 (samples i0 to i1 only),
   * by windowed-sinc interpolation. An interferogram holds no wavenumber above about 4300 cm⁻¹ and
   * is sampled for up to 7900 cm⁻¹, so this rebuilds the smooth curve between the readings. Near the
   * ends of the data the window narrows evenly on both sides, so a one-sided window cannot bend the
   * curve there.
   */
  function interp(y, x0, dx, i0, i1, xv) {
    var f = (xv - x0) / dx, k0 = Math.floor(f), sum = 0, w = 0;
    var a = Math.max(1, Math.min(LZ, k0 - i0 + 1, i1 - k0));
    for (var k = k0 - a + 1; k <= k0 + a; k++) {
      if (k < i0 || k > i1) continue;
      var v = y[k];
      if (!isFinite(v)) continue;
      var c = lanczos(f - k, a);
      sum += c * v;
      w += c;
    }
    return w > 0.5 ? sum / w : NaN;
  }

  root.Charts = { create: create, refresh: refresh, niceStep: niceStep, fmtTick: fmtTick, interp: interp };
})(window);
