/**
 * The site's navigation and URL space, in one module, so that the sidebar order,
 * the sidebar labels, the URLs and the routes cannot disagree.
 *
 * WHY THIS EXISTS AS DATA
 *
 * The generator this replaces computed a page's URL in three places — NAV entries,
 * the markdown link rewriter, and the output path — each with its own
 * `startsWith("docs/")`-style branch. They drifted, and the failure was always the
 * same: the build reported success, `/` looked right, and some fraction of internal
 * links pointed at nothing. Encoding the order here once, and deriving everything
 * else, removes the class of bug rather than the instance.
 *
 * The URLs are today's URLs on purpose (see the table in content.config.ts). Adding
 * or renaming a page is an edit to PAGES below plus a content file; nothing else
 * about the URL space is configurable, because every extra knob here has been
 * pulled at least once.
 */

export interface NavSection {
  title: string;
  /** Collection ids (the file name without .md), in sidebar order. */
  items: string[];
}

export const PAGES: NavSection[] = [
  { title: "Start", items: ["index", "install", "quickstart"] },
  { title: "Core", items: ["ucks", "docs/ucks", "config", "skills", "credentials"] },
  { title: "Extend", items: ["extend", "update", "recipes"] },
  { title: "Reference", items: ["builtins", "measurements"] },
];

/**
 * Slug (collection id) -> URL.
 *
 * `index` is the homepage and the only slug whose URL is not `/<id>/`. This is a
 * lookup, not a rule, so the special case is one line and cannot be applied twice —
 * which is exactly what a `clean === "index" ? … : …` expression inside a general
 * URL builder enabled last time.
 */
export function urlFor(slug: string): string {
  return slug === "index" ? "/" : `/${slug}/`;
}

/** Every slug in the site, flattened, in sidebar order. */
export const allSlugs: string[] = PAGES.flatMap((s) => s.items);

/**
 * Slugs rendered by a .astro route rather than a file in src/content/pages.
 *
 * The build asserts that every nav entry has a content file, which is what keeps a dead
 * sidebar link from shipping. That assertion must not demand a .md for a page that is a
 * route on purpose (/ucks/ hosts a component the .md renderer cannot import), so the
 * exceptions are declared here rather than by loosening the check for everything.
 * Adding a slug here without creating src/pages/<slug>.astro produces a 404, which the
 * link checker catches; adding a route without listing it here produces a build error.
 */
export const ROUTE_PAGES: string[] = ["ucks"];

/**
 * Slug -> its section, for the sidebar's grouping and for the <title> of a page.
 *
 * Derived rather than authored so a page cannot be filed under one section in the
 * sidebar and another in the title. Built once at module load; the site is twelve
 * pages and the lookup is a Map either way.
 */
export const SECTION_OF = new Map<string, string>(
  PAGES.flatMap((s) => s.items.map((slug) => [slug, s.title] as const)),
);

/**
 * The <title> for a slug, given its frontmatter title.
 *
 * The homepage's frontmatter title is "Overview", but the tab and og:title have always
 * read "f". The old generator handled this by special-casing the homepage inside
 * pageHead(); this keeps the same output with the special case next to the rest of the
 * URL space. Every other page titles itself from its own frontmatter.
 */
export function titleFor(slug: string, frontmatterTitle: string): string {
  return slug === "index" ? "f" : frontmatterTitle;
}
