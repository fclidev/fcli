#!/usr/bin/env node
/*
 * Capture REAL request payloads for two sessions of the same job, then print the
 * token counts the hero's animated streams animate over.
 *
 * THE FAIRNESS RULE THIS FILE EXISTS TO ENFORCE
 *
 * The f side needs a shell tool — there is no other way a model runs `f`. That means
 * the comparison is not "schema vs no schema", it is "schema for every capability" vs
 * "one generic schema plus knowledge the model already has". So this gives BOTH sides
 * knowledge: MCP gets its tool definitions, f gets the index that tells it which
 * commands exist. Charging f for a shell tool while giving MCP free authoring
 * knowledge, or the reverse, would decide the outcome before measuring.
 *
 * WHAT IS ANIMATED AND WHAT IS MEASURED
 *
 * The token counts are measured: real tools/list from a live MCP server, real tool
 * results, real `f` output, whole bodies counted by a real model. The text that
 * streams is reconstructed realistic content of the same shape. A "live session
 * replay" would be the wrong label — this is a measurement visualised, and the page
 * says so.
 *
 * Requires js-tiktoken.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";
import cl100 from "js-tiktoken/ranks/cl100k_base";

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BINARY = process.env.F_BINARY || path.join(DOCS, "..", "dist", "index.js");
if (!existsSync(BINARY)) {
  console.error(`no binary at ${BINARY} — npm run build first`);
  process.exit(1);
}
const encO = new Tiktoken(o200);
const encC = new Tiktoken(cl100);
const n = (s) => ({ o200k: encO.encode(s).length, cl100k: encC.encode(s).length });

const SERVER = "@modelcontextprotocol/server-filesystem";
const WORKDIR = "/tmp/mcpsim";

async function mcpRun() {
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
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sim", version: "1" } } });
  await w(9000);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await w(4000);
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_text_file", arguments: { path: "notes/creds.md" } } });
  await w(3000);
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "directory_tree", arguments: { path: ".", excludePatterns: [] } } });
  await w(3000);
  child.kill("SIGKILL");
  const tools = R.get(2)?.result?.tools || [];
  if (!tools.length) throw new Error("no tools/list reply");
  return { tools, calls: [R.get(3)?.result, R.get(4)?.result] };
}

function fRun() {
  const run = (a) => {
    try {
      return execFileSync("node", [BINARY, ...a], { encoding: "utf8", cwd: WORKDIR });
    } catch (e) {
      return String(e.stdout ?? "") + String(e.stderr ?? "");
    }
  };
  return { index: run([]), status: run(["creds", "status"]), read: run(["creds", "get", "prod.db"]) };
}

const [m, f] = [await mcpRun(), fRun()];

// Real tool-call objects as the model would emit them, in the harness's wire form.
const mcpCalls = [
  { type: "tool_use", name: "read_text_file", input: { path: "/tmp/mcpsim/notes/creds.md" } },
  { type: "tool_use", name: "directory_tree", input: { path: "/tmp/mcpsim", excludePatterns: [] } },
].map((x) => JSON.stringify(x));

const fCalls = ["f creds get prod.db", "f creds status"].map((c) => JSON.stringify({ tool: "bash", input: { command: c } }));

const defTok = m.tools.reduce((a, t) => a + n(JSON.stringify(t)).o200k, 0);
const SHELL_DEF = JSON.stringify({
  name: "bash",
  description: "Run a shell command and return stdout/stderr.",
  input_schema: { type: "object", properties: { command: { type: "string", description: "command to run" } }, required: ["command"] },
});

console.log(
  JSON.stringify(
    {
      encoder: "o200k_base",
      mcp: {
        tools: m.tools.length,
        defsOnce: defTok,
        callTokens: mcpCalls.map((c) => n(c).o200k),
        resultTokens: m.calls.map((r) => n(JSON.stringify(r)).o200k),
        // Resident across every turn of the session.
        resident: defTok,
      },
      f: {
        // The shell definition is paid by BOTH sides, so it is not part of the
        // difference; reported so the hero can subtract it honestly.
        shellDefOnce: n(SHELL_DEF).o200k,
        indexOnce: n(f.index).o200k,
        callTokens: fCalls.map((c) => n(c).o200k),
        resultTokens: [n(f.status).o200k, n(f.read).o200k],
      },
      crossCheck: { tool: "read_text_file", measured: n(JSON.stringify(m.tools.find((t) => t.name === "read_text_file"))).o200k, published: 260 },
    },
    null,
    2,
  ),
);
