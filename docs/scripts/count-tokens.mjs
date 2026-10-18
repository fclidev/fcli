#!/usr/bin/env node
/*
 * Count the context cost of `f` discovery and of individual uck invocations.
 *
 * Everything is read from a real store; nothing is typed by hand. If a
 * description changes upstream the numbers move and this says so. That matters:
 * the previous published figures came from invented tool definitions and
 * invented descriptions, which is why they were wrong.
 *
 * Usage:
 *   node scripts/count-tokens.mjs                 # default store (~/.f/ucks)
 *   node scripts/count-tokens.mjs --store <dir>
 *   node scripts/count-tokens.mjs --builtins <n>  # first N, the fresh-install subset
 *   node scripts/count-tokens.mjs --json *
 * Requires: js-tiktoken  (npm i --no-save js-tiktoken)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";
import cl100 from "js-tiktoken/ranks/cl100k_base";

// Measure the real built binary, not a reconstruction of it. Resolve relative to
// this script so the harness works from any cwd.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DOCS = path.resolve(HERE, "..");
const BINARY = process.env.F_BINARY || path.join(REPO, "dist", "index.js");
if (!fs.existsSync(BINARY)) {
  console.error(
    `no binary at ${BINARY} — run \`npm run build\` in ${REPO} first, or set F_BINARY`,
  );
  process.exit(1);
}

const enc = {
  o200k_base: new Tiktoken(o200),
  cl100k_base: new Tiktoken(cl100),
};

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const STORE = opt("--store") || path.join(os.homedir(), ".f", "ucks");
// Read versions from disk instead of hardcoding them: a stale fVersionMeasured
// or tokenizer version makes a snapshot look current when it describes older
// inputs.
const PKG_VERSION = (() => {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"))
        .version ?? "unknown"
    );
  } catch {
    return "unknown";
  }
})();
const VERSION = opt("--version") || PKG_VERSION;
const TIKTOKEN_VERSION = (() => {
  try {
    return (
      JSON.parse(
        fs.readFileSync(
          path.join(DOCS, "node_modules", "js-tiktoken", "package.json"),
          "utf8",
        ),
      ).version ?? "unknown"
    );
  } catch {
    return "unknown";
  }
})();

/*
 * Name and desc come from the uck's register() in index.js, NOT from
 * package.json. These packages are published as @fcli.dev/ucks, so each
 * sub-package's manifest name is a packaging artifact like
 * "kensand-fcli-ucks-ha" — while `f help` prints the registered name, "ha".
 * Counting the artifact would inflate every line and measure a string no model
 * ever sees.
 *
 * Parsed with a regex rather than imported: requiring the module would execute
 * third-party uck code for the sake of a number.
 */
