/**
 * Emits search.json and llms.txt from the built HTML.
 *
 * Reads dist/ rather than the content collection because an integration is loaded while
 * Astro parses astro.config.mjs, before the content layer exists — importing
 * `astro:content` here fails the config load. Reading the shipped pages has a bonus:
 * the index cannot describe a page that did not render, and cannot omit one that did.
 *
 * search.json shape is fixed by assets/app.js: [{ url, title, summary, body }], matched
 * case-insensitively over title + summary + body. A missing field is not a crash, it is
 * a page that silently stops matching on it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Per-page body cap, as the previous index had. Long pages are clipped, not dropped. */
const BODY_LIMIT = 4000;

/**
 * Routes that are not documents: emitted by the build, but not something to search for
 * or hand to an agent as "the site". 404.html is the page you get when the answer is
 * that nothing matched, so putting it in the index would let a search for a missing page
 * match the page that reports it missing — and llms.txt would offer it as content.
 * Its reported pathname is "404/" while the emitted file is dist/404.html, so it is
 * filtered out before the read below, which would look for a nonexistent
 * dist/404/index.html.
 */
const NOT_PAGES = ["404"];

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Tags become spaces so adjacent words never glue (a code block is many spans). */
function textOf(html: string) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export default function siteIndex() {
  return {
    name: "fcli-site-index",
    hooks: {
      "astro:build:done": async ({ dir, pages }: any) => {
        const out = dir.pathname;
        const origin = (process.env.SITE_ORIGIN ?? "https://fcli.dev").replace(/\/$/, "");

        const docs = pages
          .filter((p) => !NOT_PAGES.includes(p.pathname.replace(/\/$/, "")))
          .map((p: { pathname: string }) => {
            // pathname is a route: "ucks/", and "" for the homepage.
            const url = p.pathname === "" ? "/" : `/${p.pathname}`;
            const html = readFileSync(join(out, p.pathname, "index.html"), "utf8");
            // Article only — sidebar, toc and footer are identical on every page and
            // would dominate every match.
            const article = /<article>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
            return {
              url,
              title: decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ""),
              // The page's own description, so the index agrees with the snippet a
              // search engine shows instead of recomputing it.
              summary: decode(
                /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "",
              ),
              text: textOf(article),
            };
          })
          .sort((a, b) => a.url.localeCompare(b.url));

        writeFileSync(
          join(out, "search.json"),
          JSON.stringify(
            docs.map((d) => ({
              url: d.url,
              title: d.title,
              summary: d.summary,
              body: d.text.slice(0, BODY_LIMIT),
            })),
          ) + "\n",
          "utf8",
        );

        // llms.txt: title, canonical URL, then text — the previous file's shape.
        writeFileSync(
          join(out, "llms.txt"),
          docs.map((d) => `# ${d.title}\n${origin}${d.url}\n\n${d.text}\n`).join("\n"),
          "utf8",
        );
      },
    },
  };
}
