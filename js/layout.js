/* FTIR Interferometer Explorer: how the page is arranged. Shows the instrument page or the results page
   (#instrument, #results, so Back and Forward work), switches the one-screen arrangement on when the window
   is large enough, sizes the drawing to its box, runs the Settings drop-down and the results tabs
   (WAI-ARIA tabs pattern, automatic activation), keeps the results page's line about the recording up to
   date, and lays the charts out again when their space changes. Both pages are one document: the model,
   the recording and every chart keep running whichever page is shown. */
(function (root) {
  'use strict';

  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }

  // --- one screen ---

  function presenting() { return html.hasAttribute('data-present'); }
  // One screen needs the window to be large enough, and the drawing to come out at least MIN_DRAWING px
  // wide, the size below which its labels would crowd. If a window passes the first test but fails the
  // second (larger text settings, say), the page stacks and stays stacked until the window grows.
  var MIN_DRAWING = 500, tooSmall = null;
  function fits() {
    var w = root.innerWidth, h = root.innerHeight, p = presenting();
    if (tooSmall && tooSmall.p === p && w <= tooSmall.w && h <= tooSmall.h) return false;
    return p ? w >= 1280 && h >= 720 : w >= 1100 && h >= 680;
  }
  function oneScreen() { return html.classList.contains('one-screen'); }

  // The drawing is as large as its box allows in both directions: the box's width, or its height times
  // the drawing's width-to-height ratio, whichever is smaller. Where the card is wide for its height, the
  // Key goes beside the drawing instead of under it, if that makes the drawing larger.
  var fitBox = document.querySelector('.drawing-fit'), inst = fitBox.querySelector('.instrument'), svg = $('diagram');
  var card = document.querySelector('.instrument-card'), key = document.querySelector('.drawing-key'), keyBelow = 0;
  function ratio() { var vb = svg.viewBox.baseVal; return vb && vb.height ? vb.width / vb.height : 1.8; }
  function drawingWidth() { return Math.floor(Math.min(fitBox.clientWidth, fitBox.clientHeight * ratio())); }
  function fitDrawing() {
    if (!oneScreen() || !fitBox.clientWidth) { inst.style.width = ''; card.classList.remove('key-beside'); return; }
    var keyW = 15 * parseFloat(getComputedStyle(html).fontSize), gap = 16, r = ratio();
    var beside = card.classList.contains('key-beside');
    if (!beside) keyBelow = key.offsetHeight + 6;
    var W = fitBox.clientWidth + (beside ? keyW + gap : 0), H = fitBox.clientHeight + (beside ? 0 : keyBelow);
    var under = Math.min(W, (H - keyBelow) * r), side = Math.min(W - keyW - gap, H * r);
    var want = side > under + 24;
    if (want !== beside) card.classList.toggle('key-beside', want);
    var width = drawingWidth();
    inst.style.width = width + 'px';
    if (width < MIN_DRAWING) queueCheck();
  }

  // A drawing too small for its labels is measured again after a pause, twice, a second apart, each time
  // in a drawn frame; only if it is too small both times does the page stack. A reading taken while the
  // page is still settling (as it loads, or mid-resize) never decides it.
  var checkTimer = 0, smallCount = 0;
  function queueCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () { requestAnimationFrame(checkSize); }, smallCount ? 1000 : 500);
  }
  function checkSize() {
    if (!oneScreen() || !fitBox.clientWidth || drawingWidth() >= MIN_DRAWING) { smallCount = 0; return; }
    if (++smallCount < 2) { queueCheck(); return; }
    smallCount = 0;
    tooSmall = { p: presenting(), w: root.innerWidth, h: root.innerHeight };
    html.classList.remove('one-screen');
    card.classList.remove('key-beside');
    inst.style.width = '';
    Page.queueLayout();
  }

  html.classList.toggle('one-screen', fits());
  function update() {
    var on = fits();
    if (on !== oneScreen()) html.classList.toggle('one-screen', on);
    fitDrawing();
    Page.queueLayout();
  }
  root.addEventListener('resize', update);
  new MutationObserver(update).observe(html, { attributes: true, attributeFilter: ['data-present'] });

  // --- the Settings drop-down ---

  var settings = $('settings');
  // Escape closes it first (before presentation mode, and not while editing a typing box outside it), and
  // focus goes back to its button; a click or tap anywhere outside it closes it, as a drop-down does.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !settings.open) return;
    if (e.target.classList && e.target.classList.contains('num') && !settings.contains(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    settings.open = false;
    settings.querySelector('summary').focus();
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (settings.open && !settings.contains(e.target)) settings.open = false;
  });

  // --- tabs ---

  var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
  function selectedTab() { return document.querySelector('[role="tab"][aria-selected="true"]'); }

  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    // The transform's chart has no size while its tab is hidden, so it is laid out when the tab opens.
    if (tab.id === 'tab-ft') { Steps.layout(); Steps.refresh(); }
    Page.queueLayout();
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t, false); });
    t.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      select(tabs[j], true);
    });
  });

  // --- the two pages ---

  var pages = { instrument: $('page-instrument'), results: $('page-results') };
  var navs = { instrument: $('nav-instrument'), results: $('nav-results') };
  var baseTitle = document.title, current = null;

  function pageFromHash() { return location.hash === '#results' ? 'results' : 'instrument'; }

  /** Show one page. Focus goes to the start of the page that opens (the open tab on the results page, the
      chosen light source on the instrument page), so keyboard and screen-reader users land where it begins. */
  function show(name, focus) {
    if (name === current) return;
    current = name;
    Object.keys(pages).forEach(function (k) {
      pages[k].hidden = k !== name;
      if (k === name) navs[k].setAttribute('aria-current', 'page');
      else navs[k].removeAttribute('aria-current');
    });
    document.title = name === 'results' ? 'Results · ' + baseTitle : baseTitle;
    root.scrollTo(0, 0);
    if (name === 'results') {
      nowLine();
      var t = selectedTab();
      if (t.id === 'tab-ft') { Steps.layout(); Steps.refresh(); }
      if (focus) t.focus();
    } else if (focus) {
      document.querySelector('#page-instrument .chip[aria-pressed="true"]').focus();
    }
    fitDrawing();
    Page.queueLayout();
  }

  // The links change the address; the page follows it, so Back and Forward move between the pages too.
  root.addEventListener('hashchange', function () { show(pageFromHash(), true); });

  // --- the results page's line about the recording ---

  // What the instrument is recording now, and the scan's own status, in one line. It is a status region,
  // heard only while the results page is shown (the instrument page's own scan status is hidden then), and
  // it is written only when its text changes.
  var now = $('results-now');
  function pressed(attr) {
    var b = document.querySelector('#page-instrument [' + attr + '][aria-pressed="true"]');
    return b ? b.textContent.trim() : '';
  }
  function nowLine() {
    var sel = $('sample'), opt = sel.options[sel.selectedIndex], scans = pressed('data-scans');
    var parts = [
      (opt ? opt.textContent.trim() : '') + ' in the holder',
      pressed('data-source'),
      'resolution ' + pressed('data-res') + ' cm⁻¹'
    ];
    if ($('noise-on').checked) parts.push('noise on, averaging ' + scans + (scans === '1' ? ' scan' : ' scans'));
    var s = ('Recording: ' + parts.join(', ') + '. ' + $('scan-status').textContent.trim()).trim();
    if (now.textContent !== s) now.textContent = s;
  }
  new MutationObserver(nowLine).observe($('scan-status'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(nowLine).observe(pages.instrument, { attributes: true, attributeFilter: ['aria-pressed'], subtree: true });
  document.addEventListener('change', nowLine);

  // The page re-measures when <main> changes size; here the charts' own boxes change size too (a page or a
  // tab opens, a table opens under a chart), so watch them as well. main.js has set up the page by now: its
  // DOMContentLoaded handler was added first.
  document.addEventListener('DOMContentLoaded', function () {
    show(pageFromHash(), false);
    nowLine();
    if (!('ResizeObserver' in root)) return;
    var ro = new ResizeObserver(update);
    ro.observe(html);
    document.querySelectorAll('.chart-visual, .drawing-fit').forEach(function (el) { ro.observe(el); });
  });

  root.Layout = { oneScreen: oneScreen, show: show };
})(window);
