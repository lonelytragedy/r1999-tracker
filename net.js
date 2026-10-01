const Net = (() => {
  const RECHECK_MS = 20000;
  const TIMEOUT_MS = 6000;
  let online = navigator.onLine;
  let pending = null;
  let timer = null;
  const listeners = [];

  function set(value) {
    if (value === online) return;
    online = value;
    listeners.forEach(fn => { try { fn(value); } catch (_) {} });
  }

  function schedule() {
    clearTimeout(timer);
    if (!online) timer = setTimeout(check, RECHECK_MS);
  }

  function check() {
    if (pending) return pending;
    pending = (async () => {
      if (!navigator.onLine) { set(false); return false; }
      const ctrl = new AbortController();
      const abort = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        await fetch('lang-init.js?net=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
        set(true);
      } catch (_) {
        set(false);
      } finally {
        clearTimeout(abort);
      }
      return online;
    })().finally(() => { pending = null; schedule(); });
    return pending;
  }

  window.addEventListener('online', check);
  window.addEventListener('offline', () => { set(false); schedule(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  check();

  return {
    isOnline: () => online,
    check,
    onChange: fn => listeners.push(fn),
  };
})();
