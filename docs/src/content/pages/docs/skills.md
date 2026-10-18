---
title: Skills
summary: A skill is a named pointer to a local markdown file. Skills load into an LLM's context on demand, not up front.
---

# Skills

A **skill** is a named pointer to a local markdown file — a chunk of
instructions you read into context when it is relevant, rather than holding
it up front in every prompt.

```json
// f.config.json
{
  "skills": [{ "name": "git-flow", "path": "~/.f/skills/git-flow.md" }]
}
```

The skill _is_ the `.md` file; the config entry only names it. There is no
format, no frontmatter, no schema — write prose, read it with `f skills show`.

## Managing skills

```sh
f skills                     # show the default skill
f skills ls                  # list skills (name + path)
f skills show <name>         # print a skill's markdown content
f skills search <query>      # find relevant skills (name + content)
f skills add <name> <path>   # register a skill (path to a local .md)
f skills rm <name>           # remove a skill
```

Targeting matches the `config` uck: the project `f.config.json` by default,
`-g` for the global `~/.f/f.config.json`.

`search` ranks your configured skills by relevance to the query — names and
file contents. It is local and offline: it searches what you have, it does not
reach the network.

## Where skills come from

Two places, merged by name:

1. **Config** — entries in the `skills` array, the ones `f skills add` /
   `f skills rm` manage. A `path` points at a local `.md`.
2. **Uck-exported** — any uck can export `skills` alongside `register`:

```js
export function register(ctx) {
  return {
    name: "myuck",
    desc: "…",
    run: () => {},
    skills: [
      { name: "myuck", path: "./SKILL.md" }, // path relative to the uck dir
      { name: "notes", content: "inline markdown" },
      "bare-name",
    ],
  };
}
```

These are read off the registry at run time, so they show up in
`ls` / `show` / `search` with no config entry. A config entry **wins** over a
same-named uck skill, so you can override what a uck contributes.

## The default skill

On first install, the `skills` uck seeds a `default` skill into
`~/.f/f.config.json`, pointing at the `default.md` that ships inside it. Run
it:

```sh
f skills
```

It is f's own usage guide — how to run ucks, how to write one, when to write
one. It is the model for what skills are for: `f skills` (no op) is the entry
point an LLM reads first, and everything else is one `show` away.

## Skills vs. ucks

A uck is _behavior_ — `f <name>` does the thing. A skill is _knowledge_ — a
document that tells you (or the model) how to do the thing. They compose: a
uck can ship the skill that explains it, which is exactly what the `skills` uck
does with `default.md`.

Ucks and skills are configured the same way — a source in `f.config.json`,
installed into `~/.f/ucks/` — so shipping a uck and its documentation together
is one commit in one repo. See [Ucks](/docs/ucks/).
