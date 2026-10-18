#!/usr/bin/env node
"use strict";

// Static site generator for the fcli documentation site.
// Only deps are markdown-it + highlight.js (`npm install`, then `node build.js`).
// Every page under content/ is hand-written and tracked; the build reads nothing
// but those files. (It used to shell out to an `f` binary to generate a command
// reference. That is gone: f changed shape, and the reference will come back only
// once there is a stable way to generate it. See README.)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MarkdownIt = require("markdown-it");
const hljs = require("highlight.js");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");
const ASSETS = path.join(ROOT, "assets");
const OUT = path.join(ROOT, "dist");
const SITE =
  // Canonical URLs and sitemap.xml are baked in at build time, so this must
  // match the address the site is actually read from. fcli.dev is the intended
  // public address; it does not resolve yet (no DNS/cert/proxy), which is the
  // normal state of a pre-launch site. docs/deploy.md lists what has to land.
  process.env.SITE_ORIGIN || "https://fcli.dev";
// Where the source lives, for the sidebar's source link.
const REPO = process.env.SITE_REPO || "https://github.com/fclidev/fcli";
const UCKS_REPO = "https://github.com/fclidev/fcli-ucks";
const NPM_PKG = "@fcli.dev/f";

/* Sidebar link block. Each URL was checked against the live endpoint before it
   was listed — a link that 404s is worse than no link. */
const SIDEBAR_LINKS = [
  { label: "npm", href: `https://www.npmjs.com/package/${NPM_PKG}` },
  { label: "source", href: REPO },
  { label: "default ucks", href: UCKS_REPO },
  { label: "issues", href: `${REPO}/issues` },
];
/* Social card, 1200x630. Copy it from the canonical render — do not hand-generate
   a separate one, or the two drift and nobody notices:
     cp docs/thumbs/thumbs/fcli-wordmark-og-1200x630.png docs/assets/og.png
   docs/thumbs/ holds the tracked source of truth (see its README); writeAssets()
   hashes this copy, so the og:image URL is computed, never hand-written. */
const OG_IMAGE_FILE = "og.png";
const BASE = process.env.SITE_BASE || "";

const md = new MarkdownIt({
  html: false,
  linkify: false,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {}
    }
    return md.utils.escapeHtml(code);
  },
});

// ------------------------------------------------------------- markdown bits

function walk(dir, base = dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, base));
    else if (entry.name.endsWith(".md")) found.push(path.relative(base, full));
  }
  return found.sort();
}

function frontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0)
      meta[line.slice(0, idx).trim()] = line
        .slice(idx + 1)
        .trim()
        .replace(/^"|"$/g, "");
  }
  return { meta, body: raw.slice(match[0].length) };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// content/foo.md -> /foo/   (content/index.md -> /)
function urlFor(rel) {
  const clean = rel.replace(/\.md$/, "").replace(/\\/g, "/");
  return clean === "index" ? BASE + "/" : `${BASE}/${clean}/`;
}

function outputDirFor(rel) {
  const clean = rel.replace(/\.md$/, "").replace(/\\/g, "/");
  return clean === "index" ? OUT : path.join(OUT, ...clean.split("/"));
}

