/* Tiny DOM helpers. Everything renders from plain data, no framework. */

export function el(tag, props = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v);
  }

  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function clear(node) {
  // replaceChildren() detaches in one step. Removing children one at a time can
  // fire a blur handler mid-loop, which re-renders and invalidates the loop.
  node.replaceChildren();
  return node;
}

export function chip(text, tone = 'mute', title) {
  return el('span.chip.' + tone, { title: title || undefined }, text);
}

export function bar(pct, done) {
  return el('span.bar' + (done ? '.done' : ''), {},
    el('i', { style: { width: Math.max(0, Math.min(100, pct || 0)) + '%' } }));
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso, { withDay = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  const base = `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const yr = d.getUTCFullYear() !== new Date().getFullYear() ? ` ${d.getUTCFullYear()}` : '';
  return withDay ? `${DAY_NAMES[d.getUTCDay()]} ${base}${yr}` : base + yr;
}

export function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

export function fmtNum(n) {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString();
}

export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div.toast', { text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog', {},
      el('header', {}, title),
      el('div.body', {}, el('p', { text: message })),
      el('footer', {},
        el('button', { onclick: () => { dlg.close(); resolve(false); } }, 'Cancel'),
        el('button', { class: danger ? 'danger' : 'primary', onclick: () => { dlg.close(); resolve(true); } }, confirmLabel)
      )
    );
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function modal(title, bodyNode, { actions = [], wide = false } = {}) {
  const dlg = el('dialog', wide ? { style: { maxWidth: '900px' } } : {},
    el('header', {}, title,
      el('span.spacer'),
      el('button.ghost.sm', { onclick: () => dlg.close() }, 'Close')),
    el('div.body', {}, bodyNode),
    actions.length ? el('footer', {}, ...actions.map((a) =>
      el('button', { class: a.class || '', onclick: () => a.onClick(dlg) }, a.label))) : null
  );
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Very small markdown subset for the process guide: headings, lists, bold, code. */
export function renderDoc(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = String(text || '').split('\n');
  let out = '';
  let list = null;

  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^###\s+(.*)/))) { closeList(); out += `<h4>${esc(m[1])}</h4>`; }
    else if ((m = line.match(/^##\s+(.*)/))) { closeList(); out += `<h3>${esc(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; }
      out += `<li>${inline(esc(m[1]))}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; }
      out += `<li>${inline(esc(m[1]))}</li>`;
    } else if (!line.trim()) { closeList(); }
    else { closeList(); out += `<p>${inline(esc(line))}</p>`; }
  }
  closeList();
  return out;

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- icons ---------- */

/* Inline SVG so nothing is fetched — the app has to run from a network share
   with no internet. 24x24 grid, stroke-based, sized by CSS. */
const ICON_PATHS = {
  check: 'M20 6 9 17l-5-5',
  play: 'M6 4l14 8-14 8z',
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  note: 'M4 5h16M4 10h16M4 15h10',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  x: 'M18 6 6 18M6 6l12 12',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  arrow: 'M5 12h13M12 5l7 7-7 7',
  cloud: 'M17.5 19a4.5 4.5 0 0 0 .3-9A6.5 6.5 0 0 0 5.3 11 4 4 0 0 0 6 19z',
};

export function icon(name, { size = 16, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.dot);
  if (name === 'play') { p.setAttribute('fill', 'currentColor'); p.setAttribute('stroke', 'none'); }
  svg.append(p);
  return svg;
}

/** Toast with an action, e.g. Undo. Returns the node so it can be dismissed. */
export function toastAction(msg, actionLabel, onAction, ms = 6000) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div.toast.toast-action', {},
    el('span', {}, msg),
    el('button', {
      onclick: () => { t.remove(); onAction(); },
    }, actionLabel));
  document.body.append(t);
  const timer = setTimeout(() => t.remove(), ms);
  t.addEventListener('remove', () => clearTimeout(timer));
  return t;
}

/** Expand/collapse a block by animating its natural height, then releasing
    the constraint so later content changes are not clipped. */
export function animateHeight(node, expand) {
  if (typeof node.animate !== 'function') return;
  const h = node.scrollHeight;
  const from = expand ? 0 : h;
  const to = expand ? h : 0;
  node.style.overflow = 'hidden';
  const anim = node.animate(
    [{ height: from + 'px', opacity: expand ? 0 : 1 },
     { height: to + 'px', opacity: expand ? 1 : 0 }],
    { duration: 180, easing: 'cubic-bezier(.4,0,.2,1)' });
  anim.onfinish = () => { node.style.overflow = ''; node.style.height = ''; };
}

/** Brief highlight so a change is visible where it happened. */
export function flash(node) {
  if (!node || typeof node.animate !== 'function') return;
  node.animate(
    [{ backgroundColor: 'var(--accent-soft)' }, { backgroundColor: 'transparent' }],
    { duration: 700, easing: 'ease-out' });
}
