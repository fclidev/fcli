---
title: Credentials
summary: f creds stores credentials encrypted at rest. A daemon holds the key in memory and auto-exits after a TTL, and a local miss falls back to credential providers.
---

# Credentials

`f creds` stores credentials encrypted at rest in `~/.f/f.creds.enc` (mode
`0600`). The key is derived from a passkey you choose (scrypt KDF) and values
are encrypted with AES-256-GCM.

```sh
f creds unlock [passkey] [--ttl <dur>]  # start daemon (default 10m; s/m/h/d/w)
f creds set prod.db "postgres://u:p@h" # store
f creds get prod.db --secrets          # print — redacted without --secrets
f creds ls                             # list names (provider mirrors hidden)
f creds rm prod.db                     # remove
f creds status                         # locked / unlocked + time left, + provider readiness
f creds forget [name…]                 # drop provider mirror(s) + the miss cache
f creds request <name> [--timeout sec] # block until the cred is set elsewhere
f creds waiters                        # list open waiting requests
f creds fill [name]                    # prompt + set values for open waiters
f creds files <sub>                    # whole files in the same box
f creds lock                           # stop daemon, zeroize key
```

Durations (`--ttl`, `--timeout`) are a plain number of seconds or a length with
`s`/`m`/`h`/`d`/`w` units: `900`, `45m`, `2h`, `1d`, `1d6h30m`.

## How it works

- **Unlock** spawns a background daemon that derives the key once and holds it
  **in memory** — the passkey never touches disk and there is no key file.
  The daemon serves ops over a unix socket (`~/.f/.creds.sock`) and
  **auto-exits after the TTL** (default 10 min), zeroizing the key.
- **Wrong passkey** fails loudly: AES-GCM authentication rejects the data
  ("unable to authenticate data") rather than returning garbled plaintext.
- **Lock** (or TTL expiry) kills the daemon and removes the socket; the
  encrypted store on disk is untouched.

## Reading and writing values

`f creds get` **redacts by default**. Without `--secrets` the value is not
printed, only `[redacted — pass --secrets to reveal]`, so a `get` in a log, a
transcript or an agent trace leaks nothing. `request` is the same: it confirms
the cred arrived and stays silent unless you pass `--secrets`.

```sh
f creds get prod.db                 # [redacted — pass --secrets to reveal]
f creds get prod.db --secrets       # postgres://u:p@h
f creds get prod.db --source        # value + `f: source: local:prod.db` on stderr
```

`set` prefers a pipe over `argv`: with no value argument (or with `-`) it reads
stdin, and on a terminal it prompts without echoing. Passing a secret as a word
on the command line works, and `f` says so — anything in `argv` is readable from
`ps` for the life of the process:

```sh
echo SECRET | f creds set prod.db   # prints: set  prod.db  (stdin)
f creds set prod.db                 # terminal: prompts without echo
f creds set prod.db 'postgres://…'  # works, with a note about `ps`
```

Names are opaque strings. Two prefixes are **reserved**: `mirror:` (provider
mirrors, below) and `file:` (packed files, below). `f creds set 'mirror:x' v` is
refused — mirrors belong to their provider, not to you.

## Provider fall-through

