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
  { title: "Core", items: ["docs/ucks", "docs/config", "docs/skills", "docs/credentials"] },
  { title: "Extend", items: ["docs/extend", "docs/update", "docs/recipes"] },
  { title: "Reference", items: ["docs/builtins", "docs/measurements"] },
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
 * Pages that exist and are published but are deliberately absent from the sidebar.
 *
 * /ucks/ is one: it is the npm package listing, and the sidebar is the documentation
 * tree, so a catalogue of packages would be a different kind of thing in the same list.
 * It is reached from the homepage instead.
 *
 * Declaring it here is not just bookkeeping. The orphan check exempts ROUTE_PAGES from
 * "every content file is reachable from the sidebar", which means nothing would notice
 * if the homepage stopped linking it either — the page would quietly become reachable
 * only by guessing the URL. UNLINKED_PAGES tells the build where to look for that link,
 * so dropping it from the homepage is a build error rather than an invisible orphan.
 */
export const UNLINKED_PAGES: { slug: string; linkedFrom: string }[] = [
  { slug: "ucks", linkedFrom: "index" },
];

/**
 * Sidebar label per slug.
 *
 * Lives here, next to PAGES, rather than in whichever route needs it. Two route pages
 * (/ucks/ and /404/) need the label map and cannot read titles from the content
 * collection at module scope; when the first of them grew a local copy, the slugs in
 * that copy went stale on the next page move and the sidebar rendered "docs/config"
 * instead of "Config" — visibly, on every page. Keying off PAGES means a moved page
 * cannot have a label that disagrees with its own location, and a missing entry is the
 * only remaining failure mode, which ALL_TITLES surfaces by falling back to the slug.
 */
export const LABELS: Record<string, string> = {
  index: "Overview",
  install: "Install",
  quickstart: "Quickstart",
  ucks: "Ucks",
  "docs/ucks": "Uck contract",
  "docs/config": "Config",
  "docs/skills": "Skills",
  "docs/credentials": "Credentials",
  "docs/extend": "Extend",
  "docs/update": "Update",
  "docs/recipes": "Recipes",
  "docs/builtins": "Builtins",
  "docs/measurements": "Measurements",
};

/**
 * The full slug -> label map the sidebar renders on every page.
 *
 * Built from PAGES, not from LABELS, so a page added to the sidebar without a label
 * still appears (labelled by its slug, which is ugly but not missing) rather than
 * silently vanishing from navigation.
 */
export function allTitles(entries: { id: string; data: { title: string } }[]) {
  const fromContent = Object.fromEntries(
    entries.map((e) => [e.id.replace(/\.md$/, ""), e.data.title]),
  );
  return Object.fromEntries(
    allSlugs.map((s) => [s, LABELS[s] ?? fromContent[s] ?? s]),
  );
}

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
