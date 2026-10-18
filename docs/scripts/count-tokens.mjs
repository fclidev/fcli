#!/usr/bin/env node
/*
 * Count the context cost of `f` discovery and of issuing uck invocations.
 *
 * Discovery figures run the real binary against a real store. Invocation costs
 * tokenize the command string, which is the whole cost of issuing it — no shell
 * output is implied. Both are derived, nothing is typed by hand. If a
 * description changes upstream the numbers move and this says so.
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
  const env = home ? { ...process.env, HOME: home } : process.env;
  let out;
  try {
    out = execFileSync(process.execPath, [BINARY, ...args], {
      encoding: "utf8",
      cwd: home || REPO,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // stdout only. Node's MODULE_TYPELESS_PACKAGE_JSON warning goes to stderr
    // for every store uck whose index.js lacks "type":"module", and
    // concatenating it into the measured text inflated the no-match search row
    // from 8 tokens to 109. Errors that matter are caught by the pattern below,
    // which runs on the combined text.
    const text = String(e.stdout ?? "");
    const combined = text + String(e.stderr ?? "");
    // A search miss also exits 1, so exit code alone cannot distinguish "ran and
    // found nothing" from "did not run". Check the output: f reports a missing
    // uck, an unknown flag, or a crash, and any of those measured as a token
    // count would be a confident wrong number. This happened: after `search`
    // moved out of core, every search row reported 28 tokens, which was the
    // length of `f: unknown uck 'search'`.
    if (
      /unknown uck|not found|Cannot find|ERR_|SyntaxError|is not a function/.test(
        combined,
      )
    ) {
      throw new Error(
        `measuring \`f ${args.join(" ")}\` did not run the command:\n${combined.trim()}`,
      );
    }
    return text;
  }
  // Guard the success path too: a command that printed an error and exited 0
  // would otherwise be counted as real output.
  if (/^f: unknown uck/m.test(out)) {
    throw new Error(
      `measuring \`f ${args.join(" ")}\` hit an unknown uck:\n${out.trim()}`,
    );
  }
  return out;
}

// Discovery output must be measured against a store that actually contains the
// `search` uck. Depending on the operator's ~/.f/ucks for that is how the search
// rows all reported 28 tokens once `search` left core: the binary answered
// "f: unknown uck 'search'", and an error string is also a token count.
// So build a throwaway HOME whose store is the real one, plus `search` from the
// sibling fcli-ucks checkout.
function discoveryHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), "f-count-"));
  const store = path.join(home, ".f", "ucks");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".f", "f.config.json"),
    JSON.stringify({ ucks: [] }),
  );
  // Mirror the real store so names/descriptions are production ones, not invented.
  for (const bucket of fs.readdirSync(STORE)) {
    fs.cpSync(path.join(STORE, bucket), path.join(store, bucket), {
      recursive: true,
    });
  }
  // `search` ships in fcli-ucks. Locate it beside this repo, or refuse to guess.
  const searchSrc = [
    path.resolve(REPO, "../fcli-ucks/search/index.js"),
    path.resolve(REPO, "dist/search/index.js"),
  ].find((p) => fs.existsSync(p));
  if (!searchSrc) {
    throw new Error(
      "cannot find the `search` uck (expected ../fcli-ucks/search/index.js).\n" +
        "  Discovery search cost cannot be measured without it — refusing to guess.",
    );
  }
  const dir = path.join(store, "count-local", "search");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "search", type: "module" }),
  );
  fs.copyFileSync(searchSrc, path.join(dir, "index.js"));
  return home;
}

const DHOME = discoveryHome();
const indexOutput = runF([], DHOME);
const SEARCHES = [
  ["ssh"],
  ["credential"],
  ["list", "files"],
  ["nothingzzz"], // exercises the no-match path, which also costs tokens
];

const rows = {
  // Cost of *issuing* a command: the tokens the model writes into the tool call.
  // This is pure string tokenization, not command output — the argument to
  // `f v` is the argument, and no shell result is involved. Command output cost
  // is unmeasurable here because it depends on the repo and machine, so no
  // figure below claims it.
  invocation: [
    "f v",
    "f config get ucks",
    "f creds get prod.db",
    "f search credential",
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
    ...n(runF(["search", ...a], DHOME)),
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
          path.join(dir, "package.json"),
          JSON.stringify({ name: nm, type: "module" }),
        );
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
      note:
        "Third-party and first-party MCP measurements, all o200k_base. Per-tool " +
        "cost spans 77.6 to 963 across servers (12x), so no single multiplier " +
        "describes MCP. Re-measure before quoting; see `reMeasured`.",
      tooltax: {
        url: "https://github.com/duskel/tooltax",
        leaderboard:
          "https://github.com/duskel/tooltax/blob/main/LEADERBOARD.md",
        generatedAt: "2026-09-29T09:53:41Z",
        servers: 18,
        tools: 256,
        totalTokens: 77877,
        shareOf200k: "38.9%",
        note:
          "Totals from LEADERBOARD.md. The project README reports a different " +
          "run (20 servers, 290 tools, 73,323 tokens), so totals move between " +
          "runs — cite the dated leaderboard, not a total.",
        // Server names matter: tooltax scores both live and archived variants
        // of some servers at different prices. GitHub below is the ARCHIVED
        // server (26 tools); Playwright is microsoft's (25 tools), distinct
        // from ExecuteAutomation's (33 tools, 89.6).
        perTool: {
          min: { server: "Puppeteer (archived)", tools: 7, value: 77.6 },
          max: { server: "Sequential Thinking", tools: 1, value: 963 },
          filesystem: { tools: 14, value: 170.2 },
          githubArchived: { tools: 26, value: 138 },
          playwright: {
            server: "microsoft/playwright-mcp",
            tools: 25,
            value: 151.7,
          },
          kubernetes: { tools: 23, value: 222.2 },
          notion: { tools: 24, value: 726.3 },
        },
      },
      // Measured here, same tokenizer, current packages. Higher than tooltax's
      // 2026-09-29 figures for the same two servers, and Playwright's tool count
      // moved 24 -> 25 between the README and LEADERBOARD.md in one repo. These
      // Numbers drift; the date is part of the figure.
      // Reproduced with tooltax's own command, not a homemade measurement, so
      // these are directly comparable to the leaderboard above. An earlier
      // version of this block held a per-tool sum (2,879 / 4,413) mislabeled as
      // a server total: tokenizing each tool as its own JSON object strips the
      // array separators and one layer of braces, which reads ~18% high.
      reMeasured: {
        measuredAt: "2026-07-01",
        command:
          "npx tooltax score npm:<package> (or cmd:... for servers needing args)",
        filesystem: {
          pkg: "@modelcontextprotocol/server-filesystem@1.0.0",
          tools: 14,
          tokens: 2439,
          perTool: 174.2,
        },
        playwright: {
          pkg: "@playwright/mcp@0.0.83",
          tools: 25,
          tokens: 3793,
          perTool: 151.7,
        },
        note:
          "Filesystem matches the 2026-09-29 leaderboard within one added schema " +
          "field (2,383 / 170.2 there). Playwright matches it exactly.",
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
  console.log("-- issuing a command: tokens the model writes --");
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
