// C1(a): a local source must never point into the store, and a legitimate
// local source must survive path handling that 0.3.0 got wrong.
//
// These run against the built dist/ as a child process: setting
// process.env.HOME does not isolate an in-process test (registry.ts freezes the
// store path at import time — see ctx-contract.test.ts), so an in-process
// "throwaway HOME" test would operate on the operator's real ~/.f/ucks.
import { test, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const CLI = join(dirnameOf(import.meta.url), "..", "dist", "index.js");
function dirnameOf(u: string) {
  return new URL(".", u).pathname;
}

function uckDir(parent: string, name: string) {
  mkdirSync(join(parent, name), { recursive: true });
  writeFileSync(
    join(parent, name, "index.js"),
    `export function register() { return { name: "${name}", desc: "a uck", run: () => {} }; }\nexport default { register };\n`
  );
  writeFileSync(join(parent, name, "package.json"), '{ "type": "module" }\n');
}

/**
 * Run the built CLI with a clean env; return stdout+stderr combined and the code.
 *
 * execFileSync returns ONLY stdout on success — stdio:"pipe" does not merge the
 * streams — so a helper that returns it alone silently drops every diagnostic f
 * writes to stderr, which is where all of these assertions live (N17: stdout is
 * the answer, stderr is diagnostics). Capture both streams and concatenate.
 */
function f(home: string, cwd: string, args: string[]) {
  const child = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { HOME: home, PATH: process.env.PATH, F_UCKS_REPO: "https://invalid.invalid/none.git" },
  });
  return {
    all: `${child.stdout ?? ""}${child.stderr ?? ""}`,
    code: child.status,
  };
}

test("C1a: a local source inside the store is refused, not copied over itself", () => {
  // The incident config, verbatim in shape:
  //   { "ucks": [ "./ucks/fcli-ucks" ] }   cwd = ~/.f, bucket = fcli-ucks
  // installLocal then computes dest *inside* the source and cpSync throws
  // ERR_FS_CP_EINVAL midway, having already deleted part of the bucket.
  const home = mkdtempSync(join(tmpdir(), "f-c1-"));
  try {
    const bucket = join(home, ".f", "ucks", "fcli-ucks");
    uckDir(bucket, "creds");
    uckDir(bucket, "gh");
    // Tracked-file-shaped content, so "unchanged" means bytes too.
    writeFileSync(join(bucket, "CONTRACT.md"), "# contract\n");
    const before = readdirSync(bucket).sort();
    mkdirSync(join(home, "proj"), { recursive: true });

    // Absolute specifier: a `./relative` one would resolve against the harness
    // cwd, which vitest overrides (poolOptions) — the source must be pinned to
    // this fixture, not to wherever the test runner thinks it is.
    // The source goes in a SEPARATE dir, not ~/.f/f.config.json: allSources()
    // merges the global config with the project one, and a project
    // f.config.json found by walking up from cwd would add its own sources —
    // for the harness that is the repo's ./fcli-ucks, which shadowed this
    // fixture's source and made the child never see it.
    writeFileSync(join(home, "proj", "f.config.json"), JSON.stringify({ ucks: [join(home, ".f", "ucks", "fcli-ucks")] }));

    const { all, code } = f(home, join(home, "proj"), ["creds"]);
    expect(all, `child exit=${code} said: ${JSON.stringify(all)}`).toMatch(/refusing local source/);
    // The point of the guard: the bucket is untouched, not partly copied.
    expect(readdirSync(bucket).sort()).toEqual(before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test("C1a: the same hazard spelled through a symlink is still refused", () => {
  const home = mkdtempSync(join(tmpdir(), "f-c1s-"));
  try {
    const bucket = join(home, ".f", "ucks", "fcli-ucks");
    uckDir(bucket, "creds");
    symlinkSync(join(home, ".f", "ucks"), join(home, "lnk"));
    mkdirSync(join(home, "proj"), { recursive: true });
    writeFileSync(join(home, "proj", "f.config.json"), JSON.stringify({ ucks: [join(home, "lnk", "fcli-ucks")] }));

    const { all, code } = f(home, join(home, "proj"), ["creds"]);
    expect(all, `child exit=${code} said: ${JSON.stringify(all)}`).toMatch(/refusing local source/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test("a legitimate local source still installs — including paths 0.3.0 mangled", () => {
  const home = mkdtempSync(join(tmpdir(), "f-loc-"));
  try {
    // Space in the path: 0.3.0 resolved './my ucks' through a file:// URL and
    // got '/tmp/…/my%20ucks', so the source vanished as "not found".
    const work = join(home, "work", "my ucks");
    uckDir(work, "creds");
    uckDir(work, "gh");
    // Deliberately RELATIVE and containing a space: that is the 0.3.0
    // regression under test ("../work/my ucks" -> "/tmp/…/my%20ucks" ->
    // "local uck not found"). Keep it relative; absolutising it would stop
    // exercising resolve(). Config lives in a proj dir under HOME so the
    // harness's own project f.config.json cannot add sources (allSources
    // merges global + project).
    const proj = join(home, "home", "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "f.config.json"), JSON.stringify({ ucks: ["../../work/my ucks"] }));

    const { all, code } = f(join(home, "home"), proj, ["help"]);
    expect(all, `child exit=${code}`).not.toMatch(/refusing|not found/);
    expect(all).toMatch(/creds/);
    expect(all).toMatch(/gh/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
