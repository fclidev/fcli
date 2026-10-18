// `only` / `except` on a configured source must actually hide ucks.
//
// Regression: filters were read back and applied for git clones (a bucket with a
// .git dir) and silently skipped for npm buckets. A source configured with
// `except: ["ls", "w"]` kept showing `f ls` and `f w`. The config parsed and the
// filters were even written to .f-source.json, then ignored at load. No test
// covered either branch, so both shipped.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, afterEach } from "vitest";
import { installedUcks, storeDir } from "../src/store.js";

const realHome = process.env.HOME;
const homes: string[] = [];
let bucketDir = "";

/**
 * Build a store bucket holding four ucks, shaped like what each install path
 * leaves behind: git clones carry a .git, npm buckets do not.
 *
 * Buckets live under HOME/.f/ucks/<bucket> — fHome() is HOME/.f, so a fixture
 * that writes HOME/ucks is invisible to the loader and every assertion reads
 * back an empty list.
 */
function makeStore(bucket: string, { git }: { git: boolean }) {
  const home = mkdtempSync(join(tmpdir(), "f-filters-"));
  homes.push(home);
  process.env.HOME = home; // fHome() reads HOME on every call
  const dir = join(home, ".f", "ucks", bucket);
  for (const name of ["search", "creds", "ls", "w"]) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(
      join(dir, name, "index.js"),
      "export function register() {}\n",
    );
  }
  // A shared dir with no index.js is never a uck (lib/ in the real bundle).
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "util.js"), "export const x = 1;\n");
  if (git) mkdirSync(join(dir, ".git"), { recursive: true });
  bucketDir = dir;
  return dir;
}

function stamp(filters: Record<string, unknown>) {
  writeFileSync(join(bucketDir, ".f-source.json"), JSON.stringify(filters));
}

afterEach(() => {
  process.env.HOME = realHome;
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

const names = () =>
  installedUcks()
    .map((u) => u.name)
    .sort();

test("fixture is visible to the loader", () => {
  const dir = makeStore("ucks", { git: false });
  expect(existsSync(dir)).toBe(true);
  expect(storeDir()).toBe(join(dir, ".."));
  expect(names()).toEqual(["creds", "ls", "search", "w"]);
});

test("except hides ucks from an npm bucket", () => {
  makeStore("ucks", { git: false });
  stamp({ except: ["ls", "w"] });
  expect(names()).toEqual(["creds", "search"]);
});

test("only restricts an npm bucket to the named ucks", () => {
  makeStore("ucks", { git: false });
  stamp({ only: ["search"] });
  expect(names()).toEqual(["search"]);
});

test("except hides ucks from a git bucket", () => {
  makeStore("kensand-fcli-ucks", { git: true });
  stamp({ except: ["ls"] });
  expect(names()).toEqual(["creds", "search", "w"]);
});

test("only wins when both are present", () => {
  makeStore("ucks", { git: false });
  stamp({ only: ["ls"], except: ["ls"] });
  expect(names()).toEqual(["ls"]);
});

test("a shared dir without index.js is not a uck", () => {
  makeStore("ucks", { git: false });
  expect(names()).not.toContain("lib");
});
