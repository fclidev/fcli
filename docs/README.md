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
`main:/docs` was also the publishing source and holds the generator. This workflow
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
