---
title: Credentials
summary: f creds stores credentials encrypted at rest. A daemon holds the key in memory and auto-exits after a TTL.
---

# Credentials

`f creds` stores credentials encrypted at rest in `~/.f/f.creds.enc` (mode
`0600`). The key is derived from a passkey you choose (scrypt KDF) and values
are encrypted with AES-256-GCM.

```sh
f creds unlock [passkey] [--ttl sec]   # start daemon (default ttl 600s)
f creds set prod.db "postgres://u:p@h" # store
f creds get prod.db                     # print (decrypts)
f creds ls                              # list names
f creds rm prod.db                      # remove
f creds status                          # locked / unlocked + time left
f creds request <name> [--timeout sec]  # block until the cred is set elsewhere
f creds waiters                         # list open waiting requests
f creds fill [name]                     # prompt + set values for open waiters
f creds lock                            # stop daemon, zeroize key
```

## How it works

- **Unlock** spawns a background daemon that derives the key once and holds it
  **in memory** — the passkey never touches disk and there is no key file.
  The daemon serves ops over a unix socket (`~/.f/.creds.sock`) and
  **auto-exits after the TTL** (default 10 min), zeroizing the key.
- **Wrong passkey** fails loudly: AES-GCM authentication rejects the data
  ("unable to authenticate data") rather than returning garbled plaintext.
- **Lock** (or TTL expiry) kills the daemon and removes the socket; the
  encrypted store on disk is untouched.

## Crossing terminals

`request`, `waiters` and `fill` exist because a uck often needs a credential
the current session does not have — a token for a Forgejo instance, a registry
password. Rather than fail, the uck blocks:

Terminal A — a uck (or you) needs a cred it does not have:

```sh
f creds get forgejo.kensand.net      # not set yet
f creds request forgejo.kensand.net  # blocks until someone sets it (default 300s)
```

Terminal B — the human, seeing what is outstanding:

```sh
f creds waiters                      # name + who is waiting
f creds fill                         # prompt for each open request
```

Terminal A unblocks as soon as the value is set.

`request` also waits for `unlock` if the daemon is merely locked, so a uck can
ask for a secret and a TTL in one call without knowing the passkey. Waiters
register themselves in `~/.f/.creds-waiters.json`, which is what makes them
visible from another terminal.

- Other ucks can drive it via the exported `credsApi` (`get` / `set` / `ls` /
  `unlock` / `lock` / `status` / `wait`), which takes the same names — so a
  uck that needs a token can block on it the same way `f creds request` does.
