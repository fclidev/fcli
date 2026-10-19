# Changelog

All notable changes to the f CLI.

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
