/* FTIR Interferometer: the sample library. Each compound is a list of idealized IR absorption bands:
 * centre (cm⁻¹), full width at half height (cm⁻¹), peak absorbance through the cell, the band's
 * shape, and the vibration responsible. Every band is an IR-active mode seen in the liquid (or film,
 * or gas) IR spectrum; widths and heights are rounded, idealized values chosen so the strong bands stay
 * on scale. Positions and assignments were checked in October 2026 against reference IR data: NIST
 * SRM 1921b (polystyrene film), the NIST Chemistry WebBook (Shimanouchi's tables, solution and gas
 * spectra, the PNNL neat-liquid acetonitrile spectrum), liquid-ethanol optical constants (Myers et al.
 * 2018; Sani and Dell'Oro 2016), liquid-film peak tables, B. C. Smith's spectra and the assignment
 * literature. Bands whose assignment is uncertain are left out (ethyl acetate 938 and 1098,
 * acetonitrile 749). Liquids sit between KBr windows, which pass infrared down to 400 cm⁻¹.
 * Text uses _3 or _{10} for subscripts (Page.setRich). Exposes window.Samples.
 */
(function (root) {
  'use strict';

  function band(v, w, a, what, shape) {
    return { v: v, w: w, a: a, what: what, shape: shape || 'lorentz' };
  }

  var LIQUID = 'Liquid film between KBr windows';

  var LIST = [
    {
      id: 'empty', name: 'Empty holder', formula: '', holder: 'none',
      holderText: 'Nothing in the beam: the background',
      bands: []
    },
    {
      id: 'hexane', name: 'Hexane', formula: 'C_6H_{14}', holder: 'liquid',
      holderText: LIQUID,
      bands: [
        band(2958, 16, 1.2, 'C–H stretch, CH_3 (asymmetric)'),
        band(2927, 18, 1.4, 'C–H stretch, CH_2 (asymmetric)'),
        band(2872, 12, 0.7, 'C–H stretch, CH_3 (symmetric)'),
        band(2858, 14, 0.8, 'C–H stretch, CH_2 (symmetric)'),
        band(1467, 14, 0.6, 'C–H bend, CH_2 scissor + CH_3 asymmetric (overlapping)'),
        band(1379, 10, 0.35, 'C–H bend, CH_3 umbrella'),
        band(726, 12, 0.22, 'CH_2 rock, chain of four or more CH_2')
      ]
    },
    {
      id: 'ethanol', name: 'Ethanol', formula: 'CH_3CH_2OH', holder: 'liquid',
      holderText: LIQUID,
      bands: [
        band(3340, 260, 0.95, 'O–H stretch, hydrogen-bonded (broad)', 'gauss'),
        band(2974, 18, 0.8, 'C–H stretch, CH_3 (asymmetric)'),
        band(2928, 16, 0.4, 'C–H stretch, CH_2 and CH_3 (mixed)'),
        band(2884, 16, 0.45, 'C–H stretch, CH_3 and CH_2 (symmetric)'),
        band(1455, 20, 0.3, 'C–H bend, CH_2 and CH_3'),
        band(1381, 15, 0.25, 'C–H bend, CH_3 umbrella'),
        band(1330, 50, 0.12, 'O–H bend in plane, hydrogen-bonded (broad)', 'gauss'),
        band(1090, 18, 0.6, 'C–O stretch + CH_3 rock (coupled)'),
        band(1050, 20, 1.1, 'C–O stretch'),
        band(880, 14, 0.5, 'C–C–O stretch (symmetric)'),
        band(660, 180, 0.08, 'O–H bend out of plane (very broad)', 'gauss')
      ]
    },
    {
      id: 'acetone', name: 'Acetone', formula: '(CH_3)_2CO', holder: 'liquid',
      holderText: LIQUID,
      bands: [
        band(3412, 30, 0.05, 'C=O stretch overtone'),
        band(3005, 14, 0.15, 'C–H stretch, CH_3 (asymmetric, in plane)'),
        band(2965, 14, 0.15, 'C–H stretch, CH_3 (asymmetric, out of plane)'),
        band(2924, 12, 0.1, 'C–H stretch, CH_3 (symmetric)'),
        band(1715, 18, 1.5, 'C=O stretch, ketone'),
        band(1420, 18, 0.45, 'C–H bend, CH_3 (asymmetric)'),
        band(1362, 14, 0.8, 'C–H bend, CH_3 umbrella'),
        band(1222, 16, 0.9, 'C–C–C stretch (asymmetric)'),
        band(1092, 12, 0.15, 'CH_3 rock'),
        band(902, 12, 0.06, 'CH_3 rock'),
        band(787, 12, 0.04, 'C–C–C stretch (symmetric)'),
        band(530, 12, 0.4, 'C=O bend in plane')
      ]
    },
    {
      id: 'ethylacetate', name: 'Ethyl acetate', formula: 'CH_3COOCH_2CH_3', holder: 'liquid',
      holderText: LIQUID,
      bands: [
        band(3462, 30, 0.08, 'C=O stretch overtone'),
        band(2984, 18, 0.35, 'C–H stretch, CH_3 (asymmetric)'),
        band(2940, 16, 0.2, 'C–H stretch, CH_3 (symmetric) and CH_2'),
        band(1742, 20, 1.6, 'C=O stretch, ester'),
        band(1447, 16, 0.3, 'C–H bend, CH_2 and CH_3'),
        band(1373, 12, 0.7, 'C–H bend, CH_3 umbrella'),
        band(1241, 26, 1.4, 'C–O stretch, C–C(=O)–O (acyl side)'),
        band(1047, 18, 0.8, 'C–O stretch, O–C–C (alkyl side)'),
        band(847, 12, 0.25, 'C–C stretch, CH_3–C(=O)'),
        band(634, 12, 0.25, 'O–C=O bend in plane'),
        band(608, 12, 0.27, 'C=O bend out of plane')
      ]
    },
    {
      id: 'acetonitrile', name: 'Acetonitrile', formula: 'CH_3CN', holder: 'liquid',
      holderText: LIQUID,
      bands: [
        band(3164, 14, 0.15, 'Combination band, C≡N stretch + C–C stretch'),
        band(3002, 14, 0.2, 'C–H stretch, CH_3 (asymmetric)'),
        band(2943, 12, 0.3, 'C–H stretch, CH_3 (symmetric)'),
        band(2293, 10, 0.25, 'Combination band, CH_3 umbrella + C–C stretch (Fermi resonance with C≡N)'),
        band(2253, 10, 1.0, 'C≡N stretch, nitrile'),
        band(1444, 14, 0.5, 'C–H bend, CH_3 (asymmetric)'),
        band(1419, 12, 0.35, 'Combination band, CH_3 rock + C–C≡N bend'),
        band(1375, 10, 0.4, 'C–H bend, CH_3 umbrella'),
        band(1039, 10, 0.3, 'CH_3 rock'),
        band(918, 8, 0.25, 'C–C stretch')
      ]
    },
    {
      id: 'polystyrene', name: 'Polystyrene', formula: '(C_8H_8)_n', holder: 'film',
      holderText: 'Thin film on a card holder',
      bands: [
        band(3082, 10, 0.35, 'C–H stretch, aromatic ring'),
        band(3060, 10, 0.6, 'C–H stretch, aromatic ring'),
        band(3026, 10, 0.75, 'C–H stretch, aromatic ring'),
        band(2924, 14, 1.0, 'C–H stretch, CH_2 (asymmetric)'),
        band(2850, 12, 0.55, 'C–H stretch, CH_2 (symmetric)'),
        band(1943, 18, 0.07, 'Combination band, ring C–H out-of-plane bends'),
        band(1871, 18, 0.07, 'Combination band, ring C–H out-of-plane bends'),
        band(1802, 18, 0.05, 'Combination band, ring C–H out-of-plane bends'),
        band(1601, 8, 0.5, 'C=C stretch, aromatic ring'),
        band(1583, 6, 0.2, 'C=C stretch, aromatic ring'),
        band(1493, 8, 0.9, 'C=C stretch, aromatic ring'),
        band(1452, 10, 0.9, 'C=C stretch, aromatic ring + CH_2 scissor (overlapping)'),
        band(1181, 8, 0.1, 'C–H bend in the ring plane'),
        band(1154, 8, 0.12, 'C–H bend in the ring plane'),
        band(1069, 8, 0.2, 'C–H bend in the ring plane'),
        band(1028, 8, 0.4, 'C–H bend in the ring plane'),
        band(907, 8, 0.2, 'C–H bend out of the ring plane'),
        band(757, 10, 1.3, 'C–H bend out of plane, five adjacent ring H (one substituent)'),
        band(698, 10, 1.6, 'Ring bend out of plane, one substituent'),
        band(540, 10, 0.4, 'Ring bend out of plane')
      ]
    },
    {
      id: 'co2', name: 'Carbon dioxide', formula: 'CO_2', holder: 'gas',
      holderText: 'Gas cell with KBr windows',
      bands: [
        band(3715, 30, 0.08, 'Combination band, symmetric + asymmetric stretch'),
        band(3612, 30, 0.05, 'Combination band, two bends + asymmetric stretch'),
        band(2349, 30, 1.2, 'O=C=O stretch (asymmetric)'),
        band(667, 8, 0.9, 'O=C=O bend')
      ]
    }
  ];

  var BY_ID = {};
  LIST.forEach(function (s) { BY_ID[s.id] = s; });

  root.Samples = {
    list: LIST,
    get: function (id) { return BY_ID[id] || BY_ID.empty; }
  };
})(window);
