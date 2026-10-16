import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStoreUcks, loadFromNodeModules } from "./registry.js";
import { ensureGlobalConfig, allSources } from "./config.js";
import { installSource, installedUcks } from "./store.js";
import { updateAll } from "./update.js";
import { help } from "./help.js";
import { type Uck, type UckRunContext } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

function getFVersion(): string {
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8"));
      // f's own package is the one that exposes the `f` binary. Matching on
      // bin.f (rather than the name) keeps this correct across renames
      // (fcli -> @fcli.dev/f, etc.).
      const hasFbin =
        !!pkg.bin &&
        (typeof pkg.bin === "string" || Array.isArray(pkg.bin)
          ? pkg.bin.some((b: string) => b.includes("/f"))
          : "f" in (pkg.bin as Record<string, string>));
      if (hasFbin) return pkg.version;
    } catch {}
  }
  return "0.0.0";
}

export async function run(argv: string[]): Promise<void> {
  const fVersion = getFVersion();

  // First install: seed the global config with defaults (idempotent).
  ensureGlobalConfig();

  // Populate the store from configured sources. Normal runs only fetch when the
  // store is empty (first install); `f up` forces re-fetch. Local ucks always
  // install (cheap, no network).
  const storeEmpty = installedUcks().length === 0;
  for (const src of allSources()) {
    const specifier = typeof src === "string" ? src : src.source;
    const local = looksLocal(specifier);
    const git = specifierIsGit(specifier);
    if (local || (storeEmpty && git)) {
      await installSource(src, false);
    }
  }

  // Load ucks: from the store, then from any npm sources in node_modules.
  const ucks: Record<string, Uck> = {};
  // Where each name currently comes from — for the shadowing warning (G9).
  const origin: Record<string, string> = {};

  for (const u of await loadStoreUcks(fVersion)) {
    if (ucks[u.name]) console.error(`f: uck '${u.name}' shadowed (store) by a later source`);
    ucks[u.name] = u;
    origin[u.name] = "store";
  }
  for (const src of allSources()) {
    const specifier = typeof src === "string" ? src : src.source;
    if (specifierIsGit(specifier) || looksLocal(specifier)) continue;
    for (const u of await loadFromNodeModules(specifier, fVersion)) {
      if (ucks[u.name]) console.error(`f: uck '${u.name}' shadowed by npm:${specifier}`);
      ucks[u.name] = u; // later (project) sources override store/builtins
      origin[u.name] = `npm:${specifier}`;
    }
  }

  const [name, ...rest] = argv;

  if (!name || name === "help" || name === "--help" || name === "-h") {
    console.log(help(Object.values(ucks), fVersion));
    return;
  }

  if (name === "up") {
    // --force discards dirty git buckets after one confirmation; without it
    // dirty buckets are skipped and preserved (see updateAll).
    const force = rest.includes("--force") || rest.includes("-f");
    await updateAll({ force });
    return;
  }

  const uck: Uck | undefined = ucks[name];
  if (!uck) {
    console.error(`f: unknown uck '${name}'. Run 'f help' to list ucks.`);
    process.exit(1);
  }

  // G8: core intercepts help tokens so every uck gets usage for free.
  // Priority: uck.help (verbatim) > uck.about > uck's own run() (all current
  // ucks print usage for bare/--help, so the handoff is a no-regression path).
  const helpToken = rest[0];
  if (helpToken === "--help" || helpToken === "-h" || helpToken === "help") {
    if (typeof uck.help === "string") {
      console.log(`${name}  ${uck.desc ?? ""}\n\n${uck.help}`);
      return;
    }
    if (typeof uck.about === "string") {
      console.log(`${name}  ${uck.desc ?? ""}\n\n${uck.about}`);
      return;
    }
  }

  try {
    const uckList = Object.values(ucks).map((u) => ({ name: u.name, desc: u.desc }));
    const registry = ucks;
    const ctx: UckRunContext = {
      fVersion,
      ucks: uckList,
      self: name,
      registry,
      // G4: sanctioned peer accessor. `registry` stays as a read-only alias
      // through 0.x and is removed at 1.0.
      uck: (n: string) => registry[n],
    };
    // G3: a numeric return maps to process.exitCode; undefined → 0.
    const result = await uck.run(rest, uck.argv?.(rest) ?? { _: rest }, ctx);
    if (typeof result === "number" && result !== 0) process.exitCode = result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`f: ${msg}`);
    process.exit(1);
  }
}

function looksLocal(s: string): boolean {
  return s.startsWith("./") || s.startsWith("../") || s.startsWith("/");
}
function specifierIsGit(s: string): boolean {
  return /^(git\+)?(https?|ssh):\/\//.test(s) || s.startsWith("github:") || s.startsWith("git@");
}
