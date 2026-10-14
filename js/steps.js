/* FTIR Interferometer: the Fourier transform, from interferogram to spectrum. One canvas in four
 * stacked panels: the interferogram (its average subtracted, and windowed if apodization is shown),
 * the probe cosine, their product, and the spectrum built so far, one probe wavenumber at a time by
 * the same sum the FFT does all at once. The background can be overlaid on the spectrum.
 * Exposes window.Steps.
 */
(function (root) {
  'use strict';

  var J = Model.J_LIMIT, DD = Model.DD_UM, DVT = Model.DVT, NB = Page.NB;
  var NEAR = 40;                       // µm of path difference from zero in the near view
  var SWEEP_RATE = 360;                // cm⁻¹ per second

  var app, chart, els = {}, zoom = 'near', d = null, built = null, builtFor = null;
  var probeV = 1000, sweeping = false, paused = false, lastTable = '';
  // The spectrum starts whole, as Transform All leaves it; Clear Points or a fresh Sweep empties it so
  // it can be built one probe wavenumber at a time.
  var whole = true;

  function $(id) { return document.getElementById(id); }
  function fmt(v, n) { return Page.fmt(v, n); }

  function init(a) {
    app = a;
    chart = Charts.create($('step-canvas'));
    els.showApod = $('show-apod');
    els.apodBlock = $('apod-block');
    els.showBg = $('show-bg');
    els.legend = $('step-legend');
    els.status = $('step-status');
    els.probe = $('probe');
    els.probeOut = $('probe-out');
    els.sweep = $('sweep');
    els.probeSum = $('probe-sum');
    els.probeCount = $('probe-count');
    els.tableView = $('step-table-view');
    els.table = $('step-table');
    els.tableNote = $('step-table-note');
    els.tableCaption = $('step-table-caption');

    els.showApod.addEventListener('change', function () {
      els.apodBlock.hidden = !els.showApod.checked;
      // Hiding apodization also takes its window away, so the transform shows what it says.
      if (!els.showApod.checked) app.setWindow('none');
      app.changed();
    });
    els.showBg.addEventListener('change', draw);
    document.querySelectorAll('[data-win]').forEach(function (b) {
      b.addEventListener('click', function () { app.setWindow(b.dataset.win); });
    });
    document.querySelectorAll('[data-step-zoom]').forEach(function (b) {
      b.addEventListener('click', function () {
        zoom = b.dataset.stepZoom;
        pressChips('[data-step-zoom]', zoom, 'stepZoom');
        draw();
      });
    });
    els.probe.addEventListener('input', function () {
      var from = probeV;
      setProbe(Number(els.probe.value));
      fillBetween(from, probeV);
      computeAt(probeV);
      draw();
    });
    els.sweep.addEventListener('click', function () {
      if (sweeping) { paused = true; setSweeping(false); return; }
      if (!ready()) return;
      if (!paused) {
        // A fresh sweep builds the spectrum from 400 cm⁻¹, one probe wavenumber at a time, so it can be
        // watched; Resume carries on from where the probe was paused.
        ensureBuilt();
        whole = false;
        built.fill(NaN);
        setProbe(Model.V_LO);
      }
      paused = false;
      setSweeping(true);
      app.run();
    });
    $('fft-all').addEventListener('click', function () {
      if (!ready()) return;
      paused = false;
      setSweeping(false);
      whole = true;
      built = Float64Array.from(d.sp.single);
      builtFor = d.sp;
      draw();
    });
    $('clear-points').addEventListener('click', function () {
      paused = false;
      setSweeping(false);
      whole = false;
      if (built) built.fill(NaN);
      draw();
    });
    els.tableView.addEventListener('toggle', function () { lastTable = ''; table(); });
    els.specView = $('ft-spec-table-view');
    els.specTable = $('ft-spec-table');
    els.specNote = $('ft-spec-table-note');
    els.specView.addEventListener('toggle', function () { els.specTable._key = ''; specTable(); });
    setProbe(probeV);
  }

  function pressChips(sel, value, key) {
    document.querySelectorAll(sel).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset[key] === value));
    });
  }

  function ready() { return !!(d && d.sp && d.sp.ok); }

  function setProbe(v) {
    probeV = Math.max(Model.V_LO, Math.min(Model.V_HI, v));
    els.probe.value = String(Math.round(probeV));
    var t = fmt(probeV, 0) + NB + 'cm⁻¹ · ' + fmt(1e4 / probeV, 2) + NB + 'µm';
    els.probeOut.textContent = t;
    els.probe.setAttribute('aria-valuetext', fmt(probeV, 0) + ' per centimetre, wavelength ' + fmt(1e4 / probeV, 2) + ' micrometres');
  }

  function setSweeping(on) {
    sweeping = on;
    els.sweep.textContent = on ? 'Pause' : paused ? 'Resume Sweep' : 'Sweep';
    if (!on && els.specView) specTable();
  }

  function ensureBuilt() {
    if (!ready()) return false;
    if (builtFor !== d.sp) {
      built = whole ? Float64Array.from(d.sp.single) : new Float64Array(d.sp.single.length).fill(NaN);
      builtFor = d.sp;
    }
    return true;
  }

  /** Probe one wavenumber: add its point to the spectrum being built. */
  function computeAt(v) {
    if (!ensureBuilt()) return NaN;
    var k = Math.round(v / DVT), val = Model.probe(d.sp.tr, k * DVT) / d.sp.norm;
    built[k] = val;
    return val;
  }

  /**
   * Every wavenumber the probe passed on its way from a to b (cm⁻¹) gets its point, so moving the probe
   * draws the spectrum behind it: single points 0.48 cm⁻¹ apart with gaps between would draw no line.
   * The FFT has already computed the same sums at every grid point, so they are copied from it, which
   * keeps a long jump instant.
   */
  function fillBetween(a, b) {
    if (!ensureBuilt()) return;
    var lo = Math.max(0, Math.round(Math.min(a, b) / DVT)), hi = Math.min(built.length - 1, Math.round(Math.max(a, b) / DVT));
    for (var k = lo; k <= hi; k++) if (isNaN(built[k])) built[k] = d.sp.single[k];
  }

  /** Advance a sweep by dt seconds; true when something moved. */
  function tick(dt) {
    if (!sweeping) return false;
    if (!ensureBuilt()) { setSweeping(false); return false; }
    var v0 = probeV, v1 = Math.min(Model.V_HI, v0 + SWEEP_RATE * dt);
    for (var k = Math.ceil(v0 / DVT); k * DVT <= v1; k++) {
      built[k] = Model.probe(d.sp.tr, k * DVT) / d.sp.norm;
    }
    setProbe(v1);
    if (v1 >= Model.V_HI) { paused = false; setSweeping(false); }
    draw();
    return true;
  }

  /** New data from the page: { sp, travel, win }. */
  function setData(data) {
    d = data;
    if (d.sp && d.sp.ok && builtFor && builtFor !== d.sp && built && !whole) {
      // A new recording or setting: the points already probed are redone at the same wavenumbers.
      // (A whole spectrum is simply taken whole again, in ensureBuilt.)
      // The FFT has already computed the same sums at every grid point, so they are copied from it.
      var old = built;
      builtFor = null;
      ensureBuilt();
      for (var k = 0; k < old.length; k++) if (!isNaN(old[k])) built[k] = d.sp.single[k];
    }
    pressChips('[data-win]', d.win, 'win');
    draw();
  }

  // --- drawing --------------------------------------------------------------------------------------

  function legend(items) {
    var key = items.map(function (i) { return i.join('|'); }).join(';');
    if (els.legend._key === key) return;
    els.legend._key = key;
    els.legend.textContent = '';
    items.forEach(function (it) {
      var li = document.createElement('li'), sw = document.createElement('span'), tx = document.createElement('span');
      li.className = 'lg';
      sw.className = it[0];
      sw.style.setProperty('--key', 'var(' + it[1] + ')');
      sw.setAttribute('aria-hidden', 'true');
      tx.textContent = it[2];
      li.appendChild(sw);
      li.appendChild(tx);
      els.legend.appendChild(li);
    });
  }

  function setText(el, s) { if (el._s !== s) { el._s = s; el.textContent = s; } }

  function status(s) { setText(els.status, s); }

  function blockedMessage() {
    if (!d || !d.sp) return 'Move the mirror to record an interferogram first.';
    var r = d.sp.reason;
    if (r === 'empty') return 'Nothing is recorded yet. Move the mirror or press Scan.';
    if (r === 'no-zpd') return 'The transform needs the recording to pass through zero path difference, where the arms are equal. Move the mirror through 0 µm.';
    if (r === 'short') return 'The recording is too short to transform. Move the mirror further from zero path difference.';
    return '';
  }

  /** The view range in δ (µm) for the top three panels: from zero, as the mirror only moves out. */
  function deltaRange() {
    if (zoom === 'near') return [0, NEAR];
    var m = d && d.sp && d.sp.ok ? d.sp.M * DD : 2 * (d ? d.travel : 625);
    return [0, Math.max(m, NEAR)];
  }

  /** Symmetric arrays over j = −M … M from a one-sided array (index k ≥ 0). */
  function mirror(oneSided, scale) {
    var M = oneSided.length - 1, out = new Float64Array(2 * M + 1);
    for (var j = -M; j <= M; j++) out[j + M] = oneSided[Math.abs(j)] * scale;
    return out;
  }

  function minMax(arr, i0, i1) {
    var lo = Infinity, hi = -Infinity;
    for (var i = Math.max(0, i0); i <= Math.min(arr.length - 1, i1); i++) {
      if (isFinite(arr[i])) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; }
    }
    return [lo, hi];
  }

  /**
   * A series over the recorded path differences, zero to δmax. Its array runs over j = −M … M, the
   * negative half the mirror image of the positive, so the smooth curve starts at zero without an edge.
   */
  function positive(series) {
    var M = d.sp.tr.M;
    series.x0 = -M * DD;
    series.dx = DD;
    series.i0 = M;
    series.i1 = 2 * M;
    return series;
  }

  function rangeY(arr, r, M) {
    var mm = minMax(arr, Math.floor(r[0] / DD) + M, Math.ceil(r[1] / DD) + M), a = Math.max(Math.abs(mm[0]), Math.abs(mm[1]));
    if (!isFinite(a) || a <= 0) a = 1;
    return a * 1.12;
  }

  /** The window (0 to 1) and the processed interferogram (% points), both over j = −M … M. */
  function windowArrays() {
    var tr = d.sp.tr, M = tr.M, w = new Float64Array(M + 1);
    for (var k = 0; k <= M; k++) w[k] = Model.windowValue(tr.win, k / M);
    return { w: mirror(w, 1), x: mirror(tr.x, 100) };
  }

  function draw() {
    if (!els.legend) return;
    var msg = blockedMessage();
    if (msg) {
      chart.draw({ panels: [{ x: { min: 0, max: NEAR, title: 'Path difference, δ (µm)' }, y: { min: -1, max: 1 }, message: msg }] });
      legend([]);
      setText(els.probeSum, '—');
      setText(els.probeCount, '—');
      $('step-canvas').setAttribute('aria-label', 'Fourier transform chart, empty: ' + msg);
    } else {
      drawTransform();
    }
    status(msg);
    table();
    specTable();
  }

  function drawTransform() {
    ensureBuilt();
    var tr = d.sp.tr, M = tr.M, r = deltaRange(), wa = windowArrays(), windowed = tr.win !== 'none', bg = els.showBg.checked;
    var cosA = new Float64Array(2 * M + 1), prod = new Float64Array(2 * M + 1), j;
    for (j = -M; j <= M; j++) {
      cosA[j + M] = Model.probeWave(probeV, j);
      prod[j + M] = wa.x[j + M] * cosA[j + M];
    }
    var a = rangeY(wa.x, r, M), b = rangeY(prod, r, M);
    function probeAt(dv) { return Math.cos(2 * Math.PI * probeV * dv * 1e-4); }
    var val = computeAt(probeV), count = 0, k, k0 = Math.ceil(Model.V_LO / DVT), k1 = Math.floor(Model.V_HI / DVT);
    for (k = k0; k <= k1; k++) if (!isNaN(built[k])) count++;
    var sm = minMax(d.sp.single, k0, k1), sy0 = Math.min(-0.1, sm[0] * 1.1), sy1 = Math.max(1.1, sm[1] * 1.1);

    var top = [positive({ y: wa.x, color: '--series-c', smooth: true })];
    if (windowed) {
      // The window drawn as an envelope at the interferogram's height at zero path difference.
      var pk = Math.abs(wa.x[M]) || a / 1.12, up = new Float64Array(2 * M + 1), dn = new Float64Array(2 * M + 1);
      for (j = 0; j <= 2 * M; j++) { up[j] = pk * wa.w[j]; dn[j] = -up[j]; }
      top.unshift(positive({ y: up, color: '--text-secondary', dash: 'dotted' }),
                  positive({ y: dn, color: '--text-secondary', dash: 'dotted' }));
    }
    var spec = [];
    if (bg) spec.push({ x0: 0, dx: DVT, y: d.sp.bg, color: '--text-secondary', dash: 'dashed' });
    spec.push({ x0: 0, dx: DVT, y: built, color: '--text-primary', width: 'total' });

    chart.draw({ gap: 6, panels: [
      { weight: 1, x: { min: r[0], max: r[1] }, y: { min: -a, max: a, title: 'Interferogram' },
        hlines: [{ y: 0, color: '--axis', width: 1 }], series: top },
      { weight: 0.8, x: { min: r[0], max: r[1] }, y: { min: -1.2, max: 1.2, title: 'Probe cosine' },
        hlines: [{ y: 0, color: '--axis', width: 1 }], series: [positive({ y: cosA, color: '--series-b', fn: probeAt })] },
      { weight: 1, x: { min: r[0], max: r[1], title: 'Path difference, δ (µm)' }, y: { min: -b, max: b, title: 'Product' },
        hlines: [{ y: 0, color: '--axis', width: 1 }], series: [positive({ y: prod, color: '--series-a', fill: '--series-a',
          fn: function (dv) { return Charts.interp(wa.x, -M * DD, DD, 0, 2 * M, dv) * probeAt(dv); } })] },
      { weight: 1.4, x: { min: Model.V_HI, max: Model.V_LO, title: 'Wavenumber, ν̃ (cm⁻¹)' }, y: { min: sy0, max: sy1, title: 'Relative product area' },
        hlines: [{ y: 0, color: '--axis', width: 1 }],
        vlines: [{ x: probeV, color: '--series-b', dash: [4, 4], width: 1.5 }],
        series: spec,
        // The probe's point is the product's area summed: drawn as a green bar, the product's colour.
        bars: isFinite(val) ? [{ x: Math.round(probeV / DVT) * DVT, y0: 0, y1: val, color: '--series-a', label: 'Relative product area' }] : [],
        markers: [{ x: Math.round(probeV / DVT) * DVT, y: val, color: '--series-b' }] }
    ] });

    var items = [['lg-key', '--series-c', 'Interferogram, minus its average' + (windowed ? ', times the window' : '')]];
    if (windowed) items.push(['lg-key dotted', '--text-secondary', 'Window, at the interferogram\'s height']);
    items.push(
      ['lg-key', '--series-b', 'Probe cosine at ν̃'],
      ['lg-key', '--series-a', 'Product of interferogram and cosine probe'],
      ['lg-wash', '--series-a', 'Relative product area'],
      ['lg-key thick', '--text-primary', 'Spectrum so far']);
    if (bg) items.push(['lg-key dashed', '--text-secondary', 'Background, the empty holder']);
    items.push(['lg-dot', '--series-b', 'Current cosine probe']);
    legend(items);

    setText(els.probeSum, fmt(val, 3) + ' at ' + fmt(probeV, 0) + NB + 'cm⁻¹ (the background\'s peak is 1.000)');
    setText(els.probeCount, count.toLocaleString() + ' of ' + (k1 - k0 + 1).toLocaleString() + ' points from 400 to 4,000' + NB + 'cm⁻¹');
    $('step-canvas').setAttribute('aria-label', 'The Fourier transform at the probe wavenumber, in four panels: the interferogram, the probe cosine, their product with its area shaded, and the spectrum built so far against wavenumber, with a bar at the probe whose height is the relative product area' +
      (bg ? ', with the background' : '') + '. The probe value and its sum are listed above the chart; the values are in the table below it.');
  }

  // --- table ----------------------------------------------------------------------------------------

  function table() {
    if (!els.tableView.open) return;
    var rows = [], head = [], note = '', i;
    if (!ready()) {
      head = ['Value'];
      note = blockedMessage();
    } else {
      var tr = d.sp.tr, M = tr.M, wa = windowArrays(), windowed = tr.win !== 'none', r = deltaRange();
      var a = Math.max(0, Math.ceil(r[0] / DD)), b = Math.min(M, Math.floor(r[1] / DD)), s2 = Math.max(1, Math.ceil((b - a + 1) / 200));
      head = ['Path difference, δ (µm)', 'Interferogram (% points)'];
      if (windowed) head.push('Window');
      head.push('Probe cosine', 'Product');
      for (i = a; i <= b; i += s2) {
        var c = Model.probeWave(probeV, i), row = [fmt(i * DD, 2)];
        row.push(fmt(wa.x[i + M], 3));
        if (windowed) row.push(fmt(wa.w[i + M], 3));
        row.push(fmt(c, 3), fmt(wa.x[i + M] * c, 3));
        rows.push(row);
      }
      note = (s2 > 1 ? 'One point in every ' + s2 : 'Every point') + ' in the chart\'s view, with the probe at ' + fmt(probeV, 0) + NB + 'cm⁻¹.';
    }
    var key = head.join() + '|' + rows.length + '|' + (rows[0] || []).join() + '|' + (rows[rows.length - 1] || []).join() + '|' + note;
    if (key === lastTable) return;
    lastTable = key;
    els.tableCaption.textContent = 'Values for the Fourier transform at the probe wavenumber';
    els.tableNote.textContent = note;
    fillTable(els.table, head, rows);
  }

  /** The bottom panel as a table: the spectrum so far and the background, every 20 cm⁻¹. */
  function specTable() {
    if (!els.specView.open || sweeping) return;   // a sweep's table is filled in when it stops
    var head = ['Wavenumber (cm⁻¹)', 'Wavelength (µm)', 'Relative product area (spectrum so far)', 'Background (relative)'], rows = [], note;
    if (!ready()) {
      note = blockedMessage();
    } else {
      ensureBuilt();
      for (var v = Model.V_HI; v >= Model.V_LO; v -= 20) {
        var s = built[Math.round(v / DVT)];
        rows.push([fmt(v, 0), fmt(1e4 / v, 3), isNaN(s) ? 'not yet probed' : fmt(s, 3), fmt(Model.sampleAt(d.sp.bg, v), 3)]);
      }
      note = 'Every 20' + NB + 'cm⁻¹. Relative to the background\'s peak, 1.000. Sweep or Transform All to fill in the spectrum.';
    }
    var key = rows.map(function (r) { return r[2]; }).join() + '|' + (rows[0] || []).join() + '|' + note;
    if (els.specTable._key === key) return;
    els.specTable._key = key;
    els.specNote.textContent = note;
    fillTable(els.specTable, head, rows);
  }

  function fillTable(t, head, rows) {
    var tr = t.tHead.rows[0], tb = t.tBodies[0];
    tr.textContent = '';
    head.forEach(function (h) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      tr.appendChild(th);
    });
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var row = document.createElement('tr');
      r.forEach(function (c, i) {
        var td = document.createElement('td');
        td.textContent = c;
        if (head[i] === 'Source') td.className = 'text';
        row.appendChild(td);
      });
      frag.appendChild(row);
    });
    tb.textContent = '';
    tb.appendChild(frag);
  }

  function refresh() { draw(); }
  function layout() { if (chart.layout()) draw(); }
  function closeSweep() { if (sweeping) { setSweeping(false); return true; } return false; }

  root.Steps = {
    init: init, setData: setData, tick: tick, refresh: refresh, layout: layout, draw: draw,
    isSweeping: function () { return sweeping; }, stopSweep: closeSweep, table: table, fillTable: fillTable
  };
})(window);
