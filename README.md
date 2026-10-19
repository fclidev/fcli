# f

[![npm version](https://img.shields.io/npm/v/@fcli.dev/f)](https://www.npmjs.com/package/@fcli.dev/f)
[![downloads](https://img.shields.io/npm/dm/@fcli.dev/f)](https://www.npmjs.com/package/@fcli.dev/f)
[![unpacked size](https://img.shields.io/npm/unpacked-size/@fcli.dev/f)](https://www.npmjs.com/package/@fcli.dev/f)
[![node](https://img.shields.io/node/v/@fcli.dev/f)](#install)
[![build](https://img.shields.io/github/actions/workflow/status/fclidev/fcli/docs.yml?event=push)](https://github.com/fclidev/fcli/actions/workflows/docs.yml)
[![license](https://img.shields.io/github/license/fclidev/fcli)](LICENSE)

**A command line interface for LLM agents.**

`f` is a single executable on `PATH`. An agent learns its commands by running
`f`, not from a declared tool schema, so nothing is paid until a command is
invoked. An MCP tool definition sits in the context of _every_ request whether
the model calls it or not; `f` prints names only, and descriptions come back for
the ucks a query actually matched.

Measured locally with `js-tiktoken` (`o200k_base`, cross-checked against
`cl100k_base`):

```
f v                          →   2 tokens, on invocation
f creds get prod.db          →   5 tokens, on invocation
f           (index, 16 ucks) →  59 tokens, once per session
f search ssh                 →  14 tokens, per query
f search credential          →  33 tokens, per query
```

Discovery is two steps: `f` lists names, `f search <query>` ranks them, and
`f <uck> --help` gives detail on one. An added uck costs 1–2 tokens — a name —
plus its grid column, measured at 4.00 tokens per uck on identical 5-character
names.

For MCP-side scale, one capability measured both ways. Reading a file by path:

|                        | `f creds get prod.db` | MCP `read_text_file` |
| ---------------------- | --------------------: | -------------------: |
| To write the call      |                     5 |                    5 |
| Definition in the body |                     2 |                  260 |

`read_text_file` is that server's largest tool — 97 of its 260 tokens are prose —
and it is quoted in full, with the harness and error bars, in
[docs/content/measurements.md](docs/content/measurements.md). The server's mean is
174.2 tokens per tool against 3.8 for `f`'s index.

Per-tool MCP cost ranges from 77.6 (archived Puppeteer) to 963 (Sequential
Thinking) — a 12× spread — so no single multiplier describes it. Sample and
method: [tooltax](https://github.com/duskel/tooltax), whose figures reproduce
exactly when its own command is re-run against the same versions.

A uck (f's word for a command) is a directory with an `index.js` that exports
`register(ctx)`, so extending `f` is editing a file. Output is plain text: no
colors, no banner, no completion message.

_A [home for all the ucks you don't give](https://fcli.dev/ucks/)._

```bash
npm i -g @fcli.dev/f
```

What it looks like from the inside:

```console
$ f
config  edit f.config.json via JSONPath (get/set/add/remove/list)
creds   store credentials (scrypt+AES-GCM, daemon+socket, ttl)
fj      Forgejo/Gitea API (ls/call/<METHOD> <path>)
ls      list files (terse, one per line)
uck     push store ucks to a git repo (bucket name = target name)
v       print f version

$ f fj runs newest
3774  success  pull_request  fec3afa9  #1291  9m
3773  failure  pull_request  58eb1186  #1291  9m

$ f fj joblogs 3773 "--- FAIL"
build-lint-test-4491-attempt-1.log:9348:--- FAIL: TestListWebhooks (6.68s)
```

Docs: [fcli.dev](https://fcli.dev) · Why not MCP:
[fcli.dev/#why-a-cli-and-not-mcp](https://fcli.dev/#why-a-cli-and-not-mcp)

## Install

From npm:

```bash
npm install -g @fcli.dev/f
```

Or install from git (dev):

```bash
git clone https://github.com/fclidev/fcli.git
cd fcli
npm i        # builds dist/ via the prepare hook
npm link     # puts the `f` command on your PATH (dev install)
```

Uninstall a dev install: `npm unlink -g f` (run from the clone) or `npm unlink f`.

## Usage

```
f <uck> [args]
```

### Default ucks

| Uck                                                                              | Description                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `f v`                                                                            | print version                                    |
| `f config ...`                                                                   | edit `f.config.json` via JSONPath                |
| `f creds ...`                                                                    | store credentials (encrypted, daemon+ttl)        |
| `f uck ...`                                                                      | push store ucks to a git repo                    |
| `f up`                                                                           | full update: re-fetch all configured uck sources |
| `f help`                                                                         | list every uck name                              |
| `f help` and `f up` are handled in core before the uck registry is consulted, so |
| they work against an empty store. `f search <query>` is an ordinary uck in the   |
| default bundle.                                                                  |

`v`, `w`, and `ls` are **default ucks** — they ship in the
[`@fcli.dev/ucks`](https://www.npmjs.com/package/@fcli.dev/ucks) npm package
(the published build of the [fcli-ucks](https://github.com/fclidev/fcli-ucks)
repo). On first install f seeds `~/.f/f.config.json` with that package as a
source, then installs it into the store. Override the source with
`F_UCKS_REPO` (a git URL still works — the clone flow is unchanged).

`up` and `help` are core builtins (special-cased in `cli.ts`): `help` is the no-arg behavior, `up` is a maintenance operation on f itself. `up` re-fetches every source in your config (global + project), overwriting the store so ucks pick up upstream changes.

**`f config`** edits `f.config.json` with JSONPath:

```bash
f config list                 # whole project config
f config -g get ucks          # global config, one path
f config add ucks ./my-uck    # append a source
f config set ucks[0] ./other  # replace by index
f config remove 'ucks[?(@.source=="./old")]'   # remove by filter
```

- Targets the **project** `f.config.json` by default; `-g` for the global `~/.f/f.config.json`.
- Values are JSON-parsed (numbers/bools/objects/arrays) or kept as raw strings.
- Other ucks can drive it programmatically: the uck exports `configApi`, whose methods take an explicit target (path, `"project"`, or `"global"`), so a uck can edit any config file.

**`f creds`** stores credentials encrypted at rest (`~/.f/f.creds.enc`, mode `0600`). The key is derived from a passkey you choose (scrypt KDF) and values are encrypted with AES-256-GCM.

```bash
f creds unlock [passkey] [--ttl sec]   # start daemon (default ttl 600s)
f creds set prod.db "postgres://u:p@h" # store
f creds get prod.db                     # print (decrypts)
f creds ls                              # list names
f creds rm prod.db                      # remove
f creds status                          # locked / unlocked + time left
f creds lock                            # stop daemon, zeroize key
```

- **Unlock** spawns a background daemon that derives the key once and holds it **in memory** — the passkey never touches disk and there is no key file. The daemon serves ops over a unix socket (`~/.f/.creds.sock`) and **auto-exits after the TTL** (default 10 min), zeroizing the key.
- **Wrong passkey** fails loudly: AES-GCM authentication rejects the data ("unable to authenticate data") rather than returning garbled plaintext.
- **Lock** (or TTL expiry) kills the daemon and removes the socket; the encrypted store on disk is untouched.
- Other ucks can drive it via the exported `credsApi` (`get`/`set`/`ls`/`unlock`/`lock`/`status`).

**`f uck`** pushes ucks from the store to a git repo. A **bucket is a source** (`~/.f/ucks/<bucket>/`), so the **bucket name is the link**: a push target named `mine` mirrors the ucks in `~/.f/ucks/mine/`.

```bash
f uck repo add mine https://…/me/my-ucks.git [--ref main]  # register a push target
f uck repo ls                                            # list targets + their store ucks
f uck repo rm mine                                       # unregister
f uck push -r mine                                       # push every uck in bucket 'mine'
f uck push greet ls -r mine                              # push only these ucks
```

- **Push model (v1):** clone the target (shallow), overwrite the named uck dirs from the store, commit, `git push` (fast-forward only, never `--force`). `node_modules` is never pushed. **The store wins per uck** — the store's copy replaces the repo's.
- **Auth** is delegated to `git` (your ssh keys / credential helper).
- **Pull:** add the repo as a source in `f.config.json` (give it a matching `name` so the bucket lines up) and run `f up` — that is a `git fetch` + reset of the bucket.
- Other ucks can drive it via the exported `uckApi` (`loadTargets`/`saveTargets`/`push`/`bucketUcks`).

## The store

Every uck f knows about lives under **`~/.f/ucks/<bucket>/`**. `<bucket>` is the source the uck came from — the repo basename (git), path basename (local), or an explicit `name` on the source — so the store keeps provenance **by construction**: the path tells you where each uck came from.

- **A git bucket is the clone of that repo**, `.git/` and all. `f up` is `git fetch` + `git reset --hard`, not a re-download, so you can `git log`, `git diff`, and `git blame` an installed uck. It also means the bucket is a cache: anything you edit in place gets reset, so edit elsewhere and send it with `f uck push`.
- **A local bucket is a copy** of the path you added.
- **First install** seeds `~/.f/f.config.json` with the defaults repo, then downloads each configured source into the store (only if not already present).
- **Normal runs** just load the store — instant, no network.
- **`f up`** forces re-download.
- **Shadowing:** if two sources provide the same uck name, the **later** source wins (project config is read after global, so a project uck overrides a same-named default). Both stay in the store; only the later one loads.

## Config

`f.config.json` lists uck sources. Two levels are merged:

- **Global** `~/.f/f.config.json` — the defaults baseline (seeded on first install).
- **Project** `f.config.json` (nearest from cwd) — adds more on top.

```json
{
  "ucks": [
    "@fcli.dev/ucks",
    "./my-local-uck",
    { "source": "github:user/repo", "ref": "main" }
  ]
}
```

A source can be a **repo** (git URL / `github:user/repo`) — it expands to every `<name>/` inside — or a **local path** to a single uck. npm package sources resolve from `node_modules` at load (run `npm i` first).

### Selecting a subset of a repo

A repo source can be filtered to install only some of its ucks:

```json
{
  "ucks": [
    { "source": "github:org/many-ucks", "only": ["creds", "ls"] },
    { "source": "github:org/many-ucks", "except": ["experimental"] }
  ]
}
```

- `only: [...]` — install just these uck names (whitelist).
- `except: [...]` — install everything except these (blacklist).
- If both are given, **`only` wins**.
- Sources are **independent**: each installs whatever its own filter allows. You can point two entries at the same repo with different subsets and get the union — or pin a curated set with `only`.

You can also add a filtered source from the CLI via `f config`:

```bash
f config add ucks '{"source":"github:org/many-ucks","only":["creds"]}'
```

## Ucks

A **uck** is a unit of f functionality. Builtins are ucks. Extensions register ucks. An uck is only a word when prefixed with `f-`.

## Adding a uck

A uck is a **directory** with an `index.js` (plus any supporting files). Put it in your store, or point a config source at it.

**As a local source** — create the dir, add it to `f.config.json`:

```
my-ucks/ls/
  index.js
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
{ "ucks": ["./my-ucks/ls"] }
```

f copies it into `~/.f/ucks/ls/` and it's available. Return an array from `register()` to add multiple ucks from one module.

**As a repo** — put uck dirs in a git repo (`v/index.js`, `w/index.js`, …) and add the repo URL to `f.config.json`. f clones it into `~/.f/ucks/<repo>/` and loads every uck dir inside it, at any depth.

## Extending f (as npm packages)

For ucks you want to version, publish, or depend on, wrap them in an **npm package**. Extensions are packages that export a `register(ctx)` function. Full Node.js runtime — no sandboxing. Extensions can import each other, call `child_process`, hit the network, modify core behavior, whatever.

### 1. Create an extension

```
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
  // ctx.fVersion        — f's version
  // ctx.contractVersion — the contract this core speaks (2)
  // ctx.self            — this uck's registered name

  return {
    name: "myuck",
    desc: "what it does (terse)",
    run: (argv, args, runCtx) => {
      // args._ is the remaining CLI args
      // runCtx additionally has runCtx.ucks + runCtx.registry (peer access)
      console.log("hello", args._.join(" "));
    },
  };
}
// Can also return an array: [ {name: "a", ...}, {name: "b", ...} ]

export default { register };
```

### 2. Register it in `f.config.json`

```json
{
  "extensions": [
    "@myorg/f-my-ext",
    "./local-path/to/ext",
    { "source": "github:user/repo", "ref": "main" }
  ]
}
```

Source formats:

- **npm**: `"@scope/name"` — must be in `node_modules`
- **local**: `"./my-ext"` or `"/abs/path"` — dir with `package.json` or `index.js`
- **git**: `"github:user/repo"` or `"git+https://..."` — pre-install via `npm i`
- **object**: `{ "source": "...", "ref": "branch" }` — pin a git ref

### 3. Install & run

```bash
npm i @myorg/f-my-ext
f myuck hello
```

### Extension interop

Full Node.js runtime. Extensions can:

- Import each other: `import { helper } from "@other/f-ext"`
- Use `child_process`, `fs`, `http`, `net` — everything
- Inspect and call other ucks via `ctx.ucks` / `ctx.registry` **in `run`** — the
  register-time ctx carries neither
- Modify or override core f behavior

No sandbox. No restrictions. Ucks are first-class.

## Design principles

1. **Short names** — `f v` not `f version`
2. **Terse output** — no boilerplate, no colors, no "Done!"
3. **npm-native** — extensions are packages, `npm i` to install
4. **Full runtime** — no sandbox, ucks can do anything
5. **Context injection** — ucks know what else is registered
6. **Nothing re-sent** — the model discovers `f` by running it, so no tool list
   sits in the context of every request.

## Development

```bash
npm install
npm run build
npm run dev
npm run typecheck
```

## License

GPL-3.0. See [LICENSE](./LICENSE). Ucks (extension commands) are licensed separately per source; see each uck's own LICENSE or package.json.
