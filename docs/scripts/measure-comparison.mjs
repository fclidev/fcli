#!/usr/bin/env node
/*
 * Measure the same job two ways: an MCP server's tool definitions versus `f`.
 *
 * WHY THIS EXISTS
 *
 * The homepage hero quotes these numbers and a component cannot contain a claim that
 * nothing produces. Hand-typed figures in Compare.astro would drift the first time a
 * server description changed upstream, silently, and would look as authoritative as
 * when they were true.
 *
 * HOW IT DIFFERS FROM count-tokens.mjs
 *
 * count-tokens.mjs measures the `f` side only. This adds the MCP side by talking MCP
 * to a live server -- spawning it over stdio, sending initialize and tools/list, and
 * serializing what comes back. That matters: the published 260 tokens for
 * read_text_file is the FULL tool object (name, title, description, inputSchema,
 * annotations, execution, outputSchema). Dropping the fields a harness does not
 * recognise undercounts by ~25% (260 -> 194) and every ratio derived from it is then
 * wrong in the direction that flatters the argument.
 *
 * Usage
 *   node scripts/measure-comparison.mjs
 *   node scripts/measure-comparison.mjs --server <npm-package>   # default: filesystem
 *   node scripts/measure-comparison.mjs --json
 *
 * Requires js-tiktoken (npm i --no-save js-tiktoken).
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const BINARY = process.env.F_BINARY || path.join(REPO, "dist", "index.js");
if (!existsSync(BINARY)) {
  console.error(`no binary at ${BINARY} — run \`npm run build\` in ${REPO} first`);
  process.exit(1);
}

const enc = new Tiktoken(o200);
const n = (s) => enc.encode(s).length;

// Opt parsing the way count-tokens.mjs does it: indexOf returns -1 when the flag is
// absent, and -1 + 1 == 0 == argv[0], which is the node binary. It took a spawn of
// `node /home/kenny/.../node <cwd>` to find that out.
const argOpt = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const SERVER =
  argOpt("--server") || "@modelcontextprotocol/server-filesystem";

// tools/list over stdio. The probe is a real client: a server that gates tools
// behind initialize would return nothing to a script that skipped it.
function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", SERVER, process.cwd()], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    const replies = new Map();
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id) replies.set(m.id, m);
        } catch {
          /* servers log to stdout too; ignore non-JSON */
        }
      }
    });
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no tools/list from ${SERVER} within 30s`));
    }, 30_000);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "fcli-measure", version: "1" },
      },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    }, 8_000);
    const poll = setInterval(() => {
      if (replies.has(2)) {
        clearInterval(poll);
        clearTimeout(deadline);
        child.kill("SIGKILL");
        const tools = replies.get(2)?.result?.tools;
        if (!Array.isArray(tools) || !tools.length)
          return reject(new Error("tools/list returned no tools"));
        resolve(tools);
      }
    }, 500);
  });
}

// `f`'s resident cost is the name index, and count-tokens.mjs is the authority for
// it: it derives the grid from a known list of ucks rather than guessing names out of
// the index's rendered columns, which is why this reads its committed snapshot instead
// of parsing `f`'s output here. An earlier revision of this script did parse the
// binary and reported 14 ucks / 32 tokens against the audited 23 / 54 -- an
// undercount that flatters the ratio, which is the worst direction to be wrong in.
function fIndex() {
  const snap = JSON.parse(
    readFileSync(path.join(REPO, "docs", "content", "token-measurements.json"), "utf8"),
  );
  const rows = JSON.parse(JSON.stringify(snap));
  const found = JSON.stringify(rows).includes("f (index)");
  if (!found) {
    throw new Error(
      "token-measurements.json has no 'f (index)' row -- run count-tokens.mjs --snapshot",
    );
  }
  const stack = [rows];
  let row = null;
  while (stack.length && !row) {
    const cur = stack.pop();
    if (Array.isArray(cur)) stack.push(...cur);
    else if (cur && typeof cur === "object") {
      if (typeof cur.label === "string" && cur.label.startsWith("f (index)")) row = cur;
      else stack.push(...Object.values(cur));
    }
  }
  // The snapshot stores the uck count inside the label text, not as a field -- that is
  // how count-tokens.mjs writes it. 61 tokens / 16 ucks is the pair /index.md quotes.
  const ucks = Number(row.count ?? row.label.match(/(\d+)\s+ucks?/)?.[1]);
  const tokens = Number(row.o200k_base);
  if (!ucks || !tokens) throw new Error(`unusable index row: ${JSON.stringify(row)}`);
  return { ucks, tokens };
}

const tools = await listTools();

// FULL objects, not a harness-shaped subset: see the header note on the 260 vs 194
// discrepancy. A harness may prune fields, but pruning is its optimization, not a
// property of the server, and the site's published figure is the unpruned one.
const sizes = tools.map((t) => ({ name: t.name, tokens: n(JSON.stringify(t)) }));
const resident = sizes.reduce((a, s) => a + s.tokens, 0);
const sorted = [...sizes].sort((a, b) => b.tokens - a.tokens);

const f = fIndex();
const callTokens = n("f creds get prod.db");

const result = {
  encoder: "o200k_base",
  mcp: {
    server: SERVER,
    tools: tools.length,
    resident,
    mean: +(resident / tools.length).toFixed(1),
    min: sorted[sorted.length - 1].tokens,
    max: sorted[0].tokens,
    largest: { name: sorted[0].name, tokens: sorted[0].tokens },
  },
  f: {
    ucks: f.ucks,
    indexOnce: f.tokens,
    perUck: +(f.tokens / f.ucks).toFixed(1),
    exampleCall: "f creds get prod.db",
    callTokens,
  },
  ratio: +(resident / f.tokens).toFixed(1),
};

// Guard the one claim the whole page rests on: this method must reproduce the number
// already published on /docs/measurements/ for the same tool.
const PUBLISHED_260 = 260;
const rtf = sizes.find((s) => s.name === "read_text_file");
result.crossCheck = rtf
  ? {
      tool: "read_text_file",
      measured: rtf.tokens,
      published: PUBLISHED_260,
      agrees: rtf.tokens === PUBLISHED_260,
    }
  : { tool: "read_text_file", measured: null, note: "server has no read_text_file" };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`MCP  ${SERVER}`);
  console.log(
    `  ${result.mcp.tools} tools, ${resident} tokens resident (${result.mcp.mean} mean, ${result.mcp.min}–${result.mcp.max})`,
  );
  console.log(`  largest: ${result.mcp.largest.name} = ${result.mcp.largest.tokens}`);
  console.log(`f  store: ${f.ucks} ucks`);
  console.log(
    `  index ${f.tokens} tokens once (${result.f.perUck}/uck), invocation ${callTokens}`,
  );
  console.log(`ratio: ${result.ratio}x`);
  console.log(
    `cross-check vs published: ${JSON.stringify(result.crossCheck)}`,
  );
  if (rtf && !result.crossCheck.agrees)
    console.warn(
      `\nWARNING: read_text_file measured ${rtf.tokens}, published says ${PUBLISHED_260}.` +
        `\nEither the server changed or this method diverged — do not publish these numbers until you know which.`,
    );
}
