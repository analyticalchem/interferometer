/* FTIR Interferometer Explorer: the instrument drawing, inline SVG.
 *
 * The instrument is a top view: source, beamsplitter, fixed and movable mirrors, a fold mirror, the
 * sample compartment and the detector. The movable mirror moves in proportion to its true position,
 * so dragging it and using the Mirror position slider agree. At 800 and 400 cm⁻¹ it is drawn at twice
 * the waves' magnification (6 drawing units per µm against 3), which makes the reflected wave move
 * exactly with the mirror while keeping its true phase: the reflected pattern shifts by twice the
 * mirror's movement in true length, which is the mirror's movement in the drawing. The mirror moves
 * only away from the beamsplitter, from zero path difference (the arms equal) to the end of its
 * travel. At 4 cm⁻¹ the travel of 1,250 µm, hundreds of wavelengths, cannot be drawn at that scale;
 * it is drawn in 75 units and the beam as a line, because a wave drawn there would change by most of a cycle between
 * frames and appear to run backward. Dragging the mirror or its track moves it.
 *
 * With one or two wavelengths the beam is drawn as its wave, all at the source's height: thin black
 * going out from the source and along each arm to its mirror; orange reflected from the fixed mirror,
 * 180° out of step with the black wave it overlaps; blue reflected from the movable mirror, the same
 * as the orange at zero path difference and shifted by the true phase 2πν̃δ as the mirror moves, in
 * the direction the mirror moves (as a real reflection is: moving the mirror out by x pushes the
 * reflected wave's pattern out by 2x). Orange and blue keep their colours through the beamsplitter to
 * the detector. Only the blue wave changes as the mirror moves. After the sample each is weakened
 * where the sample absorbs.
 * The wavelengths are magnified (3 drawing units per µm) but keep their true proportions.
 * With the broadband source the beam is a pale band with a line along it.
 *
 * Drawn text keeps its minimum size by the --sch-u rule (style guide 8.7). Exposes window.Diagram.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var BS = { x: 320, y: 190 }, MIRROR0 = 450, MIRROR_SWING = 75;
  var POST = MIRROR0 + 6;              // the mirror's centre line, where it stands on its track
  var SRC_X = 84, FIXED_Y = 62;

  /**
   * Two layouts. Narrow: the drawing on its own, 760 × 470, with the Detector Signal chart under it on
   * the page. Wide: the drawing across the whole panel, 900 × 500, its lower beam carried further right
   * and lower (dy), which leaves the top right corner (chart, in drawing units) clear for the page to
   * lay the Detector Signal chart over: beside the interferometer and above the sample compartment.
   */
  var LAYOUTS = {
    narrow: { w: 760, h: 470, dy: 0, cell: 520, det: 662, meter: 712, chart: null },
    wide: { w: 900, h: 500, dy: 30, cell: 600, det: 790, meter: 850, chart: { x: 580, y: 8, w: 320, h: 322 } }
  };
  var layoutName, VB_W, VB_H, DY, FOLD_Y, DET_X, CELL_X, METER_X;
  function useLayout(name) {
    var L = LAYOUTS[name];
    layoutName = name;
    VB_W = L.w; VB_H = L.h; DY = L.dy;
    FOLD_Y = 404 + DY; DET_X = L.det; CELL_X = L.cell; METER_X = L.meter;
  }
  useLayout('narrow');
  var PER_UM = 3;                      // drawing units per µm of wavelength in the instrument drawing
  var BEAM_AMP = 9;                    // drawing units: every wave's height
  var STEP = 1;                        // drawing units between points along a wave

  var svg, scene, els = {}, opts = {}, travel = 12.5, dragging = false, lastSample = null, lastState = null;

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function text(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || '', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = s;
    return t;
  }

  function line(parent, x1, y1, x2, y2, cls) {
    return el('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls }, parent);
  }

  function init(svgEl, o) {
    svg = svgEl;
    opts = o || {};
    scene = el('g', {}, svg);
    build();
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
  }

  function build() {
    svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
    // The interferometer's housing, dashed, with its name above it.
    el('rect', { x: 140, y: 34, width: 420, height: 250, rx: 10, 'class': 'housing' }, scene);
    text(scene, 140, 24, 'Interferometer', 'sch-title');

    // Sample compartment and cell, under the beam so the beam reads as passing through.
    el('rect', { x: CELL_X - 90, y: 344 + DY, width: 180, height: 114, rx: 8, 'class': 'compartment' }, scene);
    text(scene, CELL_X, 334 + DY, 'Sample compartment', '', 'middle');
    els.cell = el('g', {}, scene);
    els.sampleName = text(scene, CELL_X, 448 + DY, '', 'sch-small', 'middle');

    // Beams: a pale band with a line along its middle. The two legs after the beamsplitter
    // carry the recombined light, drawn brighter when more of it reaches the detector.
    var beams = el('g', {}, scene);
    function beam(x1, y1, x2, y2, out) {
      var g = el('g', { 'class': out ? 'beam-out' : '' }, beams);
      var a = line(g, x1, y1, x2, y2, 'beam-band');
      var b = line(g, x1, y1, x2, y2, 'beam-line');
      return { g: g, band: a, line: b };
    }
    beam(SRC_X, BS.y, BS.x, BS.y);
    beam(BS.x, BS.y, BS.x, FIXED_Y);
    els.armMove = beam(BS.x, BS.y, MIRROR0, BS.y);
    els.out1 = beam(BS.x, BS.y, BS.x, FOLD_Y, true);
    els.out2 = beam(BS.x, FOLD_Y, DET_X, FOLD_Y, true);

    // The waves along the beam (one or two wavelengths only), under the mirrors so they end at them.
    // In the arms the reflected waves go under the thin black one, so where they coincide both show.
    els.iw = el('g', { 'class': 'inst-waves' }, scene);
    els.iwFixedBack = el('path', { 'class': 'iw-fixed' }, els.iw);
    els.iwMoveBack = el('path', { 'class': 'iw-moving' }, els.iw);
    els.iwSource = el('path', { 'class': 'iw-out' }, els.iw);
    els.iwFixedOut = el('path', { 'class': 'iw-out' }, els.iw);
    els.iwMoveOut = el('path', { 'class': 'iw-out' }, els.iw);
    // Below the beamsplitter the orange goes under the blue, so where they coincide they draw as one line.
    els.iwOutFixed = el('path', { 'class': 'iw-fixed' }, els.iw);
    els.iwOutMove = el('path', { 'class': 'iw-moving' }, els.iw);

    // Source.
    el('rect', { x: 36, y: 172, width: 48, height: 36, rx: 9, 'class': 'glow' }, scene);
    text(scene, 60, 232, 'IR source', '', 'middle');

    // Beamsplitter, fixed mirror, fold mirror.
    el('rect', { x: BS.x - 38, y: BS.y - 4, width: 76, height: 8, 'class': 'splitter', transform: 'rotate(-45 ' + BS.x + ' ' + BS.y + ')' }, scene);
    text(scene, 290, 252, 'Beamsplitter', '', 'end');
    el('rect', { x: BS.x - 42, y: FIXED_Y - 12, width: 84, height: 12, rx: 2, 'class': 'mirror' }, scene);
    text(scene, BS.x + 52, 61, 'Fixed mirror', '', 'start');
    // The fold mirror, as thick as the fixed mirror.
    el('rect', { x: BS.x - 34, y: FOLD_Y - 6, width: 68, height: 12, rx: 2, 'class': 'mirror', transform: 'rotate(45 ' + BS.x + ' ' + FOLD_Y + ')' }, scene);
    text(scene, BS.x + 26, 306 + DY, 'Halves recombine', 'sch-small', 'start');

    // Movable mirror on its track. The track shows the travel at the present resolution (setTrack),
    // from the tick at zero path difference, its left end, to the arrow at the end of the travel.
    var track = el('g', { 'class': 'track' }, scene);
    els.trackLine = line(track, POST, 254, POST + 40, 254, 'track-line');
    els.trackRight = el('polygon', { 'class': 'track-head' }, track);
    line(track, POST, 247, POST, 261, 'track-zero');
    text(track, POST, 276, 'δ = 0', 'sch-small', 'middle');
    els.mirror = el('g', { 'class': 'movable' }, scene);
    el('rect', { x: MIRROR0, y: 148, width: 12, height: 84, rx: 2, 'class': 'mirror' }, els.mirror);
    line(els.mirror, MIRROR0 + 6, 232, MIRROR0 + 6, 250, 'mirror-post');
    text(scene, POST, 138, 'Movable mirror', '', 'middle');
    // A wide transparent target over the mirror and its track, so it is easy to grab.
    el('rect', { x: POST - 22, y: 140, width: MIRROR_SWING + 44, height: 128, 'class': 'hit' }, scene);

    // Detector and its signal bar.
    el('rect', { x: DET_X, y: 386 + DY, width: 30, height: 36, rx: 4, 'class': 'detector' }, scene);
    text(scene, DET_X + 15, 446 + DY, 'Detector', '', 'middle');
    el('rect', { x: METER_X, y: 330 + DY, width: 16, height: 110, rx: 3, 'class': 'meter-track' }, scene);
    els.meter = el('rect', { x: METER_X, y: 440 + DY, width: 16, height: 0, rx: 3, 'class': 'meter-fill' }, scene);
    text(scene, METER_X + 8, 320 + DY, 'Signal', 'sch-small', 'middle');
  }

  function setSample(sample) {
    lastSample = sample;
    var g = els.cell;
    while (g.firstChild) g.removeChild(g.firstChild);
    var cx = CELL_X, cy = FOLD_Y;
    if (sample.holder === 'liquid') {
      el('rect', { x: cx - 18, y: cy - 30, width: 10, height: 60, rx: 2, 'class': 'salt' }, g);
      el('rect', { x: cx + 8, y: cy - 30, width: 10, height: 60, rx: 2, 'class': 'salt' }, g);
      el('rect', { x: cx - 8, y: cy - 22, width: 16, height: 44, 'class': 'liquid' }, g);
    } else if (sample.holder === 'film') {
      el('rect', { x: cx - 7, y: cy - 34, width: 14, height: 68, rx: 2, 'class': 'film-card' }, g);
      el('rect', { x: cx - 4, y: cy - 16, width: 8, height: 32, 'class': 'film' }, g);
    } else if (sample.holder === 'gas') {
      el('rect', { x: cx - 40, y: cy - 18, width: 80, height: 36, rx: 4, 'class': 'gas' }, g);
      el('rect', { x: cx - 46, y: cy - 21, width: 7, height: 42, rx: 2, 'class': 'salt' }, g);
      el('rect', { x: cx + 39, y: cy - 21, width: 7, height: 42, rx: 2, 'class': 'salt' }, g);
    } else {
      el('rect', { x: cx - 9, y: cy - 30, width: 18, height: 60, rx: 3, 'class': 'empty-slot' }, g);
    }
    els.sampleName.textContent = sample.name;
  }

  /**
   * Drawing units per µm of mirror movement: twice the waves' magnification where the travel fits
   * (so the reflected wave moves with the mirror at its true phase), or the whole travel in
   * MIRROR_SWING where it does not (4 cm⁻¹).
   */
  function mirrorScale() { return Math.min(2 * PER_UM, MIRROR_SWING / travel); }
  /** Whether the drawing is to the waves' scale, so the waves can be drawn. */
  function wavesToScale() { return mirrorScale() >= 2 * PER_UM - 1e-9; }
  function toDraw(x) { return x * mirrorScale(); }
  function fromDraw(u) { return u / mirrorScale(); }

  /** The track's arrow marks the end of the travel at the present resolution. */
  function setTrack() {
    var len = travel * mirrorScale();
    if (els.trackLine._len === len) return;
    els.trackLine._len = len;
    els.trackLine.setAttribute('x2', POST + len + 4);
    var r = POST + len;
    els.trackRight.setAttribute('points', (r + 10) + ',254 ' + r + ',248 ' + r + ',260');
  }

  /**
   * s = { x (µm), travel (µm), signal (0 to 1), delta (µm),
   *       lines: [{ v (cm⁻¹), w (height relative to the brightest, 0 to 1), t (sample's transmittance) }]
   *       or null for broadband }
   */
  function update(s) {
    lastState = s;
    travel = s.travel;
    setTrack();
    var dx = Math.max(0, Math.min(MIRROR_SWING, toDraw(s.x)));
    els.mirror.setAttribute('transform', 'translate(' + dx.toFixed(2) + ' 0)');
    els.armMove.band.setAttribute('x2', MIRROR0 + dx);
    els.armMove.line.setAttribute('x2', MIRROR0 + dx);
    var sig = Math.max(0, Math.min(1, s.signal));
    var op = (0.25 + 0.75 * sig).toFixed(3);
    els.out1.g.style.opacity = op;
    els.out2.g.style.opacity = op;
    els.meter.setAttribute('y', 440 + DY - 110 * sig);
    els.meter.setAttribute('height', 110 * sig);
    var waves = !!s.lines && wavesToScale();
    svg.classList.toggle('waves-on', waves);
    if (waves) instrumentWaves(s.lines, s.delta, dx);
  }

  // --- waves along the beam in the instrument --------------------------------------------------------

  /**
   * A path that follows the polyline pts, displaced sideways by fn(s, x, y), where s is the distance
   * along the beam from s0 (drawing units) and (x, y) the point on the beam's centre line.
   */
  function along(pts, s0, fn) {
    var d = '', s = s0, first = true;
    for (var i = 0; i + 1 < pts.length; i++) {
      var x0 = pts[i][0], y0 = pts[i][1], x1 = pts[i + 1][0], y1 = pts[i + 1][1];
      var len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) continue;
      // Points a fixed STEP apart from the start (and one at the end), so a stretch whose far end
      // moves, like the movable arm, keeps every point it had: it only grows or shrinks at that end.
      var ux = (x1 - x0) / len, uy = (y1 - y0) / len, n = Math.max(1, Math.ceil(len / STEP));
      for (var j = i ? 1 : 0; j <= n; j++) {
        var t = Math.min(len, j * STEP), px = x0 + ux * t, py = y0 + uy * t, f = fn(s + t, px, py);
        d += (first ? 'M' : 'L') + (px - uy * f).toFixed(1) + ' ' + (py + ux * f).toFixed(1);
        first = false;
      }
      s += len;
    }
    return d;
  }

  /**
   * The waves along the instrument. s is distance along the beam from the source (drawing units); in
   * each arm the wave going out and the one coming back follow the same line, so they overlap. Below
   * the beamsplitter u is distance from it, and each reflected wave carries on as if its pattern ran
   * straight on through the beamsplitter.
   */
  function instrumentWaves(lines, delta, dx) {
    // Each wavelength's share of the height is fixed, so the brightest keeps its height and a dimmer one
    // is drawn shorter; with two equally bright, the waves add up to the source's height.
    var A = BEAM_AMP / lines.length;
    var ks = lines.map(function (l) { return 2 * Math.PI / (PER_UM * 1e4 / l.v); });
    var phis = lines.map(function (l) { return 2 * Math.PI * l.v * delta * 1e-4; });
    var L0 = BS.x - SRC_X, MX = MIRROR0 + dx;
    // Going out: the source's wave, the same in both arms whatever the mirror does.
    function out(s) {
      var f = 0;
      for (var i = 0; i < lines.length; i++) f += lines[i].w * Math.cos(ks[i] * s);
      return A * f;
    }
    // Coming back: 180° from the outgoing wave it overlaps (a mirror turns the wave over), and from
    // the movable mirror shifted by the phase its extra path δ adds, so the pattern moves out as the
    // mirror moves out.
    function back(s, shifted) {
      var f = 0;
      for (var i = 0; i < lines.length; i++) f -= lines[i].w * Math.cos(ks[i] * s - (shifted ? phis[i] : 0));
      return A * f;
    }
    // After the sample, each wavelength's field is scaled by √T, blended across the cell.
    function sampleFactor(i, x, y) {
      if (y < FOLD_Y - 1 || x < CELL_X - 22) return 1;
      var r = Math.sqrt(lines[i].t);
      if (x > CELL_X + 22) return r;
      return 1 + (r - 1) * (x - (CELL_X - 22)) / 44;
    }
    // Below the beamsplitter: the reflected wave's pattern continued, u past the beamsplitter, as
    // s = L0 − u on the arm it came back along.
    function after(u, x, y, shifted) {
      var f = 0;
      for (var i = 0; i < lines.length; i++) {
        f -= lines[i].w * sampleFactor(i, x, y) * Math.cos(ks[i] * (L0 - u) - (shifted ? phis[i] : 0));
      }
      return A * f;
    }
    var fixedArm = [[BS.x, BS.y], [BS.x, FIXED_Y]], moveArm = [[BS.x, BS.y], [MX, BS.y]];
    var toDetector = [[BS.x, BS.y], [BS.x, FOLD_Y], [DET_X, FOLD_Y]];
    els.iwSource.setAttribute('d', along([[SRC_X, BS.y], [BS.x, BS.y]], 0, out));
    els.iwFixedOut.setAttribute('d', along(fixedArm, L0, out));
    els.iwMoveOut.setAttribute('d', along(moveArm, L0, out));
    els.iwFixedBack.setAttribute('d', along(fixedArm, L0, function (s) { return back(s, false); }));
    els.iwMoveBack.setAttribute('d', along(moveArm, L0, function (s) { return back(s, true); }));
    els.iwOutFixed.setAttribute('d', along(toDetector, 0, function (u, x, y) { return after(u, x, y, false); }));
    els.iwOutMove.setAttribute('d', along(toDetector, 0, function (u, x, y) { return after(u, x, y, true); }));
  }

  // --- dragging the mirror -------------------------------------------------------------------

  function toView(e) {
    var m = svg.getScreenCTM();
    if (!m) return null;
    var p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(m.inverse());
  }

  function onDown(e) {
    if (!e.target.classList || !(e.target.classList.contains('hit') || e.target.closest('.movable'))) return;
    dragging = true;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    svg.classList.add('is-dragging');
    e.preventDefault();
    onMove(e);
  }

  function onMove(e) {
    if (!dragging) return;
    var p = toView(e);
    if (!p) return;
    var u = Math.max(0, Math.min(MIRROR_SWING, p.x - POST)), x = fromDraw(u);
    if (opts.onDrag) opts.onDrag(Math.max(0, Math.min(travel, x)));
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('is-dragging');
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (opts.onDragEnd) opts.onDragEnd();
  }

  // --- drawn text size (style guide 8.7) -----------------------------------------------------------

  function fitOne(s, label) {
    if (!s) return;
    var vb = s.viewBox.baseVal, r = s.getBoundingClientRect();
    if (!vb || !vb.width || !r.width) return;
    var u = 1 / Math.min(r.width / vb.width, r.height / vb.height || Infinity);
    s.style.setProperty('--sch-u', u.toFixed(4));
    var box = s.parentElement;
    if (!box || !box.classList.contains('visual-scroll')) return;
    if (box.scrollWidth > box.clientWidth + 1) {
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', label + ', scrolls sideways');
    } else {
      box.removeAttribute('tabindex');
      box.removeAttribute('role');
      box.removeAttribute('aria-label');
    }
  }

  function fit() {
    fitOne(svg, 'Drawing of the interferometer');
  }

  /** Switch to the 'wide' or 'narrow' layout, drawing everything again as it was. True if it changed. */
  function setLayout(name) {
    if (name === layoutName) return false;
    useLayout(name);
    while (scene.firstChild) scene.removeChild(scene.firstChild);
    els = {};
    build();
    if (lastSample) setSample(lastSample);
    if (lastState) update(lastState);
    fit();
    return true;
  }

  root.Diagram = {
    init: init, setSample: setSample, update: update, fit: fit, setLayout: setLayout,
    /**
     * Where the Detector Signal chart goes over the wide drawing, as fractions of the drawing's width
     * (x, y, w) and its width ÷ height; null in the narrow layout.
     */
    chartPlace: function () {
      var L = LAYOUTS[layoutName], c = L.chart;
      return c ? { x: c.x / L.w, y: c.y / L.w, w: c.w / L.w, ratio: c.w / c.h } : null;
    },
    /** Whether waves can be drawn at this travel (µm each way). */
    wavesAt: function (t) { return Math.min(2 * PER_UM, MIRROR_SWING / t) >= 2 * PER_UM - 1e-9; }
  };
})(window);
