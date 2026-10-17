# fcli.dev — the documentation site

The site at [fcli.dev](https://fcli.dev). Plain HTML and CSS on disk — no
framework, no server, no analytics.

This directory is a **separate npm workspace** inside the core repo. It has its
own `package.json` and `package-lock.json`; nothing in `src/` imports it, and
`npm pack` in the repo root ships only `dist/`, `LICENSE` and `README.md`, so
none of this reaches the published `@fcli.dev/f` tarball.

## Build and preview

```sh
cd docs
npm install
npm run build        # -> dist/
npm run check        # build, then verify links and structure
npm run serve        # http://localhost:8080
```

The generator reads only `content/` and `assets/`. No build-time network access,
no external binary:

```sh
SITE_ORIGIN=https://fcli.dev node build.js
```

## Layout

```text
build.js     the whole generator (markdown-it + highlight.js)
check.js     link, structure, and frontmatter checks (npm run check)
CNAME        the Pages custom domain, carried into dist/ by build.js
assets/      style.css, hljs.css, favicon.svg, app.js — hashed into dist/
content/     hand-written pages (markdown, one file per page)
dist/        build output (gitignored)
```

## Publishing

`.github/workflows/docs.yml` builds this directory and publishes `dist/` to the
`gh-pages` branch; Pages serves that branch at the root of `fcli.dev`. A push to
`main` touching `docs/**` builds and deploys; a PR builds and checks but does not
deploy.

The publishing source is a **branch**, not `main:/docs`. `build.js` emits
root-absolute URLs (`/install/`, `/style-<hash>.css`) and bakes `SITE_ORIGIN`
into every canonical tag, into `sitemap.xml` and into `llms.txt`. Published as a
_project_ site under `kensand.github.io/fcli/`, all of those fall off the root
and Pages returns a bare 404 for unknown paths — the `redirects:0` generator it
does offer only ships for user/org sites. Publishing a branch at the domain root
keeps `SITE_BASE` empty, so `build.js` and `check.js` need no base-path
awareness at all.

`CNAME` is tracked here and copied into `dist/`, which is where Pages reads the
domain from. That keeps the domain in git rather than as an untracked file the UI
would write into the source branch.

`SITE_ORIGIN` is set in the workflow. Change it there if the canonical URL ever
moves.

## Adding a page

1. `content/<section>/<name>.md` with frontmatter:

```markdown
---
title: Page title
summary: One line — used for the meta description and search results.
---
```

2. Add it to `NAV` in `build.js`. The sidebar is explicit on purpose: no
   directory-order surprise, and the nav is reviewable in a diff. A content file
   that is not in `NAV` fails `npm run check`.

3. `npm run check` before pushing.

## Status of the content

The site documents `f` as it is now: a small core CLI plus tools ("ucks") pulled
from git, local paths, and npm packages. `content/builtins.md` is the
hand-written reference for the ucks that ship in the defaults repo, and
`content/skills.md` covers skills.

The reference is **written, not generated**. The old build shelled out to an `f`
binary to generate a command reference; that is gone, because `f` no longer has a
stable machine-readable surface to generate from (ucks come from a store whose
contents differ per machine). The generated reference comes back only if `f`
grows a stable export for it. Until then `npm run check` verifies links, nav
coverage, frontmatter and heading anchors — it cannot verify that the prose
matches the binary, so the builtins page is checked against `f help` by hand when
`f` releases.

> **The prose is behind the core.** Content was last corrected against `f` 0.2.2;
> the core in the repo above this directory is 0.3.1. `content/builtins.md` and
> `content/ucks.md` are the pages most likely to be wrong. Reconcile them against
> `f help` before treating the site as authoritative.

## History

This site used to be its own repo on Forgejo, deployed as an nginx container
behind haproxy with an Ansible-driven Actions pipeline. That was replaced by
Pages; the container, the certbot service and the haproxy frontends for
`fcli.dev` are gone.
