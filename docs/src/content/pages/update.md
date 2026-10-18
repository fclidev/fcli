---
title: Update
summary: f up re-fetches all configured uck sources. f uck push mirrors store ucks to a git repo.
---

# Update

## f up

`f up` is a core builtin that re-fetches **every** source in your config
(global + project), overwriting the store so ucks pick up upstream changes.
Normal runs never touch the network — `f up` is the maintenance operation.

```sh
f up
```

For a git source the bucket _is_ the clone of the repo, so `f up` is
`git fetch` + `git reset --hard` + `git clean` + a submodule update — not a
re-download. That has two consequences:

- **The bucket is a cache, not a workspace.** Anything you edit in place under
  `~/.f/ucks/` is discarded on the next `f up`. Edit elsewhere and send it with
  `f uck push`.
- **An installed uck is a checkout.** You can `git log`, `git diff` and
  `git blame` it to see where a uck came from and what changed.

A uck with a `package.json` gets `npm i` in its own directory on install and on
`f up` — a uck's dependencies belong to the uck, never to f core.

To pull changes to a specific repo's ucks, just make sure the repo is a
configured source and run `f up`.

## f uck push

The `f uck` uck pushes ucks from the store to a git repo. Because a bucket _is_
a source (`~/.f/ucks/<bucket>/`), the **bucket name is the link**: a push
target named `mine` mirrors the ucks under `~/.f/ucks/mine/`.

```sh
f uck repo add mine https://github.com/me/my-ucks.git [--ref main]  # register a push target
f uck repo ls                                            # list targets + their store ucks
f uck repo rm mine                                       # unregister
f uck push -r mine                                       # push every uck in bucket 'mine'
f uck push greet ls -r mine                              # push only these ucks
```

- **Push model:** a git bucket is the clone of its repo, so publishing it is
  commit → fetch → rebase → push using the bucket's own origin. A conflicted
  rebase aborts, pushes nothing, and prints the commands to resolve it in the
  bucket. `--no-rebase` skips the integration step, which git rejects unless
  the push is a fast-forward. Nothing is ever force-pushed. A copy bucket (a
  local source) still goes the old way: the named uck dirs are copied over a
  work clone, committed, and pushed — the store's copy wins per uck.
- **Targets** are `{ name, url, ref }` in `~/.f/f.repo.json`, managed by
  `f uck repo`. The name must match the bucket.
- **Auth** is delegated to `git` (your ssh keys / credential helper).
- **Pull is not re-implemented:** to pull, add the repo as a source in
  `f.config.json` (give it a matching `name` so the bucket lines up) and run
  `f up`.
- Other ucks can drive it via the exported `uckApi`
  (`loadTargets` / `saveTargets` / `push` / `bucketUcks`).
