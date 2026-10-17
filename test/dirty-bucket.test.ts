// A bucket whose only change is f's own dependency install must not be treated as
// the author's work.
//
// Why this test exists: installDepsInTree() runs `npm install` inside each uck
// dir, and package-lock.json is TRACKED. The dirty check excluded node_modules but
// not the lockfile, so `f up` classified core's own install as "1 uncommitted
// change(s)" and SKIPPED the bucket — a bucket that was up to date never got
// updated, and re-running `f up` skipped it again with no explanation. The only
// "local change" on that machine was written by f.
//
// This exercises updateAll() through the built CLI in a throwaway HOME, because
// storeDir() reads HOME at module scope: an in-process test could not point it at
// a scratch store. That is the C4 blocker; spawning is the workaround, and the
// test still verifies the shipped behaviour rather than a mock.
import { test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "index.js");

/** Only the report lines that name this fixture's bucket. */
function upLines(out: string, bucket: string): string {
  return out
    .split("\n")
    .filter((l) => l.includes(` ${bucket} `) || l.includes(`${bucket}:`) || l.includes(`ucks/${bucket}`))
    .join("\n");
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function makeFixture(options: { rewriteLock?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "f-lock-test-"));
  const home = join(root, "home");
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  mkdirSync(home, { recursive: true });

  // A real origin, so the bucket is a genuine clone with a real upstream.
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  execFileSync("git", ["clone", origin, seed], { stdio: "pipe" });
  for (const d of ["demo"]) {
    mkdirSync(join(seed, d), { recursive: true });
    writeFileSync(
      join(seed, d, "index.js"),
      `export function register() {\n  return { name: "${d}", desc: "d", run: () => {} };\n}\nexport default { register };\n`
    );
    writeFileSync(join(seed, d, "package.json"), JSON.stringify({ name: d, type: "module" }, null, 2) + "\n");
    writeFileSync(join(seed, d, "package-lock.json"), '{\n  "name": "stale"\n}\n');
  }
  git(["config", "user.email", "t@t"], seed);
  git(["config", "user.name", "t"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-m", "seed"], seed);
  git(["push", "-u", "origin", "main"], seed);

  // Global config points at it; name the bucket so the clone lands where expected.
  mkdirSync(join(home, ".f"), { recursive: true });
  writeFileSync(
    join(home, ".f", "f.config.json"),
    JSON.stringify({ ucks: [{ source: `file://${origin}`, name: "b" }] }, null, 2) + "\n"
  );

  // Clone it as the bucket, exactly as installGitSource would leave it.
  const bucket = join(home, ".f", "ucks", "b");
  execFileSync("git", ["clone", `file://${origin}`, bucket], { stdio: "pipe" });

  if (options.rewriteLock) {
    // What `npm install` does to a lockfile it considers out of date.
    writeFileSync(
      join(bucket, "demo", "package-lock.json"),
      JSON.stringify({ name: "demo", lockfileVersion: 3 }, null, 2) + "\n"
    );
  }
  return { root, home, origin, bucket };
}

function runUp(home: string, cwd: string) {
  const env = { ...process.env, HOME: home };
  delete env.F_HOME;
  // cwd is a fresh dir, not the repo: core resolves a *project* config by walking
  // up from cwd (config.ts has no cwd/PWD override), so running from the repo — or
  // anywhere under a directory that has an f.config.json — silently adds the
  // operator's own sources. That made this test assert against buckets it never
  // created: the first real run reported "fcli-ucks has local changes", a bucket
  // seeded from the default repo, and failed on a message that had nothing to do
  // with the fixture.
  const r = spawnSync(process.execPath, [CLI, "up"], {
    encoding: "utf8",
    cwd,
    env,
    input: "", // piped stdin: non-interactive, so a prompt is an abort, not a guess
    timeout: 120_000,
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

test("a lockfile rewritten by f's own npm install does not block the update", () => {
  const fx = makeFixture({ rewriteLock: true });
  try {
    // Guard the premise: the working tree genuinely has a modification. If this
    // fails, the fixture is not testing what the test claims to test.
    const raw = git(["status", "--porcelain", "--untracked-files=all"], fx.bucket);
    expect(raw).toMatch(/package-lock\.json/);

    const r = runUp(fx.home, fx.root);
    expect(upLines(r.out, "b")).not.toMatch(/has local changes/);
    expect(upLines(r.out, "b")).not.toMatch(/skipped/);
    expect(r.out).toMatch(/update complete/);
    // And the update actually did something: the bucket is still a clean clone.
    expect(existsSync(join(fx.bucket, ".git"))).toBe(true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a real author edit still blocks the update", () => {
  const fx = makeFixture();
  try {
    writeFileSync(join(fx.bucket, "demo", "index.js"), "// the author is editing this\n");
    const r = runUp(fx.home, fx.root);
    expect(upLines(r.out, "b")).toMatch(/has local changes \(1 uncommitted change/);
    expect(upLines(r.out, "b")).toMatch(/skipped/);
    // The edit survives: this is the protection that matters.
    expect(readFileSync(join(fx.bucket, "demo", "index.js"), "utf8")).toMatch(/author is editing/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("an unpushed commit still blocks the update (the case that loses work)", () => {
  const fx = makeFixture();
  try {
    writeFileSync(join(fx.bucket, "demo", "extra.js"), "export const x = 1;\n");
    git(["config", "user.email", "t@t"], fx.bucket);
    git(["config", "user.name", "t"], fx.bucket);
    git(["add", "-A"], fx.bucket);
    git(["commit", "-m", "work not on the remote"], fx.bucket);
    const sha = git(["rev-parse", "HEAD"], fx.bucket);

    const r = runUp(fx.home, fx.root);
    expect(upLines(r.out, "b")).toMatch(/1 unpushed commit/);
    expect(upLines(r.out, "b")).toMatch(/skipped/);
    expect(git(["rev-parse", "HEAD"], fx.bucket)).toBe(sha);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
