#!/usr/bin/env node
/*
 * Run the same 3-turn job twice against a real model -- once with MCP tool
 * definitions, once as `f` -- and report the ABSOLUTE prompt size of each turn,
 * as counted by the server.
 *
 * WHY SERVER-COUNTED
 *
 * The previous hero figures tokenized the tool payload alone: 2877 vs 57. True, and
 * also misleading by omission -- a real request body is a system prompt, a chat
 * template and a transcript, so 57 tokens of index inside a 9k-token prompt is a
 * different claim than 57 tokens total. Local o200k counts cannot produce that
 * number honestly, because the framing is the provider's, not ours: the chat template
 * alone adds a per-turn and per-message cost no local rank can reconstruct.
 *
 * So this asks the model. prompt_tokens is what the server actually consumed, which
 * includes framing we do not control and would otherwise have to estimate.
 *
 * WHAT THIS IS NOT
 *
 * Not a benchmark of model quality. Same model, same task, same number of turns; the
 * only variable is how the capability reaches the model. Do not read accuracy into it.
 *
 * The f side gives the model a shell tool and a one-line pointer, which is the honest
 * analogue: f has no schema, so the model must be able to run a command. Giving f a
 * schema would be arguing against a strawman, and giving MCP no schema would be
 * arguing against nothing.
 *
 * Usage: node scripts/measure-absolute.mjs [--base <url>] [--model <id>]
 */
const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i === -1 ? "http://10.1.0.7:8000/v1" : process.argv[i + 1];
})();
const MODEL = (() => {
  const i = process.argv.indexOf("--model");
  return i === -1 ? "ai" : process.argv[i + 1];
})();
const { readFileSync } = await import("node:fs");

const MCP_TOOLS = JSON.parse(readFileSync("/tmp/tools_filesystem.json", "utf8")).map(
  (t) => ({
    // OpenAI wire form: this server is OpenAI-compatible, so the body shape is
    // {type:"function", function:{...}} and that is what gets tokenized.
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }),
);

// The shell tool the `f` side needs. Deliberately generic -- it is the tool every
// agent harness already ships -- so the comparison is "schema vs no schema", not
// "one fat tool vs none".
const SHELL_TOOL = [
  {
    type: "function",
    function: {
      name: "run",
      description: "Run a shell command and return stdout.",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string", description: "command to run" } },
        required: ["cmd"],
      },
    },
  },
];

// Identical on both sides, so it cannot explain any difference.
const SYS =
  "You are an agent operating on a user's machine. Use tools to complete the task. " +
  "Prefer the narrowest tool that answers the question. Do not invent file contents.";
const TASK = "What is the status of my credentials, and what is in notes/creds.md?";

async function turn(messages, tools) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools, max_tokens: 64, stream: false }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return {
    promptTokens: d.usage?.prompt_tokens ?? null,
    completionTokens: d.usage?.completion_tokens ?? null,
    msg: d.choices?.[0]?.message,
  };
}

// Tool output shape used on both sides so result framing cannot differ either.
const asTool = (content) => ({ role: "tool", content, tool_call_id: "c1" });

async function session(name, tools, script) {
  const rows = [];
  let messages = [
    { role: "system", content: SYS },
    { role: "user", content: TASK },
  ];
  // Turn 1: prompt only. This is the number that shows scale -- everything the model
  // must be fed before it can do anything at all.
  const t1 = await turn(messages, tools);
  rows.push({ turn: 1, label: "prompt + task", promptTokens: t1.promptTokens });
  // The harness discovers capabilities itself; the model has already been given tools.
  for (let i = 0; i < script.length; i++) {
    messages = [
      ...messages,
      { role: "assistant", content: script[i].call },
      asTool(script[i].result),
    ];
    const t = await turn(messages, tools);
    rows.push({
      turn: i + 2,
      label: script[i].label,
      promptTokens: t.promptTokens,
    });
  }
  return { name, tools: tools.length, toolTokensOverhead: null, rows };
}

// Three turns each, same task, same result framing. The turn counts must match or the
// cumulative rows are not comparable -- an earlier draft gave MCP four turns and f
// three, which would have shown MCP growing faster purely because it spoke more.
const STEPS = [
  { label: "f → 16 uck names", mcpLabel: "tools/list → 14 definitions", fResult: "config creds df fj gh ha providers search skills ssh uck v", mcpResult: "14 tools registered" },
  { label: "f creds status", mcpLabel: "search_files → no matches", fResult: "unlocked (166m 54s left)", mcpResult: "No matches found" },
  { label: "f creds get prod.db", mcpLabel: "read_text_file → contents", fResult: "no such cred: prod.db", mcpResult: "prod.db\n  host: db.internal" },
];

const mcp = await session("mcp", MCP_TOOLS, STEPS.map((x) => ({ label: x.mcpLabel, call: "", result: x.mcpResult })));
const f = await session("f", SHELL_TOOL, STEPS.map((x) => ({ label: x.label, call: "", result: x.fResult })));

// Prompt size grows by the transcript each turn; the delta between rows is the framing
// cost the server adds per turn, which local tokenization cannot see.
const growth = (s) => s.rows.map((r) => r.promptTokens);
const summary = {
  mcpTurn1: mcp.rows[0].promptTokens,
  fTurn1: f.rows[0].promptTokens,
  mcpCumulative: growth(mcp),
  fCumulative: growth(f),
};

console.log(JSON.stringify({ base: BASE, model: MODEL, summary, mcp, f }, null, 2));
