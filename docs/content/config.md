---
title: Config
summary: f.config.json lists uck sources and skills. Two levels merge: global and project. Edit with f config.
---

# Config

`f.config.json` lists where ucks come from and which skills are available.
Two levels are merged:

- **Global** `~/.f/f.config.json` — the defaults baseline (seeded on first
  install).
- **Project** `f.config.json` (nearest from cwd, up to six directories) — adds
  more on top.

```json
{
  "ucks": [
    "https://github.com/kensand/fcli-ucks.git",
    "./my-local-uck",
    { "source": "github:user/repo", "ref": "main" }
  ],
  "skills": [{ "name": "git-flow", "path": "~/.f/skills/git-flow.md" }]
}
```

Only `ucks` is read by core: it is the list of sources. `skills` is read by the
`skills` uck, and anything else you put in the file is left alone for other
ucks to use — the config is a shared JSON document, not a fixed schema.

## Uck sources

A source can be:

- **A repo** — a git URL (`https://`, `ssh://`, `git+https://`), `github:user/repo`
  or `git@host:user/repo`. It expands to every uck directory inside it, at any
  depth.
- **A local path** — `./my-uck` or `/abs/path`: one uck, or a directory of
  them.
- **An npm package** — `@scope/name`, resolved from `node_modules` at load
  (run `npm i` first).
- **An object** — `{ "source": "…", "ref": "branch", "name": "bucket" }`.

Object fields:

- `ref` — branch or tag to check out (git sources).
- `name` — the store bucket. Defaults to the repo/path basename; set it when
  two sources would otherwise collide, or when you want a stable name that
  isn't the repo's.
- `only` / `except` — subset filters, below.

Each source becomes a bucket under `~/.f/ucks/`. A git bucket is the clone of
that repo; a local bucket is a copy. See [Ucks](/ucks/) for the store.

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
- Sources are **independent**: each installs whatever its own filter allows.
  You can point two entries at the same repo with different subsets and get
  the union — or pin a curated set with `only`.

### Skills

The `skills` array registers markdown files by name:

```json
{ "skills": [{ "name": "git-flow", "path": "~/.f/skills/git-flow.md" }] }
```

Managed with `f skills add` / `f skills rm`; ucks can also export skills that
need no entry at all. See [Skills](/skills/).

## f config

The `f config` uck edits `f.config.json` with JSONPath. It targets the
**project** config by default — creating one in cwd if none exists; `-g` for
the global one.

```sh
f config list                      # whole project config
f config -g get ucks               # global config, one path
f config add ucks ./my-uck         # append a source
f config add ucks '{"source":"github:org/many-ucks","only":["creds"]}'
f config set ucks[0] ./other       # replace by index
f config remove 'ucks[?(@.source=="./old")]'   # remove by filter
```

- Values are JSON-parsed (numbers, bools, objects, arrays) or kept as raw
  strings.
- Other ucks can drive it programmatically: the uck exports `configApi`, whose
  methods take an explicit target (a path, `"project"`, or `"global"`), so a
  uck can edit any config file.
