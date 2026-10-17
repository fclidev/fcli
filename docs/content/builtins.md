---
title: Builtins
summary: Every uck that ships with f — v, w, ls, config, creds, skills, uck — plus the core builtins help and up.
---

# Builtins

What you get on a fresh install, with nothing configured. `f help` is the live
list; this page is the same thing with details.

## First run

On first run `f` seeds `~/.f/f.config.json` with the
[fcli-ucks](https://github.com/kensand/fcli-ucks) repo and clones it into the
store. That repo is the builtins: seven ucks, one directory each.

```sh
f help
```

```text
f v0.2.2 — token-efficient CLI

usage: f <uck> [args]

ucks:
  config  edit f.config.json via JSONPath (get/set/add/remove/list)
  creds  store credentials (scrypt+AES-GCM, daemon+socket, ttl)
  ls  list files (terse, one per line)
  skills  manage local skill entries (search/ls/show/add/rm) in f.config.json
  uck  push store ucks to a git repo (bucket name = target name)
  v  print f version
  w  locate binary (alias for which)

run 'f <uck> --help' for details.
```

`help` and `up` are not in that list: they are special-cased in core rather
than ucks in the store — see [Core builtins](#core-builtins).

## v

```sh
f v          # 0.2.2
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
f creds unlock [passkey] [--ttl sec]   # start daemon (default ttl 600s)
f creds status                         # locked / unlocked + time left
f creds set prod.db "postgres://…"     # store
f creds get prod.db                    # print (decrypts)
f creds ls                             # list names
f creds rm prod.db                     # remove
f creds request <name> [--timeout sec] # block until someone else sets it
f creds waiters                        # open requests, from other terminals
f creds fill [name]                    # prompt + set values for open waiters
f creds lock                           # stop daemon, zeroize key
```

`request` / `waiters` / `fill` are the cross-terminal pattern: a uck in one
terminal blocks on a credential it does not have, and the human in another
terminal sees the open request (`waiters`) and answers it (`fill`). See
[Credentials](/credentials/).

Other ucks reach the same store through the exported `credsApi` (`get` / `set`
/ `ls` / `unlock` / `lock` / `status` / `wait`) — which is how a uck like a
Forgejo client can block on a token instead of failing when the token is
missing.

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

| Command  | Behavior                                                    |
| -------- | ----------------------------------------------------------- |
| `f help` | List every uck (name + one-line desc). Also the no-arg `f`. |
| `f up`   | Re-fetch every configured source into the store.            |

`f help`, `f --help`, `f -h`, and bare `f` are the same thing. `f up` is the
only routine run that touches the network — see [Update](/update/).

## Where they live

The seven ucks above are ucks like any other: plain `index.js` files in a repo
you could fork, not code compiled into the binary. What makes them builtin is
that they arrive automatically — the first install seeds that repo into the
global config. Adding your own ucks is the same mechanism pointed at a
different source: see [Ucks](/ucks/) and [Config](/config/).
