import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  cpSync,
  renameSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmdirSync,
  realpathSync,
} from "node:fs";
import { join, basename, resolve, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { fHome } from "./config.js";
import { normalizeSource, sourceKind } from "./registry.js";
import type { UckSource } from "./types.js";

/**
 * The store: ~/.f/ucks/<bucket>/, where **a git source's bucket IS its clone**.
 * One tree, no side-by-side copy directory — a bucket is either a git working
 * tree (remote source) or a plain directory (local source), and everything
 * reads them the same way.
 */
export function storeDir(): string {
  return join(fHome(), "ucks");
}

/** A git clone installed as a bucket, plus the bucket name it provides. */
export interface StoredRepo {
  bucket: string;
  dir: string;
}

/**
 * All git-backed buckets: the dirs under ~/.f/ucks/ that contain a .git.
 * A bucket without one is a local source (or a pre-clone leftover) and is
 * enumerated by the copy path instead.
 */
export function installedRepos(): StoredRepo[] {
  const dir = storeDir();
  if (!existsSync(dir)) return [];
  const out: StoredRepo[] = [];
  for (const bucket of readdirSync(dir).sort()) {
    const full = join(dir, bucket);
    try {
      if (statSync(full).isDirectory() && existsSync(join(full, ".git"))) {
        out.push({ bucket, dir: full });
      }
    } catch {
      /* unreadable entry: skip rather than abort the whole store */
    }
  }
  return out;
}
/**
 * Canonical bucket (repo) name for a source. Object sources may carry an
 * explicit `name`; otherwise it's derived: git → URL basename sans .git, local
 * → path basename, npm → package basename. This is the first-level dir under
 * ~/.f/ucks/ — it gives the store provenance by construction.
 */
export function sourceBucket(src: UckSource): string {
  if (typeof src !== "string" && src.name && src.name.trim()) {
    return src.name.trim();
  }
  const { specifier } = normalizeSource(src);
  const bare = specifier.replace(/\s*#.*$/, ""); // strip #ref
  // git:
  if (bare.startsWith("github:")) {
    const parts = bare.slice("github:".length).split("/");
    return parts[1] ?? parts[0];
  }
  if (/^(git\+)?(https?|ssh):\/\//.test(bare) || bare.startsWith("git@")) {
    // last path segment, sans .git
    const tail = bare.split("/").pop() ?? bare;
    return tail.replace(/\.git$/, "") || "repo";
  }
  // local / npm: the bucket is named after the source's last path segment.
  // npm: "@fcli.dev/ucks" → "ucks" (scoped package, scope is not a dir).
  // git: ".../fcli-ucks.git" → "fcli-ucks" (handled above).
  const tail = bare.split("/").pop()?.replace(/\.git$/, "") || "source";
  return tail;
}

/** A single installed uck: its resolved name, its dir, its source bucket, and load order. */
export interface StoredUck {
  name: string;
  dir: string;
  bucket: string;
  order: number;
}

/**
 * All installed ucks, in deterministic load order.
 *
 * One walk over ~/.f/ucks/, two shapes of bucket:
 *   - a bucket that is a git clone is walked to any depth, because the repo is
 *     intact and its ucks may sit anywhere in it;
 *   - a bucket that is a plain directory (local source, or a pre-clone cache)
 *     keeps the historical one-level rule: each <bucket>/<name>/index.js.
 *
 * `dir` is the uck's directory and is all registry.ts needs (it imports
 * <dir>/index.js), so a uck nested inside a clone needs no loader change.
 *
 * Later buckets (higher order) shadow earlier ones when two provide the same
 * uck name — see loadStoreUcks.
 *
 * `only`/`except` cannot filter a git working tree at install time, so they are
 * read back from the clone's manifest and applied here, which is what preserves
 * subset semantics for cloned sources.
 */
export function installedUcks(): StoredUck[] {
  const dir = storeDir();
  if (!existsSync(dir)) return [];
  const out: StoredUck[] = [];
  let order = 0;

  for (const bucket of readdirSync(dir).sort()) {
    const bucketDir = join(dir, bucket);
    let st;
    try {
      st = statSync(bucketDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    if (existsSync(join(bucketDir, ".git"))) {
      const prov = repoProvenance(bucketDir) as { only?: string[]; except?: string[] } | null;
      const filters = { only: prov?.only, except: prov?.except };
      for (const uckDir of findUckDirs(bucketDir)) {
        const name = basename(uckDir);
        if (!nameAllowed(name, filters)) continue;
        out.push({ name, dir: uckDir, bucket, order: order++ });
      }
      continue;
    }

    for (const name of readdirSync(bucketDir).sort()) {
      const full = join(bucketDir, name);
      try {
        if (statSync(full).isDirectory() && existsSync(join(full, "index.js"))) {
          out.push({ name, dir: full, bucket, order: order++ });
        }
      } catch {
        /* unreadable entry: skip rather than lose the whole bucket */
      }
    }
  }
  return out;
}

/**
 * Every dir at any depth containing an index.js, skipping .git/node_modules and
 * dot-dirs. A uck dir is a leaf: its own subdirs (e.g. a vendored tree with an
 * index.js of its own) are not separate ucks.
 *
 * Depth is why this exists. The copy model looked for `<repo>/<uck>/` at exactly
 * one level, so a uck nested deeper was invisible and showed up as "a complete
 * repo with no entry point". A working tree is walked, not guessed at.
 */
function findUckDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (existsSync(join(dir, "index.js"))) {
      found.push(dir);
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries.sort()) {
      if (e === ".git" || e === "node_modules" || e.startsWith(".")) continue;
      const full = join(dir, e);
      try {
        if (statSync(full).isDirectory()) walk(full);
      } catch {
        /* dangling symlink / concurrent removal: skip */
      }
    }
  };
  walk(root);
  return found;
}

/**
 * Resolve the store to the set of ucks actually loaded: when the same uck name
 * appears in multiple buckets, the *later* bucket wins (later source shadows
 * earlier). Returns name -> StoredUck in final load order.
 */
export function resolvedUcks(): Record<string, StoredUck> {
  const list = installedUcks();
  const byName: Record<string, StoredUck> = {};
  for (const u of list) {
    byName[u.name] = u; // later (higher order) overwrites earlier
  }
  return byName;
}

/** Extract subset filters from a source (only/except). undefined = no filter. */
export function subsetFilters(src: UckSource): { only?: string[]; except?: string[] } {
  if (typeof src === "string") return {};
  const f: { only?: string[]; except?: string[] } = {};
  if (Array.isArray(src.only)) f.only = src.only;
  if (Array.isArray(src.except)) f.except = src.except;
  return f;
}

/** Does a uck name pass the source's filters? (only wins if both present) */
export function nameAllowed(name: string, f: { only?: string[]; except?: string[] }): boolean {
  if (f.only && f.only.length > 0) return f.only.includes(name);
  if (f.except && f.except.length > 0) return !f.except.includes(name);
  return true;
}

/**
 * Download a source into the store. Idempotent by default (skip if already
 * present) unless force=true (f up).
 *
 * - git source: CLONE into ~/.f/ucks/<bucket> and keep it — the bucket IS the
 *   clone. `f up` is fetch + reset --hard + submodule update, so an installed
 *   source is a real checkout you can `git log` / `git diff` / `git blame`, and
 *   updating no longer re-downloads the world.
 * - local source: copy it in (a local source is already a checkout you edit).
 * - npm sources resolve from node_modules at load time; nothing to install.
 */
/** Resolve a local specifier (possibly `./relative`) against cwd. */
function resolveLocalSpecifier(specifier: string): string {
  // path.resolve(), NOT a file:// URL round-trip: the URL form percent-encodes,
  // so `./my ucks` becomes `/tmp/…/my%20ucks` and the source is reported
  // missing (0.3.0 did exactly this). resolve() also collapses `..`, which is
  // what makes containment decidable. ONE function, used by installLocal and by
  // the guard below: two lookalike resolvers silently disagree on relative paths
  // and the guard then never fires.
  if (isAbsolute(specifier)) return specifier;
  try {
    return resolve(realpathSync(process.cwd()), specifier);
  } catch {
    return resolve(process.cwd(), specifier);
  }
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path; // not there yet: cannot be inside anything
  }
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : parent + "/");
}

