'use strict';
/* Optical text centring for circles, pills, badges, chips and tags. Fonts place glyphs differently inside their line box
   (Inter, Segoe UI, SF...), so centring the box is not enough: numbers in a ring look too high, "Jobs" in a pill looks low.
   For each short single-line label this measures the real glyph shape with canvas text metrics (cap height for text with
   capitals/digits/tall letters, x-height otherwise; left and right ink edges), finds where it sits against the container's
   centre, and nudges it there. Descenders (g, y, p) are ignored on purpose, as designers do.
   Shared by both apps. Candidates: add data-center to any element, or extend SELECTOR below. */
(() => {
  if (window.__opticalCentre) return; window.__opticalCentre = true;
  const SELECTOR = '[data-center], .ring > div, .score > span, .tier, .pill, .badge, .chip, .focus-pill, .tag, .count, .nav .badge';
  const cache = new Map();
  const ctx = document.createElement('canvas').getContext('2d');
  
  const metrics = (txt, cs) => {
    const key = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontSize}|${cs.fontFamily}|${txt}`;
    let m = cache.get(key); if (m) return m;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    // the band from the top of the tallest letters (capitals, digits, ascenders like b d f h k l t) down to the baseline:
    // descenders (g j p q y) are ignored. All-x-height words ("acorn", "rose") use the x-height instead.
    const t = ctx.measureText(txt), band = ctx.measureText(/[A-Z0-9bdfhijklt%&$#!?]/.test(txt) ? 'H' : 'x');
    m = { l: -t.actualBoundingBoxLeft, r: t.actualBoundingBoxRight, w: t.width, up: band.actualBoundingBoxAscent };
    cache.set(key, m); return m;
  };

  const plain = (el) => el.childNodes.length > 0 && [...el.childNodes].every((n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName === 'CI-T'));
  const wrap = (el) => { let sp = el.querySelector(':scope > ci-t'); if (!sp) { sp = document.createElement('ci-t'); sp.style.cssText = 'display:inline-block;line-height:inherit;white-space:nowrap;font:inherit;color:inherit;'; sp.textContent = el.textContent; el.textContent = ''; el.append(sp); } return sp; };

  let raf = 0;
  const scan = () => {
    raf = 0;
    const els = [...document.querySelectorAll(SELECTOR)].filter((e) => !e.dataset.ci && e.offsetParent !== null && plain(e));
    if (!els.length) return;
    const jobs = [];
    // read phase: no writes between reads, so a table of thousands of badges stays cheap
    for (const el of els) {
      const txt = el.textContent.trim(); if (!txt || txt.length > 42) { el.dataset.ci = 'skip'; continue; }
      const er = el.getBoundingClientRect(); if (er.height > 72 || er.width > 260) { el.dataset.ci = 'skip'; continue; }
      jobs.push({ el, txt, cs: getComputedStyle(el), er });
    }
    for (const j of jobs) {
      const cs = j.cs; if (cs.display === 'none') continue;
      const m = metrics(j.txt, cs);
      // where the text really is: measure the baseline with a zero-size probe
      const probe = document.createElement('i'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      const sp = wrap(j.el); sp.style.transform = ''; sp.append(probe);
      const baseY = probe.getBoundingClientRect().bottom, sr = sp.getBoundingClientRect(); probe.remove();
      const er = j.el.getBoundingClientRect();
      // the visible shape (border box) is what the eye centres on, whatever the padding is
      const boxCx = er.left + er.width / 2, boxCy = er.top + er.height / 2;
      const inkCx = sr.left + (m.l + m.r) / 2, inkCy = baseY - m.up / 2;
      j.dx = boxCx - inkCx; j.dy = boxCy - inkCy; j.sp = sp;
    }
    // write phase
    for (const j of jobs) {
      if (!j.sp) continue;
      const dx = Math.abs(j.dx) < 6 ? j.dx : 0, dy = Math.abs(j.dy) < 6 ? j.dy : 0;
      // a pill whose text is left-aligned on purpose keeps its alignment: only fix the axis that is already centred
      const centred = /center|space/.test(getComputedStyle(j.el).justifyContent) || getComputedStyle(j.el).textAlign === 'center' || getComputedStyle(j.el).display.includes('grid');
      const x = centred || Math.abs(dx) < 1.5 ? dx : 0;
      j.sp.style.transform = Math.abs(x) < 0.15 && Math.abs(dy) < 0.15 ? '' : `translate(${x.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      j.el.dataset.ci = '1';
    }
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(scan); };
  new MutationObserver((recs) => { for (const r of recs) if (r.type === 'childList' && [...r.addedNodes].some((n) => n.nodeType === 1 && n.tagName !== 'CI-T')) return queue(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { cache.clear(); document.querySelectorAll('[data-ci]').forEach((e) => e.removeAttribute('data-ci')); queue(); });
  window.addEventListener('resize', () => { document.querySelectorAll('[data-ci="1"]').forEach((e) => e.removeAttribute('data-ci')); queue(); });
  window.__centerNow = scan; queue();
})();
