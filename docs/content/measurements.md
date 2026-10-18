---
page: measurements
title: Measurements
summary: How every token figure in these docs is produced, what each one covers, and the error bars on it.
---

# Measurements

Every token figure in these docs is produced by one script, against the built
binary and a real uck store:

```sh
node docs/scripts/count-tokens.mjs          # print the table
node docs/scripts/count-tokens.mjs --snapshot   # write content/token-measurements.json
```

`token-measurements.json` is committed, and is the source every token figure in
these docs is written from. Regenerate it whenever the binary, the store or the
tokenizer changes.

## Tokenizer

Counts come from [`js-tiktoken`](https://www.npmjs.com/package/js-tiktoken)
(1.0.21) with real `o200k_base` and `cl100k_base` ranks — not `chars/4` or a
word count. `o200k_base` is the primary; `cl100k_base` is reported beside it
because the two disagree:

| Text                                      | o200k | cl100k |
| ----------------------------------------- | ----: | -----: |
| command strings, short queries, uck names |     = |      = |
| descriptions dense with slashes or paths  |  ±1–2 |   ±1–2 |

The disagreement is real and one-sided — the ranks do **not** agree on prose.
Anything quoted to better than ±2 tokens on description text is over-precise.
Which encoder is right depends on which model is reading it.

The script records its own tokenizer version, rank checksums, the `f` version
measured and the store contents, so a stale figure is traceable.

## What each figure covers

"Tokens" is not one quantity. A call costs something to write, something to
describe, and something to answer; most published numbers conflate them. The
columns below are deliberately separate.

| Column           | what it is                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| issuing the call | the command string tokenized — what the model writes                                    |
| once per session | the `f` index: names, one grid, paid at every invocation of `f`                         |
| per query        | the text `f search <query>` prints back                                                 |
| definition       | a tool's full schema and description, in the request body on every call (cached or not) |

The measurement harness reads stdout only, and throws if output contains
`unknown uck`. That check exists because a token count of an error message is a confident wrong
number. When `search` moved from core to a uck, every search row reported 28
tokens: the length of `f: unknown uck 'search'`.

## Index cost

`f` prints uck names in a columnised grid, one line per terminal width. Cost per
added uck has two parts, and only one of them is a name:

| Component       |            Tokens | Measured how                                   |
| --------------- | ----------------: | ---------------------------------------------- |
| framing         |               ≈20 | a store of 1 uck                               |
| a name          |               1–2 | `config` = 1, `creds` = 2                      |
| its grid column | remainder of 4.00 | synthetic store of identical 5-character names |

Marginal cost — 4.00 tokens per uck — is measured directly, on a throwaway store
of identical 5-character names, and is flat from 1 name to 32. Marginal and
average are distinct and both are in the snapshot: on the real 17-uck store the
average is 3.6, lower because real names vary in length. The two are not
interchangeable, and an earlier version of these docs printed the average under a
heading that said "per uck".

Projection above the measured store uses the marginal, which is conservative.

| Ucks installed | `f` index (names only) | full listing (name + desc) |
| -------------: | ---------------------: | -------------------------: |
|             16 |                     61 |                        376 |
|             24 |                    116 |                          — |
|             72 |                    308 |                          — |
|            256 |                  1,044 |                          — |

The "full listing" column is `f`'s pre-names-only output: a description per
command, every session. At 16 ucks, 376 tokens against 61. Per line that is 6 to
27 tokens (mean 15.3), set by how long each author wrote the description — so it
grows with the store whether or not the added command is ever used.

## One definition, quoted in full

`read_text_file`, byte for byte from the filesystem server's own `tools/list`
response:

```json
{
  "name": "read_text_file",
  "title": "Read Text File",
  "description": "Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "tail": {
        "description": "If provided, returns only the last N lines of the file",
        "type": "number"
      },
      "head": {
        "description": "If provided, returns only the first N lines of the file",
        "type": "number"
      }
    },
    "required": ["path"]
  },
  "annotations": {
    "readOnlyHint": true,
    "openWorldHint": false
  },
  "execution": {
    "taskSupport": "forbidden"
  },
  "outputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "content": {
        "type": "string"
      }
    },
    "required": ["content"],
    "additionalProperties": false
  }
}
```

260 tokens. 97 of them are the description sentence; the rest is JSON Schema,
including an `outputSchema` saying the result is a string. This is the server's
_largest_ tool — its mean is 174.2 — so the pair below is an upper bound.

|                          | `f creds get prod.db` | `read_text_file` |
| ------------------------ | --------------------: | ---------------: |
| Tokens to issue the call |                     5 |                5 |
| Definition in the body   |                     2 |              260 |

## MCP figures

The same server scores differently depending on what you count as its definition.
The gap is about a fifth.

| Convention  | what it counts                                                          |
| ----------- | ----------------------------------------------------------------------- |
| billed      | `name`, `description`, `inputSchema`, `outputSchema`                    |
| on the wire | the complete tool object, including `title`, `annotations`, `execution` |

The billed rule is tooltax's, read from `BILLED_FIELDS` in its
`src/score/serialize.js`, on the argument that the dropped fields never reach a
model. Both conventions here come from one captured `tools/list` response per
server, obtained by running that server over stdio — not from a repo README.

| Server                                          | Tools | billed | billed/tool | on the wire/tool |
| ----------------------------------------------- | ----: | -----: | ----------: | ---------------: |
| `@modelcontextprotocol/server-filesystem@1.0.0` |    14 |  2,439 |       174.2 |            205.5 |
| `@playwright/mcp@0.0.83`                        |    25 |  3,768 |       150.7 |            176.4 |

Under the billed rule, filesystem reproduces the tooltax leaderboard exactly
(2,439 / 174.2); that agreement is what validates this capture and tokenizer.
Playwright lands 25 tokens under its leaderboard figure, a version difference
rather than a method one.

### The wider sample is tooltax's, and it moves

[tooltax](https://github.com/duskel/tooltax) scores 18 servers, 256 tools,
77,877 tokens (38.9% of a 200k window if all were installed). Read the dated
[LEADERBOARD.md](https://github.com/duskel/tooltax/blob/main/LEADERBOARD.md), not
a README summary — its README reports a different run (20 servers, 290 tools,
73,323 tokens). Totals move between runs.

Per-tool means in that sample run from 77.6 (archived Puppeteer, 7 tools) to 963
(Sequential Thinking, 1 tool): a factor of 12, wide enough that no single
multiplier describes MCP.

Two naming traps in that leaderboard:

- **Archived variants are priced separately.** "GitHub" at 138 is the archived
  GitHub server (26 tools). "Puppeteer" at 77.6 is likewise archived.
- **Same product, different server.** "Playwright" is microsoft's, 25 tools,
  151.7. "Playwright (ExecuteAutomation)" is a different package, 33 tools, 89.6.

[mcp-turnstile](https://github.com/singhpratech/mcp-turnstile/blob/main/report/BENCHMARK.md)
measures the same cost as tool count scales — 24 tools at 11,213 tokens, 72 tools
at 33,709, i.e. 467–468 tokens/tool at both sizes, 16.9% of a 200k window before
the first user message.

## What caching does and does not change

The token figures above count what is **in the request body**. They do not count
what the model re-processes, and the two diverge under prefix caching.

**What caching removes: reprocessing.** Prompt caching is a prefix match on exact
bytes. The tool definitions are the first block rendered (before system and
messages), so a stable tool list is a stable prefix: it is tokenized into the
model once, and a later request repeating those bytes skips the recompute. Anthropic
documents this as _"reducing processing time and costs."_

**What caching does not remove: presence.** The API is stateless, so the tool list
is in the body of every request regardless; the model only knows a tool exists
because it is in the tokens it is being fed. Caching discounts the **rate**, not
the presence, and does not free context window:

|                            | rate on a cache hit | source                                                                                 |
| -------------------------- | ------------------: | -------------------------------------------------------------------------------------- |
| Anthropic, cache read      |         10% of base | [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| OpenAI, cached input       |  up to 95% off base | [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)         |
| OpenAI, GPT-6 cached input |  up to 90% off base | [announcement](https://openai.com/index/better-prompt-caching-for-gpt-6/)              |

The discounts differ by model and era (OpenAI's original launch was 50%); quote
the figure for the model you are actually billing against, not a single number.

**When caching stops applying.** The match is on exact bytes; one tool added,
removed, or reworded invalidates the prefix from that point on, and the request
reverts to full price. A server whose tool surface drifts between requests is the
uncached column on [Home](/), which is why the two are shown side by side there
rather than one number with a footnote.

**What still holds with or without caching.** The context-window occupancy
(77.6–963 tokens per tool; 56 tools at 16.9% of 200k) is a property of the body,
not the rate, so it is unaffected by caching. And `f` never serializes a
definition into the body, so it has nothing to cache, nothing to invalidate, and
nothing occupying the window between invocations — the argument does not depend
on the discount being favorable.

## What is not measured

- Nothing here measures model behaviour. No benchmark shows agents call MCP tools
  less often because definitions are long, or prefer a CLI when both are present.
  This page counts bytes on a wire, and argues from cost alone.
- `f`'s own numbers are one store on one machine. The store is the default bundle
  plus a personal bucket; a different set of ucks changes the index size, which is
  why cost is published per uck and per store size rather than as one total.
- Token figures date. The two servers re-measured above came out 20% above a
  sample three weeks older; Playwright's tool count differs between two files in
  one repository. Re-measure before quoting a specific number.
