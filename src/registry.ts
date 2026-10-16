import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { clampDesc, satisfiesMinF, type Uck, type UckContext, type UckModule, type UckSource } from "./types.js";
import { resolvedUcks } from "./store.js";

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
  if (isAbsolute(specifier) || specifier.startsWith("./") || specifier.startsWith("../")) return "local";
  if (/^(git\+)?(https?|ssh):\/\//.test(specifier) || specifier.startsWith("github:") || specifier.startsWith("git@")) return "git";
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
 * `originOf(name)` reports where a store uck came from (its bucket name) for
 * collision warnings. */
export async function loadStoreUcks(fVersion: string): Promise<Uck[]> {
  const ucks = resolvedUcks();
  const results: Uck[] = [];

  for (const name of Object.keys(ucks).sort()) {
    const dir = ucks[name].dir;
    const indexPath = join(dir, "index.js");
    if (!existsSync(indexPath)) continue;

    const results2 = await loadUckModule(indexPath, name, fVersion, `store:${name}`);
    results.push(...results2);
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
  origin: string
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

  const ctx: UckContext = { fVersion, self };
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
export async function loadFromNodeModules(specifier: string, fVersion: string): Promise<Uck[]> {
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
