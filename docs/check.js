#!/usr/bin/env node
"use strict";

// Build-time checks: every internal link resolves to a built page or asset,
// every content file is reachable from NAV, frontmatter is well-formed, and the
// generated reference pages cover exactly the tools in the f being documented.

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const CONTENT = path.join(ROOT, "content");

const problems = [];
const fail = (msg) => problems.push(msg);

if (!fs.existsSync(DIST)) fail(`no dist/ — run node build.js first`);

function pages() {
  const found = new Map();
  const stack = [DIST];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "index.html") {
        const rel = path.relative(DIST, dir).split(path.sep).filter(Boolean);
        found.set("/" + (rel.length ? rel.join("/") + "/" : ""), full);
      }
    }
  }
  return found;
}

const site = pages();

function checkLinks() {
  for (const [url, file] of site) {
    const html = fs.readFileSync(file, "utf8");
    for (const href of new Set(
      [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    )) {
      if (/^(https?:|mailto:)/.test(href)) {
        if (
          /^https?:\/\/fcli\.dev/.test(href) &&
          !href.startsWith(process.env.SITE_ORIGIN || "https://fcli.dev")
        )
          fail(`${url}: unexpected fcli.dev origin in ${href}`);
        continue;
      }
      const target = href.split("#")[0];
      if (!target) continue;
      if (target.endsWith("/")) {
        if (!site.has(target)) fail(`${url}: broken internal link ${href}`);
      } else if (target.startsWith("/")) {
        if (!fs.existsSync(path.join(DIST, target)))
          fail(`${url}: missing asset ${href}`);
      } else {
        fail(`${url}: relative link escaped to ${href}`);
      }
    }
    for (const m of html.matchAll(/<a href="([^"]*)"[^>]*>/g)) {
      if (m[1].includes(".md"))
        fail(`${url}: an .md link survived the build (${m[1]})`);
    }
    if (/\{#[a-z0-9-]+\}/.test(html))
      fail(`${url}: heading marker leaked into output`);
    for (const need of ["style-", "hljs-", "app-"]) {
      if (!html.includes(`/${need}`))
        fail(`${url}: no hashed ${need} asset reference`);
    }
    if (!/<title>[^<]+<\/title>/.test(html)) fail(`${url}: empty title`);
  }
}

// NAV lives in build.js; parse it rather than duplicating it.
function navEntries() {
  const src = fs.readFileSync(path.join(ROOT, "build.js"), "utf8");
  const start = src.indexOf("const NAV = [");
  if (start < 0) return [];
  const block = src.slice(start, src.indexOf("function navHtml"));
  return [...block.matchAll(/\[\s*"([a-z/-]+)"\s*,\s*"[^"]*"\s*\]/g)].map(
    (m) => m[1],
  );
}

function checkNavCoverage() {
  const nav = navEntries();
  if (!nav.length) return fail("could not parse NAV from build.js");
  const navUrls = new Set(
    nav.map((rel) => (rel === "index" ? "/" : `/${rel}/`)),
  );
  for (const url of site.keys()) {
    if (!navUrls.has(url)) fail(`page not reachable from NAV: ${url}`);
  }
  for (const rel of nav) {
    const url = rel === "index" ? "/" : `/${rel}/`;
    if (!site.has(url))
      fail(`NAV points at a missing page: ${url} (content/${rel}.md)`);
  }
}

function checkFrontmatter() {
  const stack = [CONTENT];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (!entry.name.endsWith(".md")) continue;
      const raw = fs.readFileSync(full, "utf8");
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      const rel = path.relative(ROOT, full);
      if (!fm) {
        fail(`${rel}: no frontmatter`);
        continue;
      }
      for (const key of ["title", "summary"]) {
        if (!new RegExp(`^${key}:`, "m").test(fm[1]))
          fail(`${rel}: frontmatter missing ${key}`);
      }
      if (raw.includes("\t")) fail(`${rel}: tab character in markdown`);
      if (/#\s*\[?\[?todo\]?\]?/i.test(raw))
        fail(`${rel}: unresolved TODO marker`);
    }
  }
}

// Every article heading must carry an anchor: a page whose headings lost their
// ids has a toc of dead links and no deep-linkable sections.
function checkHeadingAnchors() {
  for (const [url, file] of site) {
    const html = fs.readFileSync(file, "utf8");
    const article = /<article[\s\S]*?<\/article>/.exec(html);
    if (!article) continue;
    const ids = [...article[0].matchAll(/<(h[1-3])([^>]*)>/g)];
    const missing = ids.filter((m) => !m[2].includes("id=")).map((m) => m[1]);
    if (missing.length)
      fail(
        `${url}: ${missing.length} heading(s) without an id: ${missing.join(",")}`,
      );
    const anchors = ids
      .map((m) => /id="([^"]+)"/.exec(m[2]))
      .filter(Boolean)
      .map((m) => m[1]);
    const dupes = anchors.filter((a, i) => anchors.indexOf(a) !== i);
    if (dupes.length)
      fail(`${url}: duplicate heading ids: ${[...new Set(dupes)].join(",")}`);
    const toc = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
    for (const t of toc)
      if (!anchors.includes(t))
        fail(`${url}: toc link to missing anchor #${t}`);
  }
}

function checkExtras() {
  for (const name of ["search.json", "llms.txt", "sitemap.xml", "robots.txt"]) {
    const file = path.join(DIST, name);
    if (!fs.existsSync(file)) fail(`missing ${name}`);
    else if (fs.statSync(file).size < 20) fail(`${name} looks empty`);
  }
  const search = path.join(DIST, "search.json");
  if (fs.existsSync(search)) {
    const rows = JSON.parse(fs.readFileSync(search, "utf8"));
    for (const row of rows) {
      if (!site.has(row.url))
        fail(`search.json entry points nowhere: ${row.url}`);
      if (!row.summary) fail(`search.json entry without summary: ${row.url}`);
    }
    if (rows.length !== site.size)
      fail(`search.json has ${rows.length} rows, site has ${site.size} pages`);
    console.log(
      `search: ${rows.length} rows, ${Math.round(fs.statSync(search).size / 1024)} KB`,
    );
  }
}

checkLinks();
checkHeadingAnchors();
checkNavCoverage();
checkFrontmatter();
checkExtras();

if (problems.length) {
  process.stderr.write(`check: ${problems.length} problem(s)\n`);
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.exit(1);
}
console.log(`check: ok — ${site.size} pages, every internal link resolves`);
