---
page: home
title: Overview
summary: A home for all the ucks you don't give. A token-efficient CLI for LLMs - f bills per command, not per catalogue. Install it, then read the words underneath.
---

!!!hero
<p class="hero-title">Stop paying token tax<br>for every tool call</p>
<p class="hero-tag">A home for all the ucks you don’t give.</p>
<p class="hero-lede">Every tool you give a model costs tokens <em>before</em> it
uses one. <code>f</code> bills per command, not per catalogue.</p>
<div class="install">
  <pre><code id="install-cmd">npm i -g @fcli.dev/f</code></pre>
  <button class="copy" type="button" data-copy="#install-cmd" aria-label="Copy install command">Copy</button>
</div>
<div class="terminal" aria-label="A real f session">
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
  <p class="uck-group"><span>the defaults</span><i>@fcli.dev/ucks, on first install</i></p>
  <div class="uck-row"><code>f creds</code><span>store credentials, encrypted, with a TTL daemon</span></div>
  <div class="uck-row"><code>f skills</code><span>markdown instructions, loaded into context on demand</span></div>
  <div class="uck-row"><code>f config</code><span>edit f.config.json with JSONPath</span></div>
  <div class="uck-row"><code>f uck</code><span>push ucks from the store to a git repo</span></div>
  <p class="uck-group"><span>someone else’s repo</span><i>added with one line of config</i></p>
  <div class="uck-row"><code>f fj</code><span>Forgejo/Gitea — all 491 endpoints of it</span></div>
  <div class="uck-row"><code>f gh</code><span>GitHub, via @octokit/rest</span></div>
  <div class="uck-row"><code>f ha</code><span>Home Assistant: states, scenes, automations</span></div>
  <div class="uck-row"><code>f vaultwarden</code><span>read secrets from a Vaultwarden vault</span></div>
  <div class="uck-row"><code>f ssh</code><span>ssh/scp/rsync with a key that never touches disk</span></div>
  <div class="uck-row"><code>f pi-models</code><span>save pi’s model config in the encrypted store</span></div>
</div>
!!!

# Home

**A home for all the ucks you don't give.** `f` is a command line built to be
read by an LLM. The whole interface is one line on your `PATH`, and a model
discovers it by running it:

```sh
f creds get prod.db
```

Run that and it costs **five tokens**. Counted, not estimated — `o200k_base` and
`cl100k_base` agree. The equivalent MCP tool definition is **88 tokens**, and it
gets paid on every request whether the model calls it or not. Multiply that by
the catalogue, because the catalogue is where the tax actually lives:

| What you wire up                      | What the model pays                    |
| ------------------------------------- | -------------------------------------- |
| An MCP server with 20 tools           | ~1,440 tokens, on every request        |
| `f` with the same 20 things behind it | 260 once to list them, 4–10 to use one |

Both figures counted, not guessed. The schema side is 20 realistic definitions
with descriptions and input schemas; the `f` side is what `f help` actually
prints. That is **5.5×** for the same surface — and the schema cost recurs on
every request, while the listing is paid once per session.

## Why a CLI and not MCP

**Nothing to host.** An MCP server is a process to install, configure, run, and
keep alive — plus a tool-defs payload the model wades through on every request.
`f` is one file on your `PATH`. No daemon, no handshake, no protocol version
negotiation.

**Discoverable in place.** The model finds out what `f` can do by running `f`,
not by parsing a schema someone handed it. One terse line per command, no colors,
no boilerplate, no "Done!" — and always current, because it is generated from
what is actually installed rather than from a manifest that can drift.

**Extensible in seconds.** A command is a directory with an `index.js` in it.
Drop it in the store, or `npm i` a package, and it answers on the next call. Full
Node.js runtime — `child_process`, `fs`, `http`, the network. No sandbox, no
manifest review, no restart.

## An uck doesn't need to be perfect

It just needs to answer when you call it. Most of what lives in a store got
written in an afternoon to stop one specific annoyance — `f ha-ws` exists because
Home Assistant's REST API cannot create an automation and returns a 404 when you
try, so the uck drives the WebSocket API instead. It is not elegant. It answers.

That low bar is the reason `f` spreads at all. A tool you have to polish before
you trust it never gets written; a tool you can finish in an evening and stop
thinking about gets written every time something is mildly annoying. And when an
uck turns out to matter, growing it is editing a file, not starting over — that
is exactly the [`f fj` story](/recipes/), where a whole missing capability landed
as two added words on a uck that already existed.

## What this is, in three words

- **Ucks** — a unit of `f` functionality. Builtins are ucks, extensions are ucks,
  `f creds` is a uck. [The contract →](/ucks/)
- **The store** — `~/.f/ucks/<bucket>/`. Every uck `f` knows about, with
  provenance in the path: a git bucket *is* the clone, so you can `git blame` an
  installed command. [Inside the store →](/ucks/#the-store)
- **Config** — `f.config.json`, global and project merged, listing uck sources
  and skills. [Config →](/config/)

## Start here

- [**Install**](/install/) — `npm i -g @fcli.dev/f`, then exactly what happens on
  first run.
- [**Quickstart**](/quickstart/) — run `f`, read its output, add your own uck in
  under a minute.
- [**Recipes**](/recipes/) — one real debugging session, before and after: the
  workarounds an LLM invented around a gap, the two words added to an existing
  uck to close it, and 6–8 tool round-trips becoming 2.

Source: [github.com/fclidev/fcli](https://github.com/fclidev/fcli) ·
Default ucks: [github.com/fclidev/fcli-ucks](https://github.com/fclidev/fcli-ucks)
