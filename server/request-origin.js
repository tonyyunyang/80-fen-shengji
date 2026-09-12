export function browserOriginAllowed({ method, pathname, origin, expectedOrigin, site, mode, destination }, allowDocumentNavigation = false) {
  if (origin && origin !== expectedOrigin) return false;
  if (site !== 'cross-site') return true;
  // A public game can be opened from another website. Only the static
  // document navigation is exempt; API reads and mutations remain private.
  return allowDocumentNavigation && method === 'GET' && mode === 'navigate' && destination === 'document' &&
    !pathname.startsWith('/api/') && !pathname.startsWith('/_eighty/');
}
