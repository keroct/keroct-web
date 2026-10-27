import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const cmsSite = path.resolve(here, '..');
const repo = path.resolve(cmsSite, '..');

function publication(snapshotID, revision, marker) {
  const url = name => `/api/public-media/team-1/${snapshotID}/${name}`;
  return {
    id: snapshotID,
    revision,
    snapshot: {
      schemaVersion: 2,
      creators: [
        { id: 'creator-1', slug: 'synthetic-one', title: `Creator ${marker} <&"`, role: 'LOGO / STREAM', xUrl: 'https://x.com/synthetic', description: `Bio ${marker}`, summary: `Home summary ${marker}`, portfolioIntro: `Gallery intro ${marker}`, avatar: 'avatar-1', avatarUrl: url('avatar'), avatarAlt: `Explicit avatar alt ${marker}`, order: 2 },
        { id: 'creator-2', slug: 'kaerunoankake', title: 'かえるのあんかけ', role: 'ILLUSTRATION', description: 'Profile description B', summary: 'Home summary B', portfolioIntro: 'Gallery intro B', avatar: 'avatar-2', avatarUrl: url('avatar-b'), avatarAlt: 'Explicit avatar alt B', order: 1 },
        { id: 'creator-3', slug: 'sensuishi13', title: 'Synthetic diver', role: 'ILLUSTRATION', description: 'Synthetic profile C', summary: 'Synthetic summary C', portfolioIntro: 'Synthetic gallery C', avatar: null, avatarUrl: null, order: 3 },
      ],
      works: [
        { id: 'work-1', slug: 'first', title: `Work ${marker}`, category: 'logo', description: 'Logo detail', alt: 'Synthetic image', creator: 'creator-1', image: 'image-1', imageUrl: url('work'), enlargedImage: 'large-1', enlargedImageUrl: url('large'), enlargedImageTitle: 'Large title', order: 5 },
        { id: 'work-2', slug: 'second', title: 'Illustration', category: 'illustration', description: 'Art', alt: 'Art', creator: 'creator-2', image: 'image-2', imageUrl: url('art'), enlargedImage: null, enlargedImageUrl: null, order: 1 },
        { id: 'work-3', slug: 'third', title: 'Synthetic diver emblem', category: 'logo', description: 'Emblem', alt: 'Synthetic emblem', creator: 'creator-3', image: 'image-3', imageUrl: url('emblem'), enlargedImage: null, enlargedImageUrl: null, order: 6 },
      ],
      pricing: [
        { id: 'price-design', title: 'Design prices', kind: 'design', groups: [{ id: 'group-1', title: 'Logo', plans: [{ id: 'plan-1', name: 'A', value: '¥6,000', detail: 'One concept' }] }], examples: [{ title: 'Synthetic example', alt: 'Example art', image: 'example', imageUrl: url('example'), creator: 'creator-1', dimensions: '1200 x 800' }], conditions: [{ text: 'Design condition' }], order: 1 },
        { id: 'price-illustration', title: 'Illustration prices', kind: 'illustration', groups: [{ title: 'Art', plans: [{ name: 'Full order', value: '¥9,000', detail: null }] }], examples: [], conditions: [{ text: 'Illustration condition' }], order: 2 },
        { id: 'price-sets', title: 'Sets', kind: 'sets', groups: [], sets: [{ name: 'A set', price: '¥20,000', items: [{ name: 'Logo' }], revisions: 0 }, { name: 'B set', price: '¥30,000', items: [{ name: 'Banner' }], revisions: 2 }, { name: 'C set', price: '¥45,000', items: [{ name: 'Art' }], revisions: 5 }], options: [], examples: [], conditions: [], order: 3 },
        { id: 'price-options', title: 'Options', kind: 'design', groups: [], options: [{ name: 'Rush', price: '+75%', detail: 'Three days' }], examples: [], conditions: [{ text: 'Rush condition' }], order: 4 },
      ],
      presentations: [{ siteKey: 'other', title: 'Other', order: 1, featuredWorks: [], heroImages: [] }, { siteKey: 'keroct', title: `KEROCT ${marker}`, order: 2, featuredWorks: [{ work: 'work-1' }, { work: 'work-2' }, { work: 'work-3' }], heroImages: [{ image: 'hero', imageUrl: url('hero'), alt: 'Hero art' }, { image: 'hero-2', imageUrl: url('hero-2'), alt: 'Second art' }] }],
    },
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function waitForWorker(url, child) {
  const deadline = Date.now() + 45000;
  let lastError;
  let unavailableResponses = 0;
  while (Date.now() < deadline) {
    if (child.pid == null) throw new Error(`Wrangler failed to spawn: ${child.output}`);
    if (child.exitCode !== null) throw new Error(`Wrangler exited early: ${child.output}`);
    const advertisedPort = /Ready on http:\/\/127\.0\.0\.1:(\d+)/.exec(child.output)?.[1];
    const origin = new URL(url).origin;
    const readyURL = advertisedPort ? origin.replace(/:\d+$/, `:${advertisedPort}`) : origin;
    let result;
    try { result = await fetch(readyURL); }
    catch (error) { lastError = `${error.message}; ${error.cause?.message || ''}`; }
    if (result && result.status !== 503) return readyURL;
    if (result && ++unavailableResponses >= 3) return readyURL;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler did not become ready: ${child.output}; ${lastError}`);
}

test('the Worker renders synthetic active publications and fails closed', async t => {
  const state = { current: publication('snapshot-a', 1, 'A') };
  const cms = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/content-publishing') {
      if (url.searchParams.get('teamId') !== 'team-1') { response.writeHead(400).end(); return; }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(state.current));
      return;
    }
    const media = /^\/api\/public-media\/team-1\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (media) {
      if (media[1] !== state.current.id) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end('synthetic-image');
      return;
    }
    response.writeHead(404).end();
  });
  cms.listen(0, '127.0.0.1');
  await once(cms, 'listening');
  const workerPort = await freePort();
  const initialWorkerURL = `http://127.0.0.1:${workerPort}`;
  const cmsURL = `http://127.0.0.1:${cms.address().port}`;
  const serviceBindings = [{ pricingId: 'price-design', groupId: 'group-1', planId: 'plan-1', href: 'pricing/#design', fromPrice: true }];
  const worker = spawn(process.execPath, [path.join(cmsSite, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--config', 'test/wrangler.toml', '--local', '--ip', '127.0.0.1', '--port', String(workerPort), '--var', `CMS_ORIGIN:http://127.0.0.1:${cms.address().port}`, '--var', 'CMS_TEAM_ID:team-1', '--var', `CMS_SERVICE_BINDINGS:${JSON.stringify(serviceBindings)}`, '--log-level', 'info'], { cwd: cmsSite, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.output = '';
  worker.stdout.on('data', chunk => { worker.output += chunk.toString(); });
  worker.stderr.on('data', chunk => { worker.output += chunk.toString(); });
  worker.on('error', error => { worker.output += String(error); });
  t.after(async () => {
    if (worker.pid != null && worker.exitCode === null) {
      worker.kill();
      await new Promise(resolve => worker.once('exit', resolve));
    }
    await new Promise(resolve => cms.close(resolve));
  });
  const workerURL = await waitForWorker(`${initialWorkerURL}/`, worker);

  let response = await fetch(`${workerURL}/assets/probe.fixture`);
  let assetBody = await response.text();
  assert.equal(response.status, 200, `${assetBody}\n${worker.output}`);
  assert.match(assetBody, /synthetic static asset fixture/);

  response = await fetch(`${workerURL}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let html = await response.text();
  assert.match(html, /KEROCT A \| KEROCT造船所/);
  assert.match(html, new RegExp(`${cmsURL}/api/public-media/team-1/snapshot-a/hero`));
  assert.match(html, /Creator A &lt;&amp;&quot;/);
  assert.match(html, /Home summary A/);
  const creatorCard = html.match(/<a class="creator-feature"[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.ok(creatorCard);
  let anchorDepth = 0;
  for (const match of creatorCard.matchAll(/<\/?a\b[^>]*>/g)) {
    if (match[0].startsWith('</')) anchorDepth--;
    else { assert.equal(anchorDepth, 0, 'creator-card anchors must not nest'); anchorDepth++; }
  }
  assert.equal(anchorDepth, 0);
  assert.doesNotMatch(creatorCard, /x\.com/, 'X link remains on profile pages');
  assert.match(html, /Home summary B/);
  assert.match(html, /Explicit avatar alt A/);
  assert.match(html, /data-category="logo"/);
  assert.match(html, /class="service-name">Design prices<small>One concept<\/small>/);
  assert.match(html, /class="service-price">¥6,000〜<\/p>/);
  assert.match(html, /data-image="http:\/\/127\.0\.0\.1:[0-9]+\/api\/public-media\/team-1\/snapshot-a\/large"/);
  assert.doesNotMatch(html, /Stale work|Stale creator|stale-hero/);

  response = await fetch(`${workerURL}/creators/synthetic-one/`);
  html = await response.text();
  assert.equal(response.status, 200, `${html}\n${worker.output}`);
  assert.match(html, /Creator A &lt;&amp;&quot;/);
  assert.match(html, /Bio A/);
  assert.match(html, /Gallery intro A/);
  assert.match(html, /Explicit avatar alt A/);
  assert.match(html, /href="https:\/\/x\.com\/synthetic"/);
  assert.match(html, /Work A/);
  assert.doesNotMatch(html, /Stale intro|Stale art|Stale work/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${workerURL}/creators/synthetic-one/">`));

  response = await fetch(`${workerURL}/creators/not-published/`);
  assert.equal(response.status, 404);
  response = await fetch(`${workerURL}/creators/synthetic-one` , { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), `${workerURL}/creators/synthetic-one/`);
  response = await fetch(`${workerURL}/creators/kaerunoankake/`);
  html = await response.text();
  assert.match(html, /<h1>かえるの<br>あんかけ<\/h1>/);
  assert.match(html, /Profile description B/);
  assert.doesNotMatch(html, /Home summary B/);
  assert.match(html, /Gallery intro B/);
  response = await fetch(`${workerURL}/creators/sensuishi13/`);
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /<h1>Synthetic diver<\/h1>/);
  assert.match(html, /Synthetic gallery C/);
  assert.match(html, /Synthetic diver emblem/);
  response = await fetch(`${workerURL}/pricing/`);
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /¥6,000(?!〜)/);
  assert.match(html, /1200 x 800/);
  assert.match(html, /¥45,000/);
  assert.match(html, /修正0回まで/);
  assert.match(html, /修正2回まで/);
  assert.match(html, /修正5回まで/);
  assert.match(html, /各セットの内容と修正回数は、一覧をご確認ください。/);
  assert.doesNotMatch(html, /Stale price|Stale set|Stale option|Stale condition|修正3回まで/);
  response = await fetch(`${workerURL}/assets/probe.fixture`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /synthetic static asset fixture/);

  const oldMedia = `${cmsURL}/api/public-media/team-1/snapshot-a/work`;
  assert.equal((await fetch(oldMedia)).status, 200);
  state.current = publication('snapshot-b', 2, 'B');
  assert.equal((await fetch(oldMedia)).status, 404);
  html = await (await fetch(`${workerURL}/`)).text();
  assert.match(html, /snapshot-b\/hero/);
  assert.equal((await fetch(`${cmsURL}/api/public-media/team-1/snapshot-b/work`)).status, 200);
  state.current = publication('snapshot-a', 3, 'rollback-A');
  assert.equal((await fetch(`${cmsURL}/api/public-media/team-1/snapshot-b/work`)).status, 404);
  html = await (await fetch(`${workerURL}/`)).text();
  assert.match(html, /snapshot-a\/hero/);
  assert.equal((await fetch(oldMedia)).status, 200);

  state.current = publication('snapshot-price-edit', 4, 'price-edit');
  state.current.snapshot.pricing[0].groups[0].plans[0].value = '¥7,500';
  html = await (await fetch(`${workerURL}/`)).text();
  assert.match(html, /class="service-price">¥7,500〜<\/p>/);
  html = await (await fetch(`${workerURL}/pricing/`)).text();
  assert.match(html, /¥7,500/);
  state.current.snapshot.pricing[0].groups[0].plans[0].id = 'deleted-plan';
  html = await (await fetch(`${workerURL}/`)).text();
  assert.doesNotMatch(html, /¥7,500|Stale service/);
  assert.match(html, /All menus/);

  state.current = publication('bad-snapshot', 5, 'bad');
  state.current.snapshot.schemaVersion = 1;
  response = await fetch(`${workerURL}/`);
  assert.equal(response.status, 503);
  html = await response.text();
  assert.match(html, /公開内容を読み込めませんでした/);
  assert.doesNotMatch(html, /bad-snapshot|schemaVersion/);
});

test('the Pages selector copies exactly the 24 site and 19 tool files from synthetic input', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'keroct-artifact-test-'));
  try {
    const source = path.join(scratch, 'source');
    const destination = path.join(scratch, 'output');
    mkdirSync(source);
    const prep = path.join(repo, 'scripts', 'prepare-pages-artifact.py');
    const python = process.env.PYTHON || 'python';
    const createInput = spawnSync(python, ['-c', "import importlib.util,pathlib,sys; p=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location('prep',sys.argv[2]); m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); [(p.joinpath(*pathlib.PurePosixPath(x).parts).parent.mkdir(parents=True,exist_ok=True),p.joinpath(*pathlib.PurePosixPath(x).parts).write_text('synthetic fixture',encoding='utf-8')) for x in m.SELECTED_PATHS]", source, prep], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(createInput.status, 0, createInput.stderr);
    const result = spawnSync(python, [prep, '--source', source, '--destination', destination], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /43 files .*24 site runtime, 19 Windows tool/);
    const copied = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full); else copied.push(path.relative(destination, full).replaceAll(path.sep, '/'));
      }
    };
    walk(destination);
    assert.equal(copied.length, 43);
    assert.equal(copied.includes('cms-site/src/index.js'), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('the actual tracked KEROCT templates keep published pricing in its matching section', async t => {
  const scratchRoot = path.join(cmsSite, '.wrangler');
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(path.join(scratchRoot, 'actual-template-assets-'));
  const assets = path.join(scratch, 'assets');
  for (const relative of [
    'index.html',
    'pricing/index.html',
    'creators/kaerunoankake/index.html',
    'creators/sensuishi13/index.html',
  ]) {
    const destination = path.join(assets, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repo, relative), destination);
  }
  const workerConfig = path.join(scratchRoot, 'actual-template-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.toml');
  const assetsDirectory = path.relative(scratchRoot, assets).replaceAll(path.sep, '/');
  writeFileSync(workerConfig, [
    'name = "keroct-actual-template-test"',
    'main = "../src/index.js"',
    'compatibility_date = "2026-10-26"',
    'workers_dev = true',
    '',
    '[assets]',
    'directory = ' + JSON.stringify(assetsDirectory),
    'binding = "ASSETS"',
    'run_worker_first = true',
    'html_handling = "auto-trailing-slash"',
    '',
    '[vars]',
    'CMS_SITE_KEY = "keroct"',
    '',
  ].join('\n'));
  const state = { current: publication('actual-templates', 1, 'Tracked') };
  state.current.snapshot.pricing[0].groups.push({ id: 'group-secondary', title: 'Secondary', plans: [{ id: 'plan-secondary', name: 'Secondary plan', value: '¥12,500', detail: 'Secondary detail' }] });
  state.current.snapshot.pricing[0].examples[0].title = 'Example <zero> &';
  state.current.snapshot.pricing[3].examples = [{ title: 'Zero-group example', alt: 'Synthetic zero-group image', image: 'zero-example', imageUrl: '/api/public-media/team-1/actual-templates/zero-example', creator: 'creator-1', dimensions: '400 x 300' }];
 const cms = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/content-publishing') { response.writeHead(404).end(); return; }
    if (url.searchParams.get('teamId') !== 'team-1') { response.writeHead(400).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(state.current));
  });
  cms.listen(0, '127.0.0.1');
  await once(cms, 'listening');
  const workerPort = await freePort();
  const worker = spawn(process.execPath, [
    path.join(cmsSite, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--config', workerConfig, '--local', '--ip', '127.0.0.1', '--port', String(workerPort),
    '--var', 'CMS_ORIGIN:http://127.0.0.1:' + cms.address().port,
    '--var', 'CMS_TEAM_ID:team-1',
  ], { cwd: cmsSite, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.output = '';
  worker.stdout.on('data', chunk => { worker.output += chunk.toString(); });
  worker.stderr.on('data', chunk => { worker.output += chunk.toString(); });
  worker.on('error', error => { worker.output += String(error); });
  t.after(async () => {
    if (worker.pid != null && worker.exitCode === null) {
      worker.kill();
      await new Promise(resolve => worker.once('exit', resolve));
    }
    await new Promise(resolve => cms.close(resolve));
    rmSync(scratch, { recursive: true, force: true });
    rmSync(workerConfig, { force: true });
  });
  const workerURL = await waitForWorker('http://127.0.0.1:' + workerPort + '/', worker);
  for (const route of ['/', '/pricing/', '/creators/kaerunoankake/', '/creators/sensuishi13/']) {
    const response = await fetch(workerURL + route);
    assert.equal(response.status, 200, route + ': ' + worker.output);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    if (route === '/') {
      assert.match(html, /Home summary Tracked/);
      assert.match(html, /Work Tracked/);
    }
    if (route === '/creators/kaerunoankake/') {
      assert.match(html, /<h1>かえるの<br>あんかけ<\/h1>/);
      assert.match(html, /Gallery intro B/);
    }
    if (route === '/creators/sensuishi13/') {
      assert.match(html, /Synthetic diver emblem/);
    }
    if (route !== '/pricing/') continue;
    const section = id => {
      const start = html.indexOf('<section id="' + id + '"');
      assert.notEqual(start, -1, 'tracked pricing template is missing section ' + id);
      const endTag = html.indexOf('</section>', start);
      assert.notEqual(endTag, -1, 'tracked pricing section is not closed: ' + id);
      return html.slice(start, endTag + '</section>'.length);
    };
    const priceTitles = content => [...content.matchAll(/<article class="price-group"><h3>([\s\S]*?)<\/h3>/g)].map(match => match[1]);
    assert.deepEqual(priceTitles(section('design')), ['Logo', 'Secondary', 'Design pricesの制作例', 'Optionsの制作例']);
    const design = section('design');
    assert.match(design, /Example &lt;zero&gt; &amp;/);
    assert.match(design, /Zero-group example/);
    assert.match(design, /Creator Tracked &lt;&amp;&quot;/);
    assert.equal((design.match(/<figure>/g) || []).length, 2, 'one design example and one zero-group example render once each');
    assert.ok(design.includes('href="http://127.0.0.1:' + cms.address().port + '/api/public-media/team-1/actual-templates/example"'));
    assert.deepEqual(priceTitles(section('illustration')), ['Art']);
    assert.match(section('sets'), /A set/);
    assert.match(section('sets'), /修正0回まで/);
    assert.match(section('sets'), /修正2回まで/);
    assert.match(section('sets'), /修正5回まで/);
    assert.doesNotMatch(section('sets'), /Stale set|修正3回まで/);
    assert.match(section('options'), /Rush/);
    assert.doesNotMatch(section('options'), /Stale option/);
    assert.match(section('conditions'), /Design condition/);
    assert.match(section('conditions'), /Illustration condition/);
    assert.doesNotMatch(section('conditions'), /Stale condition/);
    assert.doesNotMatch(html, /Stale price|Stale set|Stale option|Stale condition/);
  }
});

test('failed CMS images on one page cause at most one guarded reload per 30 seconds', () => {
  const images = ['failed-a', 'failed-b'].map(name => ({
    src: 'https://site.test/api/public-media/team-1/snapshot/' + name,
    complete: true,
    naturalWidth: 0,
    dataset: {},
    listeners: {},
    alt: name,
    classList: { add() {} },
    hasAttribute(attribute) { return attribute === 'data-cms-media'; },
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); },
  }));
  let reloads = 0;
  const storage = new Map();
  const document = {
    body: { appendChild() {} },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '.work-image img' || selector === 'img[data-cms-media]') return images;
      return [];
    },
    createElement() { return { dataset: {}, addEventListener() {} }; },
  };
  const sessionStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  };
  runInNewContext(readFileSync(path.join(repo, 'assets/site.js'), 'utf8'), {
    document,
    window: { KEROCT_CONFIG: {} },
    localStorage: { getItem() { return null; } },
    sessionStorage,
    location: { pathname: '/pricing/', href: 'https://site.test/pricing/', reload() { reloads++; } },
    URL,
  });
  assert.equal(reloads, 1, 'two distinct image paths must share the per-page reload guard');
  for (const image of images) {
    for (const listener of image.listeners.error) listener();
    assert.equal(image.alt, '画像を読み込めませんでした。');
  }
  assert.equal(reloads, 1, 'subsequent errors remain guarded');
  assert.deepEqual([...storage.keys()], ['keroct-cms-media-reload:/pricing/']);
});