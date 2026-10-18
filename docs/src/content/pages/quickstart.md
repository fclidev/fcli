---
title: Quickstart
summary: Run f, list its ucks, and add your own. The default ucks and the store.
---

# Quickstart

After [installing](/install/) `f`:

```sh
f            # the index: every uck name, no descriptions
f search <q> # rank ucks against a query (name, then description)
f v          # print the version
f config get ucks  # read f's own config
```

`f` is designed to be driven by a program: ucks print terse output and accept
short arguments, no colors, no "Done!".

## The default ucks

On first run `f` seeds its config with the
[`@fcli.dev/ucks`](https://www.npmjs.com/package/@fcli.dev/ucks) npm package
and installs it into the store. The defaults are:

| Uck           | Description                                         |
| ------------- | --------------------------------------------------- |
| `f v`         | print version                                       |
| `f config`    | edit `f.config.json` via JSONPath                   |
| `f creds`     | store credentials (encrypted, daemon, TTL)          |
| `f providers` | list credential providers registered with `f creds` |
| `f skills`    | manage skill files (markdown, read on demand)       |
| `f uck`       | push store ucks to a git repo                       |

`up` and `help` are core builtins — special-cased in core before the uck
registry is read, so they work even with an empty store. `help` is the no-arg
behavior; `up` re-fetches every configured source (see
[Update](/docs/update/)). Each builtin's subcommands are listed on the
[Builtins](/docs/builtins/) page.

## Add a uck

A uck is a directory with an `index.js`. The smallest one:

```sh
mkdir -p ~/my-ucks/hello
```

```js
// ~/my-ucks/hello/index.js
export function register(_ctx) {
  return {
    name: "hello",
    desc: "say hello",
    run: (_argv, args) => {
      process.stdout.write(`hello ${args._[0] ?? "world"}\n`);
    },
  };
}
export default { register };
```

Point a config source at it, then update:

```sh
f config add ucks ./my-ucks     # point at the directory containing hello/
f up
f hello kenny
```

See [Ucks](/docs/ucks/) for the full contract and [Config](/docs/config/) for sources.
