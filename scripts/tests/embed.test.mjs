import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/region/embed.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
const origin = 'https://umarzafar.vercel.app';

function bridge({ embedded = true } = {}) {
  const messages = [], frames = new Map(), listeners = new Map();
  let height = 1200, frameId = 0, observeResize;
  const parent = { postMessage: (data, target) => messages.push({ ...data, target }) };
  const window = { parent, scrollY: 0, addEventListener: (type, fn) => listeners.set(type, fn) };
  if (!embedded) window.parent = window;
  const shell = { offsetTop: 0, getBoundingClientRect: () => ({ height }) };
  const document = {
    fullscreenElement: null,
    querySelector: selector => selector === '.atlas-shell' ? shell : {},
    documentElement: { classList: { add() {} }, style: { setProperty() {} } },
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window, document, URLSearchParams,
    location: { search: '?embed=1', hostname: 'geohistory-atlas.vercel.app' },
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { constructor(fn) { observeResize = fn; } observe() {} },
  });
  vm.runInContext(source, context);
  return {
    messages, section: top => ({ getBoundingClientRect: () => ({ top }) }),
    scroll: (section, behavior = 'smooth') => context.scrollEmbeddedSection(section, behavior),
    host: (options = {}) => listeners.get('message')?.({ source: parent, origin, data: { type: 'geohistory:host', version: 1, viewportHeight: 900 }, ...options }),
    resize: value => { height = value; observeResize(); },
    flush: () => { for (const [id, fn] of [...frames]) if (frames.delete(id)) fn(); },
  };
}

test('observer rescheduling cannot deliver a scroll before its current height', () => {
  const app = bridge(); app.host(); app.flush(); app.messages.length = 0;
  app.scroll(app.section(3500));
  app.resize(4000); // Cancels/requeues ordinary resize work behind navigation.
  app.flush();
  assert.deepEqual(app.messages.map(message => message.type), ['geohistory:resize', 'geohistory:scroll']);
  assert.equal(app.messages[0].height, 4000);
  assert.equal(app.messages[1].top, 3500);
  assert(app.messages.every(message => message.target === origin));
  app.messages.length = 0;
  app.scroll(app.section(500)); app.flush();
  assert.deepEqual(app.messages.map(message => message.type), ['geohistory:resize', 'geohistory:scroll'], 'Navigation must force an unchanged height too');
});

test('latest pre-handshake navigation falls back locally and replays after a trusted handshake', () => {
  const app = bridge();
  assert.equal(app.scroll(app.section(500)), false);
  assert.equal(app.scroll(app.section(900), 'instant'), false);
  app.flush(); assert.equal(app.messages.length, 0);
  app.host(); app.flush();
  const navigation = app.messages.filter(message => message.type === 'geohistory:scroll');
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0].top, 900);
  assert.equal(navigation[0].behavior, 'instant');
  assert.equal(app.messages.at(-2).type, 'geohistory:resize');
});

test('untrusted origins and unrelated windows cannot activate the bridge', () => {
  const app = bridge(); app.scroll(app.section(900));
  app.host({ origin: 'https://untrusted.example' });
  app.host({ source: {} }); app.flush();
  assert.equal(app.messages.length, 0);
  app.host(); app.flush();
  assert.equal(app.messages.at(-1).type, 'geohistory:scroll');
});

test('standalone navigation retains the native fallback', () => {
  const app = bridge({ embedded: false });
  assert.equal(app.scroll(app.section(900)), false);
  app.flush(); assert.equal(app.messages.length, 0);
});
