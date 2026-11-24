// `f up` must exit non-zero when a source fails to install.
//
// Why this test exists: installSource() answers "did store content change?", and a
// FAILED install and a NO-OP refresh both answer false. runSources() counted those
// two together, so the whole update reported success after printing
// `f: failed to install <bucket> (...)` — and exited 0. On a real machine that made
// a permanently broken bucket indistinguishable from an up-to-date one: a stale
// clone holding an old copy of a moved tag makes `git fetch --tags origin` reject
// with `would clobber existing tag`, so EVERY future `f up` for that bucket failed,
// silently, forever. Anything scripting `f up && deploy` read a broken store as a
// refreshed one.
//
// Failure mode, in one line: the failure was on stderr and the exit code said
// success, so the only signal a caller could use was the one that lied.
//
// Driven through the built CLI in a throwaway HOME for the same reason as
// dirty-bucket.test.ts: storeDir() reads HOME at module scope, and cwd is a fresh
// dir so no project f.config.json leaks extra sources into the assertion.
import { test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "index.js");

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * A real origin with a TAG, plus a bucket clone whose copy of that tag points at a
 * DIFFERENT commit. That is the exact state a moved tag produces on a machine that
 * cloned before the move — the trigger for the real outage, reproduced rather than
 * simulated with a mock.
 */
function makeFixture(options: { moveTag: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "f-up-exit-"));
  const home = join(root, "home");
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  mkdirSync(home, { recursive: true });

  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  execFileSync("git", ["clone", origin, seed], { stdio: "pipe" });
  mkdirSync(join(seed, "demo"), { recursive: true });
  writeFileSync(
    join(seed, "demo", "index.js"),
    `export function register() {\n  return { name: "demo", desc: "d", run: () => {} };\n}\nexport default { register };\n`
  );
  writeFileSync(
    join(seed, "demo", "package.json"),
    JSON.stringify({ name: "demo", type: "module" }, null, 2) + "\n"
  );
  git(["config", "user.email", "t@t"], seed);
  git(["config", "user.name", "t"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-m", "first"], seed);
  git(["push", "-u", "origin", "main"], seed);

  // Tag, then a second commit and a tag MOVE. The bucket is cloned BETWEEN the two
  // so it holds the pre-move tag object.
  git(["tag", "demo@1.0.0"], seed);
  git(["push", "origin", "demo@1.0.0"], seed);

  const bucket = join(home, ".f", "ucks", "b");
  mkdirSync(join(home, ".f"), { recursive: true });
  execFileSync("git", ["clone", `file://${origin}`, bucket], { stdio: "pipe" });

  if (options.moveTag) {
    writeFileSync(join(seed, "demo", "more.js"), "export const x = 1;\n");
    git(["add", "-A"], seed);
    git(["commit", "-m", "second"], seed);
    git(["tag", "-f", "demo@1.0.0"], seed);
    git(["push", "-f", "origin", "demo@1.0.0"], seed);
  }

  writeFileSync(
    join(home, ".f", "f.config.json"),
    JSON.stringify({ ucks: [{ source: `file://${origin}`, name: "b" }] }, null, 2) + "\n"
  );
  return { root, home, origin, bucket };
}

function runUp(home: string, cwd: string) {
  const env = { ...process.env, HOME: home };
  delete env.F_HOME;
  const r = spawnSync(process.execPath, [CLI, "up"], {
    encoding: "utf8",
    cwd,
    env,
    input: "",
    timeout: 120_000,
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

test("a bucket whose fetch is rejected makes `f up` exit non-zero", () => {
  const fx = makeFixture({ moveTag: true });
  const blank = join(fx.root, "blank");
  mkdirSync(blank, { recursive: true });
  try {
    const first = runUp(fx.home, blank);
    // Guard the premise first: if the fetch did not actually reject, this test
    // would be asserting against a healthy bucket and could pass for nothing.
    expect(first.out).toMatch(/failed to install/);
    expect(first.out).toMatch(/clobber|would clobber|rejected|fetch/i);

    // The assertion that failed before the fix: the message was there and the code
    // was still 0.
    expect(first.status).toBe(1);

    // And the summary must name the failure, not just the exit code — an operator
    // reading `3 unchanged` on a broken bucket is the same lie in a different place.
    expect(first.out).toMatch(/FAILED/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a healthy bucket still exits 0 and reports no failure (no false alarm)", () => {
  const fx = makeFixture({ moveTag: false });
  const blank = join(fx.root, "blank");
  mkdirSync(blank, { recursive: true });
  try {
    const r = runUp(fx.home, blank);
    expect(r.out).not.toMatch(/failed to install/);
    expect(r.out).not.toMatch(/FAILED/);
    expect(r.status).toBe(0);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
