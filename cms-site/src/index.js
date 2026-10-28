import contract from '../contracts/keroct-v1.json' with { type: 'json' };
const genericFailure = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ページを表示できません</title><body><main><h1>ページを表示できません</h1><p>公開内容を読み込めませんでした。時間をおいて再度お試しください。</p></main></body></html>`;
const mediaPrefix = '/api/public-media/';

export class PublicationError extends Error {}

function fail(message) { throw new PublicationError(message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function list(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}
function text(value, label, nullable = false) {
  if (nullable && value == null) return '';
  if (typeof value !== 'string') fail(`${label} must be text`);
  return value;
}
function id(value, label, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') fail(`${label} must be an ID`);
  return String(value);
}
function order(value, label) {
  if (!Number.isFinite(value)) fail(`${label} must be an order number`);
  return value;
}
function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function safePath(value, cmsOrigin, label, teamID, snapshotID) {
  const raw = text(value, label);
  let url;
  try { url = new URL(raw, cmsOrigin); } catch { fail(`${label} is not a valid URL`); }
  const origin = new URL(cmsOrigin).origin;
  const parts = url.pathname.split('/');
  let decoded;
  try { decoded = parts.slice(3).map(part => decodeURIComponent(part)); } catch { fail(`${label} has invalid path encoding`); }
  if (url.origin !== origin || url.protocol !== 'https:' && new URL(cmsOrigin).hostname !== '127.0.0.1' && new URL(cmsOrigin).hostname !== 'localhost' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(mediaPrefix) || parts.length !== 6 || parts[1] !== 'api' || parts[2] !== 'public-media' || decoded.length !== 3 || decoded.some(part => !part || part === '.' || part === '..') || decoded[0] !== String(teamID) || decoded[1] !== String(snapshotID)) {
    fail(`${label} must be a same-origin public media path`);
  }
  return url.href;
}

export function normalizeSnapshot(payload, cmsOrigin, teamID, siteKey) {
  record(payload, 'publication');
  if (typeof payload.id !== 'string' && typeof payload.id !== 'number') fail('publication.id is required');
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 1) fail('publication.revision is invalid');
  const snapshot = record(payload.snapshot, 'publication.snapshot');
  if (snapshot.schemaVersion !== contract.schemaVersion) fail('schemaVersion 2 is required');
  const snapshotID = String(payload.id);
  const media = (value, label) => safePath(value, cmsOrigin, label, teamID, snapshotID);

  const creators = list(snapshot.creators, 'creators').map((input, index) => {
    const item = record(input, `creators[${index}]`);
    return {
      id: id(item.id, 'creator.id'), slug: text(item.slug, 'creator.slug'), title: text(item.title, 'creator.title'),
      role: text(item.role, 'creator.role', true), xUrl: text(item.xUrl, 'creator.xUrl', true),
      description: text(item.description, 'creator.description', true),
      summary: text(item.summary ?? item.description, 'creator.summary', true),
      portfolioIntro: text(item.portfolioIntro, 'creator.portfolioIntro', true),
      avatarAlt: text(item.avatarAlt, 'creator.avatarAlt', true), avatar: id(item.avatar, 'creator.avatar', true),
      avatarUrl: item.avatarUrl == null ? '' : media(item.avatarUrl, 'creator.avatarUrl'), order: order(item.order, 'creator.order'),
    };
  }).sort((a, b) => a.order - b.order);
  const creatorsByID = new Map(creators.map(item => [item.id, item]));
  const creatorsBySlug = new Map(creators.map(item => [item.slug, item]));
  if (creatorsByID.size !== creators.length || creatorsBySlug.size !== creators.length) fail('creator IDs and slugs must be unique');
  for (const creator of creators) if (!new RegExp(contract.creatorSlugPattern).test(creator.slug)) fail('creator slug is invalid');

  const works = list(snapshot.works, 'works').map((input, index) => {
    const item = record(input, `works[${index}]`);
    const creatorID = id(item.creator, 'work.creator');
    if (!creatorsByID.has(creatorID)) fail('work references a missing creator');
    if (!contract.categories.includes(item.category)) fail('work.category is invalid');
    const image = id(item.image, 'work.image');
    const enlargedImage = id(item.enlargedImage, 'work.enlargedImage', true);
    return {
      id: id(item.id, 'work.id'), slug: text(item.slug, 'work.slug'), title: text(item.title, 'work.title'),
      category: text(item.category, 'work.category'), description: text(item.description, 'work.description', true),
      alt: text(item.alt, 'work.alt'), creator: creatorID, image,
      imageUrl: media(item.imageUrl, 'work.imageUrl'), enlargedImage,
      enlargedImageUrl: item.enlargedImageUrl == null ? '' : media(item.enlargedImageUrl, 'work.enlargedImageUrl'),
      enlargedImageTitle: text(item.enlargedImageTitle, 'work.enlargedImageTitle', true), order: order(item.order, 'work.order'),
    };
  }).sort((a, b) => a.order - b.order);
  const worksByID = new Map(works.map(item => [item.id, item]));
  if (worksByID.size !== works.length) fail('work IDs must be unique');

  const pricing = list(snapshot.pricing, 'pricing').map((input, index) => {
    const item = record(input, `pricing[${index}]`);
    if (!['design', 'illustration', 'sets'].includes(item.kind)) fail('pricing.kind is invalid');
    const groups = list(item.groups, 'pricing.groups').map(groupInput => {
      const group = record(groupInput, 'pricing group');
      return { id: id(group.id, 'group.id', true), title: text(group.title, 'group.title'), plans: list(group.plans, 'group.plans').map(planInput => {
        const plan = record(planInput, 'pricing plan');
        return { id: id(plan.id, 'plan.id', true), name: text(plan.name, 'plan.name'), value: text(plan.value, 'plan.value'), detail: text(plan.detail, 'plan.detail', true) };
      }) };
    });
    const sets = list(item.sets ?? [], 'pricing.sets').map(setInput => {
      const set = record(setInput, 'pricing set');
      if (set.revisions !== null && (!Number.isSafeInteger(set.revisions) || set.revisions < 0)) fail('set.revisions is invalid');
      return { name: text(set.name, 'set.name'), price: text(set.price, 'set.price'), items: list(set.items, 'set.items').map(child => text(record(child, 'set item').name, 'set item name')), revisions: set.revisions };
    });
    const options = list(item.options ?? [], 'pricing.options').map(optionInput => {
      const option = record(optionInput, 'pricing option');
      return { name: text(option.name, 'option.name'), price: text(option.price, 'option.price'), detail: text(option.detail, 'option.detail', true) };
    });
    const examples = list(item.examples, 'pricing.examples').map(exampleInput => {
      const example = record(exampleInput, 'pricing example');
      return { title: text(example.title, 'example.title'), alt: text(example.alt, 'example.alt'), imageUrl: media(example.imageUrl, 'example.imageUrl'), creator: id(example.creator, 'example.creator', true), dimensions: text(example.dimensions, 'example.dimensions', true) };
    });
    const conditions = list(item.conditions, 'pricing.conditions').map(condition => text(record(condition, 'pricing condition').text, 'condition.text'));
    return { id: id(item.id, 'pricing.id'), title: text(item.title, 'pricing.title'), kind: item.kind, groups, sets, options, examples, conditions, order: order(item.order, 'pricing.order') };
  }).sort((a, b) => a.order - b.order);

  const presentations = list(snapshot.presentations, 'presentations').map((input, index) => {
    const item = record(input, `presentations[${index}]`);
    return {
      siteKey: text(item.siteKey, 'presentation.siteKey'), title: text(item.title, 'presentation.title'), order: order(item.order, 'presentation.order'),
      featuredWorks: list(item.featuredWorks, 'presentation.featuredWorks').map(ref => {
        const workID = id(record(ref, 'featured work').work, 'featuredWork.work');
        if (!worksByID.has(workID)) fail('presentation references a missing work');
        return worksByID.get(workID);
      }),
      heroImages: list(item.heroImages, 'presentation.heroImages').map(heroInput => {
        const hero = record(heroInput, 'hero image');
        return { imageUrl: media(hero.imageUrl, 'hero.imageUrl'), alt: text(hero.alt, 'hero.alt') };
      }),
    };
  }).sort((a, b) => a.order - b.order);
  const presentation = presentations.find(item => item.siteKey === siteKey);
  if (!presentation) fail('configured presentation is missing');
  if (presentation.featuredWorks.length > contract.maxFeatured || presentation.heroImages.length > contract.maxHero) fail('presentation exceeds the KEROCT template slots');
  for (const item of pricing) for (const example of item.examples) if (example.creator && !creatorsByID.has(example.creator)) fail('pricing example references a missing creator');
  return { id: String(payload.id), revision: payload.revision, creators, creatorsByID, creatorsBySlug, works, worksByID, pricing, presentation, teamID };
}

function image(url, alt, revision, attrs = '') {
  return `<img src="${esc(url)}" alt="${esc(alt)}" data-cms-media data-publication-revision="${revision}" ${attrs}>`;
}
function workCard(work, creator, revision, square = false) {
  const zoomUrl = work.enlargedImageUrl || work.imageUrl;
  const title = work.enlargedImageTitle || work.title;
  const category = work.category || '';
  return `<article class="work${square ? ' work-square' : ''}" data-category="${esc(category)}"><button class="work-image" data-image="${esc(zoomUrl)}" data-title="${esc(title)}" data-cms-media data-publication-revision="${revision}" aria-label="${esc(title)}を拡大"><img src="${esc(work.imageUrl)}" alt="${esc(work.alt)}" data-cms-media data-publication-revision="${revision}" loading="lazy"></button><div class="work-caption"><div><h3>${esc(work.title)}</h3><p>${esc(work.description)}</p></div><a href="/creators/${encodeURIComponent(creator.slug)}/">${esc(creator.title)}</a></div></article>`;
}
function creatorCard(creator, revision) {
  const href = '/creators/' + encodeURIComponent(creator.slug) + '/';
  const avatar = creator.avatarUrl ? '<div class="creator-visual">' + image(creator.avatarUrl, creator.avatarAlt || creator.title, revision, 'loading="lazy"') + '</div>' : '<div class="creator-visual"></div>';
  return '<a class="creator-feature" href="' + esc(href) + '">' + avatar + '<div class="creator-copy">' + (creator.role ? '<p class="creator-role">' + esc(creator.role) + '</p>' : '') + '<h3>' + esc(creator.title) + '</h3><p>' + esc(creator.summary) + '</p><span class="text-link">作品・プロフィールを見る <span aria-hidden="true">↗</span></span></div></a>';
}
function pricingExamples(examples, revision, creatorsByID) {
  if (!examples.length) return '';
  return '<div class="price-examples" aria-label="制作例">' + examples.map(example => {
    const creator = example.creator ? creatorsByID.get(example.creator) : null;
    const credit = creator ? ' / ' + esc(creator.title) : '';
    return '<figure><a href="' + esc(example.imageUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(example.title) + 'を拡大表示">' + image(example.imageUrl, example.alt, revision, 'loading="lazy"') + '</a><figcaption>' + esc(example.title) + credit + (example.dimensions ? ' / ' + esc(example.dimensions) : '') + '</figcaption></figure>';
  }).join('') + '</div>';
}
function pricingGroup(item, revision, creatorsByID) {
  const groups = item.groups.map(group => {
    const examples = item.groups.length === 1 ? pricingExamples(item.examples, revision, creatorsByID) : '';
    return '<article class="price-group"><h3>' + esc(group.title) + '</h3><dl>' + group.plans.map(plan =>
      '<div class="price-item"><dt>' + esc(plan.name) + '</dt><dd class="price-value">' + esc(plan.value) + '</dd>' + (plan.detail ? '<dd class="price-detail">' + esc(plan.detail) + '</dd>' : '') + '</div>'
    ).join('') + '</dl>' + examples + '</article>';
  }).join('');
  const separateExamples = item.groups.length === 1 || !item.examples.length ? '' : '<article class="price-group"><h3>' + esc(item.title) + 'の制作例</h3>' + pricingExamples(item.examples, revision, creatorsByID) + '</article>';
  return groups + separateExamples;
}
function setCard(item) {
  return item.sets.map(set => `<article class="set-plan"><h3>${esc(set.name)}</h3><p class="set-price">${esc(set.price)}</p><ul>${set.items.map(name => `<li>${esc(name)}</li>`).join('')}</ul>${set.revisions === null ? '' : `<p class="set-revisions">修正${esc(set.revisions)}回まで</p>`}</article>`).join('');
}
function optionCards(pricing) {
  return pricing.flatMap(item => item.options).map(option => `<article class="option"><h3>${esc(option.name)}</h3><p class="option-price">${esc(option.price)}</p>${option.detail ? `<p>${esc(option.detail)}</p>` : ''}</article>`).join('');
}
function conditionItems(pricing) {
  return pricing.flatMap(item => item.conditions).map(condition => `<li>${esc(condition)}</li>`).join('');
}
function serviceCards(pricing, rawBindings) {
  if (!rawBindings) return '';
  let bindings;
  try { bindings = JSON.parse(rawBindings); } catch { fail('CMS_SERVICE_BINDINGS must be JSON'); }
  if (!Array.isArray(bindings) || bindings.length > 3) fail('CMS_SERVICE_BINDINGS must contain at most three entries');
  const allowedHrefs = new Set(['pricing/#design', 'pricing/#illustration']);
  return bindings.map(input => {
    const binding = record(input, 'service binding');
    const pricingID = id(binding.pricingId, 'service.pricingId');
    const groupID = id(binding.groupId, 'service.groupId');
    const planID = id(binding.planId, 'service.planId');
    const href = text(binding.href, 'service.href');
    if (!allowedHrefs.has(href)) fail('service.href must be a local pricing anchor');
    if (binding.label != null && typeof binding.label !== 'string') fail('service.label must be text');
    if (binding.subtitle != null && typeof binding.subtitle !== 'string') fail('service.subtitle must be text');
    if (binding.fromPrice != null && typeof binding.fromPrice !== 'boolean') fail('service.fromPrice must be boolean');
    const source = pricing.find(item => item.id === pricingID);
    const group = source?.groups.find(item => item.id === groupID);
    const plan = group?.plans.find(item => item.id === planID);
    if (!source || !group || !plan) return '';
    const label = binding.label ?? source.title;
    const subtitle = binding.subtitle ?? plan.detail;
    const price = binding.fromPrice && /^¥[0-9,]+$/.test(plan.value) ? `${plan.value}〜` : plan.value;
    return `<a href="${href}"><span class="service-name">${esc(label)}${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</span><p class="service-price">${esc(price)}</p><span aria-hidden="true">↗</span></a>`;
  }).join('');
}
function setsIntro(pricing) {
  const sets = pricing.filter(item => item.kind === 'sets').flatMap(item => item.sets);
  if (sets.length && sets[0].revisions !== null && sets.every(set => set.revisions === sets[0].revisions && JSON.stringify(set.items) === JSON.stringify(sets[0].items))) {
    const sharedItems = sets[0].items.map(esc).join('・');
    return `すべてのセットに${sharedItems}と、修正${esc(sets[0].revisions)}回が含まれます。`;
  }
  return '各セットの内容と修正回数は、一覧をご確認ください。';
}
function profileFragment(creator, revision) {
  const social = creator.xUrl && /^https:\/\//i.test(creator.xUrl) ? `<a class="text-link" href="${esc(creator.xUrl)}" target="_blank" rel="noopener noreferrer">X ↗</a>` : '';
  const avatar = creator.avatarUrl ? `<div class="profile-art">${image(creator.avatarUrl, creator.avatarAlt || creator.title, revision)}</div>` : '';
  const title = Array.from(creator.title);
  const titleHtml = creator.slug === 'kaerunoankake' ? `${esc(title.slice(0, 4).join(''))}<br>${esc(title.slice(4).join(''))}` : esc(creator.title);
  return `<div><p class="eyebrow">${esc(creator.role)}</p><h1>${titleHtml}</h1><p>${esc(creator.description)}</p>${social}</div>${avatar}`;
}
function htmlForSlot(name, data, creatorSlug) {
  const { creators, works, presentation, pricing, revision, creatorsByID } = data;
  if (name === 'home-hero') return presentation.heroImages.slice(0, 2).map((hero, index) => image(hero.imageUrl, hero.alt, revision, `width="${index ? '1920' : '1068'}" height="${index ? '1080' : '1068'}" ${index ? 'class="hero-secondary"' : 'fetchpriority="high"'}`)).join('');
  if (name === 'service-cards') return data.serviceHtml;
  if (name === 'home-works') return presentation.featuredWorks.map(work => workCard(work, creatorsByID.get(work.creator), revision, work.category === 'illustration')).join('');
  if (name === 'creators') return creators.map(creator => creatorCard(creator, revision)).join('');
  if (name === 'profile') {
    const creator = data.creatorsBySlug.get(creatorSlug);
    if (!creator) fail('requested creator does not exist');
    return profileFragment(creator, revision);
  }
  if (name === 'creator-works') {
    const creator = data.creatorsBySlug.get(creatorSlug);
    if (!creator) fail('requested creator does not exist');
    return works.filter(work => work.creator === creator.id).map(work => workCard(work, creator, revision, work.category === 'illustration')).join('');
  }
  if (name === 'pricing-design') return pricing.filter(item => item.kind === 'design').flatMap(item => pricingGroup(item, revision, creatorsByID)).join('');
  if (name === 'pricing-illustration') return pricing.filter(item => item.kind === 'illustration').flatMap(item => pricingGroup(item, revision, creatorsByID)).join('');
  if (name === 'pricing-sets') return pricing.filter(item => item.kind === 'sets').map(setCard).join('');
  if (name === 'pricing-options') return optionCards(pricing);
  if (name === 'pricing-conditions') return conditionItems(pricing);
  if (name === 'pricing-sets-intro') return setsIntro(pricing);
  return '';
}

function templateFor(pathname) {
  if (pathname === '/' || pathname === '/index.html') return { asset: '/', kind: 'home' };
  if (pathname === '/pricing/') return { asset: '/pricing/', kind: 'pricing' };
  const match = /^\/creators\/([^/]+)\/$/.exec(pathname);
  if (match) {
    let slug;
    try { slug = decodeURIComponent(match[1]); } catch { return null; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug)) return null;
    return { asset: slug === 'sensuishi13' ? '/creators/sensuishi13/' : '/creators/kaerunoankake/', kind: 'creator', slug };
  }
  return null;
}
function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}
function headTitle(data, route) {
  if (route.kind === 'creator') return `${data.creatorsBySlug.get(route.slug).title} | KEROCT造船所`;
  if (route.kind === 'home') return `${data.presentation.title} | KEROCT造船所`;
  return '制作メニュー・料金 | KEROCT造船所';
}
function headDescription(data, route) {
  if (route.kind === 'creator') return data.creatorsBySlug.get(route.slug).description;
  return '';
}

export async function fetchPublication(env) {
  if (!env.CMS_TEAM_ID || !env.CMS_ORIGIN || new URL(env.CMS_ORIGIN).hostname.endsWith('.invalid')) fail('CMS configuration is incomplete');
  const origin = new URL(env.CMS_ORIGIN);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) fail('CMS_ORIGIN must be an origin');
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') fail('CMS_ORIGIN must use HTTPS');
  const endpoint = new URL('/api/content-publishing', origin.origin);
  endpoint.searchParams.set('teamId', env.CMS_TEAM_ID);
  const upstream = await fetch(endpoint, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!upstream.ok) fail('CMS returned a non-success response');
  const body = await upstream.json();
  if (body == null) fail('CMS has no active publication');
  return preparePublication(body, { cmsOrigin: origin.origin, teamID: env.CMS_TEAM_ID, siteKey: env.CMS_SITE_KEY || 'keroct', serviceBindings: env.CMS_SERVICE_BINDINGS || '' });
}

export function preparePublication(envelope, { cmsOrigin, teamID, siteKey = 'keroct', serviceBindings = '' }) {
  const data = normalizeSnapshot(envelope, cmsOrigin, teamID, siteKey);
  if (data.presentation.featuredWorks.some(work => !data.creatorsByID.has(work.creator))) fail('featured work creator is missing');
  data.serviceBindings = serviceBindings;
  data.serviceHtml = serviceCards(data.pricing, serviceBindings);
  return data;
}

export async function renderDocument({ data, route, template, publicOrigin }) {
  const asset = new Response(template, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const canonical = `${new URL(publicOrigin).origin}${route.kind === 'creator' ? `/creators/${encodeURIComponent(route.slug)}/` : route.kind === 'pricing' ? '/pricing/' : '/'}`;
  const headers = new Headers(asset.headers);
  headers.set('cache-control', 'no-store');
  headers.set('content-type', 'text/html; charset=utf-8');
  return new HTMLRewriter()
    .on('[data-cms]', { element(element) { element.replace(htmlForSlot(element.getAttribute('data-cms'), data, route.slug), { html: true }); } })
    .on('[data-cms-sets-intro]', { element(element) { element.setInnerContent(setsIntro(data.pricing)); } })
    .on('[data-cms-profile-heading]', { element(element) { element.setInnerContent(`${data.creatorsBySlug.get(route.slug).title}の制作例`); } })
    .on('[data-cms-profile-intro]', { element(element) { element.setInnerContent(data.creatorsBySlug.get(route.slug).portfolioIntro); } })
    .on('.work', { element(element) { element.remove(); } })
    .on('.creator-feature', { element(element) { element.remove(); } })
    .on('.service-list > a', { element(element) { element.remove(); } })
    .on('.profile-grid > div', { element(element) { element.remove(); } })
    .on('.hero-art > img', { element(element) { element.remove(); } })
    .on('.price-group', { element(element) { element.remove(); } })
    .on('.set-plan', { element(element) { element.remove(); } })
    .on('.option', { element(element) { element.remove(); } })
    .on('#conditions li', { element(element) { element.remove(); } })
    .on('title', { element(element) { element.setInnerContent(headTitle(data, route)); } })
    .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonical); } })
    .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonical); } })
    .on('meta[property="og:title"]', { element(element) { element.setAttribute('content', headTitle(data, route)); } })
    .on('meta[name="twitter:title"]', { element(element) { element.setAttribute('content', headTitle(data, route)); } })
    .on('meta[name="description"]', { element(element) { if (headDescription(data, route)) element.setAttribute('content', headDescription(data, route)); } })
    .on('meta[property="og:description"]', { element(element) { if (headDescription(data, route)) element.setAttribute('content', headDescription(data, route)); } })
    .transform(new Response(asset.body, { status: asset.status, headers }));
}

const releaseRoutes = [
  ['index.html', '/'], ['pricing/index.html', '/pricing/'],
  ['creators/kaerunoankake/index.html', '/creators/kaerunoankake/'],
  ['creators/sensuishi13/index.html', '/creators/sensuishi13/'],
];
const requiredTemplateSlots = {
  home: ['home-hero', 'home-works', 'creators', 'service-cards'],
  pricing: ['pricing-design', 'pricing-sets', 'pricing-illustration', 'pricing-options', 'pricing-conditions'],
  creator: ['profile', 'creator-works'],
};
const requiredTemplateMarkers = {
  home: [],
  pricing: ['data-cms-sets-intro'],
  creator: ['data-cms-profile-heading', 'data-cms-profile-intro'],
};
async function validateReleaseTemplate(template, route) {
  if (typeof template !== 'string' || !template.trim()) fail(`template is empty: ${route.asset}`);
  const found = new Map();
  const collect = selector => ({ element() { found.set(selector, (found.get(selector) ?? 0) + 1); } });
  let parsed;
  try {
    parsed = await new HTMLRewriter()
      .on('html', collect('html')).on('head', collect('head')).on('body', collect('body'))
      .on('title', collect('title')).on('link[rel="canonical"]', collect('canonical'))
      .on('[data-cms]', { element(element) { const marker = element.getAttribute('data-cms'); found.set(`slot:${marker}`, (found.get(`slot:${marker}`) ?? 0) + 1); } })
      .on('[data-cms-sets-intro]', collect('data-cms-sets-intro'))
      .on('[data-cms-profile-heading]', collect('data-cms-profile-heading'))
      .on('[data-cms-profile-intro]', collect('data-cms-profile-intro'))
      .transform(new Response(template)).text();
  } catch { fail(`template is invalid: ${route.asset}`); }
  const expectedSlots = new Set(requiredTemplateSlots[route.kind]);
  for (const [key, count] of found) {
    if (key.startsWith('slot:') && (!expectedSlots.has(key.slice(5)) || count !== 1)) fail(`template has an unexpected CMS slot: ${route.asset}`);
  }
  for (const marker of ['html', 'head', 'body', 'title', 'canonical', ...requiredTemplateMarkers[route.kind]]) {
    if (found.get(marker) !== 1) fail(`template is missing or duplicates required markers: ${route.asset}`);
  }
  for (const slot of expectedSlots) if (found.get(`slot:${slot}`) !== 1) fail(`template is missing or duplicates required markers: ${route.asset}`);
  for (const marker of Object.values(requiredTemplateMarkers).flat()) {
    if (!requiredTemplateMarkers[route.kind].includes(marker) && found.has(marker)) fail(`template has a marker for another route: ${route.asset}`);
  }
  return parsed;
}
function localMediaPath(value, publicOrigin, sourceURL) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f?#]/.test(value) || /%(?:25|2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) {
    fail(`missing local media mapping for ${sourceURL}`);
  }
  let resolved;
  try { resolved = new URL(value, publicOrigin); } catch { fail(`missing local media mapping for ${sourceURL}`); }
  if (resolved.origin !== new URL(publicOrigin).origin || resolved.username || resolved.password || resolved.search || resolved.hash || resolved.pathname !== value) fail(`missing local media mapping for ${sourceURL}`);
  const parts = resolved.pathname.split('/');
  let decoded;
  try { decoded = parts.map(part => decodeURIComponent(part)); } catch { fail(`missing local media mapping for ${sourceURL}`); }
  if (decoded.some(part => part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part) || /%(?:2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i.test(part))) fail(`missing local media mapping for ${sourceURL}`);
  return value;
}
export async function renderRelease({ envelope, cmsOrigin, teamID, siteKey = 'keroct', serviceBindings = '', templateLoader, publicOrigin, mapMediaURL }) {
  const data = preparePublication(envelope, { cmsOrigin, teamID, siteKey, serviceBindings });
  if (typeof templateLoader !== 'function' || typeof mapMediaURL !== 'function') fail('templateLoader and mapMediaURL are required');
  const supportedCreators = new Set(['kaerunoankake', 'sensuishi13']);
  if (data.creators.some(creator => !supportedCreators.has(creator.slug))) fail('publication contains a creator without a static template');
  const mediaFields = new Set(['avatarUrl', 'imageUrl', 'enlargedImageUrl']);
  const seen = new Set();
  const rewriteMedia = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) { for (const [key, item] of value) rewriteMedia(item); return; }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && mediaFields.has(key) && item) {
        const local = mapMediaURL(item);
        value[key] = localMediaPath(local, publicOrigin, item);
      } else rewriteMedia(item);
    }
  };
  rewriteMedia(data);
  const documents = {};
  for (const [filename, pathname] of releaseRoutes) {
    const route = templateFor(pathname);
    const template = await templateLoader(route.asset);
    const validatedTemplate = await validateReleaseTemplate(template, route);
    const response = await renderDocument({ data, route, template: validatedTemplate, publicOrigin });
    documents[filename] = await response.text();
  }
  return documents;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/pricing') return Response.redirect(new URL('/pricing/' + url.search, url), 308);
  const creatorPath = /^\/creators\/([^/]+)$/.exec(path);
  if (creatorPath) return Response.redirect(new URL(`${path}/${url.search}`, url), 308);
  const route = templateFor(path);
  if (!route) return env.ASSETS.fetch(request);
  try {
    const data = await fetchPublication(env);
    if (route.kind === 'creator' && !data.creatorsBySlug.has(route.slug)) return response('Not Found', 404, { 'content-type': 'text/plain; charset=utf-8' });
    const assetURL = new URL(route.asset, url.origin);
    const asset = await env.ASSETS.fetch(new Request(assetURL, request));
    if (!asset.ok) fail('site template is unavailable');
    return await renderDocument({ data, route, template: await asset.text(), publicOrigin: url.origin });
  } catch {
    return response(genericFailure, 503, { 'content-type': 'text/html; charset=utf-8' });
  }
}

export default { fetch: handleRequest };
