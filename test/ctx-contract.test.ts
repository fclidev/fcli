// The run-time ctx contract (CONTRACT.md N19/N20) — the half that G11 did NOT
// change, and that the register-time suite in ctx-register.test.ts does not
// cover.
//
// Split history: this file used to also pin the register-time ctx, including
// "N20a: the register-time view is partial — earlier peers only". That
// assertion was a test FOR a race condition: it locked in load-order-dependent
// visibility that no uck could depend on correctly (npm sources merge after the
// whole store pass, so store→npm visibility is impossible and npm→store is
// automatic). G11 deleted the keys; the register-time assertions moved to
// ctx-register.test.ts and this file keeps only what run() must still provide.
//
// Everything here runs against objects core built — a captured ctx for the
// in-process cases, a spawned CLI for dispatch — never a fixture's
// self-report, which would pass even when core changes.
import { test, expect, vi } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUckModule } from "../src/registry.js";
import { CONTRACT_VERSION } from "../src/types.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function load(name) {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModule(join(FIX, `${name}/index.js`), name, "1.0.0", `store:${name}`);
  err.mockRestore();
  return { ucks, ctx: ucks[0]?.ctx };
}

test("A2: CONTRACT_VERSION is a positive integer", () => {
  expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
  expect(CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
});

test("N20: ctx.uck stays deleted — the sole peer accessor is ctx.registry", async () => {
  const { ctx } = await load("observer");
  // ctx.uck was 0.3.0's sugar over registry. It stays gone: a uck left calling
  // it would degrade silently to a socket fallback and report "no-store" as
  // "not configured". (Register ctx has no registry either, so this is really
  // a statement about run ctx — asserted end-to-end below.)
  expect(ctx.uck).toBeUndefined();
});

// ---------------------------------------------------------------------------
// End-to-end run ctx. `ctx.uck` historically lived in cli.ts's RUN-time ctx, so
// without a dispatch test, reintroducing it there is invisible to the in-process
// suite. That is not hypothetical — the first draft of this file had exactly
// that hole. We run the built CLI as a child process with a clean environment:
// process.env.HOME does NOT isolate an in-process test, because registry.ts
// evaluates fHome() at module scope, so a "throwaway HOME" test still loads the
// operator's real ~/.f/ucks (ROADMAP C4/C6, as measured fact).
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
      F_UCKS_REPO: "https://invalid.invalid/none.git",
    },
  });
}

test("N20: the run-time ctx core dispatches with has no ctx.uck, and full peers", async () => {
  const home = mkdtempSync(join(tmpdir(), "f-ctx-"));
  const bucket = join(home, ".f", "ucks", "fx");
  try {
    mkdirSync(join(bucket, "dispatch"), { recursive: true });
    mkdirSync(join(bucket, "other"), { recursive: true });
    writeFileSync(
      join(bucket, "dispatch", "index.js"),
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
    // AFTER us. Run time is now the only place that answer exists.
    expect(seen.registry).toEqual(["dispatch", "other"]);
    expect(seen.ucks).toEqual(["dispatch", "other"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
