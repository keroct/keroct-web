# KEROCT CMS site Worker

This site-specific Worker uses the existing KEROCT HTML, CSS and browser JavaScript as its static template artifact. On each HTML document request it reads one active schema version 2 publication and renders the KEROCT insertion slots. The template is still the fallback source used by the current GitHub Pages flow; this Worker does not change that flow.

The public response is crawlable HTML and uses `cache-control: no-store`. A missing publication, incompatible schema, invalid site presentation, invalid media URL, or upstream error returns a generic 503 page. Static files are served from the ASSETS binding without a CMS request.

## Local development

Use Node 22 and pnpm 12.15.0. Build a fresh static artifact with the existing explicit Pages selector, then start the local Worker:

```powershell
python scripts/prepare-pages-artifact.py --source INPUT --destination _pages
corepack pnpm@12.15.0 --dir cms-site install --ignore-scripts --frozen-lockfile
corepack pnpm@12.15.0 --dir cms-site exec wrangler dev --local
```

Configure `CMS_ORIGIN`, `CMS_TEAM_ID`, `CMS_SITE_KEY`, and `CMS_SERVICE_BINDINGS` in the local Wrangler environment before connecting to a CMS. The checked-in config deliberately uses an invalid origin and an empty team ID so it cannot make a real request by default. The default site key is `keroct`.

The committed lockfile is the native output of pnpm 12.15.0, including its package-manager metadata. A clean frozen install passed in a fresh directory containing only package.json and pnpm-lock.yaml with the exact command: corepack pnpm@12.15.0 --dir FRESH install --ignore-scripts --frozen-lockfile (34 packages, Wrangler 4.152.0).
The read endpoint is `GET {CMS_ORIGIN}/api/content-publishing?teamId={CMS_TEAM_ID}`. The adapter accepts the active publication envelope documented by the immutable MyHaco P2 contract at [content-publishing-contract.md](https://github.com/tept-creator/myhaco/blob/462e2a60e820700132500a56d3b6b102152353da/docs/content-publishing-contract.md). No CMS content is copied into this repository.

## Static release renderer

`preparePublication(envelope, options)` validates and prepares an explicitly supplied publication envelope. `renderDocument({data, route, template, publicOrigin})` applies the same KEROCT HTMLRewriter rules used by requests and points Open Graph/Twitter image metadata at `{publicOrigin}/assets/ogp.jpg`. `renderRelease({envelope, cmsOrigin, teamID, siteKey, serviceBindings, templateLoader, publicOrigin, mapMediaURL})` combines these for a candidate static release and returns a filename-to-HTML object containing exactly `index.html`, `pricing/index.html`, `creators/kaerunoankake/index.html`, and `creators/sensuishi13/index.html`. These are the two creator profile templates currently available; publications containing other creator slugs are rejected before template loading. `templateLoader(assetPath)` returns the existing template HTML string; the release renderer parses it and requires a route-specific `data-cms-template` identity, document structure, and route CMS slots exactly once, rejecting empty, swapped, wrong-route, or incomplete templates. `mapMediaURL(acceptedCmsMediaURL)` returns a root-relative release-local path for every referenced CMS media URL; a missing, non-local, or unsafe mapping rejects generation. Only normalized CMS media fields are mapped; external creator links remain unchanged. The release renderer only uses the supplied envelope and callbacks and does not fetch the active CMS publication.

## Template mapping

`index.html` uses the configured presentation's ordered `heroImages` and `featuredWorks`; the existing layout has two hero slots and six featured-work slots. Creator cards use the publication's ordered creators. Creator routes render the existing profile template for any published slug and list that creator's ordered works. `/pricing/` renders design groups, sets, illustration groups, options, examples and conditions from their ordered records. Set revision counts are rendered from each set record. When all sets share their included items and revision count, the existing factual intro is rendered; for differing set contents or counts the intro says, `各セットの内容と修正回数は、一覧をご確認ください。`

The immutable template contract is [keroct-v1.json](contracts/keroct-v1.json), with synthetic boundary cases in [keroct-v1-boundaries.json](test/fixtures/contracts/keroct-v1-boundaries.json). It records schema version 2, creator slug syntax, work categories, six featured-work slots, two hero slots, and nullable nonnegative safe-integer revision counts. The Worker reads this artifact for those validation constants.

The site presentation must match `CMS_SITE_KEY`. Creator summary, profile description, gallery intro, and avatar alt text use their optional v2 fields. A missing summary falls back to the profile description for older synthetic/legacy snapshots; a missing gallery intro is empty, and a missing avatar alt falls back to the creator title. The `kaerunoankake` profile retains its four-character first-line break while the name remains CMS-driven.

Creator and pricing values are escaped as text and attributes. External creator links are emitted for HTTPS URLs. Media URLs are resolved against the configured CMS origin and accepted only for that origin's `/api/public-media/{team}/{snapshot}/{reference}` route, with team and snapshot identifiers checked against the current publication.

`CMS_SERVICE_BINDINGS` is a JSON array of up to three explicit `{pricingId, groupId, planId, href, label?, subtitle?, fromPrice?}` mappings. The IDs resolve against one active snapshot, so a plan edit is reflected on both the home card and pricing page without a template rebuild. Only `pricing/#design` and `pricing/#illustration` are allowed for `href`. `label` and `subtitle` can preserve fixed brand copy; otherwise the adapter uses the pricing record title and plan detail. `fromPrice: true` appends `〜` only to a plain yen amount like `¥6,000`. Other display strings stay unchanged. Missing or deleted target IDs omit the numeric card; the all-menus link remains. Malformed binding JSON returns the generic 503 response.

Page routes include `/`, `/index.html`, `/pricing/`, and `/creators/{published-slug}/`. Non-trailing-slash pricing and creator paths receive a 308 redirect. Unknown creator slugs return 404. Other paths pass to the static asset binding.

Published media is snapshot-scoped. If a current HTML document references an older snapshot after a publish or rollback, the existing site script allows one guarded page reload per failed CMS media path within 30 seconds so the browser can fetch the current HTML. This does not provide publication-time cache invalidation or zero 404s during a publish transition.

## Synthetic tests

Run `corepack pnpm@12.15.0 --dir cms-site test`. Tests use synthetic publication JSON, synthetic media responses, synthetic HTML templates, and synthetic files for the existing 43-entry artifact allowlist. They do not load customer content or images.

## Private renderer service

The Worker keeps the existing public `fetch` handler and exposes the `KeroctRenderer` entrypoint for private Worker RPC. The renderer reports an opaque deployment version from Cloudflare version metadata and the code SHA injected through `RENDERER_CODE_SHA`. Each RPC call that reads an asset or renders a candidate must supply the version returned by `listAssets`; a mismatch is rejected before the asset read or render begins.

`listAssets()` returns the version, code revision, and the explicit 43-path allowlist in `contracts/public-assets-v1.json`. `getAsset(path, expectedRendererVersion)` returns a streaming `Response` for one allowlisted relative path. `renderCandidate(input, expectedRendererVersion)` accepts a streamed JSON request with `schemaVersion: 1`, an envelope, and render options, then returns a JSON response containing the four rendered documents. The deployment's CMS team ID, origin, and site key are checked before rendering. Media URL mappings are supplied by the caller and must explicitly cover each referenced media URL.

The manifest is selected from the same 43 runtime and tool paths used by `scripts/prepare-pages-artifact.py`. It contains content types for each path; the renderer does not accept arbitrary asset URLs or use an external fetch for assets.
