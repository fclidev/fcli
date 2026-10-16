// Contract tests for the f<->uck contract (CONTRACT.md in fcli-ucks):
// G2 desc clamp, G1 minF warning, G3 exit mapping, G9 collision warning,
// G10 one-uck-per-dir.
import { test, expect, vi, beforeEach } from "vitest";
import { clampDesc, cmpVersion, satisfiesMinF, DESC_MAX } from "../src/types.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUckModule as loadUckModuleForTest } from "../src/registry.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

beforeEach(() => vi.restoreAllMocks());

test("cmpVersion orders dotted versions", () => {
  expect(cmpVersion("0.3.0", "0.2.5")).toBe(1);
  expect(cmpVersion("0.2.5", "0.2.5")).toBe(0);
  expect(cmpVersion("0.2.9", "0.3.0")).toBe(-1);
  expect(cmpVersion("1.0.0", "0.9.9")).toBe(1);
});

test("satisfiesMinF: equal satisfies, older does not", () => {
  expect(satisfiesMinF("0.3.0", "0.3.0")).toBe(true);
  expect(satisfiesMinF("0.3.1", "0.3.0")).toBe(true);
  expect(satisfiesMinF("0.2.5", "0.3.0")).toBe(false);
});

test("clampDesc: one line, capped at DESC_MAX with ellipsis", () => {
  expect(clampDesc("short")).toBe("short");
  expect(clampDesc("line1\nline2")).toBe("line1");
  const long = "x".repeat(DESC_MAX + 50);
  const out = clampDesc(long);
  expect(out.length).toBe(DESC_MAX);
  expect(out.endsWith("…")).toBe(true);
});

test("G1: minF below fVersion warns once, uck still loads", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModuleForTest(join(FIX, "minf/index.js"), "minf", "0.2.5", "store:minf");
  expect(ucks.map((u) => u.name)).toEqual(["minf"]);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("needs f >= 0.99.0"));
});

test("G9-style: invalid uck (no run) is dropped with a warning", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModuleForTest(join(FIX, "bad/index.js"), "bad", "0.3.0", "store:bad");
  expect(ucks).toEqual([]);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("invalid uck"));
});

test("G10: multi-uck dir loads only the first, with a warning", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const ucks = await loadUckModuleForTest(join(FIX, "multi/index.js"), "multi", "0.3.0", "store:multi");
  expect(ucks.map((u) => u.name)).toEqual(["multi-a"]);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("one uck per directory"));
});
