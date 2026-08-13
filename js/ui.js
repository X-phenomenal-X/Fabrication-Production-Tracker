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