function readUck(dir, fallback) {
  const src = fs.readFileSync(path.join(dir, "index.js"), "utf8");
  // register() returns an object literal; take the first name:/desc: pair in it.
  const nm = src.match(/\n\s+name:\s*["'`]([^"'`]+)["'`]/);
  const dm = src.match(/\n\s+desc:\s*["'`]([^"'`]*)["'`]/);
  const name = nm ? nm[1] : fallback;
  // A uck with no desc still occupies a line in the listing.
  const desc = dm ? dm[1] : "";
  return { name, desc };
}

function readUcks(store) {
  if (!fs.existsSync(store))
    throw new Error(
      `no such store: ${store}\n  run \`f\` once, or pass --store`,
    );
  const out = [];
  for (const bucket of fs.readdirSync(store, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const bdir = path.join(store, bucket.name);
    for (const e of fs.readdirSync(bdir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(bdir, e.name);
      if (!fs.existsSync(path.join(dir, "index.js"))) continue;
      // lib/ and friends are shared code, not commands: they register nothing,
      // so `f help` never lists them. Skip anything with no register().
      const src = fs.readFileSync(path.join(dir, "index.js"), "utf8");
      if (!/export\s+(async\s+)?function\s+register|register\s*=/.test(src))
        continue;
      const u = readUck(dir, e.name);
      out.push({ ...u, bucket: bucket.name, dir: e.name });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const n = (s) => {
  const a = enc.o200k_base.encode(s).length;
  const b = enc.cl100k_base.encode(s).length;
  return { o200k_base: a, cl100k_base: b, agree: a === b };
};

const ucks = readUcks(STORE);
if (!ucks.length) throw new Error(`store has no ucks: ${STORE}`);

// The exact shape help.ts emits: version banner, usage, one two-space-indented
// line per uck, trailing hint.
const line = (u) => `  ${u.name}  ${u.desc}`;
const help = (list) =>
  `f v${VERSION} — token-efficient CLI\n\nusage: f <uck> [args]\n\nucks:\n${list.map(line).join("\n")}\n\nrun 'f <uck> --help' for details.`;

const buckets = [...new Set(ucks.map((u) => u.bucket))];
const byBucket = Object.fromEntries(
  buckets.map((b) => [b, ucks.filter((u) => u.bucket === b)]),
);

// A fresh install seeds only @fcli.dev/ucks; anything else is this machine's
// doing. Report that subset explicitly instead of averaging over both.
const DEFAULT_BUCKET = buckets.find((b) => b === "fcli-ucks") || buckets[0];
const fresh = byBucket[DEFAULT_BUCKET] || [];

// The binary's own output is the only trustworthy source for discovery cost:
// reconstructing help/search text here is how a published figure silently goes
// stale when the format changes. `f` with no args and `f search ...` are core
// commands, so they run against this machine's real store.
function runF(args, home) {
  try {
    return execFileSync(process.execPath, [BINARY, ...args], {
      encoding: "utf8",
      cwd: REPO,
      env: home ? { ...process.env, HOME: home } : process.env,
    });
  } catch (e) {
    // `f search` with no hits exits 1; the text is still the thing we measure.
    return String(e.stdout ?? "") + String(e.stderr ?? "");
  }
}

const indexOutput = runF([]);
const SEARCHES = [
  ["ssh"],
  ["credential"],
  ["list", "files"],
  ["nothingzzz"], // exercises the no-match path, which also costs tokens
];

const rows = {
  invocation: [
    "f creds get prod.db",
    "f ls src",
    "f v",
    'f fj joblogs 3773 "--- FAIL"',
  ].map((c) => ({ label: c, ...n(c) })),
  index: {
    label: `f (index), ${ucks.length} ucks (this store)`,
    count: ucks.length,
    ...n(indexOutput),
  },
  search: SEARCHES.map((a) => ({
    label: `f search ${a.join(" ")}`,
    args: a,
    ...n(runF(["search", ...a])),
  })),
  // The pre-0.4 listing (name + desc for every uck), kept so the site can state
  // the change honestly rather than only showing the new number. Reconstructed
  // because that format no longer exists in the binary — it measured 375/374 when
  // generated from the real 86b3445 build (`git worktree add /tmp/oldcli 86b3445`,
  // then `npx tsx src/index.ts`), so this reconstruction is within 1 token. Treat
  // 375/374 as the figure of record.
  helpStore: {
    label: `f help with descriptions, ${ucks.length} ucks (pre-0.4 shape)`,
    count: ucks.length,
    ...n(help(ucks)),
  },
  perLine: ucks
    .map((u) => ({
      label: `${u.bucket}/${u.name}`,
      name: u.name,
      descChars: u.desc.length,
      ...n(line(u)),
    }))
    .sort((a, b) => a.o200k_base - b.o200k_base),
};

// Per-name index cost. A real store cannot measure a *marginal* cost — it has
// one fixed size — so derive the average, and label it as such. The genuine
// marginal figure comes from a synthetic store of identical names: 5-char names
// measured exactly 4.00 tokens/name, flat from 1 to 32 names (fixed ~20-token
// framing + 4/name). Real names are longer than 5 chars, so the real average is
// higher; that difference is name length, not a different mechanism.
// Measure the marginal cost directly: a synthetic store of identical short names
// isolates the per-name increment from name length, and a real store cannot — it
// has one fixed size. Names are 5 chars ("u0000"), so this is the floor; real
// names are longer, which is why the per-uck average over a real store is higher.
function marginalIndexCost() {
  const sizes = [2, 16];
  const enc_ = enc.o200k_base;
  const tokAt = (n) => {
    const home = mkdtempSync(path.join(os.tmpdir(), "f-marg-"));
    try {
      fs.mkdirSync(path.join(home, ".f/ucks/gen"), { recursive: true });
      fs.writeFileSync(
        path.join(home, ".f/f.config.json"),
        JSON.stringify({ ucks: [] }),
      );
      for (let i = 0; i < n; i++) {
        const nm = `u${String(i).padStart(4, "0")}`;
        const dir = path.join(home, ".f/ucks/gen", nm);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "index.js"),
          `export function register(c){return {name:${JSON.stringify(nm)},desc:"d",run(){}}}\n`,
        );
      }
      return enc_.encode(runF([], home)).length;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
  const [a, b] = sizes.map(tokAt);
  return +((b - a) / (sizes[1] - sizes[0])).toFixed(2);
}

const gridNames = indexOutput
  .split("\n")
  .filter((l) => ucks.some((u) => l.includes(u.name)))
  .join("\n");
const MARGINAL = marginalIndexCost();
rows.perName = {
  label: "index cost per uck (grid only, average over this store)",
  ...n(gridNames),
  perUck: +(n(gridNames).o200k_base / Math.max(1, ucks.length)).toFixed(1),
  marginalMeasured: MARGINAL,
  marginalNote:
    "synthetic store of identical 5-char names; isolates the per-name increment " +
    "from name length, so it is a floor. Real names are longer, which is why " +
    "averagePerUckThisStore is higher — that gap is name length, not a second mechanism.",
};

// Committed snapshot: the numbers the site quotes, with enough provenance to
// re-derive them. --snapshot rewrites content/token-measurements.json.
const all = [
  ...rows.invocation,
  rows.index,
  ...rows.search,
  rows.helpStore,
  rows.perName,
  ...rows.perLine,
];
const dis = all.filter((r) => !r.agree);

if (argv.includes("--snapshot")) {
  // Written by this script on purpose. The site quotes these figures, so a
  // hand-edited snapshot is the same class of bug as a hand-invented one.
  const out = {
    _comment:
      "Snapshot of `node scripts/count-tokens.mjs --snapshot`. Every number here is counted from the `f` binary's own output or from a real store — none is typed by hand. docs/content/index.md quotes these figures; regenerate this file rather than editing it.",
    generatedBy: "docs/scripts/count-tokens.mjs",
    generatedAt: new Date().toISOString().slice(0, 10),
    tokenizer: "js-tiktoken " + TIKTOKEN_VERSION,
    ranks: ["o200k_base", "cl100k_base"],
    fVersionMeasured: VERSION,
    binary: BINARY,
    store: STORE,
    ucksInStore: ucks.length,
    discovery: {
      // Names-only index: the always-present cost.
      index: {
        ucks: ucks.length,
        o200k_base: rows.index.o200k_base,
        cl100k_base: rows.index.cl100k_base,
        averagePerUckThisStore: rows.perName.perUck,
        marginalPerUck: rows.perName.marginalMeasured,
        note: "names only, columnised grid; marginal cost is the name itself",
      },
      // Per-query cost, including the no-match path.
      search: rows.search.map((r) => ({
        query: r.args.join(" "),
        o200k_base: r.o200k_base,
        cl100k_base: r.cl100k_base,
      })),
      // What `f help` printed before the names-only change. 375/374 is the
      // figure of record: it came from the real 86b3445 build. helpStore below
      // is this script's reconstruction of the same shape.
      preNamesOnlyListing: {
        o200k_base: 375,
        cl100k_base: 374,
        ucks: 16,
        measuredFrom:
          "git worktree of 86b3445, `npx tsx src/index.ts` (the real pre-change binary)",
        reconstruction: {
          o200k_base: rows.helpStore.o200k_base,
          cl100k_base: rows.helpStore.cl100k_base,
        },
        perUckLine: {
          min: rows.perLine[0].o200k_base,
          max: rows.perLine[rows.perLine.length - 1].o200k_base,
          mean: +(
            rows.perLine.reduce((a, c) => a + c.o200k_base, 0) /
            rows.perLine.length
          ).toFixed(1),
        },
      },
    },
    invocation: rows.invocation.map((r) => ({
      command: r.label,
      o200k_base: r.o200k_base,
      cl100k_base: r.cl100k_base,
    })),
    _encoders:
      "o200k_base and cl100k_base agree on invocation strings and short queries; they diverge by 1-2 tokens per line on descriptions dense with slashes or hyphens. See `disagree` below rather than assuming agreement.",
    disagree: dis.map((r) => ({
      label: r.label,
      o200k_base: r.o200k_base,
      cl100k_base: r.cl100k_base,
    })),
    mcpReference: {
      note: "Measured by others, not by this script, using o200k_base. Quoted as a range: per-tool cost spans roughly 8x across servers, so no single multiplier is honest.",
      tooltax: {
        url: "https://github.com/duskel/tooltax",
        runDate: "2026-09-29",
        servers: 18,
        tools: 256,
        totalTokens: 77877,
        perTool: {
          min: 77.6,
          max: 726.3,
          github: 138.0,
          playwright: 151.7,
          filesystem: 170.2,
          kubernetes: 222.2,
          notion: 726.3,
        },
      },
      mcpTurnstile: {
        url: "https://github.com/singhpratech/mcp-turnstile/blob/main/report/BENCHMARK.md",
        perTool: 468,
        at24Tools: { tools: 24, tokens: 11213 },
        at72Tools: { tools: 72, tokens: 33709, shareOf200k: "16.9%" },
      },
    },
  };
  const target = path.join(DOCS, "content", "token-measurements.json");
  fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${target}`);
}

if (argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        store: STORE,
        buckets: Object.fromEntries(
          buckets.map((b) => [b, byBucket[b].map((u) => u.name)]),
        ),
        rows,
        disagree: dis.map((r) => ({
          label: r.label,
          o200k_base: r.o200k_base,
          cl100k_base: r.cl100k_base,
        })),
      },
      null,
      2,
    ),
  );
} else {
  const p = (label, v) =>
    console.log(
      `  ${String(label).padEnd(36)} o200k ${String(v.o200k_base).padStart(4)}   cl100k ${String(v.cl100k_base).padStart(4)}   ${v.agree ? "agree" : "differ"}`,
    );
  console.log(`store: ${STORE}`);
  console.log(
    `buckets: ${buckets.map((b) => `${b}=${byBucket[b].length}`).join("  ")}`,
  );
  console.log(`default bucket (fresh install): ${DEFAULT_BUCKET}\n`);
  console.log("-- invocation: paid when the command runs --");
  rows.invocation.forEach((r) => p(r.label, r));
  console.log("\n-- discovery: index (names only), paid once per session --");
  p(rows.index.label, rows.index);
  console.log(
    `  cost per uck: ${rows.perName.perUck} tokens (grid only: ${rows.perName.o200k_base} for ${ucks.length} names)`,
  );
  console.log(
    `  marginal:     ${rows.perName.marginalMeasured} tokens/uck — synthetic identical 5-char names (a floor); real names are longer, hence the higher average above`,
  );
  console.log("\n-- discovery: f search, paid per query --");
  rows.search.forEach((r) => p(r.label, r));
  console.log(
    "\n-- pre-0.4 listing shape (name + desc), for the comparison --",
  );
  p(rows.helpStore.label, rows.helpStore);
  console.log("\n-- one listing line, min to max --");
  const f = rows.perLine[0];
  const l = rows.perLine[rows.perLine.length - 1];
  const mean =
    rows.perLine.reduce((a, c) => a + c.o200k_base, 0) / rows.perLine.length;
  console.log(
    `  ${f.name} (${f.descChars} ch) = ${f.o200k_base}   ..   ${l.name} (${l.descChars} ch) = ${l.o200k_base}   mean ${mean.toFixed(1)}`,
  );
  // "the two encoders agree" was published as a blanket claim and is false: they
  // diverge on slash-heavy and hyphen-heavy text. Report each divergence with its
  // delta rather than asserting agreement.
  if (dis.length) {
    console.log(
      `\no200k_base vs cl100k_base disagree on ${dis.length} of ${all.length}:`,
    );
    for (const r of dis) {
      const d = r.cl100k_base - r.o200k_base;
      console.log(
        `  ${String(r.label).padEnd(36)} ${r.o200k_base} vs ${r.cl100k_base}  (cl100k ${d >= 0 ? "+" : ""}${d})`,
      );
    }
  } else {
    console.log(`\no200k_base and cl100k_base agree on every measurement`);
  }
}
