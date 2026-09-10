import { pick } from './i18n.js';

export function dismissDialog(dialog) {
  if (!dialog.open) return;
  dialog.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
  // Match Escape semantics, including the pause menu's resume handler.
  if (typeof dialog.requestClose === 'function') dialog.requestClose();
  else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
}

export function enhanceDialogs(root = document) {
  for (const dialog of root.querySelectorAll('dialog')) {
    const header = document.createElement('div'), heading = document.createElement('div'), body = document.createElement('div');
    header.className = 'dialog-toolbar'; heading.className = 'dialog-heading'; body.className = 'dialog-body';
    const title = [...dialog.children].find(node => node.tagName === 'H2');
    const eyebrow = [...dialog.children].find(node => node.classList.contains('eyebrow'));
    if (eyebrow) heading.append(eyebrow);
    if (title) { heading.append(title); if (title.id) dialog.setAttribute('aria-labelledby', title.id); }
    let close = dialog.querySelector(':scope > .dialog-close');
    if (!close) {
      close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×';
      close.setAttribute('aria-label', pick('返回牌桌', 'Return to table')); close.onclick = () => dismissDialog(dialog);
    }
    header.append(heading, close);
    body.append(...dialog.childNodes); dialog.append(header, body);
    dialog.classList.add('framed-dialog');

    bindBackdropDismissal(dialog);
  }
}

export function bindBackdropDismissal(dialog) {
    let downOutside = false, pointerId = null;
    const outside = event => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    dialog.addEventListener('pointerdown', event => { pointerId = event.pointerId; downOutside = event.button === 0 && outside(event); });
    dialog.addEventListener('pointercancel', () => { downOutside = false; pointerId = null; });
    dialog.addEventListener('pointerup', event => {
      const dismiss = downOutside && event.pointerId === pointerId && outside(event);
      downOutside = false; pointerId = null;
      if (dismiss) { event.preventDefault(); dismissDialog(dialog); }
    });
    dialog.addEventListener('close', () => { downOutside = false; pointerId = null; });
}
