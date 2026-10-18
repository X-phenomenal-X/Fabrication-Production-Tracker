/* Just enough of a browser for the tracker's own XLSX reader to run under Node.
   The reader calls DOMParser; Node does not provide one. This is not a second
   spreadsheet parser. */

class XmlElement {
  constructor(name) {
    this.name = name;
    const colon = name.lastIndexOf(':');
    this.local = colon >= 0 ? name.slice(colon + 1) : name;
    this.attrs = {};
    this.children = [];
    this.text = '';
  }

  get textContent() {
    let out = this.text;
    for (const child of this.children) out += child.textContent;
    return out;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  getAttributeNS(_namespace, local) {
    if (Object.prototype.hasOwnProperty.call(this.attrs, local)) return this.attrs[local];
    const prefixed = Object.keys(this.attrs).find((key) => key.endsWith(`:${local}`));
    return prefixed ? this.attrs[prefixed] : null;
  }

  getElementsByTagName(tag) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.local === tag || child.name === tag) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (all, token) => {
    if (token === 'amp') return '&';
    if (token === 'lt') return '<';
    if (token === 'gt') return '>';
    if (token === 'quot') return '"';
    if (token === 'apos') return "'";
    if (token[0] === '#') {
      const code = token[1] === 'x' || token[1] === 'X'
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : all;
    }
    return all;
  });
}

function parseAttributes(source) {
  const attrs = {};
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (i >= source.length) break;
    let name = '';
    while (i < source.length && source[i] !== '=' && !/\s/.test(source[i])) {
      name += source[i];
      i += 1;
    }
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source[i] !== '=') {
      if (name) attrs[name] = '';
      continue;
    }
    i += 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    const quote = source[i];
    if (quote !== '"' && quote !== "'") continue;
    i += 1;
    let value = '';
    while (i < source.length && source[i] !== quote) {
      value += source[i];
      i += 1;
    }
    i += 1;
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

export class NodeDomParser {
  parseFromString(xml) {
    const source = String(xml);
    const root = new XmlElement('#document');
    const stack = [root];
    let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

    while (i < source.length) {
      if (source.charCodeAt(i) !== 60) {
        const next = source.indexOf('<', i);
        const text = source.slice(i, next === -1 ? source.length : next);
        stack[stack.length - 1].text += decodeEntities(text);
        i = next === -1 ? source.length : next;
        continue;
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        i = end === -1 ? source.length : end + 3;
        continue;
      }
      if (source.startsWith('<?', i)) {
        const end = source.indexOf('?>', i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i + 9);
        stack[stack.length - 1].text += source.slice(i + 9, end === -1 ? source.length : end);
        i = end === -1 ? source.length : end + 3;
        continue;
      }
      if (source.charCodeAt(i + 1) === 47) {
        const end = source.indexOf('>', i + 2);
        if (stack.length > 1) stack.pop();
        i = end === -1 ? source.length : end + 1;
        continue;
      }
      const end = source.indexOf('>', i + 1);
      let body = source.slice(i + 1, end === -1 ? source.length : end).trim();
      let selfClosing = false;
      if (body.endsWith('/')) {
        selfClosing = true;
        body = body.slice(0, -1).trim();
      }
      const nameEnd = body.search(/\s/);
      const element = new XmlElement((nameEnd === -1 ? body : body.slice(0, nameEnd)).trim());
      element.attrs = parseAttributes(nameEnd === -1 ? '' : body.slice(nameEnd));
      stack[stack.length - 1].children.push(element);
      if (!selfClosing) stack.push(element);
      i = end === -1 ? source.length : end + 1;
    }
    return root;
  }
}

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

if (typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = NodeDomParser;
if (typeof globalThis.localStorage === 'undefined') globalThis.localStorage = memoryStorage();
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { documentElement: { dataset: {} } };
}
