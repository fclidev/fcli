// C5: an error path must not destroy the output a uck already produced.
//
// 0.3.0 called process.exit(1) in the unknown-uck and catch paths. Node's
// stdout is async when it is a pipe, so data already "written" sat in libuv's
// buffer and was discarded: a uck that printed 64 KB then threw returned
// nothing, and `f <unknown>` swallowed install/load output from earlier in the
// same run. It is also a secret path — whether a printed secret survived
// depended on buffer size, which is not a policy (CONTRACT.md N17).
//
// Run through a real pipe, not a capture: the bug only exists for piped
// stdout, and that is exactly how f is invoked (agent captures output, `| head`).
import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

/** Run the CLI with stdout and stderr BOTH piped; collect them interleaved. */
function piped(home: string, cwd: string, args: string[]) {
  return new Promise<{ out: string; err: string; code: number | null }>((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { HOME: home, PATH: process.env.PATH, F_UCKS_REPO: "https://invalid.invalid/none.git" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => done({ out, err, code }));
  });
}

/**
 * Point HOME's global config at the fixture bucket.
 *
 * Global, not project: allSources() merges both, and a project f.config.json
 * found by walking up from cwd would add the harness's own sources on top. An
 * explicit global config also stops ensureGlobalConfig() from seeding the
 * default repo, so the invalid F_UCKS_REPO above is never even fetched.
 */
function useBucket(home: string, bucket: string) {
  writeFileSync(join(home, ".f", "f.config.json"), JSON.stringify({ ucks: [bucket] }));
}

function writeUck(parent: string, name: string, body: string) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.js"), body);
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
}

/** HOME whose store holds exactly one bucket with one uck. */
function fixtureHome() {
  const home = mkdtempSync(join(tmpdir(), "f-drain-"));
  // The bucket lives OUTSIDE the store on purpose: a source inside storeDir()
  // is refused outright (C1a), and the loader would install it anyway for a
  // local source. Keeping fixtures outside the store tests dispatch, not the
  // install guard.
  const bucket = join(home, "src", "fx");
  mkdirSync(bucket, { recursive: true });
  mkdirSync(join(home, ".f"), { recursive: true });
  return { home, bucket };
}

test("C5: a uck that prints then throws keeps what it printed", async () => {
  const { home, bucket } = fixtureHome();
  useBucket(home, bucket);
  // Payload must EXCEED the pipe capacity. Under it, Linux drains a pipe
  // synchronously (since 2.6.35) and exit() loses nothing, so a small fixture
  // passes against the broken code too — three earlier versions of this test
  // (200 KB, 640 KB, 3 MB) each measured nothing for that reason, and the bug
  // was only visible at 52 MB: shipped 0.3.0 delivered 7.4 MB of 52.5 MB.
  // 20k lines (~5.3 MB) is comfortably past the capacity and still cheap to
  // run; do not shrink this toward the buffer size or the test goes vacuous.
  const LINES = 20_000;
  writeUck(
    bucket,
    "chatty",
    // Throws from register(), which is inside core's try/catch (N8) — that catch
    // is the exit() path under test. A throw from run() would be caught by
    // uckmain inside the child uck, not by core, so it would not exercise it.
    [
      `export function register() {`,
      `  for (let i = 0; i < ${LINES}; i++) {`,
      `    process.stdout.write("line-" + i + " " + "x".repeat(250) + "\\n");`,
      `  }`,
      `  throw new Error("boom after printing");`,
      `}`,
      `export default { register };`,
      ``,
    ].join("\n")
  );
  useBucket(home, bucket);
  try {
    const { out, err, code } = await piped(home, home, ["chatty"]);
    expect(err).toMatch(/boom after printing/);
    expect(code).toBe(1);
    // The whole point: stdout survives the error path.
    expect(out).toContain("line-0 ");
    expect(out).toContain("line-" + (LINES - 1) + " ");
    // The full volume, not "most of it": a truncated tail is exactly the bug.
    expect(out.split("\n").filter(Boolean).length).toBe(LINES);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);

test("C5: an unknown uck still emits output produced earlier in the run", async () => {
  const { home, bucket } = fixtureHome();
  // This uck prints at LOAD time (register), which happens before dispatch and
  // is what 0.3.0's unknown-uck exit(1) threw away.
  writeUck(
    bucket,
    "loud",
    `console.log("load-time-output");
export function register() { return { name: "loud", desc: "prints at load", run() {} }; }
export default { register };
`
  );
  useBucket(home, bucket);
  try {
    const { out, err, code } = await piped(home, home, ["no-such-uck"]);
    expect(err).toMatch(/unknown uck/);
    expect(code).toBe(1);
    expect(out).toContain("load-time-output");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);

test("C5: a nonzero exit code still reaches the caller", async () => {
  const { home, bucket } = fixtureHome();
  writeUck(
    bucket,
    "rc7",
    `export function register() { return { name: "rc7", desc: "exits 7", run() { console.log("answer"); return 7; } }; }
export default { register };
`
  );
  useBucket(home, bucket);
  try {
    const { out, code } = await piped(home, home, ["rc7"]);
    expect(code).toBe(7); // G3: numeric return is the exit code
    expect(out).toContain("answer"); // and its stdout survived too
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
