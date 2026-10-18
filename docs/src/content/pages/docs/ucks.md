---
title: Ucks
summary: A uck is a unit of f functionality - a directory with an index.js exporting register(ctx). The contract, the ctx shape, the store layout at ~/.f/ucks, and shadowing order.
---

# Ucks

A home for all the ucks you don't give — the small commands too specific to
become a project and too useful to leave unscripted. `f` is where they live and
how they run; this page is the contract they satisfy.

A uck is a unit of `f` functionality. The builtins are ucks; extensions are
ucks; `f config add ucks <source>` is the same mechanism pointed at a different
source. An uck is only a word when prefixed with `f-`.

What ships on a fresh install is listed on the [Builtins](/docs/builtins/) page.

A uck is a **directory** containing an `index.js` (plus any supporting files).
The `index.js` exports a `register(ctx)` function.

## The contract

```js
// index.js
export function register(ctx) {
  // ctx.fVersion        — f's version, e.g. "0.3.1"
  // ctx.contractVersion — the contract version this core implements (1)
  // ctx.self            — this uck's own name
  // ctx.ucks            — [{name, desc}] of every loaded uck
  // ctx.registry        — name -> everything that uck returned

  return {
    name: "myuck", // the word after `f`
    desc: "what it does (terse)", // shown by `f search` and `f <name> --help`
    run: (argv, args, runCtx) => {
      // args._ is the remaining CLI args
      // argv is the full argv
      // runCtx has the same five keys as ctx above — see "One ctx shape"
      process.stdout.write("hi\n");
    },
  };
}
export default { register };
```

- Return **one** uck object, or an **array** of them to register several from
  one module.
- `run` receives the parsed arguments; `args._` is the array of remaining
  (positional) CLI args.
- Full Node.js runtime — `child_process`, `fs`, `http`, `import`, the network.
  No sandbox.

### One ctx shape, two moments

`register()` and `run()` receive the **same five keys**: `fVersion`,
`contractVersion`, `self`, `ucks`, `registry`. Core builds both from one object
shape, so they cannot drift apart. What differs is what is _in_ them:

- At **register** time `ucks`/`registry` are a **partial view** — only the ucks
  that loaded before yours, and not your own name. Use it there for feature
  detection (`"creds" in ctx.registry`), never for an authoritative peer lookup.
- At **run** time the view is complete: `ucks` is every registered uck (name +
  desc) and `registry` holds every registered uck. Inter-uck calls belong in
  `run`.

```js
export function register(_ctx) {
  return {
    name: "myuck",
    desc: "borrow a token",
    run: (_argv, _args, ctx) => {
      const creds = ctx.registry.creds?.credsApi;
      if (creds) creds.get("my.forge.example.com").then(process.stdout.write);
    },
  };
}
```

`contractVersion` is an **interface** number, not a release number: `fVersion`
(`"0.3.1"`) tells you which build of f is running, `contractVersion` (`1`) which
contract it speaks. A uck written against contract 1 can branch on it at
register time, before returning anything. It says nothing about a _peer's_ release
cadence — feature-detect `credsApi`, `configApi` or a credential provider on its
own surface, not on this number.

`ctx.registry` is the **only** peer accessor. `ctx.uck(name)` — 0.3.0's sugar over
`registry[name]` — is deleted, with no deprecation cycle: the key is absent, so a
uck still calling it fails loud (`ctx.uck is not a function`) instead of quietly
falling back to a socket read that reports "no-store" as "not configured". The
map is read-only by convention: registration happens through `register()`, never
by mutating it.

A uck may export anything else it wants — `configApi`, `credsApi`, `skills`,
your own fields. Core ignores what it does not know; other ucks read it off
`ctx.registry`. One export is read straight off the **module**, not the registry:
`credentialProvider`, which is how a uck becomes a credential provider — see
[Credentials](/docs/credentials/).

## The store

Every uck `f` knows about lives in **`~/.f/ucks/<bucket>/`**.

- **`<bucket>`** is one source: the repo basename (git), path basename
  (local), or an explicit `name` on the source. The path records provenance by
  construction.
- **A git bucket is the clone** of its repo, `.git/` and all. Uck directories
  are found at any depth inside the clone, so a repo can organise ucks into
  subdirectories. Installed ucks are checkouts: `git log`, `git diff` and
  `git blame` work on them.
- **A local bucket is a copy** of the path you added — a local source is
  already a checkout, and the one you edit. Unlike a clone, a local bucket is
  walked one level deep (`<bucket>/<name>/index.js`), so keep ucks at the top
  of the directory you point at.
- **First install** seeds `~/.f/f.config.json` with the defaults repo, then
  clones each configured source into the store (only if not already
  present).
- **Normal runs** just load the store — instant, no network.
- **`f up`** fetches and resets every bucket (see [Update](/docs/update/)).
- **The bucket is a cache.** Anything you edit under `~/.f/ucks/` is discarded
  on the next `f up`. Publish changes with `f uck push` instead.

A uck that needs a third-party library declares it in its own `package.json`;
f runs `npm i` in that uck's directory on install and on `f up`. Dependencies
belong to the uck, never to f core.

That `package.json` is also what makes an ESM uck loadable. Node decides a
`.js` file's module type from the nearest `package.json`, so an `index.js`
written with `import`/`export` needs `"type": "module"` somewhere above it:

```json
// my-ucks/hello/package.json
{ "type": "module" }
```

Git sources do not need it — f writes the marker into every ESM uck in a clone
after each install and after every `f up`. A uck that already declares a `type`
is left alone; only ESM-looking ucks get one, so a genuine CommonJS uck is not
flipped by a marker it never asked for.

Local sources get no marker, so an ESM uck installed from a path fails to load
(`Unexpected token 'export'`) until you add one. This bites on first try, and it
survives `f up` — a local bucket is re-copied from its source, so the missing
marker comes back with the copy.

### Shadowing

If two sources provide the same uck name, the **later** source wins (project
config is read after global, so a project uck overrides a same-named default).
Both copies stay in the store; only the later one loads.

## Adding a uck

**As a local source** — create the directory, add it to `f.config.json`. A
local bucket is walked one level deep, so ucks are subdirectories of the path
you point at:

```sh
my-ucks/
  ls/
    index.js
    package.json    # { "type": "module" } — see ESM note above
```

```js
// my-ucks/ls/index.js
import { execSync } from "node:child_process";
export function register(_ctx) {
  return {
    name: "ls",
    desc: "list files (terse)",
    run: (_argv, args) => {
      const target = (args._ ?? ["."])[0];
      const out = execSync(`ls -1 ${target}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      process.stdout.write(out);
    },
  };
}
export default { register };
```

```json
// f.config.json
{ "ucks": ["./my-ucks"] }
```

`f` copies it into `~/.f/ucks/my-ucks/ls/` and it is available as `f ls`. Point
ing at a single uck directory (`./my-ucks/ls`) also works; it just nests the
uck under a bucket named after itself.
**As a repo** — put uck directories in a git repo (`v/index.js`,
`w/index.js`, …) and add the repo URL to `f.config.json`. `f` clones it into
`~/.f/ucks/<bucket>/` and loads every uck directory inside it, at any depth.
See [Config](/docs/config/) for source forms and [Extend](/docs/extend/) for publishing
ucks as npm packages.
