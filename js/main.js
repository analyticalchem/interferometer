/* FTIR Interferometer Explorer: wiring. Holds the settings, builds the beam for the chosen source and sample,
 * moves the mirror and records, transforms the recording, and draws the drawings, charts, lists and
 * tables. Exposes window.app for console checks.
 */
(function (root) {
  'use strict';

  var J = Model.J_LIMIT, DD = Model.DD_UM, DVT = Model.DVT, NB = Page.NB;
  var VIEW_HALF = 25;                  // µm of path difference either side of the mirror in the near view
  var NOISE = 0.0004;                  // detector noise for one scan, as a fraction of the largest signal
  var UNKNOWNS = ['unknown-a', 'unknown-b', 'unknown-c'];
  var LIQUIDS = ['hexane', 'ethanol', 'acetone', 'ethylacetate', 'acetonitrile'];
  var WL_TICKS = [2.5, 3, 4, 5, 6, 8, 10, 15, 25];
  var WN_TICKS = [4000, 3000, 2000, 1500, 1000, 800, 600, 500, 400];

  var S = {
    source: 'single', v1: 1000, v2: 2500, ratio: 0.6,
    sample: 'empty',
    ifgView: 'full', ifgFit: false, ifgComp: false, ifgCompare: false,
    win: 'none', axis: 'wn', ymode: 'T',
    res: 400, travel: 12.5,
    noise: false, scans: 1
  };

  var beam = null, beamBg = null, bgKey = '', sp = null;
  var pct = new Float64Array(2 * J + 1), bgPct = new Float64Array(2 * J + 1), noisePct = new Float64Array(2 * J + 1);
  var comp1 = null, comp2 = null, seed = 1, unknownOf = {}, noiseRms = 0, noiseSingle = 0;
  var ifgChart, specChart, sigChart, els = {};
  var dirty = { rec: true, view: true, spec: true, now: true }, specDueAt = 0, nowDueAt = 0;
  var running = false, lastT = 0, slowSpeed = null;

  function $(id) { return document.getElementById(id); }
  function fmt(v, n) { return Page.fmt(v, n); }
  function setText(el, s) { if (el._s !== s) { el._s = s; el.textContent = s; } }
  function setStatus(el, s) { if (el._s !== s) { el._s = s; el.textContent = s; } }
  function isUnknown() { return UNKNOWNS.indexOf(S.sample) >= 0; }
  /** The compound in the beam (an unknown's real identity included). */
  function sample() { return Samples.get(unknownOf[S.sample] || S.sample); }
  /** The name shown on the page: an unknown stays unknown. */
  function sampleLabel() { return isUnknown() ? 'Unknown ' + S.sample.slice(-1).toUpperCase() : sample().name; }
  function sampleLower() { return isUnknown() ? sampleLabel() : sample().name.toLowerCase(); }
  /** "unknown B", for the middle of a sentence. */
  function unknownInText() { return 'unknown ' + S.sample.slice(-1).toUpperCase(); }

  function shuffleUnknowns() {
    var pool = LIQUIDS.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var k = Math.floor(Math.random() * (i + 1)), t = pool[i];
      pool[i] = pool[k];
      pool[k] = t;
    }
    UNKNOWNS.forEach(function (u, i) { unknownOf[u] = pool[i]; });
  }

  // --- source and beam ------------------------------------------------------------------------------

  function sourceDesc() {
    if (S.source === 'broad') return { kind: 'broad' };
    if (S.source === 'single') return { kind: 'lines', lines: [{ v: S.v1, a: 1 }] };
    var a1 = 1 / (1 + S.ratio);
    return { kind: 'lines', lines: [{ v: S.v1, a: a1 }, { v: S.v2, a: S.ratio * a1 }] };
  }

  function sourceKey() { return S.source === 'broad' ? 'broad' : S.source + ':' + S.v1 + ':' + S.v2 + ':' + S.ratio; }

  /**
   * Build the beam for the source and sample. Anything that changes what the detector sees starts a
   * new recording at the mirror's present position, so the signal is drawn again as the mirror moves.
   */
  function rebuildBeam(fresh) {
    var src = sourceDesc();
    beam = Model.beam(src, sample());
    var key = sourceKey();
    if (key !== bgKey) {
      beamBg = Model.beam(src, Samples.get('empty'));
      bgKey = key;
      for (var i = 0; i < bgPct.length; i++) bgPct[i] = beamBg.grid[i] * 100;
    }
    comp1 = comp2 = null;
    if (S.source === 'two') {
      comp1 = new Float64Array(2 * J + 1);
      comp2 = new Float64Array(2 * J + 1);
      var l = src.lines, t1 = Model.transmittance(sample(), l[0].v), t2 = Model.transmittance(sample(), l[1].v);
      for (var j = -J; j <= J; j++) {
        var d = j * Model.DD_CM;
        comp1[j + J] = 50 * l[0].a * t1 * (1 + Math.cos(2 * Math.PI * l[0].v * d));
        comp2[j + J] = 50 * l[1].a * t2 * (1 + Math.cos(2 * Math.PI * l[1].v * d));
      }
    }
    if (fresh) newRecording();
    else {
      Sim.rerecord();
      dirty.rec = dirty.view = dirty.now = true;
      kick();
    }
  }

  /** The detector reading at δ = j × 0.6328 µm, with noise averaged over the chosen number of scans. */
  function read(j) {
    var v = beam.grid[j + J];
    if (S.noise) v += NOISE / Math.sqrt(S.scans) * Model.noise(j, seed);
    return v;
  }

  function newRecording() {
    stopScan();
    seed++;                            // a fresh recording gets fresh noise
    Sim.clear();
    dirty.rec = dirty.view = dirty.now = true;
    kick();
  }

  // --- controls -------------------------------------------------------------------------------------

  function wnSpeech(v) { return fmt(v, 0) + ' per centimetre, wavelength ' + fmt(1e4 / v, 2) + ' micrometres'; }

  function showSourceControls() {
    document.querySelectorAll('[data-source]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.source === S.source));
    });
    // Every source control stays in place, switched off when the source does not use it, so the
    // panel keeps its size and the panels below do not move.
    var two = S.source === 'two', lines = S.source !== 'broad';
    setUsed($('v1'), lines, 'Not used with Broadband IR, which has every wavenumber');
    setUsed($('v2'), two, 'Used only with Two wavelengths');
    setUsed($('ratio'), two, 'Used only with Two wavelengths');
    // All three captions sit in the same place and only the current one shows, so the space they
    // take is always the longest one's, even where it wraps.
    document.querySelectorAll('#source-sub [data-src]').forEach(function (sp) {
      sp.classList.toggle('is-off', sp.dataset.src !== S.source);
    });
    $('ifg-components').disabled = S.source !== 'two';
    $('ifg-components').parentElement.title = S.source === 'two' ? '' : 'Available with Two wavelengths, where the interferogram is the sum of two simple waves';
    var broad = S.source === 'broad';
    document.querySelectorAll('[data-ymode]').forEach(function (b) {
      b.disabled = !broad;
      b.title = broad ? '' : 'Transmittance and absorbance need the Broadband IR source';
    });
  }

  function setUsed(input, used, why) {
    input.disabled = !used;
    input.title = used ? '' : why;
    var box = $(input.id + '-num');   // a wavenumber's typing box goes with its slider
    if (box) { box.disabled = !used; box.title = input.title; }
  }

  function showLineOutputs() {
    ['v1', 'v2'].forEach(function (id) {
      var box = $(id + '-num');
      $(id).value = String(S[id]);
      $(id).setAttribute('aria-valuetext', wnSpeech(S[id]));
      $(id + '-wl').textContent = fmt(1e4 / S[id], 2);
      if (document.activeElement !== box || !box._editing) box.value = String(S[id]);
    });
    $('ratio-out').textContent = fmt(S.ratio * 100, 0) + NB + '%';
    $('ratio').setAttribute('aria-valuetext', fmt(S.ratio * 100, 0) + ' percent');
  }

  function buildSampleSelect() {
    var sel = $('sample'), known = document.createElement('optgroup'), unk = document.createElement('optgroup');
    known.label = 'Samples';
    unk.label = 'Unknowns to identify';
    Samples.list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      known.appendChild(o);
    });
    UNKNOWNS.forEach(function (u) {
      var o = document.createElement('option');
      o.value = u;
      o.textContent = 'Unknown ' + u.slice(-1).toUpperCase();
      unk.appendChild(o);
    });
    sel.appendChild(known);
    sel.appendChild(unk);
    sel.value = S.sample;
    sel.addEventListener('change', function () { setSample(sel.value); });
    var ans = $('quiz-answer');
    LIQUIDS.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      o.textContent = Samples.get(id).name;
      ans.appendChild(o);
    });
  }

  function showSample() {
    var s = sample();
    if ($('sample').value !== S.sample) $('sample').value = S.sample;
    if (isUnknown()) {
      setText($('sample-sub'), 'A liquid between KBr windows');
      Diagram.setSample({ holder: 'liquid', name: sampleLabel() });
    } else {
      setText($('sample-sub'), s.holderText);
      Diagram.setSample(s);
    }
    $('quiz').hidden = !isUnknown();
    if (isUnknown()) {
      $('quiz-title').textContent = 'Identify ' + unknownInText();
      $('quiz-answer').value = '';
      quizStatus('', '');
    }
  }

  function quizStatus(msg, cls) {
    var el = $('quiz-status');
    el.className = 'verdict' + (cls ? ' ' + cls : '');
    setStatus(el, msg);
  }

  function setSample(id) {
    if (id === S.sample) return;
    S.sample = id;
    showSample();
    rebuildBeam(true);
    setStatus(els.scanStatus, sampleLabel() + ' in the holder: a new recording starts as the mirror moves.');
  }

  function setSource(kind) {
    if (kind === S.source) return;
    S.source = kind;
    showSourceControls();
    rebuildBeam(true);
    var names = { single: 'Single wavelength', two: 'Two wavelengths', broad: 'Broadband IR' };
    setStatus(els.scanStatus, names[kind] + ' source: a new recording starts as the mirror moves.');
  }

  function setWindow(w) {
    S.win = w;
    dirty.spec = true;
    kick();
  }

  /** Resolution (cm⁻¹) sets the mirror's travel: the largest path difference is 1 ÷ resolution. */
  function setResolution(r) {
    if (r === S.res) return;
    stopScan();
    var wasHigh = S.res <= 50, speedNote = '';
    S.res = r;
    S.travel = 1e4 / (2 * r);
    // The long travel for spectra would take minutes at the slow speeds that suit watching fringes,
    // so it brings the fast speed with it, and the low resolutions put the earlier speed back.
    var sp1 = $('speed');
    if (r <= 50 && !wasHigh) {
      slowSpeed = sp1.value;
      sp1.value = '1000';
      speedNote = ' Speed set to 1,000' + NB + 'µm/s for scanning.';
    } else if (r > 50 && wasHigh && slowSpeed !== null) {
      sp1.value = slowSpeed;
      speedNote = ' Speed back to ' + sp1.options[sp1.selectedIndex].text + '.';
      slowSpeed = null;
    }
    Sim.setSpeed(Number(sp1.value));
    // A new resolution starts again: the mirror back at zero path difference, nothing recorded.
    seed++;
    Sim.reset(S.travel);
    showTravel();
    mirrorMoved();
    var noWaves = !Diagram.wavesAt(S.travel) && S.source !== 'broad' ?
      ' The beam is drawn as a line: over hundreds of wavelengths a wave cannot be drawn to scale.' : '';
    setStatus(els.scanStatus, 'Resolution ' + r + NB + 'cm⁻¹' + (r <= 50 ? ', for spectra' : '') + ': the mirror travels from 0 to ' +
      travelText(S.travel) + NB + 'µm and is back at zero.' + speedNote + noWaves);
  }

  /** The travel in µm with as many decimals as it needs (156.25, 312.5, 625). */
  function travelText(t) { return fmt(t, t % 1 === 0 ? 0 : (t * 10) % 1 === 0 ? 1 : 2); }

  function showTravel() {
    var t = S.travel;
    els.mirror.min = '0';
    els.mirror.max = String(t);
    // A short travel gets a fine step, so the slider moves smoothly through each fringe.
    els.mirror.step = t <= 50 ? '0.02' : '0.1';
    document.querySelectorAll('[data-res]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.res) === S.res));
    });
    setText($('mirror-sub'), '0 to ' + travelText(t) + NB + 'µm; path difference δ = 2 × position');
  }

  function showNoiseControls() {
    document.querySelectorAll('[data-scans]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.scans) === S.scans));
      b.disabled = !S.noise;
      b.title = S.noise ? '' : 'Turn on Noise to average scans';
    });
  }

  // --- the mirror ----------------------------------------------------------------------------------

  function mirrorMoved() {
    dirty.rec = dirty.view = dirty.now = true;
    kick();
  }

  function moveMirror(x) {
    Sim.moveTo(x);
    mirrorMoved();
  }

  function showMirrorControls() {
    var x = Sim.state.x;
    els.mirror.value = String(Math.round(x * 100) / 100);
    els.mirror.setAttribute('aria-valuetext', fmt(x, 2) + ' micrometres, path difference ' + fmt(2 * x, 2) + ' micrometres');
    if (document.activeElement !== els.mirrorNum || !els.mirrorNum._editing) {
      // The long travel for spectra moves in 0.1 µm steps, and 1,250.0 fits the box where 1,250.00 does not.
      els.mirrorNum.value = fmt(x, S.travel > 50 ? 1 : 2);
    }
  }

  /** Read a typed length in µm: 12.5, −300, +40 µm, 0.1 mm, 1e2. */
  function parseLength(text) {
    var t = String(text).trim().replace(/[−–]/g, '-').replace(/\s+/g, '').replace(/^\+/, '');
    var m = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(µm|um|mm)?$/i.exec(t);
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    if (m[2] && m[2].toLowerCase() === 'mm') v *= 1000;
    return v;
  }

  function applyMirrorNum() {
    els.mirrorNum._editing = false;
    var v = parseLength(els.mirrorNum.value), msg = '', t = S.travel;
    if (isNaN(v)) {
      els.mirrorNum.setAttribute('aria-invalid', 'true');
      els.mirrorMsg.textContent = 'Type a number of micrometres from 0 to ' + travelText(t) + ', such as ' + travelText(t / 2) + '.';
      return;
    }
    if (v > t) { v = t; msg = 'Set to ' + travelText(t) + NB + 'µm, the end of the travel.'; }
    if (v < 0) { v = 0; msg = 'Set to 0' + NB + 'µm, zero path difference, where the travel starts.'; }
    els.mirrorNum.removeAttribute('aria-invalid');
    els.mirrorMsg.textContent = msg;
    stopScan();
    moveMirror(v);
    showMirrorControls();
  }

  var WN_MIN = 500, WN_MAX = 4000;

  /**
   * Read a typed wavenumber in cm⁻¹ (1650, 1650 cm-1, 1.65e3), or a wavelength in µm (6 µm, 6um),
   * which is turned into its wavenumber. NaN if it cannot be read.
   */
  function parseWavenumber(text) {
    var t = String(text).trim().replace(/\s+/g, '').replace(/,/g, '').replace(/^\+/, '');
    var m = /^(\d*\.?\d+(?:e[-+]?\d+)?)(cm-1|cm⁻¹|cm\^-1|\/cm|µm|μm|um)?$/i.exec(t);
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    if (m[2] && /^(µm|μm|um)$/i.test(m[2])) v = v > 0 ? 1e4 / v : NaN;
    return v;
  }

  function applyWnNum(id) {
    var box = $(id + '-num'), msgEl = $(id + '-num-msg');
    box._editing = false;
    var v = parseWavenumber(box.value), msg = '';
    if (!isFinite(v)) {
      box.setAttribute('aria-invalid', 'true');
      msgEl.textContent = 'Type a wavenumber from 500 to 4,000 cm⁻¹, such as 1650, or a wavelength from 2.5 to 20 µm, such as 6 µm.';
      return;
    }
    v = Math.round(v);
    if (v > WN_MAX) { v = WN_MAX; msg = 'Set to 4,000' + NB + 'cm⁻¹ (2.5' + NB + 'µm), the largest allowed.'; }
    if (v < WN_MIN) { v = WN_MIN; msg = 'Set to 500' + NB + 'cm⁻¹ (20' + NB + 'µm), the smallest allowed.'; }
    box.removeAttribute('aria-invalid');
    msgEl.textContent = msg;
    var changed = v !== S[id];
    S[id] = v;
    showLineOutputs();
    if (changed) rebuildBeam(true);
  }

  // --- scanning --------------------------------------------------------------------------------------

  function scanButton() {
    els.scan.textContent = Sim.isScanning() ? 'Pause' : Sim.inProgress() ? 'Resume' : 'Scan';
  }

  function stopScan() {
    if (Sim.inProgress()) {
      Sim.cancelScan();
      scanButton();
      setStatus(els.scanStatus, 'Scan stopped.');
    }
  }

  function scanDone() {
    scanButton();
    var s = Sim.span();
    setStatus(els.scanStatus, 'Scan complete: recorded δ from ' + fmt(s.lo, 1) + ' to ' + fmt(s.hi, 1) + NB + 'µm, ' + s.n.toLocaleString() + ' readings.');
    dirty.spec = true;
  }

  // --- drawing ---------------------------------------------------------------------------------------

  /** The detector now, including the noise of the nearest reading so the dot sits on the recorded line. */
  function signalNow() {
    var x = Sim.state.x, v = beam.at(2 * x);
    if (S.noise) v += NOISE / Math.sqrt(S.scans) * Model.noise(Model.jOf(2 * x), seed);
    return v;
  }

  /** For a single wavelength: whether the two halves meet in step or opposite. */
  function phaseWords(v, delta) {
    var n = delta * 1e-4 * v, f = n - Math.floor(n), dist = Math.min(f, 1 - f);
    if (dist < 0.05) return 'constructive (in step)';
    if (dist > 0.45) return 'destructive (opposite)';
    return 'partly constructive';
  }

  /**
   * The present reading, in the signal chart's description (it is not shown on the page). Not a live
   * region: it changes as the mirror moves, and is read when the chart is reached.
   */
  function describeSignalNow() {
    var x = Sim.state.x, delta = 2 * x, sig = signalNow(), extra = '';
    if (S.source === 'single') extra = ', ' + phaseWords(S.v1, delta);
    else if (S.source === 'broad' && Math.abs(delta) < 0.2) extra = ', every wavenumber in step';
    var now = 'Now: mirror ' + fmt(x, 2) + ' micrometres, path difference ' + fmt(delta, 2) + ' micrometres, signal ' +
      fmt(sig * 100, 1) + ' percent' + extra + '.';
    if (els.signalCanvas._s === now) return;
    els.signalCanvas._s = now;
    els.signalCanvas.setAttribute('aria-label', 'Detector signal in percent against mirror position in micrometres, drawn as the mirror moves. ' +
      now + ' The recorded values are in the interferogram table, where the path difference is twice the mirror position.');
  }

  /**
   * For one or two wavelengths without noise the signal is a simple formula, so a zoomed-in chart draws
   * it exactly, right up to the mirror's position; otherwise (broadband, or noise) the chart rebuilds
   * the curve from the readings. With noise on, the noise in each reading is added back on top (noisePct).
   * scale converts the chart's x to path difference (2 for mirror position).
   */
  function exactCurve(b, scale) {
    if (S.source === 'broad' || !b) return null;
    return function (x) { return b.at(x * scale) * 100; };
  }

  /**
   * For the broadband source without noise the exact signal costs a sum over thousands of
   * wavenumbers, so it is used only for the newest few readings at each end, where the interpolation
   * has readings on one side only; it keeps a curve smooth the moment it is drawn.
   */
  function edgeCurve(b, scale) {
    if (S.source !== 'broad' || !b) return null;
    return function (x) { return b.at(x * scale) * 100; };
  }

  function componentCurve(i) {
    if (S.noise) return null;
    var l = sourceDesc().lines[i], t = Model.transmittance(sample(), l.v);
    return function (d) { return 50 * l.a * t * (1 + Math.cos(2 * Math.PI * l.v * d * 1e-4)); };
  }

  /** Detector signal against mirror position, drawn as the mirror moves, over the travel from zero. */
  function drawSignalChart() {
    var st = Sim.state, t = S.travel;
    sigChart.draw({ panels: [{
      x: { min: 0, max: t, title: 'Mirror position (µm)' },
      y: { min: 0, max: 100, title: 'Signal (%)' },
      series: st.jLo === null ? [] : [{ x0: -J * DD / 2, dx: DD / 2, y: pct, i0: st.jLo + J, i1: st.jHi + J, color: '--series-c', smooth: true,
        fn: exactCurve(beam, 2), edgeFn: edgeCurve(beam, 2), resid: S.noise ? noisePct : null, reach: st.x }],
      vlines: [{ x: st.x, color: '--text-secondary', width: 1.5 }],
      markers: [{ x: st.x, y: signalNow() * 100, color: '--text-primary' }]
    }] });
  }

  function drawDiagram() {
    var src = sourceDesc(), lines = null;
    if (src.kind === 'lines') {
      // Each wave's height relative to the brightest one: a wave's brightness goes as its height squared.
      var amax = Math.max.apply(null, src.lines.map(function (l) { return l.a; }));
      lines = src.lines.map(function (l) { return { v: l.v, w: Math.sqrt(l.a / amax), t: Model.transmittance(sample(), l.v) }; });
    }
    Diagram.update({ x: Sim.state.x, travel: S.travel, signal: signalNow(), delta: 2 * Sim.state.x, lines: lines });
    els.waveNote.classList.toggle('is-off', !(lines && Diagram.wavesAt(S.travel)));
  }

  function ifgRange() {
    if (S.ifgView === 'full') return [0, 2 * S.travel];
    // Centred on the mirror, but never reaching below zero path difference, where the travel starts.
    var a = Math.max(0, 2 * Sim.state.x - VIEW_HALF);
    return [a, a + 2 * VIEW_HALF];
  }

  function drawIfg() {
    var st = Sim.state, r = ifgRange(), series = [], i0 = st.jLo + J, i1 = st.jHi + J;
    var lo = Math.max(i0, Math.floor(r[0] / DD) + J), hi = Math.min(i1, Math.ceil(r[1] / DD) + J);
    var showComp = S.ifgComp && S.source === 'two', showBg = S.ifgCompare && S.sample !== 'empty';
    var recorded = st.jLo !== null;    // nothing during a scan's retrace
    if (showBg && recorded) series.push({ x0: -J * DD, dx: DD, y: bgPct, i0: i0, i1: i1, color: '--text-secondary', dash: 'dashdot', smooth: true, fn: exactCurve(beamBg, 1), edgeFn: edgeCurve(beamBg, 1) });
    if (showComp && recorded) {
      series.push({ x0: -J * DD, dx: DD, y: comp1, i0: i0, i1: i1, color: '--series-a', dash: 'dashed', smooth: true, fn: componentCurve(0) });
      series.push({ x0: -J * DD, dx: DD, y: comp2, i0: i0, i1: i1, color: '--series-d', dash: 'dotted', smooth: true, fn: componentCurve(1) });
    }
    if (recorded) series.push({ x0: -J * DD, dx: DD, y: pct, i0: i0, i1: i1, color: '--series-c', smooth: true, fn: exactCurve(beam, 1), edgeFn: edgeCurve(beam, 1),
      resid: S.noise ? noisePct : null, reach: 2 * st.x });
    var sig = signalNow() * 100, ymin = 0, ymax = 100;
    if (S.ifgFit) {
      var mn = sig, mx = sig;
      series.forEach(function (s) {
        var a = Math.max(lo, s.i0), b = Math.min(hi, s.i1);
        for (var i = a; i <= b; i++) { var v = s.y[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      });
      var pad = Math.max((mx - mn) * 0.08, 0.05);
      ymin = Math.max(0, mn - pad);
      ymax = Math.min(105, mx + pad);
      setText(els.ifgScale, 'Vertical scale stretched to fit what is in view: ' + fmt(ymin, 2) + ' to ' + fmt(ymax, 2) + NB + '%.');
    } else {
      setText(els.ifgScale, 'Vertical scale fixed at 0 to 100' + NB + '%, the empty holder at zero path difference.');
    }
    ifgChart.draw({ panels: [{
      x: { min: r[0], max: r[1], title: 'Path difference, δ (µm)' },
      y: { min: ymin, max: ymax, title: 'Detector signal (%)' },
      series: series,
      vlines: [{ x: 2 * st.x, color: '--text-secondary', width: 1.5 }],
      markers: [{ x: 2 * st.x, y: sig, color: '--text-primary' }]
    }] });
    $('lg-ifg-comp1').hidden = $('lg-ifg-comp2').hidden = !showComp;
    $('lg-ifg-bg').hidden = !showBg;
    ifgTable();
  }

  function ifgTable() {
    if (!$('ifg-table-view').open) return;
    if (Sim.state.jLo === null) {
      $('ifg-table-note').textContent = 'Nothing recorded yet.';
      Steps.fillTable($('ifg-table'), ['Path difference, δ (µm)', 'Detector signal (%)'], []);
      return;
    }
    var st = Sim.state, r = ifgRange(), lo = Math.max(st.jLo, Math.ceil(r[0] / DD)), hi = Math.min(st.jHi, Math.floor(r[1] / DD));
    var rows = [], step = Math.max(1, Math.ceil((hi - lo + 1) / 200)), head = ['Path difference, δ (µm)', 'Detector signal (%)'];
    if (S.ifgCompare && S.sample !== 'empty') head.push('Empty holder (%)');
    for (var j = lo; j <= hi; j += step) {
      var row = [fmt(j * DD, 2), fmt(pct[j + J], 2)];
      if (head.length > 2) row.push(fmt(bgPct[j + J], 2));
      rows.push(row);
    }
    var note = hi < lo ? 'Nothing recorded in the chart\'s view.' : (step > 1 ? 'One reading in every ' + step : 'Every reading') + ' in the chart\'s view, from δ = ' + fmt(lo * DD, 1) + ' to ' + fmt(hi * DD, 1) + NB + 'µm.';
    var key = head.length + '|' + lo + '|' + hi + '|' + step + '|' + (rows[0] || []).join();
    if ($('ifg-table')._key === key && !dirty.rec) return;
    $('ifg-table')._key = key;
    $('ifg-table-note').textContent = note;
    Steps.fillTable($('ifg-table'), head, rows);
  }

  function computeSpectra() {
    var st = Sim.state;
    sp = Model.spectra(st.values, beamBg.grid, st.jLo, st.jHi, S.win, S.source === 'broad');
    noiseReadout(st);
    Steps.setData({ sp: sp, values: st.values, pct: pct, jLo: st.jLo, jHi: st.jHi, broad: S.source === 'broad', travel: S.travel, win: S.win });
    drawSpectrum();
    absorptions();
  }

  /**
   * With noise on: the rms difference from the same transform without noise, so it is the noise alone,
   * in what is shown (noiseRms) and in the single-beam spectrum (noiseSingle, for finding absorptions).
   */
  function noiseReadout(st) {
    noiseRms = noiseSingle = 0;
    var el = $('noise-readout');
    if (!S.noise || !sp || !sp.ok) { setText(el, ''); return; }
    var clean = Model.spectra(beam.grid, beamBg.grid, st.jLo, st.jHi, S.win, S.source === 'broad');
    var broad = S.source === 'broad', sum = 0, n = 0, sumS = 0, nS = 0;
    for (var k = Math.ceil(Model.V_LO / DVT); k <= Math.floor(Model.V_HI / DVT); k++) {
      var a = broad ? sp.T[k] : sp.single[k], b = broad ? clean.T[k] : clean.single[k];
      if (k * DVT >= 500 && isFinite(a) && isFinite(b) && (!broad || sp.bg[k] > 0.25)) { sum += (a - b) * (a - b); n++; }
      sumS += (sp.single[k] - clean.single[k]) * (sp.single[k] - clean.single[k]);
      nS++;
    }
    noiseRms = n ? Math.sqrt(sum / n) : 0;
    noiseSingle = nS ? Math.sqrt(sumS / nS) : 0;
    var scans = S.scans === 1 ? 'one scan' : 'the average of ' + S.scans + ' scans';
    setText(el, broad ?
      'Noise, from ' + scans + ': ±' + fmt(noiseRms * 100, 2) + NB + '% transmittance (rms) where the source is bright (at least a quarter of its peak); signal-to-noise about ' + fmt(1 / noiseRms, 0) + ' on the 100' + NB + '% baseline.' :
      'Noise, from ' + scans + ': ±' + fmt(noiseRms, 4) + ' (rms) of the background peak; signal-to-noise about ' + fmt(1 / noiseRms, 0) + '.');
  }

  function specXs() {
    if (specXs.cache) return specXs.cache;
    var k0 = Math.ceil(Model.V_LO / DVT), k1 = Math.floor(Model.V_HI / DVT), xs = new Float64Array(k1 - k0 + 1);
    for (var k = k0; k <= k1; k++) xs[k - k0] = 1e4 / (k * DVT);
    return (specXs.cache = { k0: k0, k1: k1, xs: xs });
  }

  function minProm() { return 0.04; }

  function drawSpectrum() {
    var broad = S.source === 'broad', wl = S.axis === 'wl', g = specXs();
    var x = wl ? { min: 2.5, max: 25, title: 'Wavelength, λ (µm)', top: { title: 'Wavenumber (cm⁻¹)', ticks: WN_TICKS.map(function (v) { return { at: 1e4 / v, label: fmt(v, 0) }; }) } }
      : { min: Model.V_HI, max: Model.V_LO, title: 'Wavenumber, ν̃ (cm⁻¹)', top: { title: 'Wavelength (µm)', ticks: WL_TICKS.map(function (l) { return { at: 1e4 / l, label: String(l) }; }) } };
    var panel = { x: x, y: { min: 0, max: 110, title: 'Transmittance (%)' }, series: [], notes: [], bands: [], hlines: [] };
    function pos(v) { return wl ? 1e4 / v : v; }
    var legendItems = [];
    if (!sp || !sp.ok) {
      var why = !sp || sp.reason === 'empty' ? 'Nothing is recorded yet. Scan, or move the mirror, to see a spectrum.' :
        sp.reason === 'no-zpd' ? 'The recording must pass through zero path difference before it can be transformed.' :
          'The recording is too short to transform. Move the mirror further from zero path difference, or press Scan.';
      panel.message = why;
      if (!broad) panel.y = { min: 0, max: 1.1, title: 'Relative intensity' };
      setText(els.specSub, 'No spectrum yet. ' + why);
    } else if (broad) {
      var n = g.k1 - g.k0 + 1, y = new Float64Array(n), k, A = S.ymode === 'A', ymax = 0;
      for (k = 0; k < n; k++) {
        var t = sp.T[g.k0 + k];
        y[k] = A ? (t > 0 ? Math.min(3, -Math.log10(t)) : NaN) : t * 100;
        if (A && y[k] > ymax) ymax = y[k];
      }
      if (A) panel.y = { min: Math.min(0, -0.05), max: Math.max(1, Math.ceil(ymax * 11) / 10), title: 'Absorbance' };
      else panel.hlines.push({ y: 100, color: '--axis', width: 1 });
      panel.bands.push({ x0: pos(1200), x1: pos(600), color: '--series-a', label: 'Fingerprint region' });
      panel.series.push(wl ? { xs: g.xs, y: y, color: '--series-d' } : { x0: g.k0 * DVT, dx: DVT, y: y, color: '--series-d' });
      Model.dips(sp, sample(), minProm(), noiseSingle).sort(function (p, q) { return p.T - q.T; }).forEach(function (dp) {
        panel.notes.push({ x: pos(dp.v), y: A ? -Math.log10(dp.T) : dp.T * 100, text: wl ? fmt(1e4 / dp.v, 2) : fmt(dp.v, 0), below: !A });
      });
      legendItems = [
        ['lg-key', '--series-d', A ? 'Absorbance' : 'Transmittance'],
        ['lg-wash', '--series-a', 'Fingerprint region, 600 to 1,200 cm⁻¹']
      ];
      setText(els.specSub, (A ? 'Absorbance' : 'Transmittance') + ' of ' + sampleLower() + ' against ' + (wl ? 'wavelength' : 'wavenumber') +
        '. Each absorption is marked with its ' + (wl ? 'wavelength' : 'wavenumber') + '; the Absorptions table names the vibration responsible.');
    } else {
      var lk0 = Math.floor(Model.V_LO / DVT), lk1 = Math.ceil(Model.V_HI / DVT), lmin = 0, lmax = 1;
      for (var q = lk0; q <= lk1; q++) { lmin = Math.min(lmin, sp.single[q]); lmax = Math.max(lmax, sp.single[q]); }
      panel.y = { min: Math.min(-0.05, lmin * 1.1), max: lmax * 1.1, title: 'Relative intensity' };
      panel.hlines.push({ y: 0, color: '--axis', width: 1 });
      var ys = sp.single.subarray(g.k0, g.k1 + 1);
      panel.series.push(wl ? { xs: g.xs, y: ys, color: '--series-c' } : { x0: g.k0 * DVT, dx: DVT, y: ys, color: '--series-c' });
      Model.lines(sp, sourceDesc()).forEach(function (l) {
        panel.notes.push({ x: pos(l.v), y: l.I, text: wl ? fmt(1e4 / l.v, 2) : fmt(l.v, 0) });
      });
      legendItems = [
        ['lg-key', '--series-c', 'Single-beam intensity']
      ];
      setText(els.specSub, 'With one or two wavelengths the spectrum is a peak at each one. Choose Broadband IR for a transmittance spectrum of the sample.');
    }
    specChart.draw({ panels: [panel] });
    specLegend(legendItems);
    $('spec-canvas').setAttribute('aria-label', (broad ? (S.ymode === 'A' ? 'Absorbance' : 'Transmittance') + ' spectrum' : 'Single-beam spectrum') +
      ' against ' + (wl ? 'wavelength in micrometres' : 'wavenumber per centimetre') + '. The absorptions are listed in the Absorptions table and the values are in the table below the chart.');
    specTable();
  }

  function specLegend(items) {
    var ul = $('spec-legend'), key = items.map(function (i) { return i.join('|'); }).join(';');
    if (ul._key === key) return;
    ul._key = key;
    ul.textContent = '';
    items.forEach(function (it) {
      var li = document.createElement('li'), sw = document.createElement('span'), tx = document.createElement('span');
      li.className = 'lg';
      sw.className = it[0];
      sw.style.setProperty('--key', 'var(' + it[1] + ')');
      sw.setAttribute('aria-hidden', 'true');
      tx.textContent = it[2];
      li.appendChild(sw);
      li.appendChild(tx);
      ul.appendChild(li);
    });
  }

  function specTable() {
    if (!$('spec-table-view').open) return;
    var head, rows = [], broad = S.source === 'broad';
    if (!sp || !sp.ok) {
      head = ['Wavenumber (cm⁻¹)'];
      $('spec-table-note').textContent = 'No spectrum yet.';
    } else {
      head = ['Wavenumber (cm⁻¹)', 'Wavelength (µm)', broad ? (S.ymode === 'A' ? 'Absorbance' : 'Transmittance (%)') : 'Relative intensity'];
      for (var v = Model.V_HI; v >= Model.V_LO; v -= 20) {
        var val;
        if (broad) { var t = Model.sampleAt(sp.T, v); val = S.ymode === 'A' ? fmt(-Math.log10(t), 3) : fmt(t * 100, 1); }
        else val = fmt(Model.sampleAt(sp.single, v), 3);
        rows.push([fmt(v, 0), fmt(1e4 / v, 3), val]);
      }
      $('spec-table-note').textContent = 'Every 20' + NB + 'cm⁻¹, read from the spectrum.';
    }
    Steps.fillTable($('spec-table'), head, rows);
  }

  function absorptions() {
    if (Sim.isScanning()) return;   // updated when the scan stops, so the table does not churn
    var t = $('abs-table'), tr = t.tHead.rows[0], tb = t.tBodies[0], head, msg, rows = [];
    if (!sp || !sp.ok) {
      head = ['Wavenumber (cm⁻¹)', 'Wavelength (µm)'];
      msg = 'No spectrum yet.';
    } else if (S.source === 'broad') {
      var ds = Model.dips(sp, sample(), minProm(), noiseSingle);
      head = ['Wavenumber (cm⁻¹)', 'Wavelength (µm)', 'Transmittance (%)', 'Vibration'];
      var stray = 0;
      ds.forEach(function (d) {
        if (!d.band) stray++;
        rows.push([fmt(d.v, 0), fmt(1e4 / d.v, 2), fmt(d.T * 100, 0), d.band ? d.band.what : 'Not one of this sample\'s bands']);
      });
      msg = S.sample === 'empty' ? 'No absorptions: with the holder empty, the transmittance is 100 % everywhere.' :
        ds.length ? ds.length + (ds.length === 1 ? ' absorption' : ' absorptions') + ' found for ' + sampleLower() + ', at resolution ' + fmt(sp.res, 1) + NB + 'cm⁻¹.' :
          'No absorptions found.';
      if (S.noise && S.sample !== 'empty') {
        msg += ' With noise, a dip is listed only where it stands at least 7 times the noise clear; average more scans to bring out weaker bands.';
      }
      if (sp.res > 50 && S.sample !== 'empty') {
        msg += ' At ' + fmt(sp.res, 0) + NB + 'cm⁻¹ resolution, bands closer together than that blur into one broad dip; choose 4' + NB + 'cm⁻¹ and scan to resolve them.';
      } else if (stray) {
        msg += ' Rows marked “not one of this sample\'s bands” are ' + (S.noise ? 'noise or ' : '') + 'ripples, not absorptions.' +
          (S.win === 'none' ? ' Ripples beside strong bands come from the abrupt ends of the scan; apodization, under From Interferogram to Spectrum, removes most of them.' : '');
      }
    } else {
      head = ['Peak', 'Wavenumber found (cm⁻¹)', 'Wavelength (µm)', 'Set to (cm⁻¹)', 'Relative intensity'];
      Model.lines(sp, sourceDesc()).forEach(function (l) {
        rows.push([String(l.n), fmt(l.v, 0), fmt(1e4 / l.v, 2), fmt(l.set, 0), fmt(l.I, 3)]);
      });
      msg = (rows.length === 1 ? 'One peak, at the wavenumber in the beam.' : 'Two peaks, one at each wavenumber in the beam.') +
        ' With one or two wavelengths there is no transmittance spectrum to read absorptions from.';
    }
    setStatus($('abs-status'), msg);
    $('abs-hint').hidden = S.source !== 'broad';
    var key = head.join() + '|' + rows.map(function (r) { return r.join(); }).join(';');
    if (t._key === key) return;
    t._key = key;
    tr.textContent = '';
    head.forEach(function (h, i) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      if (h === 'Vibration') th.className = 'text';
      tr.appendChild(th);
    });
    tb.textContent = '';
    rows.forEach(function (r) {
      var row = document.createElement('tr');
      r.forEach(function (c, i) {
        var td = document.createElement('td');
        if (head[i] === 'Vibration') { td.className = 'text'; Page.setRich(td, c); } else td.textContent = c;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
  }

  // --- the loop --------------------------------------------------------------------------------------

  function kick() {
    if (running) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(t) {
    var dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    advance(t, dt);
    if (Sim.isScanning() || Steps.isSweeping() || dirty.spec || dirty.now) requestAnimationFrame(frame);
    else running = false;
  }

  /** One frame's work: move the scan and the sweep by dt seconds, then redraw whatever changed. */
  function advance(t, dt) {
    var r = Sim.tick(dt);
    if (r) {
      dirty.rec = dirty.view = dirty.now = true;
      if (r === 'done') scanDone();
    }
    Steps.tick(dt);
    if (dirty.rec) {
      var st = Sim.state;
      if (st.jLo !== null) {
        for (var j = st.jLo; j <= st.jHi; j++) {
          pct[j + J] = st.values[j + J] * 100;
          noisePct[j + J] = pct[j + J] - beam.grid[j + J] * 100;
        }
      }
      dirty.spec = true;
    }
    if (dirty.spec && (!Sim.isScanning() || t >= specDueAt)) {
      computeSpectra();
      dirty.spec = false;
      specDueAt = t + 250;
    }
    if (dirty.view || dirty.rec) {
      showMirrorControls();
      drawDiagram();
      drawSignalChart();
      drawIfg();
    }
    if (dirty.now && (!Sim.isScanning() || t >= nowDueAt)) {
      describeSignalNow();
      dirty.now = false;
      nowDueAt = t + 200;
    }
    dirty.rec = dirty.view = false;
  }

  function redrawAll() {
    Charts.refresh();
    drawDiagram();
    drawSignalChart();
    drawIfg();
    drawSpectrum();
    Steps.refresh();
  }

  /**
   * The drawing fills the panel. Where the panel is wide enough for the Detector Signal chart to keep a
   * useful size beside the interferometer, the drawing takes its wide layout and the chart lies over its
   * clear top right corner; otherwise the drawing keeps its narrow layout with the chart under it.
   */
  function placeSignalChart() {
    var inst = els.instrument, present = document.documentElement.hasAttribute('data-present');
    var wide = inst.clientWidth >= (present ? 960 : 860);
    Diagram.setLayout(wide ? 'wide' : 'narrow');
    inst.classList.toggle('overlay', wide);
    var c = Diagram.chartPlace();
    if (c) {
      inst.style.setProperty('--chart-w', (c.w * 100).toFixed(3) + '%');
      inst.style.setProperty('--chart-top', (c.y * 100).toFixed(3) + '%');
      inst.style.setProperty('--chart-ratio', c.ratio.toFixed(4));
    }
  }

  function layout() {
    placeSignalChart();
    ifgChart.layout();
    specChart.layout();
    sigChart.layout();
    Diagram.fit();
    Steps.layout();
    drawSignalChart();
    drawIfg();
    drawSpectrum();
  }

  // --- start -----------------------------------------------------------------------------------------

  function init() {
    els.scan = $('scan');
    els.scanStatus = $('scan-status');
    els.mirror = $('mirror');
    els.mirrorNum = $('mirror-num');
    els.mirrorMsg = $('mirror-num-msg');
    els.signalCanvas = $('signal-canvas');
    els.ifgScale = $('ifg-scale');
    els.specSub = $('spec-sub');

    Charts.refresh();
    ifgChart = Charts.create($('ifg-canvas'));
    specChart = Charts.create($('spec-canvas'));
    sigChart = Charts.create($('signal-canvas'));
    // A browser may put checkboxes back as they were before a reload; the page starts from its defaults.
    document.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = c.defaultChecked; });
    els.instrument = document.querySelector('.instrument');
    els.waveNote = $('wave-note');
    Diagram.init($('diagram'), {
      onDrag: function (x) { stopScan(); moveMirror(x); }
    });
    shuffleUnknowns();
    buildSampleSelect();
    showSourceControls();
    showLineOutputs();
    showSample();
    showTravel();
    showNoiseControls();
    rebuildBeam(false);
    Sim.init(read);
    Steps.init({
      setWindow: function (w) { setWindow(w); },
      changed: function () { dirty.spec = true; kick(); },
      run: function () { kick(); }    // a sweep moves on each frame
    });

    document.querySelectorAll('[data-source]').forEach(function (b) {
      b.addEventListener('click', function () { setSource(b.dataset.source); });
    });
    ['v1', 'v2', 'ratio'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        S[id] = Number($(id).value);
        if (id !== 'ratio') { $(id + '-num').removeAttribute('aria-invalid'); $(id + '-num-msg').textContent = ''; }
        showLineOutputs();
        rebuildBeam(true);
      });
    });
    ['v1', 'v2'].forEach(function (id) {
      var box = $(id + '-num');
      box.addEventListener('input', function () { box._editing = true; });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyWnNum(id); }
        else if (e.key === 'Escape' && box._editing) {
          // Abandon the edit; this Escape does not also leave presentation mode.
          e.stopPropagation();
          box._editing = false;
          box.removeAttribute('aria-invalid');
          $(id + '-num-msg').textContent = '';
          showLineOutputs();
        }
      });
      box.addEventListener('blur', function () { if (box._editing) applyWnNum(id); });
    });

    els.mirror.addEventListener('input', function () {
      stopScan();
      moveMirror(Number(els.mirror.value));
    });
    els.mirrorNum.addEventListener('input', function () { els.mirrorNum._editing = true; });
    els.mirrorNum.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyMirrorNum(); }
      else if (e.key === 'Escape' && els.mirrorNum._editing) {
        // Abandon the edit; this Escape does not also leave presentation mode.
        e.stopPropagation();
        els.mirrorNum._editing = false;
        els.mirrorNum.removeAttribute('aria-invalid');
        els.mirrorMsg.textContent = '';
        showMirrorControls();
      }
    });
    els.mirrorNum.addEventListener('blur', function () { if (els.mirrorNum._editing) applyMirrorNum(); });

    els.scan.addEventListener('click', function () {
      if (Sim.isScanning()) {
        Sim.pauseScan();
        setStatus(els.scanStatus, 'Scan paused at ' + fmt(Sim.state.x, 1) + NB + 'µm.');
      } else {
        var resume = Sim.inProgress(), t = S.travel, x = Sim.state.x;
        Sim.startScan();
        var retrace = Sim.phase() === 'retrace' ? Math.abs(x) / Sim.retraceSpeed() : 0;
        var secs = retrace + t / Sim.state.speed;
        var takes = secs < 90 ? 'about ' + Math.max(1, Math.round(secs)) + NB + 's' : 'about ' + Math.round(secs / 60) + NB + 'min';
        setStatus(els.scanStatus, resume ? 'Scan resumed.' : 'Scanning: a new recording. ' +
          (retrace ? 'The mirror returns to 0' + NB + 'µm (zero path difference) without recording, then sweeps' : 'The mirror sweeps from 0') +
          ' to ' + travelText(t) + NB + 'µm at ' + fmt(Sim.state.speed, Sim.state.speed < 1 ? 1 : 0) + NB + 'µm/s, recording (' + takes + ').');
      }
      scanButton();
      kick();
    });
    $('zero').addEventListener('click', function () {
      stopScan();
      moveMirror(0);
      setStatus(els.scanStatus, 'Mirror at zero path difference: both arms are the same length.');
    });
    $('clear').addEventListener('click', function () {
      newRecording();
      setStatus(els.scanStatus, 'Recording cleared. Only the mirror\'s present position is recorded.');
    });
    $('speed').addEventListener('change', function () { slowSpeed = null; Sim.setSpeed(Number($('speed').value)); });

    Sim.setSpeed(Number($('speed').value));

    document.querySelectorAll('[data-res]').forEach(function (b) {
      b.addEventListener('click', function () { setResolution(Number(b.dataset.res)); });
    });
    $('noise-on').addEventListener('change', function () {
      S.noise = this.checked;
      showNoiseControls();
      newRecording();
      setStatus(els.scanStatus, 'Noise ' + (S.noise ? 'on' : 'off') + ': a new recording starts as the mirror moves.');
    });
    document.querySelectorAll('[data-scans]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.scans = Number(b.dataset.scans);
        showNoiseControls();
        newRecording();
        setStatus(els.scanStatus, 'Averaging ' + (S.scans === 1 ? 'one scan' : S.scans + ' scans') + ': a new recording starts as the mirror moves.');
      });
    });

    $('quiz-check').addEventListener('click', function () {
      var ans = $('quiz-answer').value, truth = unknownOf[S.sample];
      if (!ans) { quizStatus('Choose a compound first.', ''); return; }
      if (ans === truth) quizStatus('✓ Correct: ' + unknownInText() + ' is ' + Samples.get(truth).name.toLowerCase() + '.', 'ok');
      else quizStatus('✕ Not ' + Samples.get(ans).name.toLowerCase() + '. Compare the absorptions with the bonds each liquid has, and try again.', 'bad');
    });
    $('quiz-reveal').addEventListener('click', function () {
      quizStatus(sampleLabel() + ' is ' + Samples.get(unknownOf[S.sample]).name.toLowerCase() + '.', '');
    });
    $('quiz-new').addEventListener('click', function () {
      shuffleUnknowns();
      $('quiz-answer').value = '';
      quizStatus('New unknowns chosen: each of A, B and C may now be a different liquid.', '');
      rebuildBeam(isUnknown());
    });

    document.querySelectorAll('[data-ifg-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.ifgView = b.dataset.ifgView;
        document.querySelectorAll('[data-ifg-view]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        dirty.view = true;
        kick();
      });
    });
    $('ifg-fit').addEventListener('change', function () { S.ifgFit = this.checked; dirty.view = true; kick(); });
    $('ifg-components').addEventListener('change', function () { S.ifgComp = this.checked; dirty.view = true; kick(); });
    $('ifg-compare').addEventListener('change', function () { S.ifgCompare = this.checked; dirty.view = true; kick(); });
    $('ifg-table-view').addEventListener('toggle', function () { $('ifg-table')._key = ''; ifgTable(); });

    document.querySelectorAll('[data-axis]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.axis = b.dataset.axis;
        document.querySelectorAll('[data-axis]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        drawSpectrum();
      });
    });
    document.querySelectorAll('[data-ymode]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.ymode = b.dataset.ymode;
        document.querySelectorAll('[data-ymode]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        drawSpectrum();
      });
    });
    $('spec-table-view').addEventListener('toggle', specTable);
    // The transform's chart has no size while its panel is closed, so it is laid out when it opens.
    $('ft-fold').addEventListener('toggle', function () { if (this.open) { Steps.layout(); Steps.refresh(); } });

    Page.init({
      themeKey: 'interferometer-theme',
      refresh: redrawAll,
      layout: layout,
      escape: function () { return false; }
    });

    Steps.setData({ sp: null, values: Sim.state.values, pct: pct, jLo: null, jHi: null, broad: false, travel: S.travel, win: S.win });
    layout();
    dirty.rec = dirty.view = dirty.now = dirty.spec = true;
    kick();
    Page.start();
    setTimeout(Diagram.fit, 0);
  }

  root.app = {
    S: S, Sim: Sim, Model: Model,
    beam: function () { return beam; }, spectra: function () { return sp; },
    setSample: setSample, setSource: setSource, moveMirror: moveMirror, redraw: redrawAll,
    /** Bring everything up to date now, without waiting for a frame (for console checks). */
    flush: function () { advance(performance.now() + 1e6, 0); },
    unknowns: function () { return unknownOf; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
