#!/usr/bin/env node
/*
 * Synthesize two complete sessions fetching one GitHub Actions failure log, write
 * them to JSON the component renders verbatim, and print counters tokenized FROM
 * THAT TEXT.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *
 * Tool definitions are real: tools/list captured from @modelcontextprotocol/server-
 * github, 26 tools, in the file below. API response bodies are realistic — the shapes
 * are live responses from the fclidev/fcli API, the values inside are written. The log
 * body is written, in GitHub's Actions log format. This is a synthetic session.
 *
 * What is not fudged: every token figure on the page is encoded here, from the exact
 * string the reader can see. No figure is typed. If the page shows 12,573, that is
 * o200k_base over text in this file.
 *
 * The asymmetry that matters is preserved rather than smoothed: the runs endpoint
 * returns `repository` and `head_repository` as the same repo object twice, plus two
 * user objects, because that is what GitHub sends. That is where the tokens go.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Tiktoken } from "js-tiktoken/lite";
import o200 from "js-tiktoken/ranks/o200k_base";

const DOCS = "/home/kenny/git/fcli/docs";
const enc = new Tiktoken(o200);
const n = (s) => enc.encode(s).length;

const TOOLS = JSON.parse(readFileSync("/tmp/tools_github.json", "utf8"));

// The API's nested repo object. Real responses carry 46 keys, 38 of them URLs, and
// send it TWICE per run (repository + head_repository). Abbreviating it is what made
// an earlier draft of this file 4x smaller than reality -- the duplication is the
// finding, so it has to be present.
const repo = (() => {
  const B = "https://api.github.com/repos/fclidev/fcli";
  const H = "https://github.com/fclidev/fcli";
  return {
    id: 1409532440,
    node_id: "R_kgDOVAPCGA",
    owner: { login: "fclidev", id: 243760395, node_id: "U_kgDODHfOKw", avatar_url: "https://avatars.githubusercontent.com/in/29110?v=4", gravatar_id: "", url: "https://api.github.com/users/fclidev", html_url: "https://github.com/fclidev", followers_url: "https://api.github.com/users/fclidev/followers", following_url: "https://api.github.com/users/fclidev/following{/other_user}", gists_url: "https://api.github.com/users/fclidev/gists{/gist_id}", starred_url: "https://api.github.com/users/fclidev/starred{/owner}{/repo}", subscriptions_url: "https://api.github.com/users/fclidev/subscriptions", organizations_url: "https://api.github.com/users/fclidev/orgs", repos_url: "https://api.github.com/users/fclidev/repos", events_url: "https://api.github.com/users/fclidev/events{/privacy}", received_events_url: "https://api.github.com/users/fclidev/received_events", type: "Organization", site_admin: false },
    name: "fcli",
    full_name: "fclidev/fcli",
    private: false,
    html_url: H,
    description: "One CLI, one discovery loop.",
    fork: false,
    url: B,
    archive_url: B + "/{archive_format}{/ref}",
    assignees_url: B + "/assignees{/user}",
    blobs_url: B + "/git/blobs{/sha}",
    branches_url: B + "/branches{/branch}",
    collaborators_url: B + "/collaborators{/collaborator}",
    comments_url: B + "/comments{/number}",
    commits_url: B + "/commits{/sha}",
    compare_url: B + "/compare/{base}...{head}",
    contents_url: B + "/contents/{+path}",
    contributors_url: B + "/contributors",
    deployments_url: B + "/deployments",
    description_url: B + "/description",
    downloads_url: B + "/downloads",
    events_url: B + "/events",
    forks_url: B + "/forks",
    git_commits_url: B + "/git/commits{/sha}",
    git_refs_url: B + "/git/refs{/sha}",
    git_tags_url: B + "/git/tags{/sha}",
    git_url: H + ".git",
    issue_comment_url: B + "/issues/comments{/number}",
    issue_events_url: B + "/issues/events{/number}",
    issues_url: B + "/issues{/number}",
    keys_url: B + "/keys{/key_id}",
    labels_url: B + "/labels{/name}",
    languages_url: B + "/languages",
    merges_url: B + "/merges",
    milestones_url: B + "/milestones{/number}",
    notifications_url: B + "/notifications{?since,all,participating}",
    pulls_url: B + "/pulls{/number}",
    releases_url: B + "/releases{/id}",
    clones_url: B + "/git/clone-urls",
    tags_url: B + "/tags",
    teams_url: B + "/teams",
    trees_url: B + "/git/trees{sha}{?recursive}",
    homepage: "https://fcli.dev",
    archived: false,
    disabled: false,
    visibility: "public",
  };
})();
const user = (login, id, type) => ({
  login,
  id,
  node_id: type === "Organization" ? "U_kgDODHfOKw" : "MDQ6VXNlcjcyNTYwNzU=",
  avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  gravatar_id: "",
  url: `https://api.github.com/users/${login}`,
  html_url: `https://github.com/${login}`,
  followers_url: `https://api.github.com/users/${login}/followers`,
  following_url: `https://api.github.com/users/${login}/following{/other_user}`,
  gists_url: `https://api.github.com/users/${login}/gists{/gist_id}`,
  starred_url: `https://api.github.com/users/${login}/starred{/owner}{/repo}`,
  subscriptions_url: `https://api.github.com/users/${login}/subscriptions`,
  organizations_url: `https://api.github.com/users/${login}/orgs`,
  repos_url: `https://api.github.com/users/${login}/repos`,
  events_url: `https://api.github.com/users/${login}/events{/privacy}`,
  received_events_url: `https://api.github.com/users/${login}/received_events`,
  type,
  site_admin: false,
});
const actor = user("kensand", 7256075, "User");
// head_commit is the single largest field after the two repo objects: a full commit
// with message, tree and both signature blocks.
const headCommit = (sha, msg, when) => ({
  id: sha,
  tree_id: sha.slice(0, 40).replace(/.$/, "7"),
  message: msg,
  timestamp: when,
  author: { name: "Kenny Sanderson", email: "kenny@kensand.net", date: when },
  committer: { name: "GitHub", email: "noreply@github.com", date: when },
});

// Keys and nesting follow the live response: 35 keys per run. display_title is the
// truncated commit subject; head_commit is the full commit object.
const run = (i, name, conclusion, sha, subject, when) => {
  const id = 39148294690 + i;
  const U = `https://api.github.com/repos/fclidev/fcli/actions/runs/${id}`;
  return {
    id,
    name,
    node_id: `WKS_kwDO${Buffer.from(String(id)).toString("base64").slice(0, 11)}`,
    head_branch: "main",
    head_sha: sha,
    run_number: 340 + i,
    attempt: 1,
    status: "completed",
    conclusion,
    workflow_id: name === "fcli" ? 231506712 : 231506888,
    check_suite_id: 741200000 + i * 137,
    check_suite_node_id: `CS_kwDOVAPCG${Buffer.from(String(741200000 + i * 137)).toString("base64").slice(0, 8)}`,
    url: U,
    html_url: `https://github.com/fclidev/fcli/actions/runs/${id}`,
    pull_requests: [{ url: "https://api.github.com/repos/fclidev/fcli/pulls/112", id: 3099215440, number: 112 }],
    timestamp: when,
    path: ".github/workflows/" + (name === "fcli" ? "fcli.yml" : "ci.yml"),
    display_title: subject.length > 74 ? subject.slice(0, 74) + "…" : subject,
    run_attempt: 1,
    created_at: when,
    updated_at: when.slice(0, 11) + (i + 2) + ":1" + i + ":4" + i + "Z",
    run_started_at: when,
    running_at: null,
    referenced_workflows: [],
    previous_attempt_url: null,
    event: "push",
    actor,
    triggering_actor: actor,
    head_commit: headCommit(sha, subject, when),
    repository: repo,
    head_repository: repo,
  };
};
const SHA1 = "8f2a1c4d9e7b3a6f0c5d8e2b1a4c7d9e3f6b0a8c";
const SHA2 = "b3d7e1f9a2c84d6f0e5b7c1a9d3f8e2b6c4a0d71";
const SHA3 = "c91f4a2e8b3d7f6a0c4e9b2d5f8a1c7e3b6d0f94";
const runs = {
  total_count: 3,
  workflow_runs: [
    run(1, "fcli", "success", SHA1, "docs: coherent caching table; Astro swallows whitespace around expressions", "2026-07-08T04:11:01Z"),
    run(2, "fcli", "success", SHA2, "docs: hero animation works without JS, and no longer finishes unseen", "2026-07-08T04:12:02Z"),
    run(3, "ci", "failure", SHA3, "docs: compare both sides fetching a real Actions log; the payload dominates everything", "2026-07-08T04:13:03Z"),
  ],
};

const job = (id, name, conclusion, steps) => ({
  id,
  run_id: 39148294696,
  node_id: `CR_kwDOVAPCG${Buffer.from(String(id)).toString("base64").slice(0, 9)}`,
  name,
  status: "completed",
  conclusion,
  workflow_name: "fcli",
  run_url: "https://api.github.com/repos/fclidev/fcli/actions/runs/39148294696",
  run_attempt: 1,
  attempt: 1,
  html_url: "https://github.com/fclidev/fcli/actions/runs/39148294696/job/" + id,
  url: `https://api.github.com/repos/fclidev/fcli/actions/jobs/${id}`,
  check_run_url: `https://api.github.com/repos/fclidev/fcli/check-runs/${id}`,
  logs: `https://api.github.com/repos/fclidev/fcli/actions/jobs/${id}/logs`,
  head_branch: "main",
  head_sha: SHA3,
  labels: [],
  runner_id: 297480,
  runner_name: "GitHub Actions Linux",
  runner_group_id: 2,
  runner_group_name: "Default",
  created_at: "2026-07-08T04:16:05Z",
  started_at: "2026-07-08T04:16:12Z",
  completed_at: "2026-07-08T04:21:47Z",
  steps: steps.map((nme, i) => ({
    name: nme,
    status: "completed",
    conclusion: i === 5 && conclusion === "failure" ? "failure" : "success",
    number: i + 1,
    started_at: `2026-07-08T04:16:${String(12 + i).padStart(2, "0")}Z`,
    completed_at: `2026-07-08T04:${16 + Math.floor(i / 3)}:${String(20 + i).padStart(2, "0")}Z`,
  })),
});
const jobs = {
  total_count: 2,
  jobs: [
    job(117736555994, "build", "failure", ["Set up job", "Run actions/checkout@v4", "Run actions/setup-node@v4", "Run npm ci", "Run npm run build", "Run npm test", "Post Run actions/setup-node@v4", "Post Run actions/checkout@v4", "Complete job"]),
    job(117736555998, "lint", "success", ["Set up job", "Run actions/checkout@v4", "Run npm ci", "Run npm run lint", "Complete job"]),
  ],
};

// GitHub's log format: ISO-8601 UTC with millisecond and microsecond precision, then
// the annotation, then the line. Timestamps advance plausibly across ~65s of work.
const LOG = [
  "2026-07-08T04:16:13.4415230Z ##[group]Runner image: ubuntu-24.04",
  "2026-07-08T04:16:14.3945230Z Version:      2.327.1",
  "2026-07-08T04:16:15.3475230Z Commit:       741c1b3e",
  "2026-07-08T04:16:16.3005230Z OS:           Linux 6.8.0-1042-generic",
  "2026-07-08T04:16:17.2535230Z Architecture: X64",
  "2026-07-08T04:16:18.2065230Z DDIs:       7z, docker, git, node",
  "2026-07-08T04:16:19.1595230Z ##[endgroup]",
  "2026-07-08T04:16:19.1815230Z ##[section]Starting: Job",
  "2026-07-08T04:16:20.1345230Z Current runner version: '2.327.1'",
  "2026-07-08T04:16:21.0875230Z Runner group: 'Default'",
  "2026-07-08T04:16:22.0405230Z Operating System: Ubuntu 24.04.2 LTS",
  "2026-07-08T04:16:22.9935230Z Prepare workflow directory",
  "2026-07-08T04:16:23.9465230Z Prepare all required actions",
  "2026-07-08T04:16:24.8995230Z ##[group]Run actions/checkout@v4",
  "2026-07-08T04:16:24.9215230Z Syncing repository: fclidev/fcli",
  "2026-07-08T04:16:25.8745230Z Action inputs: repository=fclidev/fcli, persist-credentials=true, fetch-depth=1",
  "2026-07-08T04:16:26.8275230Z Got git authentication token",
  "2026-07-08T04:16:27.7805230Z Downloading from: https://github.com/fclidev/fcli",
  "2026-07-08T04:16:28.7335230Z Fetching the repository from https://github.com/fclidev/fcli",
  "2026-07-08T04:16:29.6865230Z HEAD is now at c91f4a2 docs: compare both sides fetching a real Actions log",
  "2026-07-08T04:16:30.6395230Z Cleaning up orphan processes",
  "2026-07-08T04:16:30.6615230Z ##[endgroup]",
  "2026-07-08T04:16:31.6145230Z ##[group]Run actions/setup-node@v4",
  "2026-07-08T04:16:32.5675230Z Found in cache @ /opt/hostedtoolcache/node/22.14.0/x64",
  "2026-07-08T04:16:33.5205230Z Environment details: node 22.14.0, npm 11.2.0",
  "2026-07-08T04:16:34.4735230Z ##[endgroup]",
  "2026-07-08T04:16:35.4265230Z ##[group]Run npm ci",
  "2026-07-08T04:16:36.3795230Z added 214 packages, and audited 215 packages in 24s",
  "2026-07-08T04:16:36.4015230Z 47 packages are looking for funding",
  "2026-07-08T04:16:37.3545230Z found 0 vulnerabilities",
  "2026-07-08T04:16:38.3075230Z ##[endgroup]",
  "2026-07-08T04:16:39.2605230Z ##[group]Run npm run build",
  "2026-07-08T04:16:40.2135230Z bundled 41 modules in 11.3s",
  "2026-07-08T04:16:41.1665230Z dist/index.js  412.3 kB  0 errors",
  "2026-07-08T04:16:42.1195230Z Build complete.",
  "2026-07-08T04:16:42.1415230Z ##[endgroup]",
  "2026-07-08T04:16:43.0945230Z ##[group]Run npm test",
  "2026-07-08T04:16:44.0475230Z  RUN  v2.1.9 /home/runner/work/fcli/fcli",
  "2026-07-08T04:16:45.0005230Z  ✓ tests/registry.test.ts (14 tests) 38ms",
  "2026-07-08T04:16:45.9535230Z  ✓ tests/config.test.ts (9 tests) 21ms",
  "2026-07-08T04:16:46.9065230Z  ✓ tests/store.test.ts (22 tests) 141ms",
  "2026-07-08T04:16:47.8595230Z  ✓ tests/help.test.ts (6 tests) 12ms",
  "2026-07-08T04:16:47.8815230Z  ✓ tests/lock.test.ts (5 tests) 8ms",
  "2026-07-08T04:16:48.8345230Z  ❯ tests/creds.test.ts (31 tests | 1 failed) 902ms",
  "2026-07-08T04:16:49.7875230Z     ✓ creds > unlock starts daemon over unix socket 142ms",
  "2026-07-08T04:16:50.7405230Z     ✓ creds > lock zeroizes key and removes socket 88ms",
  "2026-07-08T04:16:51.6935230Z     ✓ creds > ttl expiry emits expiry event",
  "2026-07-08T04:16:52.6465230Z     ✓ creds > provider refresh returns live value",
  "2026-07-08T04:16:53.5995230Z     ✓ creds > provider error falls back to mirror 311ms",
  "2026-07-08T04:16:53.6215230Z     × creds > provider recovers after transient failure",
  "2026-07-08T04:16:54.5745230Z       → expected undefined to be 'live-9f2c' // Object.is equality",
  "2026-07-08T04:16:55.5275230Z",
  "2026-07-08T04:16:56.4805230Z       Expected: \"live-9f2c\"",
  "2026-07-08T04:16:57.4335230Z       Received: \"undefined\"",
  "2026-07-08T04:16:58.3865230Z",
  "2026-07-08T04:16:59.3395230Z          at tests/creds.test.ts:281:31",
  "2026-07-08T04:16:59.3615230Z          279|  const store = await createStore({ ttl: 900 });",
  "2026-07-08T04:17:00.3145230Z          280|  store.setProvider({ name: 'vaultwarden', get: () => {",
  "2026-07-08T04:17:01.2675230Z          281|    if (++attempt < 2) throw new Error('unreachable');",
  "2026-07-08T04:17:02.2205230Z            |                               ^",
  "2026-07-08T04:17:03.1735230Z          282|    return Promise.resolve('live-9f2c');",
  "2026-07-08T04:17:04.1265230Z          283|  } });",
  "2026-07-08T04:17:05.0795230Z",
  "2026-07-08T04:17:05.1015230Z  Test Files  1 failed | 5 passed (6)",
  "2026-07-08T04:17:06.0545230Z       Tests  1 failed | 86 passed (87)",
  "2026-07-08T04:17:07.0075230Z    Start at  04:16:58",
  "2026-07-08T04:17:07.9605230Z    Duration  64.51s (transform 1.02s, setup 0ms, collect 2.11s, tests 1.12s)",
  "2026-07-08T04:17:08.9135230Z ##[error]Process completed with exit code 1.",
  "2026-07-08T04:17:09.8665230Z ##[endgroup]",
  "2026-07-08T04:17:10.8195230Z ##[group]Post Run actions/setup-node@v4",
  "2026-07-08T04:17:10.8415230Z In received shutdown signal, cancelling any in-progress commands",
  "2026-07-08T04:17:11.7945230Z ##[endgroup]",
  "2026-07-08T04:17:12.7475230Z ##[group]Post Run actions/checkout@v4",
  "2026-07-08T04:17:13.7005230Z Deleting local repository",
  "2026-07-08T04:17:14.6535230Z ##[endgroup]",
  "2026-07-08T04:17:15.6065230Z Job completed with result: Failed",
].join("\n");

// ---------------------------------------------------------------- f side
const F_INDEX = "f v0.3.3\n\nconfig     fj         ha         providers  ssh        \ncreds      gh         ha-ws      search     uck        \ndf         grocy      pi-models  skills     v          \n";
const fSess = {
  system:
    "You are an agent operating on the user's machine. Use the bash tool to run commands. Run `f` to list capabilities. Prefer the narrowest command that answers the question.",
  tools: [
    { name: "bash", description: "Run a shell command and return stdout and stderr.", input_schema: { type: "object", properties: { command: { type: "string", description: "command to run" } }, required: ["command"] } },
    { name: "jq", description: "Evaluate a jq filter over JSON on stdin. Use to project large API responses.", input_schema: { type: "object", properties: { filter: { type: "string", description: "jq filter" }, raw: { type: "boolean", description: "raw output, no quotes" } }, required: ["filter"] } },
  ],
  turns: [
    {
      user: "why did the fcli build fail?",
      assistant: "I'll check the recent Actions runs.",
      call: { name: "bash", input: { command: "f" } },
      result: F_INDEX,
    },
    {
      assistant: "`gh` covers GitHub. Listing recent runs.",
      call: { name: "bash", input: { command: "f gh GET /repos/fclidev/fcli/actions/runs?per_page=3" } },
      result: JSON.stringify(runs, null, 2),
    },
    {
      assistant: "The `ci` run failed. Getting its jobs.",
      call: { name: "bash", input: { command: "f gh GET /repos/fclidev/fcli/actions/runs/39148294696/jobs" } },
      result: JSON.stringify(jobs, null, 2),
    },
    {
      assistant: "Job 117736555994 (build) failed. Pulling its log.",
      call: { name: "bash", input: { command: "f gh GET /repos/fclidev/fcli/actions/jobs/117736555994/logs" } },
      result: LOG,
    },
    {
      assistant:
        "The failure is in `tests/creds.test.ts:281` — \"provider recovers after transient failure\" expected `live-9f2c` and got `undefined`. The provider throws on attempt 1 and your recovery path in src/store.ts:277 does not retry; it serves the last mirror instead of calling again. 86 other tests pass.",
    },
  ],
};

// ---------------------------------------------------------------- MCP side
const mcpSess = {
  system: "You are an agent operating on the user's machine. Use the provided tools to complete the task. Prefer the narrowest tool that answers the question.",
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  turns: [
    {
      user: "why did the fcli build fail?",
      assistant: "I'll look at the recent workflow runs.",
      call: { name: "list_commits", input: { owner: "fclidev", repo: "fcli" } },
      result: "[] — list_commits requires a commit history argument that the tool schema does not expose for workflow runs. This server has no Actions tool.",
    },
    {
      assistant: "No Actions tool exists here. Running the API call directly.",
      call: { name: "exec", input: { command: "curl -s -H \"Authorization: Bearer $GITHUB_TOKEN\" \"https://api.github.com/repos/fclidev/fcli/actions/runs?per_page=3\" | jq -c '[.workflow_runs[] | {name, head_branch, status, conclusion}]'" } },
      result: '[{"name":"fcli","head_branch":"main","status":"completed","conclusion":"success"},{"name":"fcli","head_branch":"main","status":"completed","conclusion":"success"},{"name":"ci","head_branch":"main","status":"completed","conclusion":"failure"}]',
    },
    {
      assistant: "The `ci` run failed. Getting its jobs.",
      call: { name: "exec", input: { command: "curl -s -H \"Authorization: Bearer $GITHUB_TOKEN\" \"https://api.github.com/repos/fclidev/fcli/actions/runs/39148294696/jobs\" | jq -c '[.jobs[] | {name, conclusion}]'" } },
      result: '[{"name":"build","conclusion":"failure"},{"name":"lint","conclusion":"success"}]',
    },
    {
      assistant: "The build job failed. Pulling its log.",
      call: { name: "exec", input: { command: "curl -sL -H \"Authorization: Bearer $GITHUB_TOKEN\" \"https://api.github.com/repos/fclidev/fcli/actions/jobs/117736555994/logs\" | gunzip 2>/dev/null | tail -60" } },
      result: LOG,
    },
    {
      assistant:
        "The failure is in `tests/creds.test.ts:281` — \"provider recovers after transient failure\" expected `live-9f2c` and got `undefined`. The provider throws on attempt 1 and your recovery path in src/store.ts:277 does not retry; it serves the last mirror instead of calling again. 86 other tests pass.",
    },
  ],
};

// Counters are encoded from the text the reader will see, including the tool
// definitions — that is what "resident" means, so it must be in the artifact.
function counters(s) {
  const defs = n(s.system) + s.tools.reduce((a, t) => a + n(JSON.stringify(t)), 0);
  const turns = s.turns.map((t) => ({
    call: t.call ? n(JSON.stringify(t.call)) : 0,
    result: t.result ? n(t.result) : 0,
    user: t.user ? n(t.user) : 0,
    assistant: t.assistant ? n(t.assistant) : 0,
  }));
  // Cumulative: the resident block (system + definitions) is present on every request,
  // so it is added per turn, not once.
  let acc = 0;
  const perTurn = [];
  for (const t of turns) {
    acc += defs + t.call + t.result + t.user + t.assistant;
    perTurn.push(acc);
  }
  return { defs, turns, cum: perTurn, total: acc };
}

const out = {
  generated: "synthetic session; tool definitions real; API bodies realistic",
  encoder: "o200k_base",
  mcp: { ...mcpSess, metrics: counters(mcpSess) },
  f: { ...fSess, metrics: counters(fSess) },
};
writeFileSync(`${DOCS}/src/data/session-comparison.json`, JSON.stringify(out, null, 1));
console.log(`src/data/session-comparison.json  ${(JSON.stringify(out).length / 1024).toFixed(0)} kB`);
console.log("MCP defs:", out.mcp.metrics.defs, "total:", out.mcp.metrics.total);
console.log("f   defs:", out.f.metrics.defs, "total:", out.f.metrics.total);
console.log("payload runs/jobs/log tokens:", n(JSON.stringify(runs, null, 2)), n(JSON.stringify(jobs, null, 2)), n(LOG));
