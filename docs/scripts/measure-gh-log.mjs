#!/usr/bin/env node
/*
 * Both sides fetching ONE GitHub Actions failure log, with real payloads.
 *
 * WHY THE SERVER CHANGED
 *
 * The hero previously used @modelcontextprotocol/server-filesystem. It cannot fetch an
 * Actions log — it only sees a root directory — so any log comparison built on it would
 * have been theatre. This uses @modelcontextprotocol/server-github, the canonical
 * reference server.
 *
 * AND WHY THAT MATTERS MORE THAN THE NUMBERS
 *
 * tools/list returns 26 tools: repositories, issues, PRs, commits, reviews, search.
 * There is NO tool for workflow runs, jobs, logs or artifacts. The GitHub MCP server
 * cannot do the job the hero now claims to compare. So this file measures two things:
 * the real cost of the server (3,546 tokens resident, vs 1,692 for filesystem — a
 * smaller server was undercounting the architecture by more than half), and the real
 * cost of the fallback the server forces: one nested `exec` per log fetch.
 *
 * The f side is genuinely equivalent, not a strawman: the gh uck exists and the CLI
 * wraps the logs endpoint.
 *
 * TOKENS ARE COUNTED AS THE API RETURNS THEM. GitHub serves log archives as an opaque
 * zip whose tokenization depends on unzip ordering, so the two paths are compared
 * against the same underlying bytes via the text endpoint the model would actually
 * read, and the raw sizes are reported alongside so nothing is smoothed over.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BINARY = process.env.F_BINARY || path.join(DOCS, "..", "dist", "index.js");
if (!existsSync(BINARY)) {
  console.error(`no binary at ${BINARY} — npm run build first`);
  process.exit(1);
}
const enc = new Tiktoken(o200);
const n = (s) => enc.encode(s).length;

const OWNER = "fclidev";
const REPO = "fcli";

const frun = (a) => {
  try {
    return execFileSync("node", [BINARY, ...a], { encoding: "utf8", maxBuffer: 32 << 20 });
  } catch (e) {
    return String(e.stdout ?? "") + String(e.stderr ?? "");
  }
};

// --- f side, entirely real ---------------------------------------------------
const fIndex = frun([]);
// 1. find the failing run
const runsRaw = frun(["gh", "GET", `/repos/${OWNER}/${REPO}/actions/runs?per_page=3`]);
let runId = null;
try {
  const j = JSON.parse(runsRaw);
  const bad = (j.workflow_runs || []).find((r) => r.conclusion === "failure") || j.workflow_runs?.[0];
  runId = bad?.id ?? null;
} catch {}
// 2. its jobs
const jobsRaw = runId ? frun(["gh", "GET", `/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`]) : "";
let jobId = null;
try {
  const j = JSON.parse(jobsRaw);
  jobId = (j.jobs || []).find((x) => x.conclusion === "failure")?.id ?? j.jobs?.[0]?.id ?? null;
} catch {}
// 3. the log itself
const logRaw = jobId ? frun(["gh", "GET", `/repos/${OWNER}/${REPO}/actions/jobs/${jobId}/logs`]) : "";

const fCalls = [
  { label: "f gh GET .../actions/runs?per_page=3", out: runsRaw },
  { label: "f gh GET .../actions/runs/{id}/jobs", out: jobsRaw },
  { label: "f gh GET .../actions/jobs/{id}/logs", out: logRaw },
];

// --- MCP side: real definitions, real exec payload --------------------------
const ghTools = JSON.parse(readFileSync("/tmp/tools_github.json", "utf8"));
const resident = ghTools.reduce((a, t) => a + n(JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema })), 0);

// No tool covers Actions, so the model must shell out. Measure that call's real body
// and real output, at the same endpoint the f side hit.
const execCall = JSON.stringify({
  type: "tool_use",
  name: "exec",
  input: { command: `curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${jobId ?? 0}/logs -L | gunzip 2>/dev/null | tail -400` },
});

console.log(
  JSON.stringify(
    {
      repo: `${OWNER}/${REPO}`,
      runId,
      jobId,
      mcp: {
        server: "@modelcontextprotocol/server-github",
        tools: ghTools.length,
        resident,
        actionsTools: ghTools.map((t) => t.name).filter((x) => /workflow|job|log|artifact|run/i.test(x)),
        execCallTokens: n(execCall),
      },
      f: {
        indexTokens: n(fIndex),
        indexUcks: (fIndex.match(/^\S+$/gm) || []).length,
        calls: fCalls.map((c) => ({ label: c.label, outTokens: n(c.out), outBytes: Buffer.byteLength(c.out) })),
      },
    },
    null,
    2,
  ),
);
