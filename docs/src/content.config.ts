import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Every page of the site, in one collection, with the URL computed once in paths()
// rather than inferred from the file location at each callsite. Inferring it at the
// callsite is what produced /docs/docs/config/ four separate times in the generator
// this replaces: `key.startsWith("docs/")` appeared in NAV, in link rewriting and in
// the output path, and the three copies never agreed.
//
// URLs here are the ones fcli.dev serves today, and they are written out explicitly
// so that a rename is a visible edit rather than a silent URL change:
//
//   index.md        -> /            (homepage; content/index.md, not content/index/index.md)
//   ucks.md         -> /ucks/
//   config.md       -> /config/
//   …               -> /<name>/
//
// content/index.md is the only file whose URL is not `/<name>/`. paths() gives it the
// slug "" and src/pages/index.astro renders it at the root; see that file for why the
// catch-all route does not also claim it.
const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  // Relative to the loader base, so "ucks" not "src/content/pages/ucks.md".
  // id is what getEntry/render take; slug is what the route params use.
  schema: z.object({
    title: z.string().min(1),
    // Enforced rather than defaulted. The old generator substituted "the first 150
    // characters of the body" when summary was absent, which is how
    // <meta name="description"> and og:description went blank on every page while
    // the build stayed green: the fallback always produced a string, so the pages
    // that lost their summary looked exactly like the ones that had one. A required
    // minimum-length summary turns that into a build error at the file that caused
    // it. 40 characters is below the shortest real summary in the tree (17 words
    // minimum in the docs style) and above anything accidental.
    summary: z.string().min(40),
    // Only the homepage sets this; it selects the hero layout in Page.astro.
    page: z.enum(["home"]).optional(),
    // Render src/components/Hero.astro above the article. Homepage only.
    hero: z.boolean().default(false),
    // Sidebar and toc are per-page because /measurements/ has no headings worth a toc
    // and would otherwise render an empty aside; the default matches the eleven pages
    // that do.
    toc: z.boolean().default(true),
    /**
     * Overrides `summary` for <meta name="description"> and og:description when the
     * summary is written for the sitemap and reads badly as a search snippet. Optional
     * rather than required: the fallback is the summary, which is always present and
     * always a sentence, so a missing description degrades to something correct rather
     * than to nothing — the failure mode summary itself had.
     */
    description: z.string().min(40).optional(),
    /**
     * Overrides `title` where the file is named for the tree ("index") and the sidebar
     * needs something else. Not used for <title>, which is titleFor() in src/nav.ts.
     */
    navTitle: z.string().min(1).optional(),
  }),
  // Strip the extension and fold index away, so the slug of the homepage is "" and
  // every other slug is its filename. trailingSlash: "ignore" in astro.config means
  // /ucks and /ucks/ are the same page; canonical tags decide which one is real.
});

export const collections = { pages };
