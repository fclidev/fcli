/**
 * Copies assets/ into public/ so Astro serves it.
 *
 * WHY AN INTEGRATION AND NOT A `prebuild` SCRIPT
 *
 * Astro serves public/ verbatim and cannot be pointed at another directory. The site's
 * assets have lived in assets/ since before Astro, that is what git tracks, and
 * `astro dev` / `astro build` must work on a clean clone with no extra step — which a
 * prebuild copy does not provide, since running `npx astro build` directly skips npm
 * hooks. public/ is gitignored because it is derived from assets/.
 *
 * Everything the site serves verbatim lives in assets/, including robots.txt and
 * .nojekyll, so there is one directory to look in and the copy below is a plain mirror.
 * A stale public/ is worse than a missing one — a renamed asset would keep serving at
 * its old URL — so files absent from assets/ are deleted rather than left behind.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export default function staticAssets(root: string) {
  return {
    name: "fcli-static-assets",
    hooks: {
      "astro:config:setup": ({ logger }: any) => {
        const src = join(root, "assets");
        const dest = join(root, "public");
        if (!existsSync(src)) throw new Error(`no assets dir at ${src}`);
        mkdirSync(dest, { recursive: true });

        const wanted = readdirSync(src).filter((f) => statSync(join(src, f)).isFile());
        for (const f of wanted) copyFileSync(join(src, f), join(dest, f));

        // CNAME stays at docs/CNAME in the repo (it predates Astro and GitHub Pages
        // reads it from the published root to learn the custom domain), so it is the one
        // served file not living in assets/. Without it the site publishes on
        // fclidev.github.io and fcli.dev stops resolving.
        const cname = join(root, "CNAME");
        if (existsSync(cname)) {
          const domain = readFileSync(cname, "utf8").trim();
          if (!domain) throw new Error(`${cname} is empty`);
          writeFileSync(join(dest, "CNAME"), `${domain}\n`, "utf8");
        } else {
          // Loud, not silent: a missing CNAME still builds a perfect-looking site whose
          // custom domain quietly stops working, which no one notices until fcli.dev is
          // down.
          throw new Error(`missing ${cname}; the custom domain would not be configured`);
        }

        const keep = new Set([...wanted, "CNAME"]);
        for (const f of readdirSync(dest)) {
          if (!keep.has(f)) rmSync(join(dest, f), { force: true });
        }

        logger.info(`assets: mirrored ${wanted.length} file(s) + CNAME into public/`);
      },
    },
  };
}
