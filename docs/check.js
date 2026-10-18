#!/usr/bin/env node
// Post-build assertions about how this site behaves on GitHub Pages, which no part of
// the Astro build or the link checker knows about.
//
// WHAT MOVED OUT OF HERE
//
// This file used to also verify internal links, NAV coverage, frontmatter, heading
// anchors and hashed asset names. Those are gone on purpose: astro-better-link-checker
// fails the build on a broken link or a dangling #fragment (including the /foo.md links
// this file checked by hand), the content schema rejects a missing or stubby summary,
// and route-level assertions catch a page that is not in the sidebar. Keeping a second
// implementation of each would mean two things to update whenever the site changes shape
// — which is precisely how the previous setup came to disagree with itself.
//
// WHAT REMAINS, AND WHY IT IS NOT REDUNDANT
//
// Everything below is about the deployment target rather than the site's content. Astro
// emits valid HTML and correct links while producing a tree that Pages would serve
// wrongly, so nothing in the build would notice these.
//
// Exit 1 on any problem; npm run check runs this after astro build.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(ROOT, "dist");
const SITE = process.env.SITE_ORIGIN || "https://fcli.dev";

const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(DIST)) {
  console.error(`check: no dist/ — run astro build first`);
  process.exit(1);
}

// Pages runs Jekyll over the published tree without this marker, which rewrites titles,
// breaks the pretty-URL directories and stops copying llms.txt. Invisible locally.
for (const marker of [".nojekyll", "CNAME"]) {
  if (!existsSync(join(DIST, marker)))
    fail(`dist/${marker} missing — Pages deployment would be misconfigured`);
}

// CNAME is the only thing telling Pages that fcli.dev is this site. An empty or wrong
// file still builds a perfect-looking dist/.
if (existsSync(join(DIST, "CNAME"))) {
  const domain = readFileSync(join(DIST, "CNAME"), "utf8").trim();
  if (domain !== new URL(SITE).hostname)
    fail(`dist/CNAME is "${domain}", expected ${new URL(SITE).hostname}`);
}

const htmlFiles = [];
// The error page is a real HTML file and gets the same head/asset checks as every page,
// but it is deliberately absent from search.json and llms.txt, so it is counted apart.
const ERROR_PAGE = "404.html";
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".html")) htmlFiles.push(full);
  }
})(DIST);

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const url = "/" + file.slice(DIST.length + 1).replaceAll("\\", "/");

  // Pages serves the published root directly, so hand-written asset paths must be
  // root-absolute. Relative ones work at / and 404 at /foo/.
  for (const m of html.matchAll(/<(?:link|script)[^>]*\b(?:href|src)="([^"]+)"/g)) {
    const ref = m[1];
    if (ref.startsWith("/")) {
      if (!existsSync(join(DIST, ref))) fail(`${url}: asset not in dist/ — ${ref}`);
    } else if (!/^(https?:|data:)/.test(ref)) {
      fail(`${url}: relative asset reference breaks at depth — ${ref}`);
    }
  }

  // Empty description/og:description used to ship unnoticed: the layout rendered both
  // from one argument, and dropping that argument left every page with a blank snippet
  // while every other check stayed green.
  if (!/<meta name="description" content="[^"]+"/.test(html))
    fail(`${url}: empty meta description`);
  if (!/<meta property="og:description" content="[^"]+"/.test(html))
    fail(`${url}: empty og:description`);

  // og:image is not an <a href>, so the link checker never inspects it. A card pointing
  // at a missing file is a blank share with no error anywhere.
  const ogImg = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  if (!ogImg) fail(`${url}: no og:image`);
  else if (!ogImg.startsWith(`${SITE}/`))
    fail(`${url}: og:image is not an absolute ${SITE} URL — ${ogImg}`);
  else if (!existsSync(join(DIST, ogImg.slice(SITE.length))))
    fail(`${url}: og:image not in dist/ — ${ogImg}`);
}

// search.json is fetched by assets/app.js at the site root; if it is absent or malformed,
// search silently returns nothing at every keystroke.
const searchPath = join(DIST, "search.json");
if (!existsSync(searchPath)) fail("dist/search.json missing — site search is dead");
else {
  try {
    const rows = JSON.parse(readFileSync(searchPath, "utf8"));
    if (!Array.isArray(rows) || !rows.length) fail("search.json is empty");
    for (const r of rows)
      for (const key of ["url", "title", "summary", "body"])
        if (typeof r[key] !== "string" || !r[key])
          fail(`search.json entry ${r.url ?? "?"} has no ${key}`);
    // Every document is indexed except the error page, which must not be findable:
    // indexing it would let a search for a missing page match the page reporting that
    // nothing matched.
    const indexed = htmlFiles.filter((f) => !f.endsWith(ERROR_PAGE)).length;
    if (rows.length !== indexed)
      fail(`search.json has ${rows.length} entries, dist has ${indexed} documents`);  } catch (e) {
    fail(`search.json is not valid JSON — ${e.message}`);
  }
}

// llms.txt is what agents fetch instead of the HTML; a bad file here is invisible in a
// browser and was historically an HTML error page served at that URL.
const llmsPath = join(DIST, "llms.txt");
if (!existsSync(llmsPath)) fail("dist/llms.txt missing");
else {
  const llms = readFileSync(llmsPath, "utf8");
  if (llms.includes("<!DOCTYPE") || llms.includes("<html"))
    fail("llms.txt contains HTML");
  if (!llms.includes(`${SITE}/`)) fail(`llms.txt has no ${SITE} URLs`);
}

if (problems.length) {
  console.error(`check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check: ok — ${htmlFiles.filter((f) => !f.endsWith(ERROR_PAGE)).length} pages`);
