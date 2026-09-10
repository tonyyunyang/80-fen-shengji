import { EN, STATIC_EN } from './messages.js';
import { cardLabel as label, rankLabel as rank } from '../src/cards.js';

let language = 'zh';
try { const saved = localStorage.getItem('eighty-language'); if (['en', 'zh'].includes(saved)) language = saved; } catch {}
export const locale = language;
export const pick = (zh, en) => locale === 'en' ? en : zh;
// Exact, trusted message lookup. Never scan generated markup or user data.
export function t(source) { return locale === 'en' ? EN[source] ?? STATIC_EN[source] ?? source : source; }
export const cardCount = count => count + ' ' + pick('张', count === 1 ? 'card' : 'cards');
export const rankLabel = value => rank(value, locale);
export const cardLabel = card => label(card, locale);
export const seatName = seat => ({ '你': pick('你', 'You'), '南家': pick('南家', 'South'), '东家': pick('东家', 'East'),
  '北家': pick('北家', 'North'), '西家': pick('西家', 'West'), You: pick('你', 'You'), S: pick('南家', 'South'),
  E: pick('东家', 'East'), N: pick('北家', 'North'), W: pick('西家', 'West') })[seat.name] ?? seat.name;

export function localizeStaticDocument(root = document) {
  root.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  if (locale === 'en') {
    // Runs once on the authored HTML, before any names, settings or game data enter it.
    const walk = root.createTreeWalker(root.documentElement, NodeFilter.SHOW_TEXT);
    for (let node; (node = walk.nextNode());) {
      if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
      const value = node.textContent.trim();
      if (STATIC_EN[value] !== undefined) node.textContent = node.textContent.replace(value, STATIC_EN[value]);
    }
    for (const node of root.querySelectorAll('[aria-label],[placeholder]')) for (const attribute of ['aria-label', 'placeholder']) {
      const value = node.getAttribute(attribute);
      if (STATIC_EN[value] !== undefined) node.setAttribute(attribute, STATIC_EN[value]);
    }
  }
  const select = root.getElementById('languageSelect');
  if (select) {
    select.value = locale;
    select.onchange = () => {
      try { localStorage.setItem('eighty-language', select.value); } catch { return; }
      // A reload reconnects to the same private server game and avoids stale labels
      // in dialogs, handoffs and training-answer identities.
      location.reload();
    };
  }
}
