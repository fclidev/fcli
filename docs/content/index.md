---
page: home
title: Overview
summary: f is a command line interface for LLM agents. Commands are directories with an index.js, discovered by running f rather than declared in a tool schema. Lists what ships, what discovery costs in tokens, and how to extend it.
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

5 tokens to write that call. 2 tokens describe it. Here is what an MCP tool for
the same job costs:

|                       | `f creds get prod.db` | `read_text_file` |
| --------------------- | --------------------: | ---------------: |
| To write the call     |                     5 |                5 |
| Definition in the body|                     2 |              260 |

Same 5 tokens to ask for the thing. Then 260 tokens of definition ride along in
the request body whether or not the model uses it — cached or not — against 2
tokens describing this one. What caching does and does not do with that 260 is
in [Measurements](/measurements/).

The `f` index — every command name, one grid — costs 61 tokens for 16 ucks and
is paid once per session. A tool definition instead sits in the request body on
every call, cached or not; per capability that is 3.8 tokens against 174.2, the
mean across the filesystem server's 14 tools.

## Context cost against MCP

There are two separate costs, and they behave differently under prefix caching.

**Compute.** Re-reading a prompt prefix is what makes a request slow. Prefix
caching removes that: the tool definitions are tokenized into the model once, and
a later request that repeats the same bytes skips the reprocessing. If the
definitions are stable, their compute cost is paid once.

**The bytes are still there.** The API is stateless, so every request carries the
tool list in its body, and the model only "knows" a tool exists because it is in
the tokens it is being fed right now. Caching discounts the rate, not the
presence: cached input is billed at 10% of base on Anthropic, up to 95% off on
OpenAI, against 100% on a miss.

|                        | `f`                          | MCP, cached            | MCP, uncached |
| ---------------------- | ---------------------------- | ---------------------: | ------------: |
| In the body, per request | never (names are runtime output) | full definition      | full definition |
| Re-processed, per request | never                     | not after the first    | every request |
| Steady-state billing   | ≈ 0                          | definition × 10–50%    | full definition |
| A tool never called    | 0                            | definition × 10–50%    | full definition |
| Occupies the context window | no                       | always                 | always        |

The first request always pays full, and so does every request after the bytes
change. Caching is a prefix match on exact bytes: one tool added, removed, or
reworded invalidates everything at and after it, back to full price. That is the
uncached column, and it is what a server whose tool surface drifts between
requests actually pays.

So the defensible claims are the two the cache does not remove:

- the definitions **always occupy the context window**, cached or not — 77.6 to
  963 tokens each, and 56 of them take 16.9% of a 200k window before the first
  user message;
- their **compute** cost is the only one caching removes, and only while the
  bytes are stable.

`f` has neither failure mode: it never serializes a definition into the body, so
there is nothing to cache, nothing to invalidate, and nothing occupying the
window between invocations.

No host process on the `f` side: one binary on `PATH`, no daemon. Details in
[Why a CLI and not MCP](#why-a-cli-and-not-mcp).

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
