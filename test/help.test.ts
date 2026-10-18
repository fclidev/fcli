// Discovery cost has to stay bounded as the store grows. `f help` used to print
// name + desc for every uck, which grows linearly (measured: ~21 tokens per uck
// on real descriptions, so 60 ucks costs ~1,300 tokens). It now prints names
// only, and `f search` returns a filtered set with short descriptions.
//
// These assert the properties that make that true, rather than exact output, so
// rewording the banner does not break them. `f search` ranking is a uck now; its
// tests live in fcli-ucks/search/test/cli.test.mjs.
import { test, expect } from "vitest";
import {
  helpNames,
  searchMatches,
  searchUsage,
  SEARCH_DESC_MAX,
} from "../src/help.js";
import { clampDesc, DESC_MAX } from "../src/types.js";

const uck = (name: string, desc: string) => ({
  name,
  desc: clampDesc(desc),
  run: () => {},
});

const SMALL = [
  uck(
    "creds",
    "store credentials (scrypt+AES-GCM, daemon+socket, ttl); falls back to credential providers on a miss",
  ),
  uck("ls", "list files (terse, one per line)"),
  uck("config", "edit f.config.json via JSONPath (get/set/add/remove/list)"),
  uck(
    "ha",
    "Home Assistant: states, service calls, scenes, automations, history, weather",
  ),
];

const big = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    uck(
      `uck${String(i).padStart(3, "0")}`,
      `does a thing with arguments and some more description text ${i}`,
    ),
  );

test("help lists names only — no descriptions", () => {
  const out = helpNames(SMALL, "9.9.9");
  expect(out).toContain("creds");
  expect(out).toContain("ls");
  // The whole point: descriptions must not be in the default output.
  expect(out).not.toContain("scrypt");
  expect(out).not.toContain("Home Assistant");
  expect(out).toContain("f v9.9.9");
});

test("help points at both ways to get detail", () => {
  const out = helpNames(SMALL, "9.9.9");
  expect(out).toMatch(/f <uck> --help/);
  expect(out).toMatch(/f search/);
});

test("help cost is driven by name count, not description length", () => {
  // Both lists hold 60 ucks; one has maximum-length descriptions. If help still
  // printed descriptions, the second would dwarf the first. Names-only output
  // makes them identical — that is the property, and it is the reason the
  // listing no longer sets an upper bound on discovery cost.
  const shortDesc = Array.from({ length: 60 }, (_, i) =>
    uck(`uck${String(i).padStart(3, "0")}`, "a"),
  );
  const longDesc = Array.from({ length: 60 }, (_, i) =>
    uck(
      `uck${String(i).padStart(3, "0")}`,
      "an extremely long description ".repeat(8) + i,
    ),
  );
  expect(helpNames(longDesc, "9.9.9")).toBe(helpNames(shortDesc, "9.9.9"));
});

test("help is a grid, not one-per-line, so it stays compact", () => {
  const out = helpNames(big(30), "9.9.9");
  const lines = out.trim().split("\n");
  // 30 names must fit in far fewer than 30 lines.
  const nameLines = lines.filter((l) => l.includes("uck000"));
  expect(nameLines.length).toBe(1);
  expect(lines.length).toBeLessThan(15);
});
