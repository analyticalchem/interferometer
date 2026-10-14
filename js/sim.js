/* FTIR Interferometer: the moving mirror and the recording, with no DOM.
 *
 * The mirror's displacement x (µm) gives a path difference δ = 2x, because the light travels to the
 * mirror and back. The mirror travels from zero path difference (x = 0, the arms equal) to the end of
 * its travel, so every displacement is positive and the recording is one side of the interferogram.
 * Moving the mirror by hand (dragged or typed) records every reference-laser fringe it passes. A scan
 * works as a real instrument's does: a new recording, the mirror returned quickly to zero without
 * recording (the retrace), then one sweep at constant speed to the end, recording each fringe. Either
 * way the recording is one unbroken stretch of path difference.
 * Exposes window.Sim.
 */
(function (root) {
  'use strict';

  var J = Model.J_LIMIT;

  var st = {
    x: 0, travel: 12.5,
    values: new Float64Array(2 * J + 1).fill(NaN),
    jLo: null, jHi: null,
    scanning: false, phase: null, speed: 10,   // phase: 'retrace', 'sweep' or null; speed: µm/s
    read: function () { return NaN; }
  };

  function jMax() { return Math.floor(2 * st.travel / Model.DD_UM); }
  function jAt(x) { return Math.max(0, Math.min(jMax(), Model.jOf(2 * x))); }

  function record(j) {
    st.values[j + J] = st.read(j);
    if (st.jLo === null || j < st.jLo) st.jLo = j;
    if (st.jHi === null || j > st.jHi) st.jHi = j;
  }

  /** read(j): the detector reading at δ = j × 0.6328 µm. */
  function init(read) {
    st.read = read;
    record(jAt(st.x));
  }

  /** Move the mirror, recording every fringe passed on the way. Returns the new position. */
  function moveTo(x) {
    x = Math.max(0, Math.min(st.travel, x));
    var j0 = jAt(st.x), j1 = jAt(x), step = j1 >= j0 ? 1 : -1;
    for (var j = j0; j !== j1 + step; j += step) record(j);
    st.x = x;
    return x;
  }

  function clear() {
    empty();
    record(jAt(st.x));
  }

  /** Nothing recorded at all, during a scan's retrace. */
  function empty() {
    st.values.fill(NaN);
    st.jLo = st.jHi = null;
  }

  /** Start again: a new travel, the mirror back at zero path difference, nothing recorded. */
  function reset(t) {
    st.scanning = false;
    st.phase = null;
    st.travel = t;
    st.x = 0;
    clear();
  }

  /** Read every recorded fringe again (after the source or sample changes, or the noise does). */
  function rerecord() {
    if (st.jLo === null) return;
    for (var j = st.jLo; j <= st.jHi; j++) st.values[j + J] = st.read(j);
  }

  /** A new mirror travel (µm from zero). The mirror and the recording are kept inside it. */
  function setTravel(t) {
    st.travel = t;
    st.x = Math.max(0, Math.min(t, st.x));
    var m = jMax();
    if (st.jLo !== null) {
      for (var j = -J; j <= J; j++) if (j < 0 || j > m) st.values[j + J] = NaN;
      st.jLo = Math.max(st.jLo, 0);
      st.jHi = Math.min(st.jHi, m);
      if (st.jLo > st.jHi) { st.jLo = st.jHi = null; }
    }
    record(jAt(st.x));
  }

  // --- scanning ------------------------------------------------------------------------------

  /** The retrace runs faster than the sweep, as in a real instrument: never more than a second per travel. */
  function retraceSpeed() { return Math.max(4 * st.speed, st.travel); }

  /** Start a scan (a new recording, the retrace, then the sweep), or resume a paused one. */
  function startScan() {
    if (st.phase === null) {
      if (st.x <= 1e-9) {
        st.x = 0;
        clear();
        st.phase = 'sweep';
      } else {
        empty();
        st.phase = 'retrace';
      }
    }
    st.scanning = true;
  }

  function pauseScan() { st.scanning = false; }

  /**
   * Stop and forget the scan in progress. A scan stopped during its retrace has recorded nothing, so a
   * new recording starts where the mirror is.
   */
  function cancelScan() {
    if (st.phase === 'retrace') clear();
    st.scanning = false;
    st.phase = null;
  }

  /** Advance a running scan by dt seconds. Returns 'moved', 'done' or ''. */
  function tick(dt) {
    if (!st.scanning) return '';
    if (st.phase === 'retrace') {
      var back = retraceSpeed() * dt, d0 = -st.x;
      if (Math.abs(d0) <= back) {
        st.x = 0;
        clear();                       // the first reading of the sweep
        st.phase = 'sweep';
      } else {
        st.x += Math.sign(d0) * back;  // not recorded
      }
      return 'moved';
    }
    var step = st.speed * dt, d = st.travel - st.x;
    if (d <= step) {
      moveTo(st.travel);
      st.scanning = false;
      st.phase = null;
      return 'done';
    }
    moveTo(st.x + step);
    return 'moved';
  }

  /** Recorded stretch of path difference in µm, or null. */
  function span() {
    if (st.jLo === null) return null;
    return { lo: st.jLo * Model.DD_UM, hi: st.jHi * Model.DD_UM, n: st.jHi - st.jLo + 1 };
  }

  root.Sim = {
    state: st, init: init, moveTo: moveTo, clear: clear, reset: reset, rerecord: rerecord, setTravel: setTravel,
    startScan: startScan, pauseScan: pauseScan, cancelScan: cancelScan, tick: tick, span: span,
    jMax: jMax,
    isScanning: function () { return st.scanning; },
    inProgress: function () { return st.phase !== null; },
    phase: function () { return st.phase; },
    retraceSpeed: retraceSpeed,
    /** Mirror speed in µm/s. */
    setSpeed: function (s) { st.speed = s; }
  };
})(window);
