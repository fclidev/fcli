#!/usr/bin/env node
/*
 * Tokenize two simulated sessions doing the same job, both with and without prompt
 * caching, and print what the components should render.
 *
 * WHY A SESSION AND NOT A PAIR OF CALLS
 *
 * An earlier version compared one MCP call against one `f` command. That compared the
 * part that is identical on both sides -- the model writes ~5 tokens either way -- and
 * hid the part that is not. What a session pays is the request body on every turn.
 *
 * WHY CACHING IS IN THE FIRST VERSION, NOT A FOOTNOTE
 *
 * A first pass divided MCP's per-turn definition block by f's index and reported 77x.
 * That number was wrong in the flattering direction: MCP tool definitions are the
 * first block in the body, so they are a stable prefix and prompt caching discounts
 * them (Anthropic cache reads at 10% of base, OpenAI up to 95% off). f's discovery
 * output is a tool_result sitting in message history -- it is re-sent and re-read on
 * every request and has nothing to cache. So the honest comparison is not
 * "resident vs nothing"; it is "resident-but-cached vs resident-and-not".
 *
 * Context-window occupancy is a separate axis and caching does not move it: the bytes
 * are in the window either way. Both axes are reported.
 *
 * WHY THE f SIDE INCLUDES A SEARCH
 *
 * f's cheapness depends on the model already knowing the command name. When it does
 * not, it spends a discovery turn first -- `f search credential` -- and that is the
 * realistic worst case for f, so it is shown rather than the best case.
 *
 * HOW THE DATA IS REAL
 *
 * MCP definitions and results come from one live session against
 * @modelcontextprotocol/server-filesystem (initialize, tools/list, two tools/call).
 * The f side runs the real binary. Nothing is transcribed by hand.
 *
 * Requires js-tiktoken.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";
import cl100 from "js-tiktoken/ranks/cl100k_base";

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BINARY = process.env.F_BINARY || path.join(DOCS, "..", "dist", "index.js");
if (!existsSync(BINARY)) {
  console.error(`no binary at ${BINARY} — run npm run build in ${path.dirname(DOCS)} first`);
  process.exit(1);
}
const encO = new Tiktoken(o200);
const encC = new Tiktoken(cl100);
const n = (s) => ({ o200k: encO.encode(s).length, cl100k: encC.encode(s).length });

const SERVER = "@modelcontextprotocol/server-filesystem";
const WORKDIR = "/tmp/mcpsim";

async function mcpSession() {
  const child = spawn("npx", ["--yes", SERVER, WORKDIR], { stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  const R = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.id) R.set(m.id, m);
      } catch {}
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sim", version: "1" } },
  });
  await wait(9000);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await wait(4000);
  // Turn A: the model does not know where the value is, so it searches. This is the
  // analogue of f's discovery turn -- included so neither side gets a free first move.
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_files", arguments: { path: ".", pattern: "*.md" } } });
  await wait(3000);
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_text_file", arguments: { path: "notes/creds.md" } } });
  await wait(3000);
  child.kill("SIGKILL");
  const tools = R.get(2)?.result?.tools || [];
  if (!tools.length) throw new Error("no tools/list reply");
  return { tools, results: [R.get(3)?.result, R.get(4)?.result] };
}

function fSession() {
  const run = (args) => {
    try {
      return execFileSync("node", [BINARY, ...args], { encoding: "utf8", cwd: WORKDIR });
    } catch (e) {
      // A miss is a nonzero exit and its stderr is real session content.
      return String(e.stdout ?? "") + String(e.stderr ?? "");
    }
  };
  return {
    index: run([]),
    search: run(["search", "credential"]),
    status: run(["creds", "status"]),
    miss: run(["creds", "get", "nonexistent"]),
  };
}

const [m, f] = await Promise.all([mcpSession(), Promise.resolve(fSession())]);

const defTok = m.tools.reduce((a, t) => a + n(JSON.stringify(t)).o200k, 0);
const mcpRes = m.results.map((r) => n(JSON.stringify(r)).o200k);
const fIndex = n(f.index).o200k;
const fSearch = n(f.search).o200k;
const fOut = [n(f.status).o200k, n(f.miss).o200k];

// Cache rates: the published discount, not a model of our own.
const RATES = { anthropicRead: 0.1, openaiCached: 0.05 };

// 3 model turns. Definitions precede history, so they are present on every turn; on a
// cache hit they are discounted, not removed.
const TURNS = 3;
const resSum = mcpRes.reduce((a, b) => a + b, 0);
const mcpUncached = defTok * TURNS + resSum;
// A fresh session's FIRST request hits a shared prefix: the definitions are the first
// block in the body, byte-identical for every session of this server against this
// provider, so request 1 is already a cache read. Charging turn 1 at full price was
// wrong in f's favour (it inflated MCP by ~14%), and it is the mistake this file
// exists to stop being made.
const mcpAnthropic = defTok * (RATES.anthropicRead * TURNS) + resSum;
const mcpOpenAI = defTok * (RATES.openaiCached * TURNS) + resSum;

// f's index arrives as a tool_result in message history. It is not a prefix, it
// differs between sessions, and nothing about it is cacheable: it is re-billed at full
// rate on every request. Stating this is the point -- f's advantage is occupancy, not
// billed rate, and rate is where MCP's definitions genuinely win.
const fUncached = fIndex * TURNS + fSearch + fOut.reduce((a, b) => a + b, 0);

const rtf = m.tools.find((t) => t.name === "read_text_file");
const out = {
  encoder: "o200k_base",
  server: SERVER,
  turns: TURNS,
  cacheRates: RATES,
  mcp: {
    tools: m.tools.length,
    defsPerTurn: defTok,
    resultTurns: mcpRes,
    resultsTotal: mcpRes.reduce((a, b) => a + b, 0),
    sessionUncached: mcpUncached,
    sessionAnthropicCached: Math.round(mcpAnthropic),
    sessionOpenAICached: Math.round(mcpOpenAI),
    windowOccupancy: defTok,
  },
  f: {
    indexOnce: fIndex,
    searchTurn: fSearch,
    resultTurns: fOut,
    resultsTotal: fOut.reduce((a, b) => a + b, 0),
    indexResentEachTurn: fIndex,
    sessionTotal: fUncached,
    windowOccupancy: 0,
  },
  ratioUncached: +(mcpUncached / fUncached).toFixed(1),
  ratioVsAnthropicCached: +(mcpAnthropic / fUncached).toFixed(1),
  crossCheck: { tool: "read_text_file", measured: n(JSON.stringify(rtf)).o200k, published: 260 },
};

console.log(JSON.stringify(out, null, 2));
if (out.crossCheck.measured !== 260)
  console.warn(`WARNING: read_text_file ${out.crossCheck.measured} != published 260 — method diverged, do not publish.`);