// Heading anchors (for the toc) and .md links rewritten to pretty URLs.
function prepare(src) {
  src = src.replace(
    /\]\((?!https?:|mailto:|#)([^)\s]+?)\.md(?:\s+"[^"]*")?\)/g,
    (_full, target) => {
      const clean = target
        .replace(/^\.?\//, "")
        .replace(/(^|\/)index$/, "$1")
        .replace(/\/$/, "");
      return `](${urlFor(`${clean}.md`)})`;
    },
  );
  return src;
}

// Anchors are derived from each heading's inline text, so a heading that contains
// a link gets the same anchor whether read from the source line or from tokens.
function anchorHeadings(tokens) {
  const seen = new Map();
  const anchors = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const level = Number(tokens[i].tag.slice(1));
    const text = (tokens[i + 1]?.content || "").replace(/[[\]*`]/g, "").trim();
    const slug = slugify(text);
    const count = slug ? (seen.get(slug) || 0) + 1 : 0;
    if (slug) seen.set(slug, count);
    anchors.push({ id: count > 1 ? `${slug}-${count}` : slug, text, level });
    tokens[i].attrSet("data-anchor", String(anchors.length - 1));
  }
  return anchors;
}

function renderWithIds(src) {
  const tokens = md.parse(src, {});
  const anchors = anchorHeadings(tokens);
  const html = md.renderer
    .render(tokens, {})
    .replace(/<h([1-3]) data-anchor="(\d+)">/g, (_full, level, i) =>
      anchors[i].id ? `<h${level} id="${anchors[i].id}">` : `<h${level}>`,
    )
    .replace(
      /<pre><code(?![^>]*class)([^>]*)>/g,
      '<pre><code class="language-text"$1>',
    )
    .replace(/<pre><code class="([^"]*)">/g, '<pre><code class="hljs $1">');
  return { html, headings: anchors.filter((a) => a.id) };
}

// -------------------------------------------------------------------- assets

function writeAssets() {
  const map = {};
  if (!fs.existsSync(ASSETS)) return map;
  for (const file of fs.readdirSync(ASSETS)) {
    const data = fs.readFileSync(path.join(ASSETS, file));
    const hash = crypto
      .createHash("sha256")
      .update(data)
      .digest("hex")
      .slice(0, 8);
    const ext = path.extname(file);
    const out = `${path.basename(file, ext)}-${hash}${ext}`;
    fs.writeFileSync(path.join(OUT, out), data);
    map[file] = `${BASE}/${out}`;
  }
  return map;
}

// ---------------------------------------------------------------- navigation

// The sidebar is explicit on purpose: no directory-order surprise, and the nav
// is reviewable in a diff. Kept to the pages that exist right now; the Concepts
// / Guides / Reference / Project sections come back with the content rewrite.
const NAV = [
  {
    title: "Start",
    items: [
      ["index", "Home"],
      ["install", "Install"],
      ["quickstart", "Quickstart"],
    ],
  },
  {
    title: "Core",
    items: [
      ["ucks", "Ucks"],
      ["config", "Config"],
      ["skills", "Skills"],
      ["credentials", "Credentials"],
    ],
  },
  {
    title: "Extend",
    items: [
      ["extend", "Extend"],
      ["update", "Update"],
      ["recipes", "Recipes"],
    ],
  },
  {
    title: "Reference",
    items: [
      ["builtins", "Builtins"],
      ["measurements", "Measurements"],
    ],
  },
];

function navHtml(currentUrl) {
  const sections = NAV.map((section) => {
    const links = section.items
      .map(([rel, label]) => {
        const url = urlFor(`${rel}.md`);
        return `<a class="${url === currentUrl ? "active" : ""}" href="${url}">${label}</a>`;
      })
      .join("\n");
    return `<section><h2>${section.title}</h2>\n${links}</section>`;
  }).join("\n");
  return `<nav class="sidebar">
<a class="brand" href="${BASE}/"><b>f</b>cli</a>
<p class="tagline">token-efficient CLI for LLMs</p>
${sections}
<div class="repo">${SIDEBAR_LINKS.map(
    (l) => `<a href="${l.href}">${l.label} ↗</a>`,
  ).join("")}</div>
</nav>`;
}

// The homepage hero is raw HTML, so it cannot live in markdown: pages are built
// with markdown-it `html: false` on purpose, so a content file cannot smuggle
// markup past the layout. Rather than flip that switch site wide open, the hero
// is a fenced block lifted out by build.js and injected as a slot of its own.
//
// The fence is `!!!hero`, not a `hero:` frontmatter key, because a markdown
// body cannot be a YAML block scalar and stay honest about it. A `hero: |`
// scalar's indentation is set by its first line, and the terminal transcript in
// the hero deliberately contains column-0 lines (`config  edit f.config.json…`)
// that a spec-correct YAML parser would read as the end of the scalar. Any
// indentation-based reading of this content is wrong; a fence with an explicit
// terminator makes the column-0 lines correct by construction.
//
// Two consequences worth knowing:
//   - The hero is trusted input, same status as build.js itself. It is read once
//     at build time and never echoed back into output, so it is not a render-time
//     injection surface.
//   - It is injected outside <article>, because app.js inserts the search box
//     *before the first <h1> inside* <article>. A hero rendered after that h1
//     would land under the search box, and a hero inside <article> would be
//     styled as prose. Nothing verifies this yet — `npm run check` has no hero
//     assertion, and a misplaced hero still builds and passes. If the hero moves,
//     look at it in `npm run serve`.
const HERO_FENCE = /^!!!hero[ \t]*\n([\s\S]*?)\n!!![ \t]*$/m;

function extractHero(raw) {
  const match = HERO_FENCE.exec(raw);
  if (!match) return { hero: "", body: raw };
  return {
    hero: match[1].replace(/\s+$/, ""),
    body: raw.slice(0, match.index) + raw.slice(match.index + match[0].length),
  };
}

function layout(opts) {
  const {
    title,
    summary,
    hero,
    home,
    body,
    currentUrl,
    headings,
    assets,
    ogImage,
  } = opts;
  const toc = headings
    .filter((h) => h.level === 2)
    .map((h) => `<a href="#${h.id}">${h.text}</a>`)
    .join("");
  // Empty on a page with no level-2 headings (the landing page, Install).
  const tocHtml = toc
    ? `<nav class="toc"><h2>On this page</h2>${toc}</nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeAttr(summary)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(summary)}">
${
  ogImage
    ? `<meta property="og:image" content="${escapeAttr(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeAttr(ogImage)}">
`
    : `<meta name="twitter:card" content="summary">
`
}<link rel="canonical" href="${SITE}${currentUrl}">
<link rel="icon" href="${assets["favicon.svg"]}" type="image/svg+xml">
<link rel="stylesheet" href="${assets["style.css"]}">
<link rel="stylesheet" href="${assets["hljs.css"]}">
<script src="${assets["app.js"]}" defer></script>
</head>
<body class="${home ? "home" : "doc"}${tocHtml ? " has-toc" : ""}${
    hero ? " has-hero" : ""
  }">
<a class="skip" href="#main">Skip to content</a>
${navHtml(currentUrl)}
<main id="main">
<button class="menu" aria-label="Menu">☰ Menu</button>
${hero ? `<header class="hero">${hero}</header>` : ""}
<article>
${body}
</article>
<footer>
<p>Documentation for <code>f</code>. This page is built by the site generator.</p>
<p><a href="${REPO}">site source</a></p>
</footer>
</main>
<aside>${tocHtml}</aside>
</body>
</html>
`;
}

function escapeAttr(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function stripHtml(html) {
  return html
    .replace(
      /<pre>([\s\S]*?)<\/pre>/g,
      (_, c) => "\n```\n" + c.replace(/<[^>]+>/g, "") + "\n```\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------------- main

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const assets = writeAssets();
  const ogImage = assets[OG_IMAGE_FILE] || "";
  if (!ogImage)
    console.warn(
      `warn: no ${OG_IMAGE_FILE} in assets/ — pages ship without og:image, so shared links render blank`,
    );

  // GitHub Pages runs Jekyll over the published tree unless this file exists.
  // dist/ IS the build output, so a second build over it is destructive: Jekyll
  // read our frontmatter block as its own, re-rendered index.html, rewrote the
  // title from docs/README.md via jekyll-seo-tag, dropped the pretty-URL page
  // directories, and swapped in theme CSS (/assets/css/style.css) for our
  // content-hashed assets. It also stopped copying llms.txt through, so the URL
  // served an HTML error page. Local `npm run serve` serves dist/ verbatim,
  // which is why this only ever broke in production.
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  const pages = [];
  for (const rel of walk(CONTENT)) {
    const raw = fs.readFileSync(path.join(CONTENT, rel), "utf8");
    const { meta, body: prose } = frontmatter(raw);
    const { hero, body } = extractHero(prose);
    const src = prepare(body);
    const { html, headings } = renderWithIds(src);
    const currentUrl = urlFor(rel);
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const title = meta.title || rel.replace(/\.md$/, "");
    const summary = meta.summary || text.slice(0, 150);
    fs.mkdirSync(outputDirFor(rel), { recursive: true });
    fs.writeFileSync(
      path.join(outputDirFor(rel), "index.html"),
      layout({
        title:
          rel === "index.md"
            ? "f — a token-efficient CLI for LLMs"
            : `${title} · f`,
        // Dropped in an earlier refactor, which left <meta name="description">
        // and og:description empty on every page: layout() destructures `summary`
        // and emits both from it, while search.json read the same value straight
        // off `pages`, so only the HTML meta tags went blank.
        summary,
        hero,
        home: meta.page === "home",
        body: html,
        currentUrl,
        headings,
        assets,
        ogImage: ogImage ? `${SITE}${ogImage}` : "",
      }),
    );
    // llms.txt and search.json must not carry the hero's markup: the hero is
    // chrome, and its content is a verbatim copy of the install command and the
    // `f help` listing that the prose below already states. Feed the plain-text
    // consumers the article only.
    pages.push({ rel, title, summary, text, html: body });
  }

  // GitHub Pages reads CNAME from the published root to learn the custom
  // domain. The site root here is the *repo* root, not docs/, so GitHub's
  // "Add a domain" flow would write docs/CNAME as an untracked file in the
  // source branch. Track it instead and carry it into dist/ — the deploy job
  // then owns the domain in git, and re-adding it in the UI stays a no-op.
  const cname = path.join(ROOT, "CNAME");
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(OUT, "CNAME"));

  fs.writeFileSync(
    path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
      .map((p) => `  <url><loc>${SITE}${urlFor(p.rel)}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  fs.writeFileSync(
    path.join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`,
  );

  // One plain-text blob: the whole site, for LLMs and for `curl`.
  fs.writeFileSync(
    path.join(OUT, "llms.txt"),
    pages
      .map(
        (p) =>
          `# ${p.title}\n${SITE}${urlFor(p.rel)}\n\n${stripHtml(p.html).trim()}`,
      )
      .join("\n\n---\n\n") + "\n",
  );

  // Client-side search index — no server, no build-time search service.
  fs.writeFileSync(
    path.join(OUT, "search.json"),
    JSON.stringify(
      pages.map((p) => ({
        url: urlFor(p.rel),
        title: p.title,
        summary: p.summary,
        body: p.text.slice(0, 4000),
      })),
    ),
  );

  console.log(`built ${pages.length} pages -> dist/`);
}

build();