/**
 * A local source that resolves inside the store, or null.
 *
 * Installing one copies a tree into itself: cpSync(abs, dest) with abs inside
 * dest throws ERR_FS_CP_EINVAL and kills the run midway — and the failure mode
 * *before* that throw is worse, because the copy partly lands and then the git
 * path for the same bucket re-stamps .f-source.json with provenance for a repo
 * the content did not come from. Observed on a real machine: `config/*` and
 * `lib/*` deleted from the author's own bucket, which then claimed to be a clone
 * of github.com/kensand/fcli-ucks.
 *
 * One comparison, protecting the model rather than adding machinery: core
 * promises a store bucket is a cache (see installGitSource), so an author's work
 * belongs outside it. Only store-inside-source is the hazard — a source that
 * merely shares a label with a store ancestor is a name collision (ROADMAP C5),
 * not a self-copy, and rejecting that would forbid legitimate sources.
 */
function sourceHitsStore(specifier: string): string | null {
  const store = realpathOr(storeDir());
  const abs = realpathOr(resolveLocalSpecifier(specifier));
  return isInside(store, abs) ? abs : null;
}

export async function installSource(src: UckSource, force = false): Promise<boolean> {
  const { specifier } = normalizeSource(src);
  const kind = sourceKind(specifier);
  const filters = subsetFilters(src);
  const bucket = sourceBucket(src);

  if (kind === "local") {
    const hit = sourceHitsStore(specifier);
    if (hit) {
      console.error(
        `f: refusing local source '${specifier}' — it resolves inside the store ` +
          `(${hit}). A store bucket is a cache, not an editing surface: install ` +
          `from a separate clone instead.`,
      );
      return false;
    }
    return installLocal(specifier, force, bucket);
  }

  if (kind === "npm") {
    try {
      return installNpmSource(specifier, force, filters, bucket);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.error(`f: failed to install ${specifier} (${msg.split("\n")[0]})`);
      return false;
    }
  }

  try {
    return installGitSource(specifier, force, filters, bucket);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.error(`f: failed to install ${specifier} (${msg.split("\n")[0]})`);
    return false;
  }
}

