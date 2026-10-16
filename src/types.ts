export interface UckArgs {
  _: string[];
  [key: string]: string | string[] | undefined;
}

/** Hard cap on desc length in f help / ctx.ucks. Longer values are truncated with '…'. */
export const DESC_MAX = 120;

/** A unit of f functionality. Only a word when prefixed with 'f-'. */
export interface Uck {
  name: string;
  /** One line, ≤ DESC_MAX chars (core truncates longer values). */
  desc: string;
  /**
   * Longer usage text: shown by core's `f <uck> --help` interception and is
   * the right home for LLM-facing "how to use" prose. Multi-line allowed.
   */
  about?: string;
  /** Static usage text printed by core's `--help` interception, verbatim. */
  help?: string;
  /**
   * May be sync or async.
   *
   * Exit semantics (the contract):
   *  - returns undefined  → exit 0
   *  - returns a number   → process.exitCode = that number
   *  - throws             → `f: <message>` on stderr, exit 1
   *  - sets process.exitCode directly → respected (but never exit(0) on a
   *    failure path — core cannot see through a direct exit)
   */
  run: (argv: string[], args: UckArgs, ctx: UckRunContext) => void | number | Promise<void | number>;
  argv?: (argv: string[]) => UckArgs;
  /** Minimum f semver this uck requires. Core warns (stderr, once per uck) when running older. */
  minF?: string;
  /** Ucks may export anything else they want; core ignores unknown fields. */
  [key: string]: unknown;
}

/** Context passed to a uck's register() — load time, before any ucks exist. */
export interface UckContext {
  /** f's own version string */
  fVersion: string;
  /** This uck's name */
  self: string;
}

/**
 * Context passed to a uck's run() — after every uck is loaded. A uck can
 * read any field (e.g. `skills`) exported by other ucks off the registry.
 * Core imposes no restrictions on what a uck exports.
 */
export interface UckRunContext extends UckContext {
  /** name + desc of every uck (store + npm sources). */
  ucks: { name: string; desc: string }[];
  /** name -> the complete object a uck returned from register(). Read-only alias through 0.x; removed at 1.0. */
  registry: Record<string, Uck>;
  /**
   * Look up another uck's registered object by name. The sanctioned peer
   * accessor (replaces direct `ctx.registry.<name>.<api>` duck-typing).
   * Returns undefined when the peer uck is not installed.
   */
  uck: (name: string) => Uck | undefined;
}

/** What a uck module (index.js) exports */
export interface UckModule {
  /** Called once at load time. Returns one or more ucks. */
  register: (ctx: UckContext) => Uck[] | Uck;
}

/**
 * A source in f.config.json. Either a bare string, or an object with a source
 * + optional ref + optional subset filters. A repo source expands to many ucks
 * (each subdir / file inside becomes a store entry); a local single-uck source
 * installs as one.
 *
 * Subset filters (repo sources):
 *  - only:   install just these uck names (whitelist)
 *  - except: install everything except these (blacklist)
 *  - if both are given, `only` wins.
 *  Sources are independent: each installs whatever its own filter allows.
 */
export type UckSource = string | {
  /** git URL, github:user/repo, npm package, or local path */
  source: string;
  /** optional branch/tag for git sources */
  ref?: string;
  /**
   * optional bucket name for the store (~/.f/ucks/<name>/). Defaults to the
   * repo basename (git) or path basename (local). Set it to give a source a
   * stable, collision-free bucket distinct from other sources.
   */
  name?: string;
  /** optional whitelist of uck names to install from a multi-uck repo */
  only?: string[];
  /** optional blacklist of uck names to skip from a multi-uck repo */
  except?: string[];
};

/** f.config.json shape (global ~/.f/f.config.json and/or project f.config.json) */
export interface FConfig {
  /** uck sources to install into the store */
  ucks: UckSource[];
}

/** Compare two dotted version strings. -1, 0, or 1. Non-numeric parts sort last. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i];
    const db = pb[i];
    const na = Number.isFinite(da as number) ? (da as number) : 0;
    const nb = Number.isFinite(db as number) ? (db as number) : 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** `minF` is satisfied when fVersion >= minF. Non-numeric minF is ignored. */
export function satisfiesMinF(fVersion: string, minF: string): boolean {
  return cmpVersion(fVersion, minF) >= 0;
}

/** Truncate a desc to one line ≤ DESC_MAX chars, appending '…' when cut. */
export function clampDesc(desc: string): string {
  const oneLine = String(desc ?? "").split("\n")[0].trim();
  if (oneLine.length <= DESC_MAX) return oneLine;
  return oneLine.slice(0, DESC_MAX - 1) + "…";
}
