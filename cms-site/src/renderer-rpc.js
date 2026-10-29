import { WorkerEntrypoint } from 'cloudflare:workers';
import publicAssets from '../contracts/public-assets-v1.json' with { type: 'json' };
import { auxiliaryHTMLPaths, renderAuxiliaryDocument, renderRelease } from './index.js';

const assetsByPath = new Map(publicAssets.assets.map(asset => [asset.path, asset]));
const revisionPattern = /^[0-9a-f]{40}$/i;
const payloadKeys = new Set(['schemaVersion', 'envelope', 'options']);
const v1OptionKeys = new Set(['cmsOrigin', 'teamID', 'siteKey', 'publicOrigin', 'serviceBindings', 'mediaURLs', 'assetBasePath']);
const v2OptionKeys = new Set(['cmsOrigin', 'teamID', 'siteKey', 'siteID', 'publicBaseURL', 'serviceBindings', 'mediaURLs', 'assetBasePath']);

function fail(message) { throw new Error(message); }
function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains an unsupported field`);
}
function requiredText(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} is required`);
  return value;
}
function configuredVersion(env) {
  const id = env.CF_VERSION_METADATA?.id;
  const revision = env.RENDERER_CODE_SHA;
  if (typeof id !== 'string' || id.length === 0) fail('renderer version is unavailable');
  if (typeof revision !== 'string' || !revisionPattern.test(revision)) fail('renderer code revision is unavailable');
  return { rendererVersion: `keroct-renderer-v1:${id}`, codeRevision: revision };
}
function assertExpectedVersion(env, expectedRendererVersion) {
  const version = configuredVersion(env);
  if (expectedRendererVersion !== version.rendererVersion) fail('renderer version mismatch');
  return version;
}
function safePublicBaseURL(value) {
  if (typeof value !== 'string' || !value || !value.endsWith('/') || value.includes('\\') || value.includes('%')) fail('publicBaseURL is invalid');
  const schemeEnd = value.indexOf('://');
  const pathStart = schemeEnd < 0 ? -1 : value.indexOf('/', schemeEnd + 3);
  const rawPath = pathStart < 0 ? '/' : value.slice(pathStart).split(/[?#]/, 1)[0];
  if (rawPath !== '/' && !/^\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/$/.test(rawPath)) fail('publicBaseURL is invalid');
  let url;
  try { url = new URL(value); } catch { fail('publicBaseURL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('publicBaseURL is invalid');
  if (url.pathname !== '/' && !/^\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/$/.test(url.pathname)) fail('publicBaseURL is invalid');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('publicBaseURL must use HTTPS');
  return { origin: url.origin, pathname: url.pathname };
}
function safePublicOrigin(value) {
  let url;
  try { url = new URL(requiredText(value, 'publicOrigin')); }
  catch { fail('publicOrigin must be a valid HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('publicOrigin must be a valid HTTP(S) origin');
  return url.origin;
}
function safeAssetPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('?') || path.includes('#') || /%[0-9a-f]{2}/i.test(path) || path.split('/').some(part => part === '' || part === '.' || part === '..') || !assetsByPath.has(path)) {
    fail('asset path is not in the public asset manifest');
  }
  return path;
}
function jsonResponse(body) {
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}

export class KeroctRenderer extends WorkerEntrypoint {
  async listAssets() {
    const { rendererVersion, codeRevision } = configuredVersion(this.env);
    return { schemaVersion: publicAssets.schemaVersion, rendererVersion, codeRevision, assets: publicAssets.assets };
  }

  async getAsset(path, expectedRendererVersion) {
    assertExpectedVersion(this.env, expectedRendererVersion);
    const safePath = safeAssetPath(path);
    const asset = assetsByPath.get(safePath);
    const assetURLPath = safePath.endsWith('/index.html')
      ? `/${safePath.slice(0, -'index.html'.length)}`
      : safePath === 'index.html' ? '/' : `/${safePath}`;
    const response = await this.env.ASSETS.fetch(new Request(`https://renderer-assets.invalid${assetURLPath}`));
    if (!response.ok) fail('renderer asset is unavailable');
    if (response.status >= 300 && response.status < 400) fail('renderer asset redirected');
    const headers = new Headers(response.headers);
    headers.set('content-type', asset.contentType);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('x-renderer-version', configuredVersion(this.env).rendererVersion);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    return new Response(response.body, { status: response.status, headers });
  }

  async renderCandidate(input, expectedRendererVersion) {
    const { rendererVersion, codeRevision } = assertExpectedVersion(this.env, expectedRendererVersion);
    if (!input || typeof input.getReader !== 'function') fail('render input must be a readable stream');
    const payload = await new Response(input).json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('render input must be an object');
    rejectUnknownKeys(payload, payloadKeys, 'render input');
    if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) fail('render input schemaVersion must be 1 or 2');
    const schemaVersion = payload.schemaVersion;
    const { envelope, options } = payload;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('envelope must be an object');
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('options must be an object');
    rejectUnknownKeys(options, schemaVersion === 1 ? v1OptionKeys : v2OptionKeys, 'options');
    const teamID = requiredText(options.teamID, 'teamID');
    const cmsOrigin = requiredText(options.cmsOrigin, 'cmsOrigin');
    const siteKey = requiredText(options.siteKey, 'siteKey');
    if (!this.env.CMS_TEAM_ID || teamID !== this.env.CMS_TEAM_ID) fail('teamID does not match this renderer');
    if (!this.env.CMS_ORIGIN || cmsOrigin !== this.env.CMS_ORIGIN) fail('cmsOrigin does not match this renderer');
    if (siteKey !== (this.env.CMS_SITE_KEY || 'keroct')) fail('siteKey does not match this renderer');
    let publicOrigin;
    let publicPath = '/';
    let siteID;
    if (schemaVersion === 1) publicOrigin = safePublicOrigin(options.publicOrigin);
    else {
      if (Object.keys(options).length !== 8) fail('v2 options must contain exactly eight fields');
      siteID = requiredText(options.siteID, 'siteID');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(siteID) || !this.env.CMS_SITE_ID || siteID !== this.env.CMS_SITE_ID) fail('siteID does not match this renderer');
      const publicBaseURL = safePublicBaseURL(options.publicBaseURL);
      publicOrigin = publicBaseURL.origin;
      publicPath = publicBaseURL.pathname;
    }
    const assetBasePath = options.assetBasePath;
    if ((schemaVersion === 2 && typeof assetBasePath !== 'string') || assetBasePath !== undefined && (typeof assetBasePath !== 'string' || !/^\/__releases\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/i.test(assetBasePath))) fail('assetBasePath is invalid');
    const serviceBindings = schemaVersion === 1 ? options.serviceBindings ?? '' : options.serviceBindings;
    if (typeof serviceBindings !== 'string') fail('serviceBindings must be text');
    const mediaURLs = options.mediaURLs;
    if (!mediaURLs || typeof mediaURLs !== 'object' || Array.isArray(mediaURLs)) fail('mediaURLs must be an object');
    if (schemaVersion === 2) for (const [source, target] of Object.entries(mediaURLs)) {
      const suffix = typeof target === 'string' && target.startsWith(assetBasePath) ? target.slice(assetBasePath.length) : '';
      if (typeof source !== 'string' || !source || !suffix || target.includes('\\') || /[?#\u0000-\u001f\u007f]/.test(target) || /%(?:25|2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i.test(target) || suffix.split('/').some(part => !part || part === '.' || part === '..')) fail('mediaURLs contains an invalid release path');
    }
    const documents = await renderRelease({
      envelope, cmsOrigin, teamID, siteKey, serviceBindings, publicOrigin, publicPath, siteID, schemaVersion, assetBasePath,
      templateLoader: async assetPath => {
        if (typeof assetPath !== 'string' || !assetPath.startsWith('/') || assetPath.startsWith('//')) fail('template path is invalid');
        const relativePath = assetPath.endsWith('/')
          ? `${assetPath.slice(1)}index.html`
          : assetPath.slice(1);
        return (await this.getAsset(relativePath, rendererVersion)).text();
      },
      mapMediaURL: url => {
        if (!Object.prototype.hasOwnProperty.call(mediaURLs, url)) fail('media URL has no local mapping');
        return schemaVersion === 2 ? new URL(mediaURLs[url].slice(assetBasePath.length), publicOrigin + assetBasePath).pathname : mediaURLs[url];
      },
    });
    for (const filename of auxiliaryHTMLPaths) {
      const template = await (await this.getAsset(filename, rendererVersion)).text();
      const rendered = await renderAuxiliaryDocument({ filename, template, publicOrigin, publicPath, siteID, schemaVersion, assetBasePath });
      documents[filename] = await rendered.text();
    }
    return jsonResponse({ schemaVersion, rendererVersion, codeRevision, documents });
  }
}
