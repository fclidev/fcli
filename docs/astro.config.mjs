import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { satteri } from "@astrojs/markdown-satteri";
import betterLinks from "astro-better-link-checker";
import staticAssets from "./src/integrations/static-assets.ts";
import siteIndex from "./src/integrations/site-index.ts";

// The site is published by GitHub Pages from the docs/dist artifact (see
// .github/workflows/docs.yml), which is served at the domain root. `site` feeds
// @astrojs/sitemap and any canonical URL; there is no `base`, because the site
// owns the root of fcli.dev and /docs/ is an ordinary content directory, not a
// deployment prefix. Do not reintroduce a SITE_BASE-style env var: the last time
// this repo carried one, build.js and check.js disagreed about whether it moved
// files or only URLs, and every combination shipped something broken.
export default defineConfig({
  site: process.env.SITE_ORIGIN || "https://fcli.dev",
  output: "static",
  trailingSlash: "ignore",
  build: {
    format: "directory",
    // Content-hashed asset URLs are the current site's cache strategy; Astro's
    // default `discrete` chunks get the same effect via immutable caching.
    inlineStylesheets: "auto",
  },
  markdown: {
    // Keep the apostrophes and dashes exactly as the .md files spell them. Sätteri
    // smartens punctuation by default, which rewrote 47 straight apostrophes across the
    // site ("project's" -> "project’s") without touching a single source file — so
    // what you read in the repo would not be what ships, and a reader copying an
    // apostrophe out of prose gets a character their shell will not match.
    // See the satteri() call below for why smart punctuation is off.
    processor: satteri({ features: { smartPunctuation: false } }),
    shikiConfig: {
      themes: { light: "github-dark", dark: "github-dark" },
      // A single transformer that deletes the theme's background from the <pre>, and
      // nothing else. Why only that:
      //
      // The inline `color:` Shiki puts on each token span is harmless — it is the
      // highlighting, and it is the first working syntax colour this site has ever had
      // (the previous generator emitted <code class="hljs undefinedjs"> with no token
      // spans at all, and its stylesheet's eleven .hljs-* rules matched nothing).
      //
      // The background is different. style.css declares pre { background: var(--code-bg) }
      // — #14171a, the site's own near-black, re-tokened under prefers-contrast — and an
      // inline background-color on the element beats that declaration on specificity.
      // Left alone, every code block on every page would silently shift to GitHub grey
      // and stop tracking the token. So the background goes, and nothing else does.
      //
      // Attempting this with shikiConfig alone is a trap worth recording: `theme` with
      // defaultColor:false produced inline colours anyway, and `themes` with
      // defaultColor:false produced --shiki-light/--shiki-dark variables on every span
      // (the same colour twice, since both name github-dark) and no tok-* classes.
      // Neither combination yielded what the option names imply. This transformer is
      // verifiable instead: grep dist/ for background-color and it must not appear
      // inside a pre.astro-code.
      transformers: [
        {
          name: "fcli:transparent-code-surface",
          pre(node) {
            const el = node;
            if (el.type !== "element") return;
            const style = el.properties?.style;
            if (typeof style !== "string") return;
            // Strip every background declaration, including the --shiki-*-bg custom
            // properties the dual-theme output sets on the element.
            const kept = style
              .split(";")
              .map((d) => d.trim())
              .filter(
                (d) => d && !/^(-webkit-)?background(-color)?\s*:/i.test(d) && !/^--shiki-[a-z]+-bg\s*:/i.test(d),
              )
              .join("; ");
            el.properties.style = kept ? kept + ";" : undefined;
            if (el.properties.style === undefined) delete el.properties.style;
          },
        },
      ],
    },
  },
  integrations: [
    staticAssets(process.cwd()),
    siteIndex(),
    sitemap({
      // The homepage is emitted at / and, for backwards compatibility, also at
      // /docs/; only the canonical location belongs in the sitemap.
      filter: (page) => !/\/docs\/$/.test(page),
    }),
    // Fails the build when an internal href in the built HTML does not resolve to
    // a built page or a real file. This is the reason the framework swap is safe:
    // Astro itself reports 0 errors on a tree with a bogus /does-not-exist/ href
    // and an unconverted ./ucks.md, and `astro check` also reports 0 errors.
    // Verified 2026-10-18 against astro 7.4.0 / this plugin v1.0.1, and it is the
    // only tested plugin that also checks #fragment targets against real heading
    // ids — which is how /ucks/#shadowing sat pointing at a nonexistent heading
    // without anything noticing.
    betterLinks(),
  ],
});
