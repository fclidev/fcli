---
page: home
title: Overview
summary: f is a token-efficient CLI for LLMs. Every tool you hand a model costs tokens before it uses one - f bills per command, not per catalogue. Install it, then read the 300 words underneath.
---

!!!hero
<p class="hero-title">Stop paying token tax<br>for every tool call</p>
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
!!!

# Home

`f` is a command line built to be read by an LLM. The whole interface is one
line on your `PATH`, and a model discovers it by running it:

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
