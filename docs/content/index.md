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
config  edit f.config.json via JSONPath (get/set/add/remove/list)
creds   store credentials (scrypt+AES-GCM, daemon+socket, ttl)
fj      Forgejo/Gitea API (ls/call/&lt;METHOD&gt; &lt;path&gt;)
ls      list files (terse, one per line)
skills  manage local skill entries (search/ls/show/add/rm)
uck     push store ucks to a git repo (bucket name = target name)
v       print f version

<span class="t-cmd">f ls src</span>
cli.ts
config.ts
help.ts
index.ts
lock.ts
registry.ts
store.ts

<span class="t-cmd">f creds status</span>
unlocked  8m12s left

<span class="t-cmd">f fj runs newest</span>
3774  success  pull_request  fec3afa9  #1291  9m
3773  failure  pull_request  58eb1186  #1291  9m

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
schema. Commands cost nothing until invoked — the listing is the only
always-present cost.

```sh
f creds get prod.db
```

Token cost is measured with `js-tiktoken` under `o200k_base` and `cl100k_base`,
which agree on every figure below.

| Cost                             | Tokens           | When it is paid  |
| -------------------------------- | ---------------- | ---------------- |
| `f creds get prod.db`            | 5                | on invocation    |
| `f help`, first run (8 commands) | 161              | once per session |

Both counted locally with `js-tiktoken`; the two encoders agree.

The comparison worth making is not a token count but a payment schedule: an MCP
tool definition sits in the context of every request whether or not the model
calls it, and `f help` is fetched once. Absolute sizes depend on description
length, so they are not stated here as a single number.

For scale, measured elsewhere (neither count produced here; both used the same
`o200k_base` encoder): real MCP servers average roughly **140–730 tokens per
tool definition** — GitHub 138, Playwright 152, Kubernetes 222, Notion 726 —
across a 18-server sample of 256 tools and 77,877 tokens. A separate benchmark
of verbose production schemas measured 466 tokens per tool, and reports that a
72-tool surface costs ~33,700 tokens, 16.9% of a 200k window, before the first
user message. Sources: [tooltax](https://github.com/duskel/tooltax) and
[mcp-turnstile](https://github.com/singhpratech/mcp-turnstile/blob/main/report/BENCHMARK.md).

## Why a CLI and not MCP

**No host process.** An MCP server is installed, configured, and kept running.
`f` is one executable on `PATH`: no daemon, no handshake, no protocol version
negotiation.

**Discovery at runtime.** `f help` lists every installed command, one line each.
That output is generated from the store at invocation time, so it reflects what
is actually installed rather than a manifest that can drift. Output is plain
text: no colors, no banner, no completion message.

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
- [Quickstart](/quickstart/) — read `f help`, add a uck, run it.
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
