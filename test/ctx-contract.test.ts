// G4-as-resolved + A2: the ctx contract itself.
//
// Decisions these pin down (CONTRACT.md N18-N20b):
//   - register() and run() receive the SAME ctx shape (one shape, not two)
//   - `ctx.registry` is the sole peer accessor; `ctx.uck()` is deleted
//   - at register time `ucks`/`registry` are a partial view, usable only for
//     feature detection
//   - `ctx.contractVersion` is present at register time (A2)
//   - `ctx.self` is the registered NAME, not a path or source label (B2)
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
async function load(name, view) {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModule(join(FIX, `${name}/index.js`), name, "1.0.0", `store:${name}`, view);
  err.mockRestore();
  return { ucks, ctx: ucks[0]?.ctx };
}

const NO_VIEW = { ucks: [], registry: {} };

test("A2: ctx.contractVersion is present at register time and matches core", async () => {
  const { ctx } = await load("observer", NO_VIEW);
  expect(ctx.contractVersion).toBe(CONTRACT_VERSION);
});

test("A2: CONTRACT_VERSION is a positive integer", () => {
  expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
  expect(CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
});

test("N19/N18: register-time and run-time ctx carry the same keys", async () => {
  const { ctx } = await load("observer", NO_VIEW);
  // Core's run-time ctx (cli.ts) must expose exactly these — no more, no less.
  expect(Object.keys(ctx).sort()).toEqual(["contractVersion", "fVersion", "registry", "self", "ucks"]);
});

test("N20: ctx.uck is deleted — the sole peer accessor is ctx.registry", async () => {
  const { ctx } = await load("observer", NO_VIEW);
  // Asserted on core's object, so this FAILS if the accessor is reintroduced.
  // That matters because a uck left calling ctx.uck() would otherwise degrade
  // silently to a socket fallback and report "no-store" as "not configured".
  expect(ctx.uck).toBeUndefined();
  expect(typeof ctx.registry).toBe("object");
});

test("N18: ctx.self is the registered name, not a path or a source label", async () => {
  const { ctx } = await load("observer", NO_VIEW);
  expect(ctx.self).toBe("observer");
  expect(ctx.self).not.toContain("/");
});

test("N20a: the register-time view is partial — earlier peers only", async () => {
  // Simulate the loader's accumulating pass: `minf` registers before `observer`.
  const first = await load("minf", NO_VIEW);
  const earlier = [{ name: "minf", desc: first.ucks[0].desc }];
  const registry = { minf: first.ucks[0] };

  const { ctx } = await load("observer", { ucks: earlier, registry });
  expect(ctx.ucks.map((u) => u.name)).toEqual(["minf"]);
  expect(Object.keys(ctx.registry)).toEqual(["minf"]);
  // A peer loaded AFTER ours is not visible — feature detection at register
  // time can only ever confirm presence, never absence.
  expect("creds-like" in ctx.registry).toBe(false);
});

test("N20a: register-time feature detection sees a peer that loaded first", async () => {
  const peer = await load("peer", NO_VIEW);
  const registry = { "creds-like": peer.ucks[0] };
  const { ctx } = await load("observer", {
    ucks: [{ name: "creds-like", desc: peer.ucks[0].desc }],
    registry,
  });
  // This is the sanctioned register-time use: `"creds" in ctx.registry`.
  expect("creds-like" in ctx.registry).toBe(true);
  expect(ctx.registry["creds-like"].credsLike.version).toBe(1);
});

// ---------------------------------------------------------------------------
// The run-time ctx. Everything above exercises registry.ts's register-time ctx;
// `ctx.uck` historically lived in cli.ts's RUN-time ctx, so without an
// end-to-end dispatch test, reintroducing it there is invisible to this suite.
// That is not hypothetical — the first draft of this file had exactly that hole.
//
// Why this spawns `f` instead of calling run(): setting process.env.HOME does
// NOT isolate a test. registry.ts evaluates fHome() in a module-scope const
// (`uckMainPath()`), so the store path is frozen at import time and a
// "throwaway HOME" test still loads and runs the operator's real ~/.f/ucks —
// observed directly: the in-process variant printed the real store's 15 ucks
// with the fixture's 2 missing. That is ROADMAP C4 (no store-dir injection) and
// C6 (env read at import time) as measured fact, not theory. So we run the
// built CLI as a child process with a clean environment.
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

test("N20: the run-time ctx core dispatches with has no ctx.uck", async () => {
  const home = mkdtempSync(join(tmpdir(), "f-ctx-"));
  const bucket = join(home, ".f", "ucks", "fx");
  try {
    mkdirSync(join(bucket, "dispatch"), { recursive: true });
    mkdirSync(join(bucket, "other"), { recursive: true });
    writeFileSync(
      join(bucket, "dispatch", "index.js"),
      // The uck prints the ctx core handed it, as JSON, so the assertions read
      // core's own object rather than a self-report we control.
      `export function register() {\n` +
        `  return {\n` +
        `    name: "dispatch",\n` +
        `    desc: "prints the ctx core dispatched it",\n` +
        `    run(_a, _argv, ctx) {\n` +
        `      console.log(JSON.stringify({ keys: Object.keys(ctx).sort(), self: ctx.self, contractVersion: ctx.contractVersion, hasUck: typeof ctx.uck, registry: Object.keys(ctx.registry).sort(), ucks: ctx.ucks.map((u) => u.name).sort() }));\n` +
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
    mkdirSync(join(home, ".f"), { recursive: true });

    const out = runF(home, ["dispatch"]);
    const seen = JSON.parse(out.trim().split("\n").filter((l) => l.startsWith("{")).pop());

    // The assertion that actually guards the removal:
    expect(seen.hasUck).toBe("undefined");
    expect(seen.keys).toEqual(["contractVersion", "fVersion", "registry", "self", "ucks"]);
    expect(seen.self).toBe("dispatch");
    expect(seen.contractVersion).toBe(CONTRACT_VERSION);
    // Peers reachable only through the map — including `other`, which loaded
    // AFTER us and so could never appear in the register-time partial view.
    expect(seen.registry).toEqual(["dispatch", "other"]);
    expect(seen.ucks).toEqual(["dispatch", "other"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