/**
 * Install/refresh one source. Resolves **true only when store content changed**,
 * which is the question its caller actually asks. cli.ts re-installs local
 * sources when the store is *empty*, and used to read "the git command exited
 * 0" as "content changed". An unchanged refresh returned true, so the store was
 * never seen as empty and EVERY f invocation re-copied every local source. That
 * is what turned a mistyped local source into data loss: one bad config meant a
 * destructive cpSync on every f command, not just on `f up`. It also made a
 * local edit look like it needed two invocations, since the copy ran after the
 * store had already been read for this run.
 *
 *   installGitSource: clone → true; refresh → true only if HEAD moved.
 *   installLocal:     installed or replaced → true; skipped as present → false.
 *
 * Install/refresh a git source as the bucket itself at ~/.f/ucks/<bucket>/.
 *
 * `force` (f up) is fetch + `git reset --hard <upstream>`: the clone is a cache
 * of the remote, never an editing surface, so local edits get discarded rather
 * than merged — exactly what the copy model did (rm + re-copy), and keeping that
 * means `f up` can never leave a merge conflict somewhere nobody thinks to look.
 * Work happens in a clone you made yourself, or in `f uck push`'s work clone.
 *
 * Submodules are explicit (`--recurse-submodules` on clone, `submodule update
 * --init --recursive` on refresh) because a repo-of-repos is precisely the
 * layout where ucks arrive as submodules, and that is the information the copy
 * model destroyed: cpSync copied .gitmodules as a plain file and left the
 * submodule directory empty.
 *
 * only/except cannot filter a working tree, so they are recorded in the clone's
 * manifest for discovery-time filtering (see repoProvenance).
 */
