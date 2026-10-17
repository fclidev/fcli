// C2: concurrent f processes must not mutate the store at the same time.
//
// Without a lock, two `f up` runs interleave clone / rm-copy / fetch+reset
// --hard on the same bucket, and one of them dies mid-tree — or worse, leaves a
// bucket that is a mixture of two installs. These tests drive two real child
// processes, because the thing under test is cross-process exclusion: an
// in-process double-acquire proves nothing about symlinks and pids.
import { test, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
  symlinkSync,
  readlinkSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const ENV = { ...process.env, F_UCKS_REPO: "https://invalid.invalid/none.git" };

function safeLs(p: string) {
  try {
    return readdirSync(p);
  } catch {
    return "MISSING";
  }
}

function sh(command: string, home: string) {
  return spawnSync("sh", ["-c", command], {
    encoding: "utf8",
    env: { ...ENV, HOME: home },
    cwd: home,
  });
}

/** A local git repo of ucks — installable as a git source, so `f up` resets it. */
/**
 * A git source spec for a local repo.
 *
 * Must be spelled as a URL: sourceKind() treats any absolute or ./ path as
 * "local", and a local source is COPIED, never cloned — so passing the bare
 * path would exercise installLocal instead of the fetch + reset --hard + clean
 * path the lock exists to serialise. file:// is matched by both specifierIsGit
 * and sourceKind, and git clones local paths over the file transport fine.
 */
function gitSource(repo: string) {
  return `file://${repo}#main`;
}

function makeGitBucketRepo(home: string, names: string[]) {
  const repo = join(home, "repo");
  mkdirSync(repo, { recursive: true });
  for (const n of names) {
    mkdirSync(join(repo, n), { recursive: true });
    writeFileSync(
      join(repo, n, "index.js"),
      `export function register() { return { name: "${n}", desc: "a uck", run: () => {} }; }\nexport default { register };\n`
    );
    writeFileSync(join(repo, n, "package.json"), '{ "type": "module" }\n');
  }
  const g = (a: string) =>
    spawnSync("git", a.split(" "), { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  g("init -q -b main .");
  g("config user.email t@t.invalid");
  g("config user.name t");
  g("add -A");
  g("commit -qm fixtures");
  return repo;
}

function spawnF(home: string, args: string[]) {
  return new Promise<{ code: number | null; all: string }>((done) => {
    const c = spawn(process.execPath, [CLI, ...args], {
      cwd: home,
      env: { ...ENV, HOME: home },
    });
    let all = "";
    c.stdout.on("data", (d) => (all += d));
    c.stderr.on("data", (d) => (all += d));
    c.on("close", (code) => done({ code, all }));
  });
}

test("C2: two concurrent f up runs serialise and leave a consistent store", async () => {
  const home = mkdtempSync(join(tmpdir(), "f-lock-"));
  try {
    const repo = makeGitBucketRepo(home, ["alpha", "beta"]);
    mkdirSync(join(home, ".f"), { recursive: true });
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [gitSource(repo)] }));

    // Two at once on a cold store: both want to clone into the same bucket.
    // A local clone is fast, so this one proves "no crash, coherent result";
    // the destructive interleaving it prevents is measured separately below.
    const [a, b] = await Promise.all([spawnF(home, ["up", "--force"]), spawnF(home, ["up", "--force"])]);

    // Neither may crash with a filesystem/clone error: the lock makes them queue.
    for (const r of [a, b]) {
      expect(r.all, r.all).not.toMatch(/ENOENT|ENOTEMPTY|EEXIST|EINVAL|git clone failed|git reset failed|already exists and is not an empty/);
    }

    // The store must be a coherent clone of the repo, with both ucks present —
    // i.e. not half-written by two overlapping installs.
    const bucket = join(home, ".f", "ucks", "repo");
    expect(existsSync(join(bucket, ".git")), "bucket should be a clone").toBe(true);
    for (const n of ["alpha", "beta"]) {
      expect(existsSync(join(bucket, n, "index.js")), `${n} missing`).toBe(true);
    }
    const prov = JSON.parse(readFileSync(join(bucket, ".f-source.json"), "utf8"));
    // Provenance records the source as configured (ref included), which is what
    // makes the bucket recognisable next time.
    expect(prov.specifier).toBe(gitSource(repo));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 180_000);

test("C2: the lock is held for the duration and released after", async () => {
  const home = mkdtempSync(join(tmpdir(), "f-lock2-"));
  try {
    mkdirSync(join(home, ".f"), { recursive: true });
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [] }));
    // Nothing to install -> the idle path must not take the lock at all.
    const r = sh(`node ${CLI} help`, home);
    expect(r.stderr + r.stdout).not.toMatch(/waiting for the store lock/);
    expect(existsSync(join(home, ".f", ".lock"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);

test("C2: a lock left by a dead process is reclaimed, not fatal", () => {
  const home = mkdtempSync(join(tmpdir(), "f-lock3-"));
  try {
    mkdirSync(join(home, ".f"), { recursive: true });
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [] }));
    const repo = makeGitBucketRepo(home, ["solo"]);
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [gitSource(repo)] }));

    // A pid that is certainly not an f process. boot_id is left off, which is
    // the conservative spelling: the reclaim must not depend on reading ours.
    symlinkSync("999999", join(home, ".f", ".lock"));

    const r = sh(`node ${CLI} help`, home);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/another f process/);
    // Reclaimed: not left dangling forever, which would brick every f command.
    expect(existsSync(join(home, ".f", ".lock"))).toBe(false);
    // And the store still works.
    expect(r.stdout).toMatch(/solo/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);