`f creds get` reads the local box first. On a **miss** it asks every registered
**credential provider** — see [Providers](#providers) — and mirrors a hit into
the box as `mirror:<name>` under a TTL, so later reads are offline, fast, and
survive the provider being unreachable.

```sh
f creds get github.com --secrets --source
# s3cret
# f: source: myprov:github.com (mirrored)     ← the provider answered, not the box

f creds ls                     # (1 provider mirror(s) hidden — --all)
f creds ls --all               # mirror:github.com  (mirror; myprov; expires 2026-10-17T04:50:08.805Z)
f creds forget github.com      # drop that mirror + its cached miss; no args = all mirrors
```

Because a mirror is a real copy of a secret, `f creds rm mirror:<name>` is a
real deletion. `f creds rm <name>` where only a mirror exists drops the local
copy and tells you the provider still answers for that name — the next `get`
re-mirrors it. To stop a name resolving, remove it at the source.

### Flags on `get`

| flag          | meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `--secrets`   | print the value; without it the output is redacted                            |
| `--local`     | never consult providers                                                       |
| `--vault`     | skip the local value and the mirror, revalidate with the provider now         |
| `--source`    | print provenance to stderr (`local:<name>`, `<provider>:<name> (mirrored)`)   |
| `--no-cache`  | ignore **and clear** the negative cache for that name first                   |

**`--local` does not work on `get` — use `creds lookup --local`.** The `get` handler
never reads the flag: `--local` sets `localOnly`, and `case "get"` calls the provider
ladder unconditionally on a local miss, so the flag is parsed and then discarded.
`creds lookup` does honour it. Confirmed against `creds/index.js` rather than inferred,
and the two are not equivalent:

```sh
f creds lookup <name> --local   # f: no such cred   <- correct, providers skipped
f creds get <name> --local      # serves the provider value anyway
```

Pass `--source` alongside `get` when provenance matters: `f: source: <provider>:<name>
(mirrored)` on a value you asked to be local-only is how you catch this.

### The miss cache

A name no provider knows is cached briefly (300s) so one typo does not hammer a
server on every invocation. `--no-cache` resets one name; `f creds forget`
clears them. The cache lives in `~/.f/.creds-cache.json` (plaintext at rest,
mode `0600`) as `miss:<name>` entries, next to `src:<name>` provenance — those
are **not** box keys, so `f creds ls` never shows them and `f creds rm` cannot
clear them.

Providers are configured in `~/.f/f.config.json`:

```json
{
  "providers": { "myprov": { "mirrorTtlSec": 3600, "enabled": false } },
  "mirrorTtlSec": 3600
}
```

`enabled: false` takes a provider out of the ladder without uninstalling its
uck; `mirrorTtlSec` bounds how long a mirrored hit may go before it is
revalidated.

## Providers

A credential provider is any uck that exports a `credentialProvider` object
alongside `register()`. `f providers` lists them and their readiness;
`f creds status` prints the same readiness lines.

```sh
f providers            # one row per provider: myprov  uck:myprov  mirrorTtl:3600s
f providers --dump     # the discovery payload `f creds` actually reads (--json is the same)
```

On a fresh install there are none — no default uck is a provider — and the
output says so with exit code 0.

The interface, normative in section 5 of `CONTRACT.md` in the
[fcli-ucks](https://github.com/fclidev/fcli-ucks) repo:

```js
credentialProvider: {
  name: "myprov",            // required; the id in provenance and status output
  resolve: (name) => value,  // required
  has?: (name) => boolean,   // optional pre-filter
  status?: () => ({ ready, note?, hint? }),
  mirrorTtlSec?: number,     // floor on how long a hit may go un-revalidated
}
```

`resolve(name)` has exactly **three** outcomes, and the difference is the whole
contract:

| outcome                        | meaning            | what you see                                       |
| ------------------------------ | ------------------ | -------------------------------------------------- |
| a value (string or `Buffer`)   | a hit              | the value, mirrored as `mirror:<name>`             |
| `null` / `undefined` / `""`    | "this name is not mine" | the next provider, then `no such cred: <name>` |
| **throws**                     | availability failure | the error, verbatim, exit non-zero                |

**Returning `null` for a failure is the cardinal sin**: an unreachable vault
reads as "you have no such credential". Throwing is how a provider says
*broken* rather than *absent* — verified against a provider that throws:

```text
f: provider 'myprov' failed: … myprov is offline     # exit 1
```

`has(name)` is a trap. If it answers false, `resolve` is never called **and that
answer is cached**. Implement it only if it can answer offline; not implementing
it is always safe. `status()` feeds `f creds status` and `f providers` — report
readiness, not ownership.

Discovery imports every installed uck and reads the **module-level**
`credentialProvider` export — putting it on the object returned by `register()`
is not enough, and nothing provider-owned runs until a name is looked up. For a
provider whose `index.js` is also its CLI entry, creds reaches it as a child
process (`node <uck>/index.js resolve <name> | has <name> | status`), so a
provider must be side-effect free at module scope, must never prompt (throw
instead), and must pass `F_CREDS_NO_PROVIDER=1` through when it shells out to
`f` — that is the recursion guard. Because the probe is a child process, a
provider may not import a sibling bucket's shared code; dependencies belong in
its own `package.json`.

## Packed files

`f creds files` stores whole files in the same encrypted box, keyed by absolute
path (`file:<abs path>`), with the manifest itself a normal cred entry named
`files`. `f creds pack` and `f creds unpack` are aliases for
`f creds files pack` / `f creds files unpack`.

```sh
f creds files pack ./id_ed25519 ./kubeconfig.yaml   # store, keyed by absolute path
f creds files ls                                    # path, bytes, mode, packed-at
f creds files ls --json                             # the raw manifest
f creds files unpack ./id_ed25519                   # restore in place (refuses an existing file)
f creds files unpack ./id_ed25519 --force           # … overwriting, with a .bak written first
f creds files unpack ./id_ed25519 --dir /tmp/stage  # stage under a root instead
f creds files unpack 'file:/root/.ssh/id_ed25519' - # raw bytes to stdout
f creds files unpack id_key '=>' /elsewhere/key     # restore to a different path
f creds files rm ./kubeconfig.yaml                  # drop one entry + its manifest line
```

## Crossing terminals

`request`, `waiters` and `fill` exist because a uck often needs a credential
the current session does not have — a token for a Forgejo instance, a registry
password. Rather than fail, the uck blocks:

Terminal A — a uck (or you) needs a cred it does not have:

```sh
f creds get my.forge.example.com      # not set yet
f creds request my.forge.example.com  # blocks until someone sets it (default 300s)
```

Terminal B — the human, seeing what is outstanding:

```sh
f creds waiters                      # name + who is waiting
f creds fill                         # prompt for each open request
```

Terminal A unblocks as soon as the value is set.

`request` also waits for `unlock` if the daemon is merely locked, so a uck can
ask for a secret and a TTL in one call without knowing the passkey. Waiters
register themselves in `~/.f/.creds-waiters.json`, which is what makes them
visible from another terminal.

- Other ucks can drive it via the exported `credsApi` (`get` / `set` / `ls` /
  `unlock` / `lock` / `status` / `wait`), which takes the same names — so a
  uck that needs a token can block on it the same way `f creds request` does.

## Where these rules come from

`CONTRACT.md` in the [fcli-ucks](https://github.com/fclidev/fcli-ucks) repo,
section 5, is the **normative** text for the provider interface;
`creds/README.md` in the same repo is the operational doc that mirrors it. Where
they disagree this page follows CONTRACT.md and the built binary — and they do
disagree: the README calls the store `~/.f/.creds.box` and a `files list`
subcommand, while `creds/index.js` writes `~/.f/f.creds.enc` and the subcommand
is `files ls`, and the README lists `import`/`export` commands this build's
`f creds` usage does not offer.