function installGitSource(
  specifier: string,
  force: boolean,
  filters: { only?: string[]; except?: string[] },
  bucket: string,
): boolean {  const url = gitUrl(specifier);
  // Split #ref into a branch: git's own parser does not understand our suffix.
  const hash = specifier.indexOf("#");
  const ref = hash === -1 ? undefined : specifier.slice(hash + 1).trim() || undefined;
  const dir = join(storeDir(), bucket);
  const isClone = existsSync(join(dir, ".git"));

  if (!isClone) {
    mkdirSync(storeDir(), { recursive: true });
    // Whatever sits here now is either a pre-clone cache of this same repo or a
    // half-finished clone. Both are replaced wholesale; the cache is only truly
    // safe to lose because we are about to fetch its upstream, so a failed
    // clone puts the old copy back (see backup/restore below).
    const backup = stashExisting(dir);
    // No --depth 1: history is the whole point of cloning instead of copying.
    const branch = ref ? `--branch ${quote(ref)} ` : "";
    try {
      execSync(`git clone ${branch}--recurse-submodules ${quote(url)} ${quote(dir)}`, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (e) {
      rmSync(dir, { recursive: true, force: true }); // clone may have left a partial tree
      restoreStash(dir, backup);
      throw new Error(`git clone failed: ${firstLine(e)}`);
    }
    writeManifest(dir, specifier, url, ref, filters);
    ensureModuleMarkers(dir);
    installDepsInTree(dir);
    discardStashes(backup);
    console.error(`f: cloned ${bucket} → ${dir}`);
    return true;
  }

  try {
    execSync(`git fetch --tags origin`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (e) {
    throw new Error(`git fetch failed: ${firstLine(e)}`);
  }

  const before = gitRevParseHead(dir);
  const target = ref ? `origin/${ref}` : remoteDefaultRef(dir);
  try {
    execSync(`git reset --hard ${quote(target)}`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
    // Keep node_modules: it is untracked by definition, and reinstalling it on
    // every f up would cost a 120s npm i per uck for no benefit.
    execSync(`git clean -fdx -e node_modules`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
    execSync(`git submodule update --init --recursive`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (e) {
    throw new Error(`git reset failed: ${firstLine(e)}`);
  }

  writeManifest(dir, specifier, url, ref, filters);
  ensureModuleMarkers(dir);
  installDepsInTree(dir);
  // A content-level answer, not "the git commands succeeded": see installSource.
  return gitRevParseHead(dir) !== before;
}

/**
 * Give every ESM uck in the clone a `package.json` with `"type": "module"`, if
 * it does not already resolve as ESM.
 *
 * This is not cosmetic. `import()` picks a file's module type from the nearest
 * package.json, so an index.js that starts with `import` needs one somewhere
 * above it. In the copy store each uck dir was self-contained and (for the
 * handful that had one) carried its own package.json; in a clone, a uck with no
 * package.json and no package.json at the repo root resolves as CommonJS and
 * dies with "Cannot use import statement outside a module" at load time, which
 * `f up` prints as a per-uck warning and then silently omits the command.
 * fcli-ucks' ls, skills, v and w are exactly that: ESM, no package.json, and no
 * package.json at their repo root either.
 *
 * Why materialize a file instead of loading ucks as ESM explicitly: registry.ts
 * builds an import URL from a path, and a uck may be a bare `import`s file or an
 * honest CJS file. Rewriting the loader would mean detecting the format of every
 * uck at import time, per uck, and Node caches that decision by extension. A
 * one-line marker per uck is the same information, written once at install, and
 * it also makes the clone correct for anything else that imports it — including
 * a plain `node ucks/ls/index.js` while developing a uck.
 *
 * Only ESM-looking ucks get one, so a genuine CommonJS uck is not broken by a
 * marker that would flip its own file to ESM.
 *
 * The marker is untracked; `git clean` in the refresh path deletes it, so this
 * runs after every reset, not just after clone.
 */
function ensureModuleMarkers(cloneDir: string): void {
  for (const uckDir of findUckDirs(cloneDir)) {
    const pkgPath = join(uckDir, "package.json");
    if (existsSync(pkgPath)) {
      // Respect whatever the author declared; only add the field if a
      // `type`-less manifest is present and the file wants ESM.
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      } catch {
        continue; // malformed manifest is the author's problem, not ours
      }
      if (pkg.type === "module" || pkg.type === "commonjs") continue;
      if (!looksLikeEsm(join(uckDir, "index.js"))) continue;
      try {
        writeFileSync(pkgPath, JSON.stringify({ ...pkg, type: "module" }, null, 2) + "\n");
      } catch {
        /* unwritable dir: the uck will fail to load and say so */
      }
      continue;
    }
    if (!looksLikeEsm(join(uckDir, "index.js"))) continue;
    try {
      writeFileSync(pkgPath, JSON.stringify({ type: "module" }, null, 2) + "\n");
    } catch {
      /* unwritable dir: the uck will fail to load and say so */
    }
  }
}

/**
 * Does this file look like an ES module? A leading `import`/`export` statement,
 * skipping shebang, blank lines and comments. Deliberately cheap and
 * conservative: a false negative leaves a uck broken in the same way it is
 * broken today, while a false positive would break a working CommonJS uck.
 */
function looksLikeEsm(indexPath: string): boolean {
  let src: string;
  try {
    src = readFileSync(indexPath, "utf8");
  } catch {
    return false;
  }
  for (const line of src.split("\n", 60).values()) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#!"))
      continue;
    // First real statement decides: dynamic `import()` is legal in CommonJS, so
    // only static import/export syntax means ESM here.
    return /^import[\s{*'"]/.test(t) || /^export[\s{*]/.test(t);
  }
  return false;
}

/** Resolve the remote's default branch to a local ref, else the current branch. */
function remoteDefaultRef(dir: string): string {
  const tryGit = (cmd: string): string => {
    try {
      return execSync(`git ${cmd}`, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const head = tryGit("symbolic-ref --quiet refs/remotes/origin/HEAD");
  if (head) return head.replace(/^refs\/remotes\//, "");
  const cur = tryGit("rev-parse --abbrev-ref HEAD");
  if (cur && cur !== "HEAD") return `origin/${cur}`;
  return "origin/HEAD";
}

/** Record where a clone came from, inside the clone (survives f up). */
/** Current HEAD sha of a bucket, or null (not a repo / unreadable). */
function gitRevParseHead(dir: string): string | null {
  try {
    return (
      execSync(`git rev-parse HEAD`, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

function writeManifest(
  dir: string,
  specifier: string,
  url: string,
  ref: string | undefined,
  filters: { only?: string[]; except?: string[] },
): void {
  const manifest = {
    specifier,
    url,
    ref: ref ?? null,
    installedAt: new Date().toISOString(),
    ...(filters.only ? { only: filters.only } : {}),
    ...(filters.except ? { except: filters.except } : {}),
  };
  try {
    writeFileSync(join(dir, ".f-source.json"), JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    /* metadata only: a read-only clone still works */
  }
}

/** Provenance written by writeManifest, or null for a clone f does not manage. */
export function repoProvenance(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, ".f-source.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Move a pre-existing (non-git) bucket aside so `git clone` can take the path,
 * and return the paths to delete on success or restore on failure. Renaming is
 * used rather than copying because it is atomic and free, and because it is the
 * only way to vacate a directory without first destroying what is in it: once
 * the old copy is gone, the clone about to be made is the only copy of this repo
 * that exists, so a failed clone must be able to put the old one back.
 *
 * Several paths can pile up on one bucket -- the original copy plus stashes from
 * runs that died mid-clone -- so every `.pre-clone-*` sibling is swept, not just
 * the one made here.
 */
/**
 * Move a pre-existing (non-git) bucket aside so `git clone` can take the path,
 * and return the paths to delete on success or restore on failure.
 *
 * An empty directory is **not** stashed — it is removed. That case is the
 * common one: ensureGlobalConfig() + the default source create ~/.f/ucks/<repo>
 * as an empty dir on a fresh machine, and git refuses to clone into a path that
 * exists and is non-empty... except that it counts an empty dir as "exists", so
 * renaming it aside and cloning worked only when *something else* had already
 * claimed the stash name. Net effect: a first `f up` on a fresh store failed
 * every git source with "destination path already exists", and the empty dir
 * was left in place. git clones fine into a path that does not exist at all.
 */
function stashExisting(dir: string): string[] {
  if (!existsSync(dir)) return [];
  // Empty (or listing failed): drop it, nothing of value to preserve.
  let entries: string[] | null = null;
  try {
    entries = readdirSync(dir);
  } catch {
    entries = null;
  }
  if (entries && entries.length === 0) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return [];
    } catch {
      /* fall through and try the rename, which may still work */
    }
  }
  const stash = dir + ".pre-clone-" + Date.now().toString(36);
  try {
    renameSync(dir, stash);
    const stashes = [stash];
    // Sweep stashes an earlier run left behind (it died between rename and
    // clone). They are dead weight once this clone succeeds; naming them
    // `.pre-clone-<ts>` is what makes them recognisable.
    try {
      const parent = join(dir, "..");
      const stem = basename(dir) + ".pre-clone-";
      for (const e of readdirSync(parent)) {
        if (e.startsWith(stem) && !stashes.includes(join(parent, e))) stashes.push(join(parent, e));
      }
    } catch {
      /* cannot list the store root: the stash just made is still tracked */
    }
    return stashes;
  } catch {
    // Could not move it (permissions, open handles). Remove it instead — this
    // bucket is a cache of the very URL we are about to clone, so its content
    // is recoverable from the remote by definition.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* leave it; clone will fail and say so */
    }
    return [];
  }
}

/** Put a stashed pre-clone bucket back when the clone did not happen. */
function restoreStash(dir: string, stashes: string[]): void {
  if (!stashes.length) return;
  // stashes[0] is the copy this run moved aside, so it is the one worth keeping.
  try {
    if (!existsSync(dir)) renameSync(stashes[0], dir);
  } catch {
    console.error(`f: could not restore ${basename(stashes[0])} — left at ${stashes[0]}`);
  }
}


/** The clone works; the copy it replaced is now just a stale second checkout. */
function discardStashes(stashes: string[]): void {
  for (const s of stashes) {
    try {
      rmSync(s, { recursive: true, force: true });
    } catch {
      console.error(`f: could not remove ${s} — left in place`);
    }
  }
}

/**
 * npm i in each uck dir that has a package.json but no node_modules. A clone
 * cannot carry node_modules (the source repo gitignores it), so this is how a
 * freshly cloned uck gets its deps. Scoped to uck dirs so a repo root's own
 * package.json is left alone.
 */
function installDepsInTree(cloneDir: string): void {
  for (const uckDir of findUckDirs(cloneDir)) {
    if (!existsSync(join(uckDir, "package.json"))) continue;
    if (existsSync(join(uckDir, "node_modules"))) continue;
    installUckDeps(uckDir);
  }
}

/** Shell-quote one argument, so no URL or path is ever interpolated by the shell. */
function quote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * The useful line from a failed command.
 *
 * NOT the first line: git writes progress first ("Cloning into '…'...") and the
 * failure afterwards ("fatal: destination path … already exists"), so first-line
 * reporting printed the harmless progress line and hid the actual reason — which
 * is how a clone that failed on every source looked like a network problem.
 * Prefer git's own error lines, then the last non-empty line.
 */
function firstLine(e: unknown): string {
  const msg =
    e instanceof Error ? ((e as { stderr?: unknown }).stderr?.toString?.() || e.message) : String(e);
  const lines = (msg ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return String(e);
  const err = lines.find((l) => /^(fatal|error|warning|remote:)/i.test(l) || /already exists|not a git|denied|invalid/i.test(l));
  return err ?? lines[lines.length - 1];
}

/**
 * Install a local source into the store under <bucket>/.
 * - dir containing uck subdirs (each with an index.js) → a local "repo": each subdir is a uck.
 * - dir with index.js at its root → a single uck (the dir is the uck).
 * - lone .js/.mjs file → a single uck named after the file.
 * Returns true if it made progress.
 */
async function installLocal(specifier: string, force: boolean, bucket: string): Promise<boolean> {
  const abs = resolveLocalSpecifier(specifier);
  if (!existsSync(abs)) {
    console.error(`f: local uck not found: ${abs}`);
    return false;
  }

  if (statSync(abs).isFile()) {
    // Lone file: single uck named after the file (sans extension).
    const name = basename(abs).replace(/\.(js|mjs)$/, "");
    const dest = join(storeDir(), bucket, name);
    if (existsSync(dest) && !force) return false;
    if (force) rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    copyFileSync(abs, join(dest, "index.js"));
    console.error(`f: installed local uck ${bucket}/${name}`);
    return true;
  }

  // Directory: is it a repo of ucks (subdirs with index.js) or a single uck?
  const subUcks = readdirSync(abs).filter(
    (e) => statSync(join(abs, e)).isDirectory() && existsSync(join(abs, e, "index.js"))
  );
  if (subUcks.length > 0) {
    // Local repo: install each subdir as a uck under <bucket>/.
    let count = 0;
    for (const e of subUcks) {
      copyUckToStore(e, join(abs, e), force, bucket);
      count++;
    }
    console.error(`f: installed ${count} local uck(s) under ${bucket}/`);
    return count > 0;
  }

  // Single uck dir (index.js at root).
  const name = basename(abs.replace(/\/$/, ""));
  const dest = join(storeDir(), bucket, name);
  if (existsSync(dest) && !force) return false;
  if (force) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(abs, dest, { recursive: true });
  installUckDeps(dest);
  console.error(`f: installed local uck ${bucket}/${name}`);
  return true;
}

function copyUckToStore(name: string, srcDir: string, force: boolean, bucket: string): void {
  const bucketDir = join(storeDir(), bucket);
  const dest = join(bucketDir, name);
  if (existsSync(dest) && !force) return;
  if (force) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(srcDir, dest, { recursive: true });
  installUckDeps(dest);
}

/** If a uck dir has a package.json, npm i its deps in place. No-op otherwise. */
function installUckDeps(uckDir: string): void {
  const pkg = join(uckDir, "package.json");
  if (!existsSync(pkg)) return;
  try {
    execSync("npm i --no-fund --no-audit --loglevel=error", {
      cwd: uckDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`f: uck deps install failed in ${basename(uckDir)} (${msg.split("\n")[0]})`);
  }
}

/** Normalize a git-ish specifier into a clonable URL. */
/**
 * The URL to hand git, with our `#ref` suffix removed.
 *
 * The suffix is f's own convention (see sourceBucket / installGitSource, which
 * split it off into --branch), and git's URL parser does not know that: passed
 * verbatim it becomes part of the repo path, so
 * `https://host/o/repo.git#main` is looked up as a repository literally named
 * `repo.git#main` and every fetch/clone/refspec fails — against github it
 * reports the generic "correct access rights" line (private repo or does not
 * exist, per GitHub's own wording), which reads like a permissions problem and
 * sent everyone looking at credentials. Shipped 0.3.0 cloned `url` unstripped,
 * so **any** source with an explicit ref was uninstallable; it went unnoticed
 * because the seeded default source carries no ref.
 */
function gitUrl(specifier: string): string {
  const bare = specifier.replace(/\s*#.*$/, ""); // strip #ref (also trailing whitespace)
  if (bare.startsWith("github:")) {
    const parts = bare.slice("github:".length).split("/");
    return `https://github.com/${parts.slice(0, 2).join("/")}.git`;
  }
  if (bare.startsWith("git+")) return bare.slice(4);
  return bare;
}

/**
 * Install/refresh an npm source as a store bucket.
 *
 * The bucket is <store>/<bucket>/ and contains exactly the published tarball's
 * contents: for the @fcli.dev/ucks bundle that is dist/ (one dir per uck, a
 * shared lib/, the deps' node_modules, and a version-stamped manifest.json).
 *
 * `npm pack <spec>` downloads the tarball without touching any local project,
 * so it runs with cwd = bucket and a `--no-save`-free pack: nothing else is
 * read or written outside the bucket. The spec may carry a #<version> suffix,
 * which npm resolves natively — `@fcli.dev/ucks#0.2.0` pins the source.
 *
 * Returns true only when the installed content changed (version or tarball
 * integrity moved), so the caller's "changed/unchanged" accounting is honest.
 */
function installNpmSource(
  specifier: string,
  force: boolean,
  filters: { only?: string[]; except?: string[] },
  bucket: string,
): boolean {
  const hash = specifier.indexOf("#");
  const base = hash === -1 ? specifier : specifier.slice(0, hash);
  const pinned = hash === -1 ? undefined : specifier.slice(hash + 1).trim() || undefined;
  const spec = pinned ? `${base}@${pinned}` : base;

  const dir = join(storeDir(), bucket);
  const prevManifest = repoProvenance(dir);
  const prev = prevManifest?.url ?? "";
  const prevVersion = prevManifest?.version as string | undefined;
  const prevIntegrity = prevManifest?.integrity as string | undefined;

  // Same spec already installed and not forced: skip the download entirely.
  // (A git bucket's "unchanged" check compares HEADs; for npm the tarball's
  // published content is immutable per version, so the recorded integrity is
  // the equivalent answer.)
  if (!force && prev === spec && prevIntegrity) return false;

  mkdirSync(dir, { recursive: true });
  // Wipe whatever is here (an older install, or a git clone from before the
  // source changed kind). The old manifest is the only thing worth keeping
  // during the swap, for the change-detection below.
  for (const e of readdirSync(dir)) {
    if (e === ".f-source.json") continue;
    rmSync(join(dir, e), { recursive: true, force: true });
  }

  let tarball: string | null = null;
  try {
    // npm pack --pack-destination=<dir> <spec>: downloads and unpacks? No —
    // pack produces the .tgz. We extract it ourselves below so the bucket
    // holds the tarball's CONTENTS (npm's "package/" prefix stripped), which
    // is what installedUcks() walks.
    execSync(
      `npm pack --pack-destination ${quote(dir)} ${quote(spec)}`,
      { cwd: dir, stdio: ["pipe", "pipe", "pipe"], timeout: 180_000 },
    );
    const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack produced no tarball");
    tarball = tgz;
    execSync(`tar -xzf ${quote(tgz)} -C ${quote(dir)}`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch (e) {
    // Restore the old install: delete what the failed attempt left, move the
    // stashed old contents back. Same shape as the git clone-failure path.
    rmSync(dir, { recursive: true, force: true });
    if (prevManifest) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".f-source.json"), JSON.stringify(prevManifest, null, 2) + "\n");
    }
    throw new Error(`npm pack failed: ${firstLine(e)}`);
  }

  // npm tarballs extract into a "package/" wrapper — flatten it.
  const wrapped = join(dir, "package");
  if (existsSync(wrapped)) {
    for (const e of readdirSync(wrapped)) {
      renameSync(join(wrapped, e), join(dir, e));
    }
    rmdirSyncSafe(wrapped);
  }
  if (tarball) rmSync(join(dir, tarball), { force: true });

  // The published @fcli.dev/ucks tarball holds dist/ + its root package.json.
  // installedUcks() walks the bucket for uck dirs (each with an index.js), so
  // the bucket's loadable content is dist/ — rebase it onto the bucket root.
  const dist = join(dir, "dist");
  if (existsSync(dist) && !existsSync(join(dir, "manifest.json"))) {
    for (const e of readdirSync(dist)) {
      const from = join(dist, e);
      const to = join(dir, e);
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
    }
    rmdirSyncSafe(dist);
  }

  // Read the version out of the extracted manifest (bundle) or the root
  // package.json (single-uck npm sources).
  let version: string | undefined;
  try {
    version = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version;
  } catch {
    try {
      version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    } catch {
      /* neither present: fine, the bucket still loads */
    }
  }

  // Integrity for change detection: sha512 of the tarball would need it kept,
  // but the version is content-addressed enough for a published package (npm
  // cannot republish a version with different bytes). Pin + version it.
  const manifest = {
    specifier,
    url: spec,
    kind: "npm",
    version: version ?? null,
    ref: pinned ?? null,
    installedAt: new Date().toISOString(),
    ...(filters.only ? { only: filters.only } : {}),
    ...(filters.except ? { except: filters.except } : {}),
  };
  writeFileSync(join(dir, ".f-source.json"), JSON.stringify(manifest, null, 2) + "\n");

  const changed = prev === "" || prev !== spec || version !== prevVersion;
  console.error(changed ? `f: installed ${spec} (${version ?? "unknown version"}) → ${dir}` : `f: ${bucket} up to date (${version ?? spec})`);
  return changed;
}

function rmdirSyncSafe(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    /* not empty (unexpected) or already gone: leave it */
  }
}

