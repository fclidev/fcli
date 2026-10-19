# Changelog

All notable changes to the f CLI.

## [0.4.0]

### Changed (breaking, contract v2 — G11)
- **The register-time ctx no longer carries `ucks` or `registry`.** `register()`
  receives `{ fVersion, contractVersion, self }` and nothing else; `run()` is
  unchanged and remains the only place a uck can see a peer. The v1 register-time
  view was partial, and not partial along a stable axis: it tracked load order
  *and* source kind (npm sources merge after the whole store pass), so a store
  uck could never see an npm uck while an npm uck always saw the store. No uck
  could depend on that correctly, and N20a's "feature detection only" rule could
  not fix a property of the loader.
- **`CONTRACT_VERSION` 1 → 2**, per the field's own bump rule (the meaning of an
  existing ctx key changed for code already written). Read it at register time to
  branch; `fVersion` cannot answer interface questions.
- Why absent rather than `Object.freeze({})`: an empty object keeps the v1-documented
  `"creds" in ctx.registry` idiom alive while making it guaranteed-false, which
  degrades a peer read to a fallback reporting "no-store" as "not configured" —
  the same silent-degradation failure `ctx.uck` was deleted for. Absent throws.

### Removed
- `snapshot()` and `UckView` from `registry.ts` — no partial view to snapshot.
  `loadUckModule` / `loadFromNodeModules{,Maybe}` lose their `view` parameter.

### Migration
One grep per bucket; check that each hit is lexically inside `run`:
```bash
grep -rn "ctx\.registry\|ctx\.ucks" --include=*.js . | grep -v node_modules
```
Adoption in the installed buckets was already zero at register time — every peer
site (`fj`, `grocy`, `ha`, `ha-ws`, `skills`, `search`, `gh`) lived in `run`.

### Tests
- New `test/ctx-register.test.ts`: pins the exact register key set, asserts the keys
  are *absent* (not empty), and asserts both v1 idioms throw `TypeError`. Includes
  an end-to-end case proving `run()` still sees every peer — so "delete it from
  register" cannot quietly become "delete it everywhere".
- `test/ctx-contract.test.ts` drops the "register-time view is partial — earlier
  peers only" cases: they asserted a race was working as intended. Retained here as
  a split note; see the file header.

## [0.3.3]

### Added
- `-V` / `--version` flag; works with no ucks installed and no network.
- npm uck sources: `f config add ucks @fcli.dev/ucks` installs the package into the store as a source.

### Fixed
- CI verify step no longer requires ucks or network to check `--version`.

## [0.3.2]

### Fixed
- Pointed `repository` and `bugs` fields at the renamed `fclidev/fcli` repo.
- Updated workflow comments and uck references for the kensand → fclidev rename.

## [0.3.1]

### Added
- **Store lock (C2).** Concurrent `f up` runs now serialize; a lock held by a live process is reported, not stolen.
- **No stdout truncation (C5).** `f` no longer cuts long output; the full stream reaches the caller.
- **Contract versioning.** `contractVersion` field in the ctx; one ctx shape; `ctx.uck` deleted (A1, A2).
- **G8 help interception.** Bare `f <uck>` shows help; falls through when the uck exports no `help`/`about`.
- **G10 one-uck-per-dir.** Enforced in core.
- **First test suite.** 8 test files, 38 tests.

### Fixed
- `f up` no longer reports its own `npm install` as the author's work, blocking the update.
- Store refuses a local source inside the store; reports real content change (C1a).
- Four latent install bugs found during the store-lock work.

## [0.3.0]

### Added
- **Uck contract 1.0.** Pinned in core: G8 help interception, G10 one-uck-per-dir, ctx shape.
- Contract 0.3: pinned the f↔uck contract in core as a prerequisite for 1.0.

## [0.2.5]

- Version bump for the contract 0.3 pin (no behavioural change in core).

## [0.2.4]

### Added
- `f up` now updates the core CLI itself, not just the uck store.

### Fixed
- `f up` protects local work from force-overwrite (dirty-bucket check).

## [0.2.3]

### Changed
- Store: a git bucket is the clone of its repo (no separate metadata dir).
- Dropped the `~/.f/uck-repos` legacy path.

### Fixed
- `df-ext` register crash; dropped self-dependency; package.json fixes.
- CI: publish on Node 24 (npm ≥ 11.5.1 required for OIDC trusted publishing).

## [0.2.2]

- Version bump (no behavioural change).

## [0.2.1]

### Changed
- **Runtime ctx.registry.** No cross-uck access at register time; the full registry is available at run time. Ucks discover each other through the registry, not by importing.

## [0.2.0]

### Added
- Initial tagged release. Token-efficient CLI for LLM agents: a single executable on PATH, commands discovered by running `f`, not declared in a tool schema.
