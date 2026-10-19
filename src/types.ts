export interface UckArgs {
  _: string[];
  [key: string]: string | string[] | undefined;
}

/** Hard cap on desc length in f help / ctx.ucks. Longer values are truncated with '…'. */
export const DESC_MAX = 120;

/**
 * The f <-> uck contract version (CONTRACT.md). ONE number answering "does this
 * bucket speak this core's language" — the alternative was the three ad-hoc
 * dials already in the tree (`uck.minF`, `credsApi.version`,
 * `credentialProvider.providerVersion`), which answer three different
 * questions and never this one.
 *
 * Bumped ONLY when the meaning of an existing ctx/uck field changes for code
 * that is already written. Purely additive fields (a new optional uck key, a
 * new optional credentialProvider key) do NOT bump it: `"field" in ctx` and
 * `typeof x === "function"` already cover those, and bumping on addition would
 * make every uck author declare a version for nothing.
 *
 *   1 — the CONTRACT.md baseline as implemented in core 0.3.x, plus the G4
 *       reversal: `ctx.registry` as the sole peer accessor (`ctx.uck()`
 *       deleted). See v2 for what happened to the register-time view.
 *
 *   2 — the G11 reversal: register-time ctx no longer carries `ucks` or
 *       `registry` at all. v1 handed register() a **partial** view whose
 *       contents depended on load order (and it is not stable load order —
 *       npm sources merge after the whole store pass, so a store uck can never
 *       see an npm uck and not vice versa). A view no uck can depend on
 *       correctly is not an interface, so it is gone rather than made
 *       consistently unreliable. `ctx.uck` was deleted on exactly this logic
 *       (N20: fail loud rather than degrade silently); v2 finishes it.
 *       A v1 uck reading `ctx.registry` in register() now gets `undefined`
 *       immediately, instead of an order-dependent map.
 *
 * Available to a uck at **register** time as `ctx.contractVersion`, so it can
 * branch before returning anything. Peers that expose their own versioned
 * surface should still feature-detect that separately — a core contract version
 * says nothing about a uck's release cadence.
 */
export const CONTRACT_VERSION = 2;

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

/**
 * Context passed to a uck's register(). This is a **strict subset** of
 * UckRunContext, not an equal shape: register() gets identity and versioning
 * only, and deliberately gets NO view of its peers (G11).
 *
 * Why the keys are absent rather than empty:
 *  - `Object.freeze({})` makes `ctx.registry.x = y` throw, but leaves the
 *    v1-documented idiom `"creds" in ctx.registry` present-but-always-false —
 *    the worst outcome, because a uck following the docs to the letter gets a
 *    confident wrong answer and degrades to a fallback that reads to a user as
 *    "not configured".
 *  - an absent key makes the same code throw `Cannot use 'in' operator` /
 *    `ctx.registry is undefined` at load, on the spot.
 *  - "absent" and "present-but-empty" become distinguishable, which they were
 *    not under a partial view.
 *
 * Peer work belongs in run(), which is the only place every uck is loaded.
 */
export interface UckRegisterContext {
  /** f's own version string */
  fVersion: string;
  /** The f <-> uck contract version this core implements. See CONTRACT_VERSION. */
  contractVersion: number;
  /**
   * This uck's **registered name** — i.e. what `f <self>` invokes. A name,
   * NOT a filesystem path or a source label: derive a path from
   * `import.meta.url`, never from this. (For a directory registering several
   * ucks it is only correct for one, which is why core enforces one per dir.)
   */
  self: string;
}

/**
 * Context passed to a uck's run() — after every uck is loaded. A uck can
 * read any field (e.g. `skills`) exported by other ucks off the registry.
 * Core imposes no restrictions on what a uck exports.
 *
 * This is UckRegisterContext **plus** the two discovery fields — the superset
 * direction is what makes the subset safe: a uck written for register-time ctx
 * typechecks in run(). `ctx` is rebuilt per invocation, so nothing captured
 * from an earlier run can go stale.
 */
export interface UckRunContext extends UckRegisterContext {
  /** name + desc of every registered uck — the same data `f help` prints. */
  ucks: { name: string; desc: string }[];
  /**
   * name -> the complete object a uck returned from register().
   * The **sole** sanctioned peer accessor (CONTRACT.md N20). Read-only by
   * convention: do not mutate, add keys to, or delete from it.
   *
   * Everything on ctx, including this, must stay structured-cloneable —
   * credential providers are spawned as child processes (CONTRACT.md N20b).
   *
   * Present at run time ONLY. At register time this key does not exist (G11);
   * do not reach for it before run().
   */
  registry: Record<string, Uck>;
}

/** What a uck module (index.js) exports */
export interface UckModule {
  /** Called once at load time. Returns one or more ucks. */
  register: (ctx: UckRegisterContext) => Uck[] | Uck;
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
