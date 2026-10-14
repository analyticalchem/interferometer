/* FTIR Interferometer Explorer: the physics, as pure functions with no DOM.
 *
 * The beam from the source (a broadband infrared source near 1500 K, or one or two single wavelengths) is
 * split, sent to the two mirrors and recombined. With a path difference δ between the arms, each
 * wavenumber ν̃ reaches the detector with intensity ½B(ν̃)[1 + cos 2πν̃δ], and the detector adds them
 * all up: the interferogram. The sample multiplies the beam by its transmittance T = 10^−A first.
 *
 * Path differences are sampled every 0.6328 µm (one fringe of a red reference laser), so the highest
 * wavenumber the transform can report is 1 / (2 × 0.6328 µm) ≈ 7900 cm⁻¹. Interferograms are scaled
 * so the empty holder at zero path difference gives 1, the largest signal the detector ever sees.
 * Exposes window.Model.
 */
(function (root) {
  'use strict';

  var DD_UM = 0.6328;                     // sampling step in path difference (µm)
  var DD_CM = DD_UM * 1e-4;
  var NYQUIST = 1 / (2 * DD_CM);          // ≈ 7901 cm⁻¹
  var NF = 65536, DVF = 1 / (NF * DD_CM); // synthesis grid, ≈ 0.241 cm⁻¹, fine enough for the narrowest band
  var NT = 32768, DVT = 1 / (NT * DD_CM); // transform grid, ≈ 0.48 cm⁻¹ (the scan is zero-filled to NT)
  var J_LIMIT = 7904;                     // 5000 µm of path difference, the longest scan offered (2 cm⁻¹)
  var V_LO = 400, V_HI = 4000;            // the range shown on the spectra
  var T_SOURCE = 1500;                    // K
  var BROAD_V0 = 250, BROAD_V1 = 5200;    // where the broadband source is worth summing over
  var PROBES = [1050, 1715, 2350, 2960];  // the wavenumbers drawn for the broadband beam

  // --- fast Fourier transform (radix 2, in place) ----------------------------------------

  var tables = {};
  function fftTables(n) {
    if (tables[n]) return tables[n];
    var bits = Math.round(Math.log2(n)), rev = new Uint32Array(n);
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), i, k;
    for (i = 0; i < n; i++) {
      var r = 0, x = i;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    for (k = 0; k < n / 2; k++) {
      cos[k] = Math.cos(2 * Math.PI * k / n);
      sin[k] = -Math.sin(2 * Math.PI * k / n);
    }
    return (tables[n] = { rev: rev, cos: cos, sin: sin });
  }

  function fft(re, im) {
    var n = re.length, t = fftTables(n), i, j, tmp;
    for (i = 0; i < n; i++) {
      j = t.rev[i];
      if (j > i) {
        tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (var k = 0; k < half; k++) {
          var wr = t.cos[k * step], wi = t.sin[k * step], a = i + k, b = a + half;
          var xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  // --- source and sample -------------------------------------------------------------------

  function planck(v) {
    if (v <= 0) return 0;
    return v * v * v / Math.expm1(1.4388 * v / T_SOURCE);
  }

  // A blackbody near 1500 K seen through a beamsplitter and detector that pass about 440 to 4300 cm⁻¹.
  function rawShape(v) {
    return planck(v) / (1 + Math.exp(-(v - 440) / 25)) / (1 + Math.exp((v - 4300) / 110));
  }
  var SHAPE_MAX = (function () {
    var m = 0;
    for (var v = 300; v <= 5000; v += 1) m = Math.max(m, rawShape(v));
    return m;
  })();
  /** Source intensity at wavenumber v (cm⁻¹), scaled so its peak is 1. */
  function sourceShape(v) { return rawShape(v) / SHAPE_MAX; }

  function bandAbs(b, v) {
    var d = (v - b.v) / (b.w / 2);
    return b.shape === 'gauss' ? b.a * Math.exp(-Math.LN2 * d * d) : b.a / (1 + d * d);
  }

  function absorbance(sample, v) {
    var A = 0, bands = sample ? sample.bands : [];
    for (var i = 0; i < bands.length; i++) A += bandAbs(bands[i], v);
    return A;
  }

  function transmittance(sample, v) { return Math.pow(10, -absorbance(sample, v)); }

  /** The band that absorbs most at v, or null when nothing absorbs there. */
  function bandAt(sample, v) {
    var best = null, bestA = 0.02;
    (sample ? sample.bands : []).forEach(function (b) {
      var a = bandAbs(b, v);
      if (a > bestA) { bestA = a; best = b; }
    });
    return best;
  }

  // --- the beam at the detector ----------------------------------------------------------------

  /**
   * source: { kind: 'broad' } or { kind: 'lines', lines: [{ v (cm⁻¹), a }] } with the a adding to 1.
   * Returns { grid, at(δ µm), components }: the interferogram sampled at every reference fringe
   * (index j + J_LIMIT for δ = j × 0.6328 µm), the signal at any path difference, and the waves to draw.
   */
  function beam(source, sample) {
    if (source.kind === 'lines') return linesBeam(source, sample);
    return broadBeam(sample);
  }

  function linesBeam(source, sample) {
    var lines = source.lines.map(function (l) {
      return { v: l.v, a: l.a, t: transmittance(sample, l.v) };
    });
    function at(dUm) {
      var s = 0, d = dUm * 1e-4;
      for (var i = 0; i < lines.length; i++) {
        s += 0.5 * lines[i].a * lines[i].t * (1 + Math.cos(2 * Math.PI * lines[i].v * d));
      }
      return s;
    }
    var grid = new Float64Array(2 * J_LIMIT + 1);
    for (var j = -J_LIMIT; j <= J_LIMIT; j++) grid[j + J_LIMIT] = at(j * DD_UM);
    var amax = Math.max.apply(null, lines.map(function (l) { return l.a; }));
    // Wave amplitudes go as the square root of intensity: the field, not the power.
    return {
      grid: grid, at: at,
      components: lines.map(function (l) { return { v: l.v, amp: Math.sqrt(l.a / amax * l.t), t: l.t, a: l.a }; })
    };
  }

  var bgTotal = null;
  function broadTotal(sample) {
    var k0 = Math.ceil(BROAD_V0 / DVF), k1 = Math.floor(BROAD_V1 / DVF), s = 0;
    for (var k = k0; k <= k1; k++) {
      var v = k * DVF;
      s += sourceShape(v) * (sample ? transmittance(sample, v) : 1);
    }
    return s;
  }

  function broadBeam(sample) {
    if (bgTotal === null) bgTotal = broadTotal(null);
    var k0 = Math.ceil(BROAD_V0 / DVF), k1 = Math.floor(BROAD_V1 / DVF), n = k1 - k0 + 1;
    var vk = new Float64Array(n), bk = new Float64Array(n), total = 0, k;
    for (k = 0; k < n; k++) {
      vk[k] = (k0 + k) * DVF;
      bk[k] = sourceShape(vk[k]) * transmittance(sample, vk[k]);
      total += bk[k];
    }
    // I(δ) = ½∫B dν̃ + ½∫B cos(2πν̃δ) dν̃, both sums on the same grid, scaled by the empty holder's ∫B.
    var re = new Float64Array(NF), im = new Float64Array(NF);
    for (k = 0; k < n; k++) { re[k0 + k] = bk[k]; re[NF - k0 - k] = bk[k]; }
    fft(re, im);
    var grid = new Float64Array(2 * J_LIMIT + 1), dc = 0.5 * total / bgTotal;
    for (var j = -J_LIMIT; j <= J_LIMIT; j++) {
      grid[j + J_LIMIT] = dc + 0.25 * re[(j + NF) % NF] / bgTotal;
    }
    function at(dUm) {
      var d = dUm * 1e-4, s = 0;
      for (var i = 0; i < n; i++) s += bk[i] * Math.cos(2 * Math.PI * vk[i] * d);
      return dc + 0.5 * s / bgTotal;
    }
    return {
      grid: grid, at: at,
      components: PROBES.map(function (v) {
        var t = transmittance(sample, v);
        return { v: v, amp: Math.sqrt(t), t: t };
      })
    };
  }

  // --- from interferogram to spectrum ------------------------------------------------------------

  function windowValue(name, u) {
    if (name === 'triangular') return Math.max(0, 1 - u);
    if (name === 'happ-genzel') return 0.54 + 0.46 * Math.cos(Math.PI * Math.min(1, u));
    return 1;
  }

  /**
   * values: interferogram indexed by j + J_LIMIT, recorded from jLo to jHi. The interferogram is
   * symmetric about zero path difference, so the two halves are folded together (and averaged where
   * both were recorded); the shorter side is filled in from the longer one. The average is subtracted,
   * the window applied, and the cosine transform taken by FFT.
   */
  function transform(values, jLo, jHi, win) {
    if (jLo === null || jHi === null) return { ok: false, reason: 'empty' };
    if (jLo > 0 || jHi < 0) return { ok: false, reason: 'no-zpd' };
    var M = Math.max(-jLo, jHi), both = Math.min(-jLo, jHi);
    if (M < 8) return { ok: false, reason: 'short' };
    var folded = new Float64Array(M + 1), k;
    for (k = 0; k <= M; k++) {
      var p = k <= jHi ? values[k + J_LIMIT] : NaN, m = k <= -jLo ? values[-k + J_LIMIT] : NaN;
      folded[k] = k <= both ? 0.5 * (p + m) : (isNaN(p) ? m : p);
    }
    var sum = folded[0];
    for (k = 1; k <= M; k++) sum += 2 * folded[k];
    var mean = sum / (2 * M + 1);
    var x = new Float64Array(M + 1);
    for (k = 0; k <= M; k++) x[k] = (folded[k] - mean) * windowValue(win, k / M);
    var re = new Float64Array(NT), im = new Float64Array(NT);
    re[0] = x[0];
    for (k = 1; k <= M; k++) { re[k] = x[k]; re[NT - k] = x[k]; }
    fft(re, im);
    var spec = new Float64Array(NT / 2 + 1);
    for (k = 0; k <= NT / 2; k++) spec[k] = re[k] * DD_CM;
    return {
      ok: true, M: M, both: both, jLo: jLo, jHi: jHi, mean: mean, folded: folded, x: x, win: win,
      spec: spec, dv: DVT, res: 1 / (M * DD_CM),
      filled: jHi > -jLo ? 'negative' : (-jLo > jHi ? 'positive' : 'none')
    };
  }

  /** One point of the cosine transform, the sum the FFT does all at once. */
  function probe(tr, v) {
    var x = tr.x, s = x[0], w = 2 * Math.PI * v * DD_CM;
    for (var k = 1; k < x.length; k++) s += 2 * x[k] * Math.cos(w * k);
    return s * DD_CM;
  }

  /** The probe's running pieces at each k for drawing: cos(2πν̃δ) and the product. */
  function probeWave(v, k) { return Math.cos(2 * Math.PI * v * k * DD_CM); }

  /**
   * Single-beam spectra of the sample and the empty holder, transformed the same way from the same
   * stretch of path difference, scaled so the background's peak is 1, and their ratio, T.
   */
  function spectra(sampleValues, bgValues, jLo, jHi, win, broad) {
    var trS = transform(sampleValues, jLo, jHi, win);
    if (!trS.ok) return trS;
    var trB = transform(bgValues, jLo, jHi, win);
    var n = trS.spec.length, norm = 0, k;
    var k0 = Math.floor(300 / DVT), k1 = Math.ceil(4500 / DVT);
    for (k = k0; k <= k1; k++) norm = Math.max(norm, trB.spec[k]);
    if (!(norm > 0)) norm = 1;
    var single = new Float64Array(n), bg = new Float64Array(n), T = new Float64Array(n);
    for (k = 0; k < n; k++) {
      single[k] = trS.spec[k] / norm;
      bg[k] = trB.spec[k] / norm;
      T[k] = broad && bg[k] > 0.03 ? single[k] / bg[k] : NaN;
    }
    return { ok: true, tr: trS, trBg: trB, norm: norm, single: single, bg: bg, T: T, dv: DVT, res: trS.res, M: trS.M };
  }

  /** Linear interpolation into a spectrum array on the transform grid. */
  function sampleAt(arr, v) {
    var f = v / DVT, i = Math.floor(f), t = f - i;
    if (i < 0 || i + 1 >= arr.length) return NaN;
    return arr[i] * (1 - t) + arr[i + 1] * t;
  }

  /**
   * Absorption dips in T between 400 and 4000 cm⁻¹: local minima that stand at least minProm below
   * the higher ground on both sides, each with the sample's band responsible. With noise (its rms in the
   * single-beam spectrum, relative to the background's peak), the noise in T at each wavenumber is that
   * divided by the background there, so it is largest where the background is dim. A dip must then
   * stand NOISE_Z times that above its neighbours and below 100 %T: noise alone makes dips of 4 or 5
   * times its rms many times across a spectrum, and almost never 7.
   */
  var NOISE_Z = 7;
  function dips(sp, sample, minProm, noise) {
    var T = sp.T, k0 = Math.ceil(V_LO / DVT), k1 = Math.floor(V_HI / DVT), out = [], k;
    for (k = k0 + 1; k < k1; k++) {
      var t = T[k];
      if (!(t < T[k - 1] && t <= T[k + 1])) continue;
      var left = t, right = t, i;
      for (i = k - 1; i >= k0; i--) { if (isNaN(T[i]) || T[i] < t) break; left = Math.max(left, T[i]); }
      for (i = k + 1; i <= k1; i++) { if (isNaN(T[i]) || T[i] < t) break; right = Math.max(right, T[i]); }
      var prom = Math.min(left, right) - t;
      var sd = noise ? noise / Math.max(sp.bg[k], 0.02) : 0;
      if (prom >= Math.max(minProm, NOISE_Z * sd) && 1 - t >= NOISE_Z * sd) {
        // Refine the minimum with a parabola through the three points.
        var a = T[k - 1], c = T[k + 1], den = a - 2 * t + c, off = den > 0 ? 0.5 * (a - c) / den : 0;
        var v = (k + off) * DVT;
        out.push({ v: v, T: t, prom: prom, band: bandAt(sample, v) });
      }
    }
    return out.sort(function (p, q) { return q.v - p.v; });
  }

  /** For a line source: the peak of the single-beam spectrum found nearest each line that was set. */
  function lines(sp, source) {
    var win = Math.max(3 * sp.res, 6);
    return source.lines.map(function (l, idx) {
      var k0 = Math.max(1, Math.floor((l.v - win) / DVT)), k1 = Math.ceil((l.v + win) / DVT), best = k0;
      for (var k = k0; k <= k1; k++) if (sp.single[k] > sp.single[best]) best = k;
      var a = sp.single[best - 1], t = sp.single[best], c = sp.single[best + 1], den = a - 2 * t + c;
      var off = den < 0 ? 0.5 * (a - c) / den : 0;
      return { n: idx + 1, set: l.v, v: (best + off) * DVT, I: t };
    });
  }

  // --- noise (an optional extra) -------------------------------------------------------------------

  function rand(a) {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** A standard normal number fixed by the point and the run, so passing a point twice reads it the same. */
  function noise(j, seed) {
    var u1 = rand(seed * 15485863 + j * 2 + 1) || 1e-12, u2 = rand(seed * 15485863 + j * 2 + 2);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function jOf(dUm) { return Math.round(dUm / DD_UM); }

  root.Model = {
    DD_UM: DD_UM, DD_CM: DD_CM, NYQUIST: NYQUIST, J_LIMIT: J_LIMIT, V_LO: V_LO, V_HI: V_HI, DVT: DVT,
    T_SOURCE: T_SOURCE, PROBES: PROBES,
    fft: fft, sourceShape: sourceShape, absorbance: absorbance, transmittance: transmittance, bandAt: bandAt,
    beam: beam, windowValue: windowValue, transform: transform, probe: probe, probeWave: probeWave,
    spectra: spectra, sampleAt: sampleAt, dips: dips, lines: lines, noise: noise, jOf: jOf
  };
})(window);
