---
title: Examples
summary: A real uck written by an agent in one session. Search DuckDuckGo from the CLI, 266 lines, zero dependencies, installed by adding a git repo to f's config.
description: "What an agent produced when asked for cat pictures: the ddg uck, 266 lines of zero-dependency index.js, the SKILL.md that carries what it learned, and how to install it."
---

# Examples

Every so often the cheapest version of a tool is the one your agent writes
itself. This is one of those, written to settle a question nobody should have to
spend a session on: **how do I get cat pictures into the terminal?**

The uck is
[`ddg`](https://github.com/kensand/kensand-fcli-ucks/tree/main/ddg)
in [kensand/kensand-fcli-ucks](https://github.com/kensand/kensand-fcli-ucks),
and it came out of one agent session — the prompt was "make me an `f` command
for cat pictures". Everything below is a real artifact from that session, not a
reconstruction: the file, the help text, the installed path. Run the commands and
you get the same output.

## What it does

```
f ddg — search DuckDuckGo
  f ddg <query...>          web results (numbered: title / url / snippet)
  f ddg images <query...>   image-oriented results
  f ddg open <query...>     open the results page in the browser
  options: --json  --n <k>  --region us-en  --safe 0|1|2  --lite
           --timeout ms  --retries <k>  --no-block (fallback: open in browser)
  note: DDG rate-limits server-side clients (HTTP 202 'anomaly' page);
        the cooldown is IP-based, usually a few minutes.
```

That is the whole surface, and it is `f ddg --help` — the file the uck ships,
not a page in a config. Eight lines that tell you everything the tool can do,
printed on demand, costing nothing until you ask.

## What it is

Three files, and the smallest one is the interesting one:

| file           | lines | bytes | role                                    |
| -------------- | ----: | ----: | --------------------------------------- |
| `index.js`     |   266 | 10171 | the command                             |
| `SKILL.md`     |    50 |  2260 | what the session learned, for next time |
| `package.json` |     6 |   169 | `type: module` — and no dependencies    |

No `node_modules`. `fetch` and a regular expression do the work. A uck is a
directory with an `index.js` that exports `register(ctx)`, so the entire
implementation of "search DuckDuckGo" is this:

```js
export function register(_ctx) {
  return {
    name: "ddg",
    desc: "search DuckDuckGo: f ddg [images|open] <query> [--json --n --region --no-block]",
    skills: [{ name: "f-ddg", path: path.join(here, "SKILL.md") }],
    run: async (argv, _args) => {
      /* parse, fetch, parse again, print */
    },
  };
}
```

`name` is the word after `f`. `desc` is what `f search` ranks. `run` is the
command. There is no manifest, no schema, no server to keep alive, and no
registration step — dropping the directory into the store makes `f ddg` work on
the next invocation.

## The part that is worth the trip

An afternoon of hitting an API teaches you things that do not fit in a help
message. The session found that DuckDuckGo does not rate-limit politely:

```console
$ f ddg cat pictures
f ddg: blocked by DuckDuckGo rate limit (HTTP 202 anomaly page). The cooldown is
IP-based and can last tens of minutes to hours from a datacenter IP; wait, or use
--no-block to open the search in your browser instead.
```

A blocked search returns **202**, not 429 — a status that means "accepted", with
an HTML challenge page in the body. Nothing about that is guessable, and a
naive client reads it as success and parses zero results. So the uck detects the
challenge, refuses to retry into it, and says what the cooldown actually is.

Where that knowledge ends up is the point. It goes in `ddg/SKILL.md`:

> The cooldown is **IP-based**, not per-request: once you trip it, _every_ DDG
> endpoint (html, lite, i.js JSON API) stays blocked for a long window […]
> Retrying faster or with different params does nothing.
>
> If results ever come back empty without a block message, DDG changed the
> markup: check `curl -s 'https://html.duckduckgo.com/html/?q=test' | grep
> result__a` and update the regexes in `index.js`.

A skill is a markdown file `f` loads into context on demand, and the uck
declares its own — that `skills:` line above means the next agent to touch this
gets the diagnosis without rediscovering it. The regexes will eventually rot when
DuckDuckGo changes its markup — that is the read of the file, not its words, but
the file draws the same conclusion: it names the symptom, the one-line check, and
which lines to edit. That is the difference between a script you rewrite every
six months and a tool that accumulates.

## Install it

```sh
f config add ucks https://github.com/kensand/kensand-fcli-ucks.git
f up
f ddg cat pictures
```

`f config add ucks <source>` accepts a git repo, a local directory, or an npm
package; `f up` fetches every configured source into `~/.f/ucks/`. The bucket is
a live git clone, so the installed command is the repo you can read and blame:

```console
$ ls ~/.f/ucks/kensand-fcli-ucks/ddg/
SKILL.md  index.js  package.json
```

Three committed files, plus a `package-lock.json` that `f up` materialises when it
installs the bucket. The bucket is a clone, so `git blame` on an installed command
works, and `f up` resets it to the remote — which is why publishing a uck means
pushing, not merely committing.

Installing someone else's uck means running their code with your privileges —
ucks are plain Node with no sandbox, and this one is a personal bucket, not a
vetted registry. Read it first. It is 266 lines and it is
[right there](https://github.com/kensand/kensand-fcli-ucks/blob/main/ddg/index.js).

## Write your own

The [Quickstart](/quickstart/) has the eight-line template and the three commands
that register it. What a real uck adds over the template is worth copying from
[`ddg/index.js`](https://github.com/kensand/kensand-fcli-ucks/blob/main/ddg/index.js)
instead:

- **a `USAGE` string.** Every flag fits in eight lines, so `--help` is the
  whole manual and there is no second place to keep in sync;
- **argument parsing that survives `--` and a value after a flag.** Sixteen lines,
  no dependency; a uck that needs `minimist` is a uck that needs `node_modules`;
- **an error that names the fix.** `no results parsed (DDG layout change?) — try
--lite`, not `exit 1`. Compare `blocked by DuckDuckGo rate limit (HTTP 202 …)`,
  which tells you what to do _and_ why retrying will not help;
- **`skills: [{ name, path }]`**, so the file that carries what you learned loads
  with the uck instead of living in a terminal's scrollback.

Ask an agent for the thing you keep doing by hand — the third `curl` to the same
endpoint this week — and ask it to leave a uck behind. The contract is on the
[Ucks](/docs/ucks/) page, and [Recipes](/docs/recipes/) walks through a second
case: an API that returned a zip where a JSON wrapper assumed text.
