import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const cmsSite = path.resolve(here, '..');
const repo = path.resolve(cmsSite, '..');
const manifest = JSON.parse(readFileSync(path.join(cmsSite, 'contracts/public-assets-v1.json'), 'utf8'));
const publication = { id: 'rpc', revision: 1, snapshot: { schemaVersion: 2,
  creators: [
    { id: 'c1', slug: 'kaerunoankake', title: 'Synthetic creator', role: 'ART', xUrl: 'https://x.com/synthetic', description: 'Bio', summary: 'Summary', portfolioIntro: 'Gallery', avatar: null, avatarUrl: null, order: 1 },
    { id: 'c2', slug: 'sensuishi13', title: 'Synthetic diver', role: 'ART', xUrl: '', description: 'Bio', summary: 'Summary', portfolioIntro: 'Gallery', avatar: null, avatarUrl: null, order: 2 },
  ],
  works: [{ id: 'w1', slug: 'sample', title: 'Synthetic work', category: 'logo', description: 'Work description', alt: 'Work', creator: 'c1', image: 'i1', imageUrl: 'https://cms.example/api/public-media/team-1/rpc/work', enlargedImage: null, enlargedImageUrl: null, order: 1 }],
  pricing: [
    { id: 'p1', title: 'Design', kind: 'design', groups: [{ id: 'g1', title: 'Logo', plans: [{ id: 'pl1', name: 'Basic', value: '¥6,000', detail: 'Plan' }] }], examples: [], conditions: [], order: 1 },
    { id: 'p2', title: 'Illustration', kind: 'illustration', groups: [], examples: [], conditions: [], order: 2 },
    { id: 'p3', title: 'Sets', kind: 'sets', groups: [], sets: [], examples: [], conditions: [], order: 3 },
  ],
  presentations: [{ siteKey: 'keroct', title: 'Synthetic site', order: 1, featuredWorks: [{ work: 'w1' }], heroImages: [] }],
} };

function freePort() { return new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitReady(url, child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited: ${child.output}`);
    const port = /Ready on http:\/\/127\.0\.0\.1:(\d+)/.exec(child.output)?.[1];
    const target = new URL(url); if (port) target.port = port;
    try { const response = await fetch(target, { signal: AbortSignal.timeout(3000) }); if (response.status !== 503) return target.origin; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler did not become ready: ${child.output}`);
}

