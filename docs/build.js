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
const REPO = process.env.SITE_REPO || "https://github.com/kensand/fcli";
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
      ["index", "Overview"],
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
    items: [["builtins", "Builtins"]],
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
<p class="repo"><a href="${REPO}">source ↗</a></p>
</nav>`;
}

function layout(opts) {
  const { title, summary, body, currentUrl, headings, assets } = opts;
  const toc = headings
    .filter((h) => h.level === 2)
    .map((h) => `<a href="#${h.id}">${h.text}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeAttr(summary)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(summary)}">
<link rel="canonical" href="${SITE}${currentUrl}">
<link rel="icon" href="${assets["favicon.svg"]}" type="image/svg+xml">
<link rel="stylesheet" href="${assets["style.css"]}">
<link rel="stylesheet" href="${assets["hljs.css"]}">
<script src="${assets["app.js"]}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${navHtml(currentUrl)}
<main id="main">
<button class="menu" aria-label="Menu">☰ Menu</button>
<article>
${body}
</article>
<footer>
<p>Documentation for <code>f</code>. This page is built by the site generator.</p>
<p><a href="${REPO}">site source</a></p>
</footer>
</main>
<aside>${toc ? `<nav class="toc"><h2>On this page</h2>${toc}</nav>` : ""}</aside>
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

  const pages = [];
  for (const rel of walk(CONTENT)) {
    const raw = fs.readFileSync(path.join(CONTENT, rel), "utf8");
    const { meta, body } = frontmatter(raw);
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
        summary,
        body: html,
        currentUrl,
        headings,
        assets,
      }),
    );
    pages.push({ rel, title, summary, text, html });
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
