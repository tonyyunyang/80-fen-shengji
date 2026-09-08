// Finish the local wait even if a provider ignores cancellation. A late result
// may reconcile usage, but must never become a second game action.
export function awaitProvider(work, signal, onLate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then((result) => finish(null, result), (error) => finish(error, null));
    function finish(error, result) {
      if (settled) { onLate(error, result); return; }
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    }
    if (signal.aborted) abort();
  });
}
