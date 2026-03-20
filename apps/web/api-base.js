/**
 * Single place for API origin: same-origin on Vercel / invariant.me;
 * localhost, loopback, or file:// (Electron) → optional localStorage override or :3000.
 * Prevents a stale inv_api_endpoint from forcing production pages to call localhost.
 */
(function () {
  var proto = window.location.protocol;
  var h = window.location.hostname;
  var isFile = proto === 'file:';
  var loopback = h === 'localhost' || h === '127.0.0.1';
  var isLocalFrontend = isFile || loopback;

  if (!isLocalFrontend) {
    window.INVARIANT_API_BASE = '';
    return;
  }

  var raw = '';
  try {
    raw = (localStorage.getItem('inv_api_endpoint') || '').trim();
  } catch (e) {}
  if (raw) {
    window.INVARIANT_API_BASE = raw.replace(/\/$/, '');
    return;
  }
  window.INVARIANT_API_BASE = 'http://localhost:3000';
})();
