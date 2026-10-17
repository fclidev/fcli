/**
 * A lock around store mutation (C2).
 *
 * Two `f` processes running at once can corrupt ~/.f/ucks: installGitSource
 * does fetch + `reset --hard` + `clean -fdx` on a directory another process
 * may be cloning, copying or npm-installing into, and installLocal does
 * rm-then-copy. Nothing stopped that, and it is easy to hit by accident — an
 * agent running several `f` commands in parallel, a shell loop, or `f up`
 * alongside any other invocation.
 *
 * Implemented as a symlink because a symlink is the one create-exclusive
 * primitive that is atomic **and** carries a pid in its target:
 *
 *   - `symlink()` fails with EEXIST when the name exists at all — file, dir or
 *     dangling link — so it cannot be dislodged by a plain `open(O_CREAT|O_EXCL)`
 *     competing for the same name, and we never have to worry about a
 *     zero-length lock file racing an empty file another writer opened.
 *   - the target string holds `pid@boot_id`, which is what makes a stale lock
 *     decidable (see holderIsDead) instead of a timeout.
 *
 * A TIMEOUT is deliberately not a staleness test: a cold `f up` clones several
 * buckets and npm-installs each one, so a second process that gave up after N
 * seconds would take the lock from a healthy first one and both would mutate
 * the same tree — which is the exact damage the lock exists to prevent. A real
 * holder may legitimately run for minutes, so a waiter waits, and reports who
 * holds the lock after a few seconds rather than stealing it.
 *
 * If the holder is verifiably gone, the lock is reclaimed: the alternative is
 * that one SIGKILL bricks every f command on the machine until someone deletes
 * a file by hand.
 */
import {
  symlinkSync,
  readlinkSync,
  unlinkSync,
  statSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fHome } from "./config.js";

export class StoreLockedError extends Error {
  constructor(public readonly holder: string) {
    super(`f: another f process (pid ${holder}) holds the store lock`);
  }
}

function ensureHome(): void {
  const dir = fHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function lockPath(): string {
  return join(fHome(), ".lock");
}

/**
 * Boot id, used to tell "pid was reused by a new process" from "process is
 * gone". Absent or unreadable (non-Linux, restricted container) returns null,
 * which downgrades staleness detection to "live if /proc/<pid> exists".
 */
let bootId: string | null | undefined;
function readBootId(): string | null {
  if (bootId !== undefined) return bootId;
  try {
    bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
  } catch {
    bootId = null;
  }
  return bootId;
}

function token(): string {
  const b = readBootId();
  return b ? `${process.pid}@${b}` : String(process.pid);
}

function pidOf(target: string): number {
  const at = target.indexOf("@");
  const raw = at === -1 ? target : target.slice(0, at);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

/** Same boot, live pid? Only a clear "no" counts as dead. */
function holderIsDead(target: string): boolean {
  const pid = pidOf(target);
  if (pid <= 0) return true; // unparseable lock: treat as garbage
  const at = target.indexOf("@");
  if (at !== -1) {
    const boot = readBootId();
    // Different boot (or we cannot read ours) => cannot claim it is stale.
    if (!boot || target.slice(at + 1) !== boot) return false;
  }
  try {
    statSync(`/proc/${pid}`);
    return false;
  } catch {
    return true;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Take the store lock. Returns a release function; call it in a finally.
 *
 * Waits (up to ~2 minutes) rather than proceeding unlocked — a lock you skip on
 * contention is not a lock. A stuck holder surfaces as StoreLockedError naming
 * the pid, which is actionable, unlike silent corruption.
 */
export async function acquireStoreLock(
  opts: { waitMs?: number; noteAfterMs?: number } = {}
): Promise<() => void> {
  // F_LOCK_WAIT_MS lets a caller (or a test) shorten the wait; it does not
  // weaken the lock, which still refuses to proceed while a live holder has it.
  const envWait = Number(process.env.F_LOCK_WAIT_MS ?? "");
  const waitMs = opts.waitMs ?? (Number.isInteger(envWait) && envWait > 0 ? envWait : 120_000);
  const noteAfterMs = opts.noteAfterMs ?? Math.min(5_000, waitMs);
  const path = lockPath();
  const mine = token();
  const started = Date.now();
  let noted = false;
  ensureHome();

  for (;;) {
    try {
      symlinkSync(mine, path);
      return () => {
        try {
          // Only remove OUR lock: if it was reclaimed and re-taken while we ran,
          // deleting it would unlock someone else's critical section.
          if (readlinkSync(path) === mine) unlinkSync(path);
        } catch {
          /* already gone */
        }
      };
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      let target = "";
      try {
        target = readlinkSync(path);
      } catch {
        continue; // vanished between EEXIST and readlink: retry immediately
      }
      if (holderIsDead(target)) {
        try {
          unlinkSync(path);
        } catch {
          /* lost a reclaim race; the next attempt sees EEXIST and re-evaluates */
        }
        continue;
      }
      const waited = Date.now() - started;
      if (!noted && waited >= noteAfterMs) {
        noted = true;
        console.error(`f: waiting for the store lock held by pid ${pidOf(target)}…`);
      }
      if (waited >= waitMs) throw new StoreLockedError(target);
      await sleep(Math.min(250, Math.max(25, waited / 4)));
    }
  }
}
