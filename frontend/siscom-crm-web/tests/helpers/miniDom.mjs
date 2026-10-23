// Minimal in-memory DOM (no dependency) so React 18 client rendering + synthetic events can run under `node --test`.
// Only what react-dom/client + the customer form/panel components touch. NOT a browser: no layout, no CSS, no focus management.
class Node_ {
  constructor(nodeType, ownerDocument) { this.nodeType = nodeType; this.ownerDocument = ownerDocument; this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); c.parentNode = this; return c; }
  appendChild(c) { return this.insertBefore(c, null); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes.slice().forEach((c) => this.removeChild(c)); if (v !== '' && v != null) this.appendChild(new Text_(String(v), this.ownerDocument)); }
}
class Text_ extends Node_ {
  constructor(data, doc) { super(3, doc); this.data = data; this.nodeValue = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); this.nodeValue = this.data; }
}
class Element_ extends Node_ {
  constructor(tag, doc) {
    super(1, doc); this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.attributes = {}; this.listeners = {};
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.value = ''; this.checked = false; this.disabled = false;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
  removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  get type() { return this.attributes.type || (this.tagName === 'INPUT' ? 'text' : this.tagName === 'BUTTON' ? 'submit' : ''); }
  focus() {} blur() {}
  getRootNode() { let x = this; while (x.parentNode) x = x.parentNode; return x; }
  querySelectorAll(pred) { const out = []; const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { if (pred(c)) out.push(c); walk(c); } }); walk(this); return out; }
}
export function createMiniDom() {
  const doc = new Node_(9, null); doc.ownerDocument = doc;
  doc.createElement = (t) => new Element_(t, doc); doc.createElementNS = (_ns, t) => new Element_(t, doc); doc.createTextNode = (d) => new Text_(d, doc);
  doc.oninput = null; doc.onchange = null; doc.onclick = null; // React feature-detects native input events via `'oninput' in document`
  doc.addEventListener = () => {}; doc.removeEventListener = () => {};
  doc.documentElement = doc.createElement('html'); doc.body = doc.createElement('body'); doc.documentElement.appendChild(doc.body); doc.appendChild(doc.documentElement);
  doc.activeElement = doc.body; doc.defaultView = null;
  return doc;
}

// Install globals React DOM looks for. Returns { doc, container, restore }.
export function installDom() {
  const doc = createMiniDom(); const keys = ['window', 'document', 'navigator', 'HTMLIFrameElement']; const prev = {};
  for (const k of keys) prev[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const win = { document: doc, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, event: undefined, HTMLIFrameElement: class {}, location: { href: 'http://localhost/' } };
  doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'HTMLIFrameElement', { value: class {}, configurable: true, writable: true });
  const container = doc.createElement('div'); doc.body.appendChild(container);
  return { doc, container, restore() { for (const k of keys) { if (prev[k]) Object.defineProperty(globalThis, k, prev[k]); else delete globalThis[k]; } } };
}

// ---- queries / interaction helpers ----
export const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
export const findAll = (root, pred) => root.querySelectorAll(pred);
export const byTag = (root, tag) => findAll(root, (e) => e.tagName === tag.toUpperCase());
export const buttonByText = (root, re) => byTag(root, 'button').find((b) => re.test(text(b)));
// Input/textarea that belongs to the <label> whose text matches `re` (Field renders label htmlFor=id).
export function inputByLabel(root, re) {
  const label = byTag(root, 'label').find((l) => re.test(text(l)));
  if (!label) return null;
  return findAll(root, (e) => (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.attributes.id === label.attributes.for)[0] || null;
}
// React attaches ONE listener per event type on the root container; dispatch a bubbling event from `target` through the ancestors' listeners.
function dispatch(target, type, init = {}) {
  const ev = { type, target, bubbles: true, defaultPrevented: false, cancelBubble: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, isTrusted: true, timeStamp: Date.now(), nativeEvent: null, ...init };
  ev.currentTarget = null;
  for (let n = target; n && !ev.cancelBubble; n = n.parentNode) { ev.currentTarget = n; (n.listeners && n.listeners[type] ? n.listeners[type].slice() : []).forEach((f) => f(ev)); }
  return ev;
}
export const click = (el) => { if (el.disabled) return false; dispatch(el, 'click', { button: 0 }); return true; };
// Controlled input typing: React tracks the value via a property setter on the node; set the plain value then fire `input`.
export function type(el, value) { el.value = value; dispatch(el, 'input'); }
