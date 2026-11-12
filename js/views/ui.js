/* Reusable supervisor overview components. */
import { el, icon } from '../ui.js';

export function sectionHeader(title, { count, sub, action } = {}) {
  return el('div.shared-section-header', {},
    el('h2', {}, title,
      count == null ? null : el('span.shared-inline-count', {}, String(count)),
      sub ? el('small', {}, ' · ' + sub) : null),
    action || null);
}

export function listRow({ primary, secondary = '', meta = '', tone = '', onClick } = {}) {
  const tag = onClick ? 'button.shared-list-row' : 'div.shared-list-row';
  return el(tag + (tone ? '.' + tone : ''), onClick ? { type: 'button', onclick: onClick } : {},
    el('strong.mono', {}, primary || '—'),
    secondary ? el('span.shared-secondary', {}, secondary) : null,
    meta ? el('small.shared-meta', {}, meta) : null);
}

export function cappedList(rows = [], { limit = 5, empty = 'Nothing to show.' } = {}) {
  const root = el('div.shared-capped-list', {});
  if (!rows.length) { root.append(el('p.shared-empty-text', {}, empty)); return root; }
  const body = el('div.shared-list-items', {}, ...rows.slice(0, limit));
  root.append(body);
  if (rows.length > limit) {
    let expanded = false;
    const toggle = el('button.shared-show-all', { type: 'button', onclick: () => {
      expanded = !expanded;
      body.replaceChildren(...(expanded ? rows : rows.slice(0, limit)));
      toggle.textContent = expanded ? 'Show less' : 'Show all (' + rows.length + ')';
      toggle.setAttribute('aria-expanded', String(expanded));
    }, 'aria-expanded': 'false' }, 'Show all (' + rows.length + ')');
    root.append(toggle);
  }
  return root;
}

export function statTile({ value, label, sub = '', tone = '' } = {}) {
  return el('div.shared-stat-tile' + (tone ? '.' + tone : ''), {},
    el('strong.mono', {}, String(value ?? '—')), el('span', {}, label || ''),
    sub ? el('small', {}, sub) : null);
}

export function emptyState({ icon: symbol = 'check', text = '', action = null } = {}) {
  return el('div.shared-empty', {}, icon(symbol, { size: 22 }), el('span', {}, text), action);
}
