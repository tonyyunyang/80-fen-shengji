// Keep physical cards, scroll containers, focused controls, and the renderer alive
// across SSE updates. Only strings built by our escaped view templates enter here.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const key = node => node.nodeType === 1 ? node.id || node.getAttribute('data-key') || (node.hasAttribute('data-card') ? 'card:' + node.dataset.card : null) : null;
const compatible = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
function reconcile(parent, target) {
  let cursor = parent.firstChild;
  for (const next of [...target.childNodes]) {
    let current = cursor;
    if (!current || !compatible(current, next)) {
      current = [...parent.childNodes].find(node => node !== cursor && key(next) && compatible(node, next));
      if (current) parent.insertBefore(current, cursor);
      else { current = next.cloneNode(true); parent.insertBefore(current, cursor); }
    }
    if (current.nodeType === 1) {
      if (!current.hasAttribute('data-preserve')) {
        for (const attr of [...current.attributes]) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        for (const attr of [...next.attributes]) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
        reconcile(current, next);
      }
    } else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    cursor = current.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}
export function patchHtml(parent, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  reconcile(parent, template.content);
}
