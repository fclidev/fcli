import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStoreUcks, loadFromNodeModules, loadFromNodeModulesMaybe, snapshot, sourceKind } from "./registry.js";
import { ensureGlobalConfig, migrateLegacyDefaults, allSources } from "./config.js";
import { installSource, installedUcks } from "./store.js";
import { acquireStoreLock } from "./lock.js";
import { updateAll } from "./update.js";
import { helpNames, searchMatches, searchUsage } from "./help.js";
import { type Uck, type UckRunContext, CONTRACT_VERSION } from "./types.js";

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
  // Existing installs: point a legacy git defaults source at the npm package.
  migrateLegacyDefaults();

  // Populate the store from configured sources. Normal runs only fetch when the
  // store is empty (first install); `f up` forces re-fetch. Local ucks always
  // install (cheap, no network).
  const storeEmpty = installedUcks().length === 0;
  if (needsInstall(storeEmpty)) {
    const release = await acquireStoreLock();
    try {
      for (const src of allSources()) {
        const specifier = typeof src === "string" ? src : src.source;
        const local = looksLocal(specifier);
        const git = specifierIsGit(specifier);
        if (local || (storeEmpty && git)) {
          await installSource(src, false);
        }
      }
    } finally {
      release();
    }
  }

  // Load ucks from the store. Git and npm sources both install into store
  // buckets, so loadStoreUcks covers both; the legacy node_modules path (an
  // npm source resolved through require.resolve, for installs predating store
  // installs of npm sources) still runs after the store so its ucks shadow.
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
    if (sourceKind(specifier) !== "npm") continue;
    // Legacy npm sources (pre-store-install) live in a surrounding
    // node_modules; skip silently if they never resolved there.
    const u = await loadFromNodeModulesMaybe(specifier, fVersion, snapshot(Object.values(ucks)));
    for (const uck of u) {
      if (ucks[uck.name]) console.error(`f: uck '${uck.name}' shadowed by npm:${specifier}`);
      ucks[uck.name] = uck; // later (project) sources override store/builtins
      origin[uck.name] = `npm:${specifier}`;
    }
  }

  const [name, ...rest] = argv;

  if (!name || name === "help" || name === "--help" || name === "-h") {
    console.log(helpNames(Object.values(ucks), fVersion));
    return;
  }

  // `f search` is core rather than a uck for the same reason `help` and `up`
  // are: it has to work against the registry with an empty store, and it is the
  // path that keeps discovery bounded as the store grows.
  if (name === "search") {
    if (!rest.length) {
      console.log(searchUsage());
      return;
    }
    const hits = searchMatches(Object.values(ucks), rest.join(" "));
    if (!hits.length) {
      // Say so plainly: a silent empty result reads as "no such capability"
      // and sends the model off to invent a workaround.
      console.log(`no uck matched: ${rest.join(" ")}`);
      process.exitCode = 1;
      return;
    }
    const byName = hits.filter((h) => h.byName);
    const byDesc = hits.filter((h) => !h.byName);
    for (const h of byName) console.log(`${h.name}  ${h.desc}`);
    if (byDesc.length) {
      // Separate section: these did not match a name, so they are leads rather
      // than answers. Folding them in would let a description keyword outrank
      // the command the query actually named.
      if (byName.length) console.log("maybe:");
      for (const h of byDesc) console.log(`${h.name}  ${h.desc}`);
    }
    return;
  }

  if (name === "--version" || name === "-V") {
    console.log(fVersion);
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
    // exitCode + return, never exit(): see the note at the bottom.
    console.error(`f: unknown uck '${name}'. Run 'f' to list ucks, 'f search <query>' to look one up.`);
    process.exitCode = 1;
    return;
  }

  // G8: core intercepts BARE help — `f <uck>` alone, or `f <uck> --help`/
  // `-h`/`help` with no other tokens — and prints uck.help (verbatim) >
  // uck.about. No such export? Fall through to the uck's own run() (every
  // current uck prints usage itself). Subcommand help (`f uck cmd --help`)
  // always goes to the uck.
  const helpToken = rest[0];
  const isBareHelp =
    rest.length === 0 ||
    (rest.length === 1 && (helpToken === "--help" || helpToken === "-h" || helpToken === "help"));
  if (isBareHelp && (typeof uck.help === "string" || typeof uck.about === "string")) {
    console.log(`${name}  ${uck.desc ?? ""}\n\n${(uck.help ?? uck.about) as string}`);
    return;
  }

  try {
    const uckList = Object.values(ucks).map((u) => ({ name: u.name, desc: u.desc }));
    const registry = ucks;
    const ctx: UckRunContext = {
      fVersion,
      contractVersion: CONTRACT_VERSION,
      ucks: uckList,
      self: name,
      // G4, resolved: `registry` is the sole peer accessor (CONTRACT.md N20).
      // `ctx.uck(name)` — 0.3.0's sugar over this same map — is deleted: it was
      // the subset of a lookup that is also unreachable below run(), and 5 of 6
      // in-tree call sites already used `registry`. Deleting the key fails loud
      // (`ctx.uck is not a function`) instead of silently degrading a peer read
      // to a socket fallback that reports "no-store" as "not configured".
      registry,
    };
    // G3: a numeric return maps to process.exitCode; undefined → 0.
    const result = await uck.run(rest, uck.argv?.(rest) ?? { _: rest }, ctx);
    if (typeof result === "number" && result !== 0) process.exitCode = result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`f: ${msg}`);
    process.exitCode = 1;
  }
}

/*
 * Why `process.exitCode` and never `process.exit(1)` on these two paths.
 *
 * process.exit() terminates immediately, and Node's stdout writes are queued
 * when stdout is not a TTY — the normal way f is invoked (an agent captures
 * output, `f x | head`). Anything already "written" can still be sitting in
 * libuv's buffer, so a uck that printed its answer and then threw had the
 * answer dropped. Measured on Linux 7.2 (pipes are synchronous since Linux
 * 2.6.35, so this kernel drains ~1 MB before it starts dropping) a piped
 * write() of ~640 KB lost 1,110 bytes to exit(1): the truncation is real but
 * environment-dependent, which means "was the reader draining at that instant"
 * decided how much of a printed secret survived — not a policy for secrets
 * (CONTRACT.md N17).
 *
 * exitCode also fixes a second, cheaper bug: the unknown-uck path discarded
 * everything written earlier in the same run (install/load output), because
 * exit() skips the drain entirely.
 *
 * Nothing here keeps the event loop alive — core holds no timers, servers or
 * child handles on these paths (the one timeout in update.ts is cleared when
 * its request settles) — so normal completion always follows. If that stops
 * being true, close the loop explicitly on return; do not reach for exit(),
 * which is what lost output in the first place.
 */

/** Does this run have anything to install? Avoids taking the lock when idle. */
function needsInstall(storeEmpty: boolean): boolean {
  if (storeEmpty) return true;
  return allSources().some((src) => looksLocal(typeof src === "string" ? src : src.source));
}

function looksLocal(s: string): boolean {
  return s.startsWith("./") || s.startsWith("../") || s.startsWith("/");
}
function specifierIsGit(s: string): boolean {
  return sourceKind(s) === "git";
}
