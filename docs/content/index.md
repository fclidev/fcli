---
title: Overview
summary: f is a token-efficient CLI for LLMs. Short commands, terse output, extensible via npm packages and the uck store.
---

# f

`f` is a token-efficient CLI for LLMs: short commands, terse output, no
boilerplate. It extends by dropping **ucks** — small units of functionality —
into a local store, sourced from git repos or npm packages.

## Why a CLI and not MCP?

LLMs use command lines more efficiently than MCP servers:

- **Nothing to host.** An MCP server is a process to install, run, and keep
  alive, plus a tool-defs payload the model has to wade through. `f` is a
  command on your `PATH`.
- **Discoverable in place.** `f help` lists exactly what is available, in the
  model's own working context.
- **Extensible in seconds.** Drop a directory with an `index.js` into the
  store, or `npm i` an extension package, and the new uck is there.
- **Full runtime.** Ucks are plain Node.js — `child_process`, `fs`, `http`,
  network, imports. No sandbox.

## The model

- **Ucks** are units of functionality. A uck is a directory with an
  `index.js` that exports `register(ctx)`. Builtins are ucks; extensions are
  ucks.
- **The store** is `~/.f/ucks/<bucket>/`. Every uck f knows about lives
  here. For a git source, the bucket _is_ the clone of that repo — `.git/`
  and all — so provenance is by construction and an installed uck can be
  `git log`'d.
- **Config** is `f.config.json` (global at `~/.f/`, project at the nearest
  directory from cwd). It lists uck sources and skills.
- **Extensions** are npm packages that export `register(ctx)`. `npm i` to
  install, add to `f.config.json`, done.
- **Skills** are named pointers to local markdown files — instructions read
  into context on demand. Same config, same store.

## Layout

```
f
├─ core (src/)          the CLI runtime: arg parsing, store, config, registry
├─ store (~/.f/ucks/)   every uck f knows about, one bucket per source
└─ config (f.config.json)  sources + skills, global + project merged
```

## Pages

- [Install](/install/) — get `f` on your PATH.
- [Quickstart](/quickstart/) — first run, the default ucks.
- [Ucks](/ucks/) — what a uck is, the store, the `register` contract.
- [Builtins](/builtins/) — the eight ucks that arrive on first install.
- [Config](/config/) — `f.config.json`, sources, filters.
- [Skills](/skills/) — markdown instructions, loaded on demand.
- [Credentials](/credentials/) — encrypted secrets with `f creds`.
- [Extend](/extend/) — extensions as npm packages.
- [Update](/update/) — `f up`, pushing ucks to a repo.

Source: [github.com/kensand/fcli](https://github.com/kensand/fcli) ·
Default ucks: [github.com/kensand/fcli-ucks](https://github.com/kensand/fcli-ucks)
