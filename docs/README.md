# fcli.dev — the documentation site

The site at [fcli.dev](https://fcli.dev). Static HTML and CSS on disk — no
server, no analytics.

This directory is a **separate npm workspace** inside the core repo. It has its
own `package.json` and `package-lock.json`; nothing in the core `src/` imports
it, and `npm pack` in the repo root ships only `["dist"]` (the core `files`
field), so none of this reaches the published `@fcli.dev/f` tarball.

## Build and preview

```sh
cd docs
npm install
npm run build        # astro build -> dist/
npm run check        # astro build, then the post-build assertions in check.js
npm run dev          # astro dev, http://localhost:4321
npm run preview      # serve the built dist/
```

The origin comes from the environment, with `https://fcli.dev` as the default,
so a local build produces the same canonical URLs and `og:image` values as CI:

```sh
SITE_ORIGIN=https://fcli.dev npm run build
```

## Layout

```text
astro.config.mjs         site URL, static output, link checker, sitemap, md setup
src/content.config.ts    the pages collection + its frontmatter schema
src/nav.ts               the URL space and sidebar: PAGES, LABELS, ROUTE_PAGES
src/content/pages/       hand-written pages (markdown, one file per page)
src/pages/               routes: the catch-all, /ucks/, /docs/, 404
src/components/          Hero, Compare, Sidebar, Topbar, UckRegistry
src/layouts/Page.astro   the shell every page renders through
src/data/                generated measurement inputs (see scripts/)
src/integrations/        site-index (search.json, llms.txt), static-assets
assets/                  style.css, hljs.css, favicon.svg, app.js
content/                 NOT a page directory — token-measurements.json only
check.js                 post-build assertions about the Pages target
dist/                    build output (gitignored)
public/                  copied from assets/ by a prebuild hook (gitignored)
```

`content/` is a leftover name. It is **not** read by the markdown pipeline,
which globs `src/content/pages`. The one file in it, `token-measurements.json`,
is the committed source of every token figure on the site, written by
`scripts/count-tokens.mjs --snapshot` — see [Measurements](./src/content/pages/docs/measurements.md).

`public/` is a build artifact rather than a source: Astro serves files verbatim
from `public/` and cannot be pointed at `assets/`, which is what git tracks. The
`static-assets` integration mirrors `assets/` into it (and deletes stale files, so
a renamed asset cannot keep serving at its old URL). It is an integration rather
than a `prebuild` script on purpose: running `npx astro build` directly skips npm
hooks, and `astro dev` must work on a clean clone with no extra step.

## Publishing

`.github/workflows/docs.yml` builds this directory and publishes `docs/dist` as a
Pages **artifact**. A push to `main` builds and deploys; a PR builds and checks but
does not deploy.

**Pages must be in "GitHub Actions" mode, and the workflow enforces it** with
`actions/configure-pages` in the deploy job. Two ways exist to publish a repository
and they fight:

| mode                 | what it serves                                | who wins                                                                               |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Deploy from a branch | Jekyll output built from a branch plus folder | GitHub's own `pages build and deployment` workflow, on every push to the source branch |
| GitHub Actions       | the artifact this workflow uploads            | this workflow                                                                          |

In branch mode the Jekyll build overwrites whatever `deploy-pages` publishes, and
`deploy-pages` still reports success. That is what happened on the first cutover:
fcli.dev served Jekyll-rendered `docs/README.md` — title `fcli.dev — the
documentation site | fcli`, `/install/` and every other page 404, `llms.txt` an HTML
error page — plus `/build.js` and `/package.json` as public files, because
`main:/docs` was also the publishing source and held the generator. This workflow
was green the whole time.

Two rules follow, both enforced:

- **`docs/` must never be a Pages publishing source.** `/docs` on the default branch
  is GitHub's built-in guess for "the site lives here", so stale branch-mode
  settings find it. What gets published is the _artifact_; this directory is source
  code.
- **`dist/.nojekyll` stays.** Actions mode does not run Jekyll, so the marker is
  inert today. It is kept so a fallback to branch mode cannot silently mangle the
  site, and `npm run check` fails if it disappears.

The `deploy` job is restricted to `refs/heads/main`: the `github-pages` environment
carries a branch policy allowing only `main`, so a deploy from another ref fails with
"Branch X is not allowed to deploy to github-pages due to environment protection
rules".

`CNAME` is tracked here and copied into `dist/`, which is where Pages reads the
domain from.

## Adding a page

1. `src/content/pages/<name>.md`, or `src/content/pages/docs/<name>.md` for a page
   under `/docs/`, with frontmatter:

```markdown
---
title: Page title
summary: One line — the sitemap entry, and the meta description unless overridden.
---
```

   The schema in `src/content.config.ts` requires `summary` and `description` to
   be at least 40 characters. Optional: `description` (overrides `summary` for
   `<meta name="description">` / `og:description`) and `navTitle`.

2. Add the slug to `PAGES` in `src/nav.ts`, and a label to `LABELS`. The sidebar is
   explicit on purpose: no directory-order surprise, and the nav is reviewable in a
   diff. A content file that is not in `PAGES` fails the build; so does a `PAGES`
   entry with no content file — unless it is listed in `ROUTE_PAGES`, for slugs a
   `.astro` route renders instead of the markdown collection (`/ucks/`, `/docs/`).

   A page that is published but deliberately outside the sidebar goes in
   `UNLINKED_PAGES` with the slug that links it, so "the homepage stopped linking
   it" is a build error rather than an invisible orphan.

   The homepage is the other special case: frontmatter `hero: true` renders
   `src/components/Hero.astro` above the article. It is a component rather than
   fenced markup because the transcript in it is column-aligned terminal output
   that a markdown pipeline cannot be trusted to preserve. `src/content/pages/index.md`
   is in `.prettierignore` for the same reason.

3. `npm run check` before pushing.

## What is verified, and what is not

The build checks **structure**, mechanically:

| claim                                   | checked by                                                          |
| --------------------------------------- | ------------------------------------------------------------------- |
| internal links and `#fragments` resolve | `astro-better-link-checker`, fails the build                        |
| `summary` present and not stubby        | `src/content.config.ts` schema                                      |
| every nav entry has a page, every page is reachable | `src/nav.ts` assertions in the build                 |
| assets are root-absolute, `.nojekyll`/`CNAME` correct, `search.json` and `llms.txt` sound | `check.js` (runs only in `npm run check`) |

What is **not** verified anywhere: that prose matches the `f` binary. The command
reference in `src/content/pages/docs/builtins.md` is written by hand, because `f`
has no stable machine-readable surface to generate one from — ucks come from a
store whose contents differ per machine. Nothing compares `builtins.md` against
`f`, `f help`, or `f search`, and no build step would notice if `f` renamed a flag
tomorrow. Treat that page as documentation to be re-read against the binary when
`f` releases, not as something CI has confirmed.

This README is the cautionary example for exactly that gap. Until the Astro
rewrite (`d798bdf`), it described the generator it documented — `node build.js`,
`NAV`, `content/` as the page directory, the `!!!hero` fence — and stayed
unusually confident while doing so. If a paragraph here names a file, verify the
file.

## Formatting

Prettier is a devDependency and there is **no `format` script** in either this
directory or the repo root, so nothing formats these files automatically and CI
does not check formatting. `npm exec prettier --write <file>` is therefore
destructive to run on a hunch — it reflows prose, and it reflows it differently
depending on the file:

- `src/content/pages/index.md` and `examples.md` are listed in `.prettierignore`.
  The first holds a column-aligned `f help` transcript that Prettier collapses
  inside `<pre>`; the second quotes a blockquote with lines past `printWidth`,
  which Prettier unwraps by dropping the `> ` marker and splitting the quote.
- `src/content/pages/docs/credentials.md` does **not** match Prettier today. It is
  pre-existing drift, not protected by the ignore file; formatting it is its own
  change.
- The `prettier.overrides` entry in `package.json` targets `content/**/*.md`, a
  pattern that matches nothing now that the pages live under `src/content/pages/`.
  It survives only because `proseWrap: "preserve"` happens to be Prettier's default.

`.prettierignore` paths are relative to the working directory Prettier runs from,
which is why the Astro move silently un-ignored the homepage: it still said
`content/index.md` while the file had become `src/content/pages/index.md`. Nothing
asserts an ignore pattern matches a real file, so the protection vanished without a
warning. If you rename or relocate a page, check that its ignore entry followed it.

## Measurements

The token figures on the homepage and on [Measurements](./src/content/pages/docs/measurements.md)
are generated, not typed:

```sh
node scripts/count-tokens.mjs --snapshot   # rewrites content/token-measurements.json
npm run measure:session                    # rewrites src/data/*, used by Compare.astro
```
