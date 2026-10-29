import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/site.js'), 'utf8');

function runSite(siteID, localValues = new Map(), sessionValues = new Map()) {
  const events = new Map();
  const storageCalls = { local: [], session: [] };
  const storage = (values, calls) => ({
    getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key, value]); values.set(key, String(value)); },
  });
  const themeButton = { addEventListener(name, callback) { events.set(`theme:${name}`, callback); }, setAttribute() {} };
  const navButton = { addEventListener() {}, getAttribute() { return 'false'; }, setAttribute() {}, focus() {} };
  const media = { dataset: {}, complete: false, naturalWidth: 0, src: 'https://site.example/media/image.jpg', alt: '', classList: { add() {} }, hasAttribute(name) { return name === 'data-cms-media'; }, addEventListener(name, callback) { events.set(`media:${name}`, callback); }, removeAttribute() {} };
  const documentElement = { dataset: {}, getAttribute(name) { return name === 'data-myhaco-site-id' ? siteID : null; }, setAttribute() {} };
  const dialog = { showModal() {}, close() {} };
  const document = {
    documentElement,
    body: { appendChild() {} },
    head: { appendChild() {} },
    querySelector(selector) {
      if (selector === '.theme-toggle') return themeButton;
      if (selector === '.menu-toggle') return navButton;
      if (selector === '#navigation') return { classList: { contains() { return false; }, toggle() {}, remove() {} }, querySelectorAll() { return []; } };
      if (selector === '#contact-dialog') return dialog;
      if (selector === '#contact-content') return { textContent: '' };
      return null;
    },
    querySelectorAll(selector) { return selector === '.work-image img' || selector === 'img[data-cms-media]' ? [media] : []; },
    addEventListener() {},
    createElement() { return { type: '', className: '', dataset: {}, addEventListener() {} }; },
  };
  const location = { pathname: '/keroct/pricing/', reloadCount: 0, reload() { this.reloadCount++; } };
  const context = {
    document, location, window: { KEROCT_CONFIG: {} },
    localStorage: storage(localValues, storageCalls.local),
    sessionStorage: storage(sessionValues, storageCalls.session),
    matchMedia() { return { matches: false }; },
    URL, Date, setTimeout, console,
  };
  runInNewContext(source, context);
  return { events, documentElement, location, localValues, sessionValues, storageCalls };
}

test('site storage is namespaced by valid site ID and keeps legacy keys without the marker', () => {
  const firstID = '2cb8c2a1-fd03-4f22-b651-4bb00ec65466';
  const secondID = '3cb8c2a1-fd03-4f22-b651-4bb00ec65466';
  const localValues = new Map([[`keroct-theme:${firstID}`, 'dark'], [`keroct-theme:${secondID}`, 'light']]);

  const first = runSite(firstID, localValues);
  assert.equal(first.documentElement.dataset.theme, 'dark');
  first.events.get('theme:click')();
  assert.equal(localValues.get(`keroct-theme:${firstID}`), 'light');
  assert.equal(localValues.get(`keroct-theme:${secondID}`), 'light');
  first.events.get('media:error')();
  assert.ok(first.sessionValues.has(`keroct-cms-media-reload:${firstID}:/keroct/pricing/`));

  const legacy = runSite(null, new Map([['keroct-theme', 'dark']]));
  assert.equal(legacy.documentElement.dataset.theme, 'dark');
  legacy.events.get('media:error')();
  assert.ok(legacy.sessionValues.has('keroct-cms-media-reload:/keroct/pricing/'));

  const invalid = runSite('not-a-lowercase-uuid');
  invalid.events.get('media:error')();
  assert.deepEqual(invalid.storageCalls.local, []);
  assert.deepEqual(invalid.storageCalls.session, []);
  assert.equal(invalid.location.reloadCount, 0);
});
