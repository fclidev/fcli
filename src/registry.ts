import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { clampDesc, satisfiesMinF, CONTRACT_VERSION, type Uck, type UckRegisterContext, type UckModule, type UckSource } from "./types.js";
import { installedUcks, resolvedUcks } from "./store.js";

const require = createRequire(import.meta.url);

/** Normalize a UckSource to a specifier string. */
export function normalizeSource(src: { source: string; ref?: string } | string): { label: string; specifier: string } {
  if (typeof src === "string") {
    return { label: src, specifier: src };
  }
  const ref = src.ref ? `#${src.ref}` : "";
  return { label: `${src.source}${ref}`, specifier: `${src.source}${ref}` };
}

/** Classify a specifier: local path, git, or npm. */
export function sourceKind(specifier: string): "local" | "git" | "npm" {
  // git FIRST. installGitSource clones any URL git itself accepts, and that
  // includes file:///…/repo.git — so file:// must be classified here, or it
  // falls through to npm resolution: "f: file:///…: not in node_modules
  // (run npm i file:///…)" for a git URL that git could clone happily. Same
  // reason for the other local transports git understands.
  if (/^(git\+|file):\/\//.test(specifier) || /^ssh:\/\//.test(specifier) || /^(https?|ftps?):\/\//.test(specifier)) return "git";
  if (specifier.startsWith("github:") || specifier.startsWith("git@")) return "git";
  if (isAbsolute(specifier) || specifier.startsWith("./") || specifier.startsWith("../")) return "local";
  return "npm";
}

/** Resolve a uck entry (a file URL string) to a dynamic-import URL. */
function toImportUrl(entry: string): string {
  if (entry.startsWith("file://")) return entry;
  const abs = isAbsolute(entry) ? entry : resolve(entry);
  return pathToFileURL(abs).href;
}

/** Load every uck in the store, in stable load order. Later buckets shadow earlier ones.
 *
 * Load is one pass for discovery purposes: register() receives no view of its
 * peers at all (G11), so nothing here depends on load order any more. Order
 * still decides name shadowing (N9, last wins), which is the only remaining
 * reason it has to be stable. */
export async function loadStoreUcks(fVersion: string): Promise<Uck[]> {
  // Iterate the discovered entries directly, in load order. resolvedUcks() keys
  // by DIRECTORY basename, which is not the same thing as a registered uck name
  // (a local source is flattened, so its ucks sit at <store>/<uck>/ while the
  // label is the parent) — keying the loop by registered name makes that
  // mismatch a silent miss. Iterating entries keeps dir and name paired, which
  // is the invariant the loader actually needs.
  const results: Uck[] = [];

  for (const entry of installedUcks()) {
    const indexPath = join(entry.dir, "index.js");
    if (!existsSync(indexPath)) continue;

    const loaded = await loadUckModule(indexPath, entry.name, fVersion, `store:${entry.bucket}`);
    results.push(...loaded);
  }

  return results;
}

/**
 * Load a single uck module (index.js) and run its register().
 *
 * `origin` names where the uck came from (bucket or npm specifier) and is used
 * in the name-collision warning when the same uck name registers twice.
 */
export async function loadUckModule(
  indexPath: string,
  self: string,
  fVersion: string,
  origin: string,
): Promise<Uck[]> {
  let mod: UckModule;
  try {
    const imported = await import(toImportUrl(indexPath));
    mod = imported.default ?? imported;
  } catch (e) {
    console.error(`f: uck '${self}': ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return [];
  }

  if (typeof mod.register !== "function") {
    console.error(`f: uck '${self}': index.js must export register(ctx)`);
    return [];
  }

  // G11: register-time ctx carries identity + versioning ONLY. No `ucks`, no
  // `registry`: the v1 partial view was keyed on load order, which is not a
  // stability ucks are entitled to (npm sources merge after the whole store
  // pass, so store->npm visibility is impossible and npm->store is automatic).
  // Absent beats empty here because it fails loud — see UckRegisterContext.
  const ctx: UckRegisterContext = { fVersion, contractVersion: CONTRACT_VERSION, self };
  let newUcks: Uck[] | Uck;
  try {
    newUcks = mod.register(ctx);
  } catch (e) {
    console.error(`f: uck '${self}': register() threw ${e instanceof Error ? e.message : e}`);
    return [];
  }

  if (!Array.isArray(newUcks)) newUcks = [newUcks];

  // G10: one uck per directory. A register() returning multiple objects is
  // ambiguous (ctx.self would be wrong for all but one), so core loads only
  // the first and warns. Contract: split multi-uck dirs into one dir each.
  if (newUcks.length > 1) {
    console.error(`f: uck dir '${self}' (${origin}) registered ${newUcks.length} ucks; loading only '${newUcks[0].name}' — one uck per directory, split the rest into their own dirs`);
    newUcks = newUcks.slice(0, 1);
  }

  const out: Uck[] = [];
  for (const u of newUcks) {
    if (!u.name || typeof u.run !== "function") {
      console.error(`f: uck '${self}' (${origin}): register() returned an invalid uck (needs name + run)`);
      continue;
    }
    // G2: desc is one line, capped. Clamp here so f help and ctx.ucks agree.
    u.desc = clampDesc(u.desc ?? "");
    // G1: version negotiation — warn once, still load.
    if (typeof u.minF === "string" && u.minF && !satisfiesMinF(fVersion, u.minF)) {
      console.error(`f: uck '${u.name}' needs f >= ${u.minF} (running ${fVersion}); it may not work`);
    }
    out.push(u);
  }
  return out;
}

/**
 * Load ucks from an npm/git source that is already installed in node_modules
 * (not in the store). Used for sources that resolve via the package system.
 */
export async function loadFromNodeModules(
  specifier: string,
  fVersion: string,
): Promise<Uck[]> {
  let resolved: string;
  try {
    resolved = require.resolve(specifier);
  } catch {
    console.error(`f: ${specifier}: not in node_modules (run npm i ${specifier})`);
    return [];
  }
  const name = specifier.includes("/") ? specifier.split("/").pop()! : specifier;
  return loadUckModule(resolved, name, fVersion, `npm:${specifier}`);
}

/**
 * Like loadFromNodeModules, but silent when the specifier simply does not
 * resolve: npm sources now install into store buckets (so the package is NOT
 * in a surrounding node_modules by design), and the legacy node_modules path
 * should only fire for pre-store installs. Distinguishing "not installed
 * here" from "installed but broken" without a warning would require knowing
 * which; the caller only invokes this for npm sources, and a store bucket
 * already loaded the uck in that case, so silence is the right call.
 */
export async function loadFromNodeModulesMaybe(
  specifier: string,
  fVersion: string,
): Promise<Uck[]> {
  let resolved: string;
  try {
    resolved = require.resolve(specifier);
  } catch {
    return [];
  }
  const name = specifier.includes("/") ? specifier.split("/").pop()! : specifier;
  return loadUckModule(resolved, name, fVersion, `npm:${specifier}`);
}
