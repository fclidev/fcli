# f 0.3.1

Contract changes from the 1.0 solidification work. Pre-1.0, so breaking
changes land without a deprecation cycle — but every one of these fails
loudly, which was itself a design decision (see A1).

## The ctx contract

**`ctx.contractVersion` — new (A2).** `ctx` carries the f↔uck contract version
(core exports `CONTRACT_VERSION`, currently `1`). CONTRACT.md told ucks to
"compare a contractVersion" without ever saying where it came from, so nothing
could. `fVersion` cannot answer "does this core implement the ctx I was written
against" — it is a release number, not an interface number.

**`register()` and `run()` now receive the same ctx shape (G4).**
`{ fVersion, contractVersion, self, ucks, registry }` in both. At register time
`ucks`/`registry` are a **partial view** of what has loaded so far: fine for
feature detection (`"creds" in ctx.registry`), not for concluding a peer is
absent. One object literal in core builds both, so they cannot drift apart.

**`ctx.uck(name)` is deleted (A1). `ctx.registry` is the only peer accessor.**
It was sugar over a lookup in the same map. Adoption decided it: 5 of 6 in-tree
peer accesses already used `registry`, 1 used `uck()`. Deleting the subset (not
the superset) matters: `registry` is passed into helpers as a parameter, so
removing it breaks *silently*, whereas `ctx.uck is not a function` is a message.
A uck left calling `ctx.uck?.("creds")` is the trap — optional chaining makes it
`undefined`, and the callee then falls back to a socket and reports a configured
store as "no store". Migrated: `gh` (both its success path and its catch
handler, which had the same fallback).

## Store safety

**A local source that resolves inside the store is refused (C1a).** It used to
copy a tree into itself: the copy partly lands, then the git path for the same
bucket re-stamps `.f-source.json` with provenance for a repo the content did not
come from. Observed on a real machine: `config/*` and `lib/*` deleted from the
author's own bucket, which then believed it was a clone of another repo.
No marker files or recovery tooling — the store's documented model already says
a bucket is a cache, so this enforces the model instead of adding machinery to
survive violating it.

**The store has a lock (C2).** Two `f` processes could interleave clone /
rm-copy / fetch+reset-hard on one bucket. Measured without the lock, the result
was a bucket directory with **no `.git`** and both runs failing
(`could not lock config file …/.git/config`, then `destination path … already
exists and is not an empty directory`). Implemented as a symlink: the one
create-exclusive primitive that is atomic and carries a pid in its target, so a
lock left by a killed process is decidable (boot-id compared) and reclaimed —
one SIGKILL must not brick every f command. A *timeout* is deliberately not
treated as staleness: a cold `f up` legitimately runs for minutes, and stealing
a live lock is the corruption the lock exists to prevent. A waiter waits, then
names the holding pid.

**`installSource` resolves true only when store content changed.** It used to
mean "the git command exited 0", and `cli.ts` reads it as "was the store empty" —
so an unchanged refresh made the store look populated and **every** `f`
invocation re-copied every local source. That is what turned one mistyped local
source into repeated data loss: a destructive `cpSync` on every command, not just
on `f up`. It also made a local edit look like it needed two invocations.

## Output and exit

**`process.exit(1)` → `process.exitCode = 1` in the error paths (C5).** `exit()`
terminates without draining stdout, which is queued whenever stdout is not a TTY
— the normal case for an agent or a pipe. Measured at 52 MB of uck output: 0.3.0
delivered **7.4 MB of 52.5 MB**; with `exitCode`, all of it. Also a secret path:
whether a printed secret survived depended on whether the reader happened to be
draining. The unknown-uck path had the same bug and additionally discarded
everything printed earlier in the same run.

## Bugs found while doing the above

- **Any source with a `#ref` could not be installed.** `gitUrl()` passed the
  specifier to git with f's `#ref` suffix attached, so git looked up a repository
  literally named `repo.git#main`. Against GitHub this surfaces as "Please make
  sure you have the correct access rights", which reads as an authentication
  problem; everyone looked at credentials. It shipped unnoticed because the
  seeded default source has no ref. Fixed by stripping the ref in `gitUrl()`.
- **Failures reported the wrong line.** `firstLine()` took the first stderr line,
  which for git is progress ("Cloning into '…'…"), hiding the reason below it —
  how a ref bug and a clone collision both looked like network trouble. Now
  prefers git's `fatal:`/`error:` lines, else the last line.
- **Local source paths were percent-encoded.** Resolution went through a
  `file://` URL, so a repo under a path containing a space was reported
  "local uck not found" and silently dropped. Now `path.resolve`, in one shared
  function also used by the C1a guard — two resolvers that merely look equivalent
  disagree on relative paths, and the guard then never fires.
- **`file://` git URLs were misrouted to npm.** `sourceKind()` did not know the
  `file` transport, so `f config add ucks file:///repo` produced
  "not in node_modules (run npm i file:///repo)". Classification is now
  single-sourced from `sourceKind()`; `cli.ts` had its own copy of the regex.

## For uck authors

- Peer reads: `ctx.registry.<name>`, never `ctx.uck(...)`.
- Register-time peer checks detect presence only.
- If you target this ctx, read `ctx.contractVersion`.
- `desc` ≤ 120 chars, `import.meta.url` for paths, skills with absolute paths —
  all enforced by `f uck check`, which also no longer reports uninstalled
  dependencies as contract violations.
