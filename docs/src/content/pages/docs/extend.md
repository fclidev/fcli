---
title: Extend
summary: Extend f with npm packages. An extension exports register(ctx) — the same contract as a uck — and is listed in the ucks array.
---

# Extend

For ucks you want to version, publish, or depend on, wrap them in an **npm
package**. Extensions are packages that export a `register(ctx)` function —
the same contract as [ucks](/docs/ucks/).

Full Node.js runtime — no sandboxing. Extensions can import each other, call
`child_process`, hit the network, modify core behavior, whatever.

## 1. Create an extension

```sh
my-f-ext/
  package.json
  index.js
```

**package.json:**

```json
{
  "name": "@myorg/f-my-ext",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.js"
}
```

**index.js:**

```js
export function register(ctx) {
  // ctx.fVersion — f's version
  // ctx.self     — this package's name

  return {
    name: "myuck",
    desc: "what it does (terse)",
    run: (argv, args, runCtx) => {
      // runCtx.ucks     — [{name, desc}] of every loaded uck
      // runCtx.registry — name -> everything that uck returned
      console.log("hello", args._.join(" "));
    },
  };
  // Can also return an array: [ {name: "a", ...}, {name: "b", ...} ]
}
export default { register };
```

## 2. Register it in f.config.json

Add it to the `ucks` array — an npm package is a source like any other:

```json
{
  "ucks": [
    "@myorg/f-my-ext",
    "./local-path/to/ext",
    { "source": "github:user/repo", "ref": "main" }
  ]
}
```

Source formats:

- **npm** — `"@scope/name"` — must be in `node_modules`, resolved at load.
- **local** — `"./my-ext"` or `"/abs/path"` — a dir with `package.json` or
  `index.js`.
- **git** — `"github:user/repo"` or `"git+https://…"`.
- **object** — `{ "source": "…", "ref": "branch", "name": "bucket" }`.

## 3. Install and run

Add the package to `ucks` and run `f up`. `f` fetches the tarball into
`~/.f/ucks/` — see [Adding a uck](/docs/ucks/#adding-a-uck).

```json
// f.config.json
{ "ucks": ["@myorg/f-my-ext"] }
```

```sh
f up
f myuck hello
```

The package is a copy under the store, not a dependency of your project: nothing
is added to your `package.json` or `node_modules`, and `f up` is what refreshes
it. `f uck` itself has no install subcommand.

> A legacy `extensions` key in `f.config.json` is still read as a source list
> when `ucks` is absent. Prefer `ucks`.

## Extension interop

Extensions run in the full Node.js runtime, and they share the uck registry:

- Import each other: `import { helper } from "@other/f-ext"`
- Use `child_process`, `fs`, `http`, `net` — everything.
- Call other ucks through `ctx.registry` in `run` (e.g. `ctx.registry.creds`),
  not at register time — the registry does not exist yet then.
- Modify or override core `f` behavior.

No sandbox. No restrictions. Ucks are first-class.

## Precedence

Later sources win. Store ucks load first, then npm sources, so an npm package
shadows a same-named uck from the store; within each group, project config
loads after global. See [Ucks](/docs/ucks/) for shadowing.
