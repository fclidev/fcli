---
title: Install
summary: Install f from npm (or from git for a dev install). What happens on first run.
---

# Install

`f` needs **Node 20 or newer**.

## npm

```sh
npm install -g @fcli.dev/f
```

Verify:

```sh
f v
```

The npm package is `@fcli.dev/f`; the binary it installs is `f`. The published
package trails the source repo by a release — `f v` tells you which build you
actually have.

## Git install (dev)

```sh
git clone https://github.com/kensand/fcli.git
cd fcli
npm i        # builds dist/ via the prepare hook
npm link     # puts the `f` command on your PATH
```

## Uninstall a dev install

```sh
npm unlink -g f
```

(run from the clone), or `npm unlink f`.

## What happens on first run

On first run, `f` seeds `~/.f/f.config.json` with the
[fcli-ucks](https://github.com/kensand/fcli-ucks) repo as its only source,
clones that repo into `~/.f/ucks/fcli-ucks/`, and registers the seven ucks
inside it. Override the default source with the `F_UCKS_REPO` environment
variable before the first run. See [Builtins](/builtins/) for what you get and
[Config](/config/) for the full picture.
