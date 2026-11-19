/** Resize and navigate only inside an explicitly trusted Website embed. */
export const embedded = window.parent !== window && new URLSearchParams(location.search).get('embed') === '1';
let hostOrigin = null;
let lastHeight = 0;
let resizeFrame = 0;
let pendingScroll = null;
const trustedHosts = new Set(['https://umarzafar.vercel.app', 'https://hateforsale.vercel.app']);
if (location.hostname === '127.0.0.1') trustedHosts.add('http://127.0.0.1:8768');

function post(message) {
  if (hostOrigin) window.parent.postMessage({ ...message, version: 1 }, hostOrigin);
}

function publishHeight(force = false) {
  const shell = document.querySelector('.atlas-shell');
  const height = Math.ceil(shell.getBoundingClientRect().height + shell.offsetTop);
  if (!Number.isFinite(height) || height < 320 || height > 50000) return false;
  if (force || Math.abs(height - lastHeight) >= 2) {
    lastHeight = height;
    post({ type: 'geohistory:resize', height });
  }
  return true;
}

function reportHeight() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => publishHeight());
}

/** Return true when the trusted parent is responsible for document scrolling. */
export function scrollEmbeddedSection(section, behavior) {
  if (document.fullscreenElement) return false;
  if (!hostOrigin) {
    if (embedded) pendingScroll = { section, behavior };
    return false;
  }
  pendingScroll = null;
  requestAnimationFrame(() => {
    // Keep resize and navigation adjacent: observer rescheduling cannot reverse them.
    if (!publishHeight(true)) return;
    post({ type: 'geohistory:scroll', top: section.getBoundingClientRect().top + window.scrollY, behavior });
  });
  return true;
}

if (embedded) {
  document.querySelector('.brand').href = './?embed=1';
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !trustedHosts.has(event.origin) || !data || data.type !== 'geohistory:host' || data.version !== 1) return;
    if (!Number.isFinite(data.viewportHeight) || data.viewportHeight < 200 || data.viewportHeight > 5000) return;
    const firstHandshake = !hostOrigin;
    hostOrigin = event.origin;
    document.documentElement.classList.add('atlas-embedded');
    document.documentElement.style.setProperty('--host-map-height', Math.max(640, Math.min(820, data.viewportHeight * .78)) + 'px');
    if (firstHandshake) {
      new ResizeObserver(reportHeight).observe(document.querySelector('.atlas-shell'));
      document.fonts?.ready.then(reportHeight);
    }
    reportHeight();
    if (firstHandshake && pendingScroll) {
      const { section, behavior } = pendingScroll;
      scrollEmbeddedSection(section, behavior);
    }
    if (Number.isFinite(data.viewportTop)) {
      document.dispatchEvent(new CustomEvent('geohistory:viewport', { detail: { top: data.viewportTop, height: data.viewportHeight, headerHeight: Number.isFinite(data.headerHeight) ? data.headerHeight : 0 } }));
    }
  });
}
