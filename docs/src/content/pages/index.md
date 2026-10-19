---
page: home
# Renders src/components/Hero.astro above the article. The hero is markup rather than
# prose, so it is a component and not a content field — see that file for why.
hero: true
title: Overview
summary: f is a command line interface for LLM agents. Commands are directories with an index.js, discovered by running f rather than declared in a tool schema. Lists what ships, what discovery costs in tokens, and how to extend it.
---

`f` is a command line interface for LLM agents. It is a single executable on
`PATH`; an agent learns its commands by running `f`, not from a declared tool
schema. A command costs nothing until invoked, and the always-present cost is a
name index rather than a description per command.

## Context cost against MCP

Three costs, compared assuming both sides use their best strategy: MCP with
prefix caching and tools/list discovery, `f` with its name grid.

**Discovery.** MCP: one tools/list call, full definitions cached from then on.
`f`: one `f` call, 61-token name grid cached from then on. Both are paid once
per session. Per capability, the `f` grid costs 3.8 tokens (61 / 16 ucks); a
single MCP tool definition costs 77.6–963 tokens.

**Compute.** Re-reading a prompt prefix is what makes a request slow. Prefix
caching removes that: the tool definitions are tokenized into the model once, and
a later request that repeats the same bytes skips the reprocessing. If the
definitions are stable, their compute cost is paid once.

**The bytes are still there.** The API is stateless, so every request carries the
tool list in its body, and the model only “knows” a tool exists because it is in
the tokens it is being fed right now. Caching discounts the rate, not the
presence: cached input is billed at 10% of base on Anthropic, up to 95% off on
OpenAI, against 100% on a miss.

|                        | `f`                          | MCP, cached + tools/list |
| ---------------------- | ---------------------------- | ---------------------: |
| Discovery, per capability | 3.8 tokens (61 / 16) | 77.6–963 tokens (one def) |
| In the body, per request | never (names are runtime output) | full definition      |
| Re-processed, per request | never                     | not after the first    |
| Steady-state billing   | ≈ 0                          | definition × 10–50%    |
| A tool never called    | 0                            | definition × 10–50%    |
| Occupies the context window | no                       | always                 |

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

Discovery does not fix either: tools/list puts the full definitions in the
context window, and caching only discounts their rate. `f` has neither failure
mode: the name grid is 61 tokens that occupy 0.03% of a 200k window, and it is
paid once.

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
  [Shadowing](/docs/ucks/#shadowing).

Installing a source means trusting it: `f config add ucks <source>` accepts an
arbitrary GitHub repo or npm package. See [Config](/docs/config/).

## Terms

- **Uck** — one unit of `f` functionality: a directory with an `index.js` that
  exports `register(ctx)`. Builtins, extensions, and your own commands are all
  ucks, differing only in which source installed them. Details: [Ucks](/docs/ucks/).
- **Store** — `~/.f/ucks/<bucket>/`. Every uck `f` has loaded. The bucket name is
  part of the path, so a git-sourced uck sits in its own clone and `git blame`
  works against installed commands. Layout: [The store](/docs/ucks/#the-store).
- **Config** — `f.config.json`, global and project scopes merged, listing uck
  sources and skills. Format and keys: [Config](/docs/config/).

## Ucks on npm

- [Ucks](/ucks/) — packages tagged `fcli-uck`, resolved live against npm. It sits
  outside the documentation tree above and outside the sidebar: it reports what is
  published, which changes without a rebuild.

Source: [github.com/fclidev/fcli](https://github.com/fclidev/fcli) ·
Default ucks: [github.com/fclidev/fcli-ucks](https://github.com/fclidev/fcli-ucks)