test('private renderer RPC uses two local Workers for versioned asset streaming and candidate rendering', async t => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'keroct-renderer-rpc-'));
  const assets = path.join(scratch, 'assets');
  const clientFile = path.join(scratch, 'client.mjs');
  const clientConfig = path.join(scratch, 'client.toml');
  const rendererConfig = path.join(scratch, 'renderer.toml');
  for (const entry of manifest.assets) {
    const dest = path.join(assets, ...entry.path.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, `synthetic ${entry.path}`);
  }
  for (const name of ['index.html', 'pricing/index.html', 'creators/kaerunoankake/index.html', 'creators/sensuishi13/index.html']) {
    const dest = path.join(assets, ...name.split('/')); mkdirSync(path.dirname(dest), { recursive: true }); copyFileSync(path.join(repo, name), dest);
  }
  const auxiliaryDirectory = 'tools/windows/obs-tawk-quiet';
  const auxiliaryHome = path.join(assets, ...`${auxiliaryDirectory}/index.html`.split('/'));
  const verificationPage = path.join(assets, ...`${auxiliaryDirectory}/VERIFICATION.html`.split('/'));
  mkdirSync(path.dirname(auxiliaryHome), { recursive: true });
  writeFileSync(auxiliaryHome, [
    '<!doctype html><html><head><title>OBS helper</title>',
    '<link rel="canonical" href="https://old.example/old">',
    '<meta property="og:url" content="https://old.example/old">',
    '<meta name="twitter:url" content="https://old.example/old">',
    '<meta property="og:image" content="/assets/ogp.jpg">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=contract">',
    '<script src="/assets/site.js"></script></head><body>',
    '<main>Auxiliary package page preserved</main>',
    '<a href="/tools/windows/obs-tawk-quiet/VERIFICATION.html">Verification page</a>',
    '<a download href="/tools/windows/obs-tawk-quiet/VERIFICATION.html">Download verification page</a>',
    '<a download href="/tools/windows/obs-tawk-quiet/Install.cmd">Install command</a>',
    '<a href="https://external.example/help">External help</a>',
    '</body></html>',
  ].join(''));
  writeFileSync(verificationPage, [
    '<!doctype html><html><head><title>Verification details</title>',
    '<link rel="stylesheet" href="../../../assets/css/style.css?v=relative">',
    '</head><body><main>Verification body stays intact</main>',
    '<a download href="Install.cmd">Download helper</a></body></html>',
  ].join(''));
  writeFileSync(path.join(assets, 'assets/fonts/ZenKakuGothicNew-Black.ttf'), Buffer.alloc(1024 * 1024 + 37, 0x61));
  writeFileSync(clientFile, `import { DurableObject } from 'cloudflare:workers';
export class RpcProxy extends DurableObject { async fetch(request) { const p=new URL(request.url).pathname; const b=p==='/rpc/asset'?await request.json():{}; try {
if(p==='/rpc/list') return Response.json(await this.env.RENDERER.listAssets());
if(p==='/rpc/asset') { const r=await this.env.RENDERER.getAsset(b.path,b.version); return new Response(r.body,{status:r.status,headers:r.headers}); }
if(p==='/rpc/render') { const r=await this.env.RENDERER.renderCandidate(request.body,request.headers.get('x-renderer-version')); return new Response(r.body,{status:r.status,headers:r.headers}); }
if(p==='/renderer-public-fetch') return this.env.RENDERER_PUBLIC.fetch(new Request('https://renderer.example/rpc/list'));
return new Response('not found',{status:404}); } catch(e) { return Response.json({error:e.message},{status:400}); } } }
export default { async fetch(request,env) { if(new URL(request.url).pathname.startsWith('/rpc/')) return env.RPC_PROXY.get(env.RPC_PROXY.idFromName('test')).fetch(request); return env.ASSETS.fetch(request); } };`);
  const slashes = value => value.replaceAll('\\', '/');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  writeFileSync(rendererConfig, ['name = "keroct-renderer-rpc-test"', `main = "${slashes(path.join(cmsSite, 'src/worker.js'))}"`, 'compatibility_date = "2026-10-26"', 'compatibility_flags = ["nodejs_compat"]', 'workers_dev = true', '', '[version_metadata]', 'binding = "CF_VERSION_METADATA"', '', '[assets]', `directory = "${slashes(assets)}"`, 'binding = "ASSETS"', 'run_worker_first = true', '', '[vars]', 'CMS_TEAM_ID = "team-1"', 'CMS_ORIGIN = "https://cms.example"', 'CMS_SITE_KEY = "keroct"', `RENDERER_CODE_SHA = "${sha}"`].join('\n'));
  writeFileSync(clientConfig, ['name = "keroct-renderer-rpc-client-test"', `main = "${slashes(clientFile)}"`, 'compatibility_date = "2026-10-26"', 'compatibility_flags = ["nodejs_compat"]', 'workers_dev = true', '', '[[durable_objects.bindings]]', 'name = "RPC_PROXY"', 'class_name = "RpcProxy"', '', '[[migrations]]', 'tag = "v1"', 'new_sqlite_classes = ["RpcProxy"]', '', '[[services]]', 'binding = "RENDERER"', 'service = "keroct-renderer-rpc-test"', 'entrypoint = "KeroctRenderer"', '', '[[services]]', 'binding = "RENDERER_PUBLIC"', 'service = "keroct-renderer-rpc-test"', '', '[assets]', `directory = "${slashes(assets)}"`, 'binding = "ASSETS"', 'run_worker_first = true'].join('\n'));
  const port = await freePort(); const persist = path.join(cmsSite, '.wrangler', 'renderer-rpc-state');
  const child = spawn(process.execPath, [path.join(cmsSite, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', clientConfig, '--config', rendererConfig, '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info'], { cwd: cmsSite, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = ''; child.stdout.on('data', x => child.output += x.toString()); child.stderr.on('data', x => child.output += x.toString());
  t.after(async () => { if (child.pid != null && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const origin = await waitReady(`http://127.0.0.1:${port}/`, child);
  const call = (route, body = {}, headers = {}) => fetch(new URL(route, origin), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  let response = await call('/rpc/list'); assert.equal(response.status, 200, child.output);
  const listed = await response.json(); assert.equal(listed.assets.length, 43); assert.equal(listed.codeRevision, sha); assert.match(listed.rendererVersion, /^keroct-renderer-v1:/);
  response = await call('/rpc/asset', { path: 'assets/fonts/ZenKakuGothicNew-Black.ttf', version: listed.rendererVersion });
  assert.equal(response.status, 200, child.output); assert.equal(response.headers.get('content-type'), 'font/ttf'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal((await response.arrayBuffer()).byteLength, 1024 * 1024 + 37);
  for (const path of ['/assets/ogp.jpg', '../index.html', 'assets/%2e%2e/index.html', 'unknown.txt']) { response = await call('/rpc/asset', { path, version: listed.rendererVersion }); assert.ok(response.status >= 400, `accepted path ${path}`); }
  response = await call('/rpc/asset', { path: 'index.html', version: 'keroct-renderer-v1:stale' }); assert.ok(response.status >= 400);
  const request = { schemaVersion: 1, envelope: publication, options: { cmsOrigin: 'https://cms.example', teamID: 'team-1', siteKey: 'keroct', publicOrigin: 'https://site.example', serviceBindings: '', assetBasePath: '/__releases/2cb8c2a1-fd03-4f22-b651-4bb00ec65466/', mediaURLs: { 'https://cms.example/api/public-media/team-1/rpc/work': '/media/work.jpg' } } };
  const versionHeader = { 'x-renderer-version': listed.rendererVersion };
  response = await call('/rpc/render', request, versionHeader); const responseText = await response.text(); assert.equal(response.status, 200, `${responseText}\n${child.output}`);
  const rendered = JSON.parse(responseText); assert.equal(rendered.rendererVersion, listed.rendererVersion); assert.equal(rendered.codeRevision, sha);
  const auxiliaryIndex = 'tools/windows/obs-tawk-quiet/index.html';
  const verificationPath = 'tools/windows/obs-tawk-quiet/VERIFICATION.html';
  assert.deepEqual(Object.keys(rendered.documents).sort(), ['creators/kaerunoankake/index.html', 'creators/sensuishi13/index.html', 'index.html', 'pricing/index.html', auxiliaryIndex, verificationPath].sort());
  assert.match(rendered.documents['index.html'], /Synthetic creator/); assert.match(rendered.documents['pricing/index.html'], /¥6,000/);
  assert.match(rendered.documents['index.html'], /data-cms-static="true"/);
  for (const html of Object.values(rendered.documents)) assert.doesNotMatch(html, /https:\/\/cms\.example\/api\/public-media/);
  const auxiliaryHTML = rendered.documents[auxiliaryIndex];
  const verificationHTML = rendered.documents[verificationPath];
  const releasePrefix = '/__releases/2cb8c2a1-fd03-4f22-b651-4bb00ec65466/';
  assert.match(auxiliaryHTML, /Auxiliary package page preserved/);
  assert.match(auxiliaryHTML, /data-cms-static="true"/);
  assert.match(auxiliaryHTML, /href="https:\/\/site\.example\/tools\/windows\/obs-tawk-quiet\/"/);
  assert.match(auxiliaryHTML, /property="og:url" content="https:\/\/site\.example\/tools\/windows\/obs-tawk-quiet\/"/);
  assert.match(auxiliaryHTML, /name="twitter:url" content="https:\/\/site\.example\/tools\/windows\/obs-tawk-quiet\/"/);
  assert.ok(auxiliaryHTML.includes(`href="${releasePrefix}assets/css/style.css?v=contract"`));
  assert.ok(auxiliaryHTML.includes(`src="${releasePrefix}assets/site.js"`));
  assert.ok(auxiliaryHTML.includes(`href="${releasePrefix}tools/windows/obs-tawk-quiet/Install.cmd"`));
  assert.ok(auxiliaryHTML.includes(`href="${releasePrefix}tools/windows/obs-tawk-quiet/VERIFICATION.html"`), 'HTML downloads may use the release-pinned path');
  assert.ok(auxiliaryHTML.includes('href="/tools/windows/obs-tawk-quiet/VERIFICATION.html"'), 'ordinary HTML navigation stays on its active path');
  assert.ok(auxiliaryHTML.includes('href="https://external.example/help"'), 'external navigation stays unchanged');
  assert.ok(auxiliaryHTML.includes(`content="https://site.example${releasePrefix}assets/ogp.jpg"`));
  assert.match(verificationHTML, /Verification body stays intact/);
  assert.ok(verificationHTML.includes(`href="${releasePrefix}assets/css/style.css?v=relative"`));
  assert.ok(verificationHTML.includes(`href="${releasePrefix}tools/windows/obs-tawk-quiet/Install.cmd"`));
  response = await call('/rpc/render', { ...request, options: { ...request.options, assetBasePath: '/__releases/../../' } }, versionHeader); assert.ok(response.status >= 400, 'unsafe release path rejected');
  response = await call('/rpc/render', { ...request, options: { ...request.options, teamID: 'team-2' } }, versionHeader); assert.ok(response.status >= 400);
  response = await call('/rpc/render', request, { 'x-renderer-version': 'keroct-renderer-v1:stale' }); assert.ok(response.status >= 400);
  response = await call('/renderer-public-fetch'); assert.ok(response.status >= 400, 'renderer default fetch must not expose private RPC methods');
});

test('public asset manifest matches the exact Pages selector paths', () => {
  assert.equal(manifest.assets.length, 43);
  assert.equal(new Set(manifest.assets.map(asset => asset.path)).size, 43);
  const python = [
    'import ast, json, pathlib, sys',
    'tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
    'values = {}',
    'for node in tree.body:',
    '    if isinstance(node, ast.Assign):',
    '        for target in node.targets:',
    '            if isinstance(target, ast.Name) and target.id in {"SITE_RUNTIME_PATHS", "TOOL_PUBLIC_PATHS"}:',
    '                values[target.id] = ast.literal_eval(node.value)',
    'print(json.dumps(values["SITE_RUNTIME_PATHS"] + values["TOOL_PUBLIC_PATHS"]))',
  ].join('\n');
  const result = spawnSync(process.env.PYTHON || 'python', ['-c', python, path.join(repo, 'scripts/prepare-pages-artifact.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(manifest.assets.map(asset => asset.path), JSON.parse(result.stdout));
});
