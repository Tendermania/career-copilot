/* Dark, themeable dropdowns. Replaces the browser's native <select> popup (which is light blue
   and ignores the app's theme) with a styled list. The native <select> stays in the page, hidden,
   so forms, values and change handlers keep working exactly as before. */
(() => {
  if (window.__darkSelect) return; window.__darkSelect = true;
  const chev = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1.5l5 5 5-5\' fill=\'none\' stroke=\'%238a93ab\' stroke-width=\'1.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")';
  const style = document.createElement('style');
  style.textContent = `
  .ds-wrap{position:relative;display:block;min-width:0}
  .ds-native{position:absolute!important;inset:0;opacity:0;pointer-events:none;width:100%!important;height:100%!important}
  .ds-btn{width:100%;display:flex;align-items:center;text-align:left;font:inherit;cursor:pointer;min-height:38px;padding:8px 42px 8px 12px;border:1px solid var(--border-strong);border-radius:10px;
    background:${chev} no-repeat right 17px center/12px 8px,color-mix(in srgb,var(--bg) 55%,var(--surface));color:var(--text);transition:border-color .15s,box-shadow .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ds-btn:hover{border-color:var(--accent)}
  .ds-btn.open,.ds-btn:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .ds-btn[disabled]{opacity:.5;cursor:not-allowed}
  .ds-btn .ds-txt{overflow:hidden;text-overflow:ellipsis}
  .ds-pop{position:fixed;z-index:2000;min-width:140px;max-height:300px;overflow:auto;padding:6px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-strong);box-shadow:0 18px 50px -12px rgba(0,0,0,.65);animation:dsIn .12s ease}
  @keyframes dsIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .ds-opt{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:.93em;white-space:nowrap}
  .ds-opt:hover,.ds-opt.hl{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--text)}
  .ds-opt.sel{color:var(--text);font-weight:600}
  .ds-opt.sel::after{content:"";margin-left:auto;width:10px;height:5px;border-left:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(-45deg) translateY(-2px)}
  .ds-opt.dis{opacity:.4;pointer-events:none}
  .ds-grp{padding:8px 12px 4px;font-size:.72em;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}`;
  document.head.append(style);

  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(HTMLSelectElement.prototype, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); if (this._dsSync) this._dsSync(); }, configurable: true });
  const idxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', { get() { return idxDesc.get.call(this); }, set(v) { idxDesc.set.call(this, v); if (this._dsSync) this._dsSync(); }, configurable: true });

  let pop = null, popFor = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } if (popFor) { popFor.classList.remove('open'); popFor = null; } };
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !(popFor && popFor.contains(e.target))) closePop(); });
  window.addEventListener('resize', closePop);
  window.addEventListener('scroll', (e) => { if (pop && !pop.contains(e.target)) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { const b = popFor; closePop(); b && b.focus(); } }, true);

  function enhance(sel) {
    if (sel._ds || sel.multiple || sel.size > 1) return; sel._ds = true;
    const wrap = document.createElement('span'); wrap.className = 'ds-wrap';
    for (const p of ['width', 'maxWidth', 'minWidth', 'flex', 'margin', 'marginTop', 'marginBottom', 'gridColumn']) if (sel.style[p]) { wrap.style[p] = sel.style[p]; sel.style[p] = ''; }
    if (getComputedStyle(sel).display === 'inline-block' || getComputedStyle(sel).width === 'auto') { /* keep natural */ }
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ds-btn ' + [...sel.classList].join(' '); btn.innerHTML = '<span class="ds-txt"></span>';
    if (sel.id) btn.dataset.for = sel.id; btn.setAttribute('aria-haspopup', 'listbox');
    sel.parentNode.insertBefore(wrap, sel); wrap.append(btn, sel); sel.classList.add('ds-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    const label = () => { const o = sel.options[sel.selectedIndex]; btn.querySelector('.ds-txt').textContent = o ? o.textContent : ''; btn.disabled = sel.disabled; };
    sel._dsSync = label; label();
    new MutationObserver(label).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'], characterData: true });
    sel.addEventListener('change', label);
    sel.addEventListener('focus', () => btn.focus());
    if (sel.autofocus) btn.focus();

    const open = () => {
      if (btn.disabled) return; if (popFor === btn) { closePop(); return; } closePop();
      pop = document.createElement('div'); pop.className = 'ds-pop'; pop.setAttribute('role', 'listbox'); popFor = btn; btn.classList.add('open');
      const items = []; let hl = Math.max(0, sel.selectedIndex);
      const addOpt = (o, i) => { const d = document.createElement('div'); d.className = 'ds-opt' + (i === sel.selectedIndex ? ' sel' : '') + (o.disabled ? ' dis' : ''); d.textContent = o.textContent; d.dataset.i = i; d.setAttribute('role', 'option'); d.onmousedown = (e) => e.preventDefault(); d.onclick = () => pick(i); items.push(d); return d; };
      [...sel.children].forEach((c) => { if (c.tagName === 'OPTGROUP') { const g = document.createElement('div'); g.className = 'ds-grp'; g.textContent = c.label; pop.append(g); [...c.children].forEach((o) => pop.append(addOpt(o, o.index))); } else pop.append(addOpt(c, c.index)); });
      const host = btn.closest('dialog[open]') || document.body; host.append(pop);
      const r = btn.getBoundingClientRect(); pop.style.minWidth = r.width + 'px';
      const h = Math.min(pop.scrollHeight, 300), below = innerHeight - r.bottom - 12, up = r.top - 12;
      if (below < h && up > below) { pop.style.maxHeight = Math.min(300, up) + 'px'; pop.style.bottom = (innerHeight - r.top + 6) + 'px'; } else { pop.style.maxHeight = Math.min(300, below) + 'px'; pop.style.top = (r.bottom + 6) + 'px'; }
      pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
      const mark = () => items.forEach((d) => d.classList.toggle('hl', +d.dataset.i === hl));
      const sc = () => { const d = items.find((x) => +x.dataset.i === hl); d && d.scrollIntoView({ block: 'nearest' }); };
      mark(); sc();
      pop._key = (e) => {
        const ok = (i) => sel.options[i] && !sel.options[i].disabled; let n = hl;
        if (e.key === 'ArrowDown') { do { n++; } while (n < sel.options.length && !ok(n)); if (n < sel.options.length) hl = n; }
        else if (e.key === 'ArrowUp') { do { n--; } while (n >= 0 && !ok(n)); if (n >= 0) hl = n; }
        else if (e.key === 'Home') hl = 0; else if (e.key === 'End') hl = sel.options.length - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(hl); return; }
        else if (e.key.length === 1) { const k = e.key.toLowerCase(); const j = [...sel.options].findIndex((o, i) => i > hl && ok(i) && o.textContent.trim().toLowerCase().startsWith(k)); const j2 = j >= 0 ? j : [...sel.options].findIndex((o, i) => ok(i) && o.textContent.trim().toLowerCase().startsWith(k)); if (j2 >= 0) hl = j2; }
        else return; e.preventDefault(); mark(); sc();
      };
    };
    const pick = (i) => { const changed = sel.selectedIndex !== i; idxDesc.set.call(sel, i); label(); closePop(); btn.focus(); if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } };
    btn.addEventListener('blur', () => { if (popFor === btn) closePop(); });
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', (e) => { if (pop && popFor === btn && pop._key) { pop._key(e); return; } if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } });
  }
  const scan = (root = document) => root.querySelectorAll && root.querySelectorAll('select:not([data-nods])').forEach(enhance);
  let t = null; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => scan(), 0); }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
