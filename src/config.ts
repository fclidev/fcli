import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FConfig, UckSource } from "./types.js";

/**
 * The default ucks source, seeded into the global config on first install.
 * An npm package: `f` installs it into the store like any other source and
 * loads the ucks from its dist/ via manifest.json. Override with
 * F_UCKS_REPO to a git URL (or the package name of another npm source) —
 * the git flow (clone / reset --hard on `f up`) is unchanged.
 */
export const DEFAULTS_REPO =
  process.env.F_UCKS_REPO ?? "@fcli.dev/ucks";

export function fHome(): string {
  return join(process.env.HOME ?? "", ".f");
}

/** Global config path: ~/.f/f.config.json */
export function globalConfigPath(): string {
  return join(fHome(), "f.config.json");
}

/** Project config path: nearest f.config.json from cwd walking up */
export function projectConfigPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = join(dir, "f.config.json");
    if (existsSync(p)) return p;
    dir = join(dir, "..");
  }
  return null;
}

/** Read a config file, or null if absent/invalid. */
export function readConfigFile(path: string): FConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    // Accept both new "ucks" and legacy "extensions" keys.
    const sources = raw.ucks ?? raw.extensions ?? [];
    if (!Array.isArray(sources)) return null;
    return { ucks: sources };
  } catch (e) {
    console.error(`f: invalid config at ${path}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * First install: if the global config doesn't exist, seed it with the defaults
 * source as a source. Idempotent — never clobbers an existing config.
 */
export function ensureGlobalConfig(): void {
  const p = globalConfigPath();
  if (existsSync(p)) return;
  try {
    mkdirSync(fHome(), { recursive: true });
    const seed: FConfig = { ucks: [DEFAULTS_REPO] };
    writeFileSync(p, JSON.stringify(seed, null, 2) + "\n");
  } catch (e) {
    console.error(`f: could not seed ${p}: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Migrate existing installs: a global config seeded with the old git defaults
 * repo is rewritten to the npm source. Only the exact string we used to seed
 * is touched, so a user who pointed F_UCKS_REPO elsewhere (or edited the URL)
 * is left alone. Idempotent — once migrated the string no longer matches.
 */
const LEGACY_DEFAULTS_REPO = "https://github.com/fclidev/fcli-ucks.git";
export function migrateLegacyDefaults(): void {
  const p = globalConfigPath();
  if (!existsSync(p)) return;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return; // invalid config: leave it for readConfig to complain about
  }
  const sources = (raw as { ucks?: unknown; extensions?: unknown }).ucks ??
    (raw as { extensions?: unknown }).extensions;
  if (!Array.isArray(sources)) return;
  const idx = sources.indexOf(LEGACY_DEFAULTS_REPO);
  if (idx === -1) return;
  sources[idx] = DEFAULTS_REPO;
  try {
    writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");
    console.error(`f: ucks source migrated: ${LEGACY_DEFAULTS_REPO} → ${DEFAULTS_REPO}`);
  } catch {
    /* read-only config: the old source still works (it's just git) */
  }
}

/** Combined sources: global config first (defaults baseline), then project. */
export function allSources(): UckSource[] {
  const out: UckSource[] = [];
  const g = readConfigFile(globalConfigPath());
  if (g) out.push(...g.ucks);
  const pc = projectConfigPath();
  if (pc) {
    const p = readConfigFile(pc);
    if (p) out.push(...p.ucks);
  }
  return out;
}
