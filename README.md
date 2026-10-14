# FTIR Interferometer

An interactive teaching page about the Michelson interferometer inside an FTIR spectrometer: how moving the mirror produces an interferogram, and how the Fourier transform turns the interferogram into a spectrum showing which wavelengths a sample absorbs.

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Running it

- **Locally:** open `index.html` in a browser (classic scripts, so double-clicking works).
- **GitHub Pages:** *Settings → Pages → Deploy from a branch*, default branch, `/ (root)`. Served at `https://analyticalchem.github.io/interferometer/`.

## Using the page

1. **Choose a light source.** *Single wavelength* (500 to 4000 cm⁻¹, like a laser), *Two wavelengths* (with the second one's brightness); a wavenumber can be set on its slider or typed, in cm⁻¹ or as a wavelength in µm, or *Broadband IR*, every wavenumber from about 450 to 4300 cm⁻¹ (a blackbody source near 1500 K).
2. **Choose a sample** from the list: the empty holder (the background), hexane, ethanol, acetone, ethyl acetate, acetonitrile, a polystyrene film or carbon dioxide gas, or Unknown A, B or C.
3. **Move the mirror.** Drag the movable mirror in the drawing, use the Mirror position slider or type a position, or press **Scan**. The mirror travels from zero path difference to the end of its travel, so every displacement is positive. A scan works as a real instrument's does: a new recording, the mirror returned quickly to zero without recording, then one sweep at the chosen speed to the end, recording at every reference-laser fringe. That is a single-sided interferogram; the transform takes the negative side as its mirror image (an ideal interferogram is symmetric), so the spectrum is the same as from both sides. Moving the mirror by hand records every fringe it passes. The Detector Signal chart plots the signal against mirror position as the mirror moves. On a wide screen the drawing fills the panel and the chart sits in its top right corner, beside the interferometer and above the sample compartment; on a narrow one the chart is under the drawing. Changing the source, a wavenumber, the sample, the noise or the resolution starts a new recording.
4. **Watch the interferogram build.** View it over the whole scan (the default) or around the mirror (±25 µm of path difference). With two wavelengths, show the two component waves; with a sample, compare with the empty holder.
5. **Follow the transform.** From Interferogram to Spectrum (closed until opened) shows the Fourier transform in four panels: the interferogram (its average subtracted), a probe cosine, their product, and the spectrum. The spectrum starts whole, as the FFT computes every wavenumber at once; a probe wavenumber multiplies the interferogram by a cosine and adds up the product, the relative product area, which is one point of the spectrum. Sweep rebuilds the spectrum from 400 cm⁻¹ one probe wavenumber at a time, and Clear Points empties it to build by moving the probe. A checkbox overlays the background (the empty holder) on the spectrum; another reveals apodization. The Spectrum panel gives the transmittance, T = I ÷ I₀.
6. **Read the spectrum.** Transmittance or absorbance against wavenumber or wavelength, with each absorption labelled, the fingerprint region (600 to 1200 cm⁻¹) shaded, and the Absorptions table naming the vibration responsible.

The extras: a **Resolution** setting that sets the mirror's travel and puts the mirror back at zero: 800 or 400 cm⁻¹ (0 to 6.25 or 0 to 12.5 µm, a few fringes of every wavelength, for moving the mirror by hand; spectra are broad) or 4 cm⁻¹ for recording spectra (0 to 1,250 µm, with the speed set to 1,000 µm/s); detector **Noise** with averaging of 1, 4, 16 or 64 scans; and three **unknown** liquids, chosen at random, to identify from their spectra.

## The model

- Path difference δ = 2 × mirror displacement. Each wavenumber ν̃ reaches the detector with intensity ½B(ν̃)[1 + cos 2πν̃δ], and the detector adds them all up.
- The broadband source is a 1500 K blackbody, tapered off below about 440 and above about 4300 cm⁻¹. The sample multiplies it by T = 10^−A, with A a sum of idealized Lorentzian bands (a Gaussian for ethanol's hydrogen-bonded O–H) at positions from correlation tables and reference spectra (`js/samples.js`).
- The interferogram is sampled every 0.6328 µm of δ, one fringe of a helium–neon reference laser, which puts the highest wavenumber the transform can report at about 7900 cm⁻¹. It is synthesized by an FFT on a 0.24 cm⁻¹ grid.
- The transform folds the two halves of the recording together (the interferogram is symmetric about zero path difference), subtracts the average, applies the window (none, triangular or Happ-Genzel), zero-fills to 32768 points and takes the cosine transform by FFT. The same steps on the empty holder give the background, and T is the ratio.
- Each sample's bands are IR-active modes at the positions of reference IR spectra of the liquid (polystyrene: film; carbon dioxide: gas), checked in October 2026 against NIST SRM 1921b (polystyrene), the NIST Chemistry WebBook (Shimanouchi's tables, solution and gas spectra, the PNNL neat-liquid acetonitrile spectrum), liquid-ethanol optical constants (Myers et al. 2018; Sani and Dell'Oro 2016), liquid-film peak tables, B. C. Smith's spectra and the assignment literature. Raman-only modes, and bands whose assignment is uncertain, are left out; the Spectrum and Absorptions panels say the spectrum is simulated. Liquids sit between KBr windows, which pass infrared down to 400 cm⁻¹.
- Absorptions are local minima in T that stand at least 4 percentage points below the ground on both sides; with noise on, also 7 times the noise above their neighbours and below 100 %T, where the noise in T is the single-beam noise divided by the background at that wavenumber (so it is largest where the source is dim). Noise alone makes dips of 4 or 5 times its rms many times across a spectrum, and almost never 7.

## Scaling and drawing tricks

- The movable mirror is drawn in proportion to its true position, so dragging it and the slider agree. At 800 and 400 cm⁻¹ its movement is drawn at twice the waves' magnification (6 against 3 drawing units per µm), so the reflected wave moves with the mirror while keeping its true phase; at 4 cm⁻¹ the 1,250 µm travel is drawn in 75 units and the beam as a line, since a wave there would change by most of a cycle between frames.
- Between readings (every 0.6328 µm of path difference) the charts draw the curve the readings describe by windowed-sinc (Lanczos) interpolation, so fringes look smooth when zoomed in; the signal holds no wavenumber above about 4,300 cm⁻¹, well under the 7,900 cm⁻¹ the sampling can carry.
- Long curves are drawn one pixel column at a time from the lowest to the highest value in that column, so fringes thousands of times finer than a pixel show as a solid band rather than aliasing.
- The mirror speed runs from 0.5 µm/s, slow enough to watch each wave fall in and out of step, to 1,000 µm/s; a real mirror moves a few thousand µm/s.
- With one or two wavelengths the instrument drawing shows the beam as its wave, every wave at the source's height: thin black going out to the mirrors; orange reflected from the fixed mirror, 180° out of step with the outgoing wave it overlaps, the same width as the blue and under it, so in step the two draw as one line and out of step they separate; blue reflected from the movable mirror, shifted by 2πν̃δ in the direction the mirror moves. Orange and blue keep their colours through the beamsplitter to the detector. Only the blue wave changes as the mirror moves. The wavelengths are magnified (3 drawing units per µm) but keep their proportions, and the phase between the halves is the true 2πν̃δ. With two wavelengths, wavenumber 1 keeps its height and wavenumber 2's wave is drawn in proportion to the square root of its brightness, since brightness goes as a wave's height squared.

## Presentation mode

Press **Present** or **Alt + Shift + P** (Option + Shift + P on a Mac); Escape leaves it. Add `?present=1` to a link to open it ready to present.

## Files

```
index.html          page structure and text
css/styles.css      house tokens (with the instrument drawing's colours), components, themes, presentation mode
css/page.css        this page: the drawings, Key, charts, the Fourier transform, the extras
js/page.js          theme, presentation mode, formatting
js/samples.js       the sample library: bands, widths, heights and assignments
js/model.js         the physics: source, sample, interferogram, FFT, windows, transform, peak finding, noise
js/sim.js           the mirror and the recording, and scanning
js/charts.js        line charts on canvas
js/diagram.js       the instrument drawing (SVG)
js/steps.js         the Fourier transform, from interferogram to spectrum
js/main.js          wires the controls, drawings, charts, tables and extras
```

## License

MIT. See [LICENSE](LICENSE).
