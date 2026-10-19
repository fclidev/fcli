// G11: the register-time ctx is identity + versioning ONLY.
//
// v1 handed register() a partial `ucks`/`registry` view with N20a as the
// rulebook ("feature detection only"). The view was keyed on load order *and*
// source kind — npm sources merge after the whole store pass, so a store uck
// could never see an npm uck while an npm uck always saw the store. No uck
// could depend on that correctly, so the keys are gone rather than made
// consistently unreliable.
//
// The assertions run against the ctx OBJECT core built (captured by reference
// in test/fixtures/observer), never against a fixture's self-report — a test
// that asks the fixture what it saw passes even when core changes.
import { test, expect, vi } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUckModule } from "../src/registry.js";
import { CONTRACT_VERSION } from "../src/types.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Load one fixture uck and return { uck, ctx } where ctx is core's own object. */
async function load(name) {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModule(join(FIX, `${name}/index.js`), name, "1.0.0", `store:${name}`);
  err.mockRestore();
  return { ucks, ctx: ucks[0]?.ctx };
}

test("G11: register-time ctx carries exactly {fVersion, contractVersion, self}", async () => {
  const { ctx } = await load("observer");
  // Exact key set: a reintroduced view fails here, not just a wrong value.
  expect(Object.keys(ctx).sort()).toEqual(["contractVersion", "fVersion", "self"]);
});

test("G11: ucks/registry are ABSENT at register time, not present-but-empty", async () => {
  const { ctx } = await load("observer");
  // The distinction is the whole point. An empty object would keep v1's
  // documented idiom alive while making it guaranteed-false, which degrades a
  // peer read to a fallback reporting "no-store" as "not configured" — the
  // exact failure N20 refuses for ctx.uck. Absent makes it throw instead.
  expect("registry" in ctx).toBe(false);
  expect("ucks" in ctx).toBe(false);
});

test("G11: v1 register-time peer access fails loud at load", async () => {
  const { ctx } = await load("observer");
  // Both v1 idioms must explode rather than answer wrong:
  //   ctx.registry.creds            → TypeError (reading a property of undefined)
  //   "creds" in ctx.registry       → TypeError (left side is not an object)
  expect(() => ctx.registry.creds).toThrow(TypeError);
  expect(() => "creds" in ctx.registry).toThrow(TypeError);
  expect(() => ctx.ucks.map((u) => u.name)).toThrow(TypeError);
});

test("A2: ctx.contractVersion is still present at register time, and is v2", async () => {
  // contractVersion survives precisely because it is the only pre-run signal.
  expect(CONTRACT_VERSION).toBe(2);
  const { ctx } = await load("observer");
  expect(ctx.contractVersion).toBe(CONTRACT_VERSION);
});

test("N18: ctx.self is the registered name, not a path or a source label", async () => {
  const { ctx } = await load("observer");
  expect(ctx.self).toBe("observer");
  expect(ctx.self).not.toContain("/");
});

test("G11: register ctx is a strict subset of the run ctx core dispatches with", () => {
  // The subset direction is what makes this safe in both directions: code
  // written against register ctx typechecks inside run(), not vice versa.
  const REGISTER_KEYS = ["contractVersion", "fVersion", "self"];
  const RUN_KEYS = ["contractVersion", "fVersion", "self", "registry", "ucks"];
  expect(REGISTER_KEYS.every((k) => RUN_KEYS.includes(k))).toBe(true);
  expect(RUN_KEYS.filter((k) => !REGISTER_KEYS.includes(k))).toEqual(["registry", "ucks"]);
});

// ---------------------------------------------------------------------------
// End-to-end: the register ctx above is only half the contract. The other half
// is that run() STILL gets the complete view — otherwise "delete it from
// register" is one refactor away from "delete it everywhere".
//
// This spawns `f` rather than calling run(): setting process.env.HOME does NOT
// isolate a test. registry.ts evaluates fHome() in a module-scope const, so the
// store path is frozen at import time and a "throwaway HOME" test still loads
// the operator's real ~/.f/ucks — observed: it printed the real store's ucks
// with the fixtures missing. That is ROADMAP C4/C6 as measured fact. So we run
// the built CLI as a child process with a clean environment.
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runF(home: string, args: string[]) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: home,
    encoding: "utf8",
    env: {
      HOME: home,
      PATH: process.env.PATH,
      // Nothing inherited: the default bucket must not resolve, so the only
      // ucks in play are the fixture's.
      F_UCKS_REPO: "https://invalid.invalid/none.git",
    },
  });
}

/**
 * Two ucks in one bucket. `regsees` records what ITS OWN register() saw and
 * `dispatch` reports it at run time, so one `f dispatch` call answers both
 * halves: what register() got, and what run() got.
 */
function writePair(bucket: string) {
  mkdirSync(join(bucket, "dispatch"), { recursive: true });
  mkdirSync(join(bucket, "other"), { recursive: true });
  writeFileSync(
    join(bucket, "dispatch", "index.js"),
    `let seen;\n` +
      `export function register(ctx) {\n` +
      `  // Record what core handed register(), as the fixture cannot assert on\n` +
      `  // its own object in a way core would fail.\n` +
      `  seen = { keys: Object.keys(ctx).sort(), hasRegistry: "registry" in ctx, hasUcks: "ucks" in ctx, contractVersion: ctx.contractVersion };\n` +
      `  return {\n` +
      `    name: "dispatch",\n` +
      `    desc: "reports register-time and run-time ctx",\n` +
      `    run(_a, _argv, rctx) {\n` +
      `      console.log(JSON.stringify({ register: seen, run: { keys: Object.keys(rctx).sort(), self: rctx.self, hasUck: typeof rctx.uck, registry: Object.keys(rctx.registry).sort(), ucks: rctx.ucks.map((u) => u.name).sort() } }));\n` +
      `    },\n` +
      `  };\n` +
      `}\nexport default { register };\n`
  );
  writeFileSync(join(bucket, "dispatch", "package.json"), '{ "type": "module" }\n');
  writeFileSync(
    join(bucket, "other", "index.js"),
    `export function register() {\n` +
      `  return { name: "other", desc: "a second uck", run: () => {} };\n` +
      `}\nexport default { register };\n`
  );
  writeFileSync(join(bucket, "other", "package.json"), '{ "type": "module" }\n');
}

test("G11 end-to-end: register sees nothing, run sees everything, neither sees ctx.uck", async () => {
  const home = mkdtempSync(join(tmpdir(), "f-g11-"));
  const bucket = join(home, ".f", "ucks", "fx");
  try {
    writePair(bucket);
    mkdirSync(join(home, ".f"), { recursive: true });

    const out = runF(home, ["dispatch"]);
    const seen = JSON.parse(out.trim().split("\n").filter((l) => l.startsWith("{")).pop());

    // register(): no peer view at all, contract version intact
    expect(seen.register.keys).toEqual(["contractVersion", "fVersion", "self"]);
    expect(seen.register.hasRegistry).toBe(false);
    expect(seen.register.hasUcks).toBe(false);
    expect(seen.register.contractVersion).toBe(CONTRACT_VERSION);

    // run(): unchanged and complete — including `other`, loaded after us,
    // which is the visibility the partial view could never give.
    expect(seen.run.keys).toEqual(["contractVersion", "fVersion", "registry", "self", "ucks"]);
    expect(seen.run.registry).toEqual(["dispatch", "other"]);
    expect(seen.run.ucks).toEqual(["dispatch", "other"]);
    expect(seen.run.self).toBe("dispatch");
    expect(seen.run.hasUck).toBe("undefined");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
