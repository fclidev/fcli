---
page: home
title: Overview
summary: f is a command line interface for LLM agents. Commands are directories with an index.js, discovered by running f rather than declared in a tool schema. Lists what ships, how the store works, and how to extend it.
---

!!!hero
<span class="hero-title"><span>A command line interface</span> <span>for LLM agents</span></span>
<p class="hero-lede"><code>f</code> puts a machine-readable CLI on your <code>PATH</code>. Commands are discovered by running <code>f</code>, not declared in a tool schema.</p>
<div class="install">
  <pre><code id="install-cmd">npm i -g @fcli.dev/f</code></pre>
  <button class="copy" type="button" data-copy="#install-cmd" aria-label="Copy install command">Copy</button>
</div>
<div class="terminal" aria-label="Example f session">
  <div class="term-bar"><i></i><i></i><i></i><span>~/repo</span></div>
  <pre><code><span class="t-cmd">f</span>
config     creds      fj        ha         ls         skills     v
creds      df         gh        ha-ws      pi-models  ssh        w

<span class="t-cmd">f search credential</span>
creds store credentials (scrypt+AES-GCM,…
providers list credential providers reg…
vaultwarden read secrets from a Vaultwar…

<span class="t-cmd">f creds status</span>
unlocked 8m12s left

<span class="t-cmd">f fj runs newest</span>
3774 success pull_request fec3afa9 #1291 9m
3773 failure pull_request 58eb1186 #1291 9m

<span class="t-cmd">f fj joblogs 3773 "--- FAIL"</span>
build-lint-test-4491-attempt-1.log:9348:--- FAIL: TestListWebhooks (6.68s)</code></pre>
</div>
<div class="uck-wall" aria-label="Ucks from different sources, all answering as f">
  <p class="uck-group"><span>defaults</span><i>@fcli.dev/ucks, installed on first run</i></p>
  <div class="uck-row"><code>f creds</code><span>store credentials, encrypted, with a TTL daemon</span></div>
  <div class="uck-row"><code>f skills</code><span>markdown instructions, loaded into context on demand</span></div>
  <div class="uck-row"><code>f config</code><span>edit f.config.json with JSONPath</span></div>
  <div class="uck-row"><code>f uck</code><span>push ucks from the store to a git repo</span></div>
  <p class="uck-group"><span>additional sources</span><i>added in f.config.json</i></p>
  <div class="uck-row"><code>f fj</code><span>Forgejo/Gitea — all 491 endpoints of it</span></div>
  <div class="uck-row"><code>f gh</code><span>GitHub, via @octokit/rest</span></div>
  <div class="uck-row"><code>f ha</code><span>Home Assistant: states, scenes, automations</span></div>
  <div class="uck-row"><code>f vaultwarden</code><span>read secrets from a Vaultwarden vault</span></div>
  <div class="uck-row"><code>f ssh</code><span>ssh/scp/rsync with a key that never touches disk</span></div>
  <div class="uck-row"><code>f pi-models</code><span>save pi’s model config in the encrypted store</span></div>
</div>
!!!

# Home

`f` is a command line interface for LLM agents. It is a single executable on
`PATH`; an agent learns its commands by running `f`, not from a declared tool
schema. A command costs nothing until invoked, and the always-present cost is a
name index rather than a description per command.

```sh
f creds get prod.db
```

Token counts come from `docs/scripts/count-tokens.mjs`, which runs the `f`
binary against a real uck store. Counts use `js-tiktoken` under `o200k_base`,
cross-checked against `cl100k_base`; the ranks agree on command strings and
short queries and differ by 1–2 tokens per line on descriptions dense with
slashes or paths.

| Cost                           | `o200k_base` | `cl100k_base` | What it covers   |
| ------------------------------ | ------------ | ------------- | ---------------- |
| `f v`                          | 2            | 2             | issuing the call |
| `f config get ucks`            | 5            | 5             | issuing the call |
| `f creds get prod.db`          | 5            | 5             | issuing the call |
| `f search credential`          | 3            | 3             | issuing the call |
| `f fj joblogs 3773 "--- FAIL"` | 10           | 10            | issuing the call |
| `f` index, 16 ucks             | 61           | 62            | once per session |
| `f search ssh` (1 hit)         | 14           | 13            | per query        |
| `f search list files` (3 hits) | 29           | 29            | per query        |
| `f search credential` (3 hits) | 33           | 34            | per query        |
| `f search nothingzzz` (0 hits) | 8            | 9             | per query        |

| Ucks installed | `f` index (names only) | full listing (name + desc) |
| -------------: | ---------------------: | -------------------------: |
|             16 |                     61 |                        376 |
|             24 |                    116 |                          — |
|             72 |                    308 |                          — |
|            256 |                  1,044 |                          — |

Index rows above 16 are projected at 4.00 tokens per uck, measured on identical
5-character names. A name itself is 1–2 tokens; the rest of that 4 is the grid
column it is padded into. The projection is conservative for the store measured
here, where the marginal worked out at 2.44.

## One capability, both ways

Reading a file by path. `f creds get` and the MCP filesystem server's
`read_text_file` both take one path and return its contents.

```sh
f creds get prod.db
```

The MCP side, byte for byte from that server's own `tools/list` response
(`@modelcontextprotocol/server-filesystem@1.0.0`):

```json
{
  "name": "read_text_file",
  "title": "Read Text File",
  "description": "Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "tail": {
        "description": "If provided, returns only the last N lines of the file",
        "type": "number"
      },
      "head": {
        "description": "If provided, returns only the first N lines of the file",
        "type": "number"
      }
    },
    "required": ["path"]
  },
  "annotations": {
    "readOnlyHint": true,
    "openWorldHint": false
  },
  "execution": {
    "taskSupport": "forbidden"
  },
  "outputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "content": {
        "type": "string"
      }
    },
    "required": ["content"],
    "additionalProperties": false
  }
}
```

|                                     | `f creds get prod.db` | `read_text_file` |
| ----------------------------------- | --------------------: | ---------------: |
| Tokens to issue the call            |                     5 |                5 |
| Tokens of definition, every request |                     2 |              260 |

Same 5 tokens to ask for the thing. Then 260 tokens describe that tool on every
request, against 2 tokens describing this one. 97 of those 260 are the
description sentence; the rest is JSON Schema, including an `outputSchema` that
says the result is a string.

`read_text_file` is this server's largest tool. Its mean is 174.2 (table below),
so this pair shows an upper bound, not a typical tool.

Across the whole filesystem server: 2,439 tokens for 14 tools, a mean of 174.2.
The `f` index costs 61 tokens for 16 ucks. Per capability that is 174.2 against
3.8, which spans from 46× to 108× depending on whether `f`'s number is the whole
index or a single name.

That ratio is worth one caveat: the two costs are not identical. An MCP
definition is the complete interface — types, enums, nested objects, limits —
and arrives on every request. The index gives names; `f <uck> --help` and
`f search` cost extra, and fire only on demand. `f` moves work from every request
to the ones that need it.

## Context cost against MCP

An MCP tool definition is sent with every request, whether or not the model
calls it. `f` sends a name index once and pays for descriptions only on the ucks
a query returns.

|                                     | `f`                      | MCP                                      |
| ----------------------------------- | ------------------------ | ---------------------------------------- |
| Cost per capability, always present | 2.4–4 tokens (name only) | 77.6–963 tokens (full definition)        |
| What is always present              | name                     | name, description, input + output schema |
| Who sets the size                   | the command name         | the author of the description            |
| When it is paid                     | once per session         | every request                            |
| A capability never called costs     | 1–2 tokens               | its full definition, every request       |
| Host process                        | none — one binary        | installed, configured, running           |

Per-tool MCP cost, `o200k_base`. Where there are two columns, they are the same
server at the same version: tooltax scores a live server over stdio, "here"
tokenizes its captured `tools/list` response. They differ by how much JSON
syntax the tokenizer sees, and the column says which.

| Server               | Tools | tokens/tool (tooltax) | tokens/tool (here)¹ |
| -------------------- | ----: | --------------------: | ------------------: |
| Fetch                |     1 |                   237 |                   — |
| Puppeteer (archived) |     7 |                  77.6 |                   — |
| Git                  |    12 |                  94.1 |                   — |
| Everything           |    13 |                  90.1 |                   — |
| Filesystem           |    14 |                 170.2 |               205.6 |
| Memory               |     9 |                 225.3 |                   — |
| Playwright           |    25 |                 151.7 |               176.5 |
| GitHub (archived)    |    26 |                   138 |                   — |
| Kubernetes           |    23 |                 222.2 |                   — |
| MongoDB              |    31 |                 533.3 |                   — |
| Firecrawl            |    26 |                 642.8 |                   — |
| Notion               |    24 |                 726.3 |                   — |
| Sequential Thinking  |     1 |                   963 |                   — |

¹ "here" captures the `tools/list` response and tokenizes each tool as its own
JSON object, then averages. That strips array separators and one layer of braces,
so it reads high: filesystem 205.5, Playwright 176.5. tooltax tokenizes the whole
list as one value and gives 174.2 and 151.7 for the same servers at the same
versions — it reproduces its own leaderboard exactly. Use the tooltax column; "here"
is the per-tool count, not a server total. Tool counts match across both methods,
which is the part that matters for this table.

The per-tool figures span 77.6 to 963 tokens, a factor of 12, so no single multiplier describes
MCP. Reference runs, both tokenizing the output of `tools/list`:

- [tooltax](https://github.com/duskel/tooltax) — leaderboard generated
  2026-09-29: 18 servers scored live, 256 tools, 77,877 tokens, 38.9% of a 200k
  window if all were installed. Its README reports a different run (20 servers,
  290 tools, 73,323 tokens), so totals move between runs; per-server figures come
  from the leaderboard file, linked below, and are dated.
  [Full leaderboard](https://github.com/duskel/tooltax/blob/main/LEADERBOARD.md)
- [mcp-turnstile](https://github.com/singhpratech/mcp-turnstile/blob/main/report/BENCHMARK.md)
  — 24 tools at 11,213 tokens, 72 tools at 33,709 tokens; 467–468 tokens/tool at
  both sizes, 16.9% of a 200k window before the first user message. Reported as
  468 in the source.

## Why a CLI and not MCP

**No host process.** An MCP server is installed, configured, and kept running.
`f` is one executable on `PATH`: no daemon, no handshake, no protocol version
negotiation.

**Discovery at runtime, in two steps.** `f` prints the names of every installed
uck; `f search <query>` ranks them against what you are trying to do, and
`f <uck> --help` gives the detail for one. Both are generated from the store at
invocation time, so they reflect what is actually installed rather than a
manifest that can drift. Output is plain text: no colors, no banner, no
completion message.

**Extension is a directory.** A command is a directory containing `index.js`.
Adding it to the store, or `npm i`-ing a package, makes it available on the next
invocation. Extensions run in the full Node.js runtime — `child_process`, `fs`,
`http`, the network. There is no sandbox, no manifest review, and no restart.

## Runtime and safety

There is no sandbox. Code in the store executes with full process privileges: it
can read credentials, files, and anything else the invoking user can reach. `f`
does not vet ucks.

Two mechanisms limit the blast radius, and neither is a sandbox:

- Stored credentials expire. `f creds` holds values behind a TTL, after which a
  lookup misses. It bounds how long a secret stays readable; it does not restrict
  what running code can do.
- Name collisions resolve by source order, not by trust. The later source wins —
  project config is read after global, so a project uck overrides a same-named
  default. Both copies stay installed; only one loads. See
  [Shadowing](/ucks/#shadowing).

Installing a source means trusting it: `f config add ucks <source>` accepts an
arbitrary GitHub repo or npm package. See [Config](/config/).

## Terms

- **Uck** — one unit of `f` functionality: a directory with an `index.js` that
  exports `register(ctx)`. Builtins, extensions, and your own commands are all
  ucks, differing only in which source installed them. Details: [Ucks](/ucks/).
- **Store** — `~/.f/ucks/<bucket>/`. Every uck `f` has loaded. The bucket name is
  part of the path, so a git-sourced uck sits in its own clone and `git blame`
  works against installed commands. Layout: [The store](/ucks/#the-store).
- **Config** — `f.config.json`, global and project scopes merged, listing uck
  sources and skills. Format and keys: [Config](/config/).

## Pages

- [Install](/install/) — `npm i -g @fcli.dev/f`, and what the first run writes.
- [Quickstart](/quickstart/) — run `f`, search it, add a uck, run it.
- [Builtins](/builtins/) — every command present on a fresh install, one section
  each.
- [Ucks](/ucks/) — the `register(ctx)` contract, the store layout, shadowing.
- [Config](/config/) — source declarations, subset selection, skills.
- [Credentials](/credentials/) — encrypted store, provider fall-through, miss
  cache, packed files.
- [Skills](/skills/) — markdown instruction files loaded into context on demand.
- [Extend](/extend/) — writing and registering an extension package.
- [Update](/update/) — `f up`, and `f uck push`.
- [Recipes](/recipes/) — a worked example: a specific API gap, the wrapper's
  behavior around it, and the change that closed it. Contains narrative; the
  reference pages above are the specification.

Source: [github.com/fclidev/fcli](https://github.com/fclidev/fcli) ·
Default ucks: [github.com/fclidev/fcli-ucks](https://github.com/fclidev/fcli-ucks)