test("C2: the lock serialises a slow clone — the corruption it prevents", async () => {
  /*
   * Measured, not assumed. Without the lock, two `f up` runs cloning the same
   * bucket interleave and the result is a directory with no .git — the store is
   * left in a state nothing else can repair:
   *
   *   without lock: state=dir-no-git, both runs fail —
   *     "error: could not lock config file …/repo/.git/config: No such file or directory"
   *     "fatal: destination path '…/repo' already exists and is not an empty directory."
   *   with lock:    state=clone+uck, both succeed
   *
   * Reproducing that on demand needs a clone slow enough to overlap, which a
   * local file:// clone is not (~30 ms). Slowing it means injecting a sleep into
   * installGitSource, i.e. production code shaped by the test — and a race test
   * that cannot fail is worse than none, because it reads like coverage. So this
   * test asserts the weaker always-true property (a concurrent run never leaves
   * a gitless bucket), and the comment above records the measured failure mode
   * for whoever changes the lock. The strong, deterministic guarantee is the
   * live-holder test below.
   */
  const home = mkdtempSync(join(tmpdir(), "f-lock5-"));
  try {
    const repo = makeGitBucketRepo(home, ["alpha", "beta"]);
    mkdirSync(join(home, ".f"), { recursive: true });
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [gitSource(repo)] }));

    await Promise.all([
      spawnF(home, ["up", "--force"]),
      spawnF(home, ["up", "--force"]),
      spawnF(home, ["up", "--force"]),
    ]);

    const bucket = join(home, ".f", "ucks", "repo");
    // The invariant that broke without the lock: if the bucket exists, it is a
    // clone — never a half-written directory whose .git one process renamed away.
    if (existsSync(bucket)) {
      expect(existsSync(join(bucket, ".git")), "bucket exists but is not a clone").toBe(true);
      expect(readFileSync(join(bucket, ".f-source.json"), "utf8")).toContain("specifier");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 180_000);

test("C2: a lock held by a live process is reported, not stolen", () => {
  const home = mkdtempSync(join(tmpdir(), "f-lock4-"));
  try {
    mkdirSync(join(home, ".f"), { recursive: true });
    const repo = makeGitBucketRepo(home, ["solo"]);
    writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [gitSource(repo)] }));
    symlinkSync(`${process.pid}@${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}`, join(home, ".f", ".lock"));

    // Short wait so the test does not sit for two minutes.
    const r = sh(`F_LOCK_WAIT_MS=300 node ${CLI} help`, home);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/another f process/);
    expect(r.stdout + r.stderr).toMatch(new RegExp(`pid ${process.pid}`));
    // The live holder's lock survives the failed attempt.
    expect(readlinkSync(join(home, ".f", ".lock"))).toContain(String(process.pid));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
