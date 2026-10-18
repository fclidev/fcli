---
title: Builtins
summary: Every uck that ships with f — v, w, ls, config, creds, providers, skills, uck — plus the core builtins help and up.
---

# Builtins

What you get on a fresh install, with nothing configured. `f` prints the live
list of names; this page is the same set with details.

## First run

On first run `f` seeds `~/.f/f.config.json` with the
[`@fcli.dev/ucks`](https://www.npmjs.com/package/@fcli.dev/ucks) npm package
and installs it into the store. That package is the builtins: the published
build of the [fcli-ucks](https://github.com/fclidev/fcli-ucks) repo, one
directory per uck.

```sh
f
```

```text
f v0.3.3

config     creds      ls         providers    skills       uck          v            w

f <uck> --help | f search <query>
```

Names only, deliberately. A name-plus-description listing grows linearly with
the store (measured at ~21 tokens per uck on real descriptions), so it cannot be
the default surface for a large store. Read one description with
`f <uck> --help`, or get a filtered set with `f search <query>` — see
[Core builtins](#core-builtins).

`help` and `up` are not in that list: they are special-cased in core rather
than ucks in the store — see [Core builtins](#core-builtins).

## v

```sh
f v          # 0.3.1
```

Prints f's own version — the version of the `f` binary, not of the ucks.

## w

```sh
f w node     # /usr/local/bin/node
```

Locate a binary on `PATH`. An alias for `which`, and it passes its arguments
through, so `which`'s flags work.

## ls

```sh
f ls some/dir
```

List files, terse, one per line. A thin wrapper over `ls -1` that passes its
arguments through. Note that it does not default a path for you: with no
argument the wrapper asks `ls` for `undefined` and errors, so pass `.`
explicitly.

## config

Edit `f.config.json` with JSONPath. Targets the **project** config by default;
`-g` for the global `~/.f/f.config.json`.

```sh
f config list                      # whole project config
f config -g get ucks               # global config, one path
f config add ucks ./my-uck         # append a source
f config set ucks[0] ./other       # replace by index
f config remove 'ucks[?(@.source=="./old")]'   # remove by filter
```

Values are JSON-parsed (numbers, bools, objects, arrays) or kept as raw
strings. See [Config](/config/) for the file itself.

Other ucks can drive it programmatically: the uck module exports `configApi`
alongside `register`, and its methods take an explicit target (a path,
`"project"`, or `"global"`), so a uck can edit any config file.

## creds

Credentials encrypted at rest, held in memory by a daemon with a TTL.

```sh
f creds unlock [passkey] [--ttl <dur>] # start daemon (default 10m; s/m/h/d/w)
f creds status                         # locked / unlocked + time left, + provider readiness
f creds set prod.db "postgres://…"     # store (no value: stdin, or a no-echo prompt)
f creds get prod.db --secrets          # print — redacted without --secrets
f creds ls                             # list names (provider mirrors hidden)
f creds rm prod.db                     # remove
f creds forget [name…]                 # drop provider mirrors + the miss cache
f creds request <name> [--timeout sec] # block until someone else sets it
f creds waiters                        # open requests, from other terminals
f creds fill [name]                    # prompt + set values for open waiters
f creds files <sub>                    # whole files in the same box
f creds lock                           # stop daemon, zeroize key
```

`request` / `waiters` / `fill` are the cross-terminal pattern: a uck in one
terminal blocks on a credential it does not have, and the human in another
terminal sees the open request (`waiters`) and answers it (`fill`). See
[Credentials](/credentials/).

`--ttl` and `--timeout` take a plain number of seconds or a duration with
`s`/`m`/`h`/`d`/`w` (`45m`, `2h`, `1d6h30m`).

Other ucks reach the same store through the exported `credsApi` (`get` / `set`
/ `ls` / `unlock` / `lock` / `status` / `wait`) — which is how a uck like a
Forgejo client can block on a token instead of failing when the token is
missing.

On a **local miss** `get` consults credential providers — see
[providers](#providers) and [Credentials](/credentials/).

## providers

List the credential providers registered with `f creds`.

```sh
f providers            # providers, then their readiness
f providers --dump     # the machine-readable discovery payload (--json is the same)
```

A **credential provider** is any uck that exports a `credentialProvider` object
alongside `register()`. `f creds get` asks them on a local miss and mirrors a
hit back into the encrypted store as `mirror:<name>`, so later reads are
offline. With one provider installed:

```text
myprov    uck:myprov    mirrorTtl:3600s
ok        1 provider(s)
  myprov: ready — fake provider
```

With none — the state on a fresh install, since no default uck is a provider —
the output is `(no credential providers — a uck exports 'credentialProvider')`
and the exit code is still 0. `f creds status` prints the same readiness lines.

Discovery imports every installed uck and reads the export; nothing
provider-owned runs until a name is looked up. The interface — `resolve`, the
optional `has` / `status` / `mirrorTtlSec`, and the rule that a provider
**throws** rather than returns `null` when it is broken — is normative in
section 5 of `CONTRACT.md` in the
[fcli-ucks](https://github.com/fclidev/fcli-ucks) repo. What `f creds` does with
it is on [Credentials](/credentials/).

## skills

Skills are named pointers to local markdown files — instructions an LLM pulls
into context on demand instead of paying for on every prompt.

```sh
f skills                     # show the default skill
f skills ls                  # list skills (name + path)
f skills show <name>         # print a skill's markdown
f skills search <query>      # rank configured skills by relevance
f skills add <name> <path>   # register a skill
f skills rm <name>           # remove a skill
```

`-g` targets the global config, same rule as `config`. First install seeds a
`default` skill pointing at the `default.md` that ships inside the skills uck
— that file is f's own usage guide. See [Skills](/skills/).

## uck

Push ucks from the store to a git repo. The bucket name is the link: a push
target named `mine` mirrors `~/.f/ucks/mine/`.

```sh
f uck repo add mine https://…/my-ucks.git [--ref main]
f uck repo ls                              # targets + their store ucks
f uck repo rm mine
f uck push -r mine                         # every uck in bucket 'mine'
f uck push greet ls -r mine                # only these ucks
```

Pushes are fast-forward only, never `--force`; authentication is delegated to
`git`. See [Update](/update/).

## Core builtins

Two commands are handled in core, before the uck registry is consulted, so
they work even with an empty store:

| Command  | Behavior                                                   |
| -------- | ---------------------------------------------------------- |
| `f help` | List every uck name, no descriptions. Also the no-arg `f`. |
| `f up`   | Re-fetch every configured source into the store.           |

`f help`, `f --help`, `f -h`, and bare `f` are the same thing. Both are handled
before the uck registry is consulted, so they answer even with an empty store —
which is exactly why they are core and not ucks. `f up` is the
only routine run that touches the network — see [Update](/update/).

`f search` is **not** in that table: it is an ordinary uck in the default bundle,
not core code. Ranking is the part of discovery most likely to need tuning, and a
uck ships without an f release. Unlike `help` and `up` it has nothing to answer
with on an empty store, so it does not need core's guarantee. Matching is by
substring and word prefix, so it is predictable rather than fuzzy — a typo does
not match. See [fcli-ucks](https://github.com/fclidev/fcli-ucks).

## Where they live

The eight ucks above are ucks like any other: plain `index.js` files in a repo
you could fork, not code compiled into the binary. What makes them builtin is
that they arrive automatically — the first install seeds that repo into the
global config. Adding your own ucks is the same mechanism pointed at a
different source: see [Ucks](/ucks/) and [Config](/config/).
