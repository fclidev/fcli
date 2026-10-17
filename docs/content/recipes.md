---
title: Recipes
summary: A before/after. The f fj uck already talked to a Forgejo API — it just could not read CI logs. The LLM worked around that with Python; then the uck got two words and the workarounds went away.
---

# Recipes

What `f` changes for the LLM, not just for you. This is a real session: an
agent debugging a red Forgejo Actions run on a monorepo.

## Background

The [`f fj` uck](https://github.com/fclidev/fcli-ucks/tree/main/fj)
existed before any of this. It wraps the
[@llamaduck/forgejo-ts](https://www.npmjs.com/package/@llamaduck/forgejo-ts)
SDK — all 491 generated REST endpoints, exposed by name
(`f fj call repoGet ownerName=… repoName=…`) or by raw path
(`f fj GET /repos/o/r`). The base URL comes from the git origin of the
directory you run in, and the token comes from
[`f creds`](/credentials/) under the instance's host name. Inside any
clone, `f fj …` just works:

```sh
f creds set forgejo.example.com <pat>     # once, per instance
f fj whoami                               # inside a clone
```

What it could **not** do was read Actions logs, and the SDK is why: the
generated operations include `listActionRuns` and `actionRun`, but the
spec has no log endpoint at all — and the one raw endpoint that exists,
`GET …/actions/runs/{id}/logs`, returns a **zip** (one file per job), not
text. A JSON-printing wrapper meets a binary payload, and the log is
gone. So the uck's own `ls` help text said it plainly:

> _some operations are absent from the spec — Actions LOGS are: call the
> raw path instead_

"Call the raw path instead" is where the LLM landed, every time.

## The "before" — the LLM's workarounds

**1. Guessing which of three numbers was the run id.** The API, the tasks
endpoint, and the web UI each carry a different identifier for one run:

```sh
f fj call listActionRuns ownerName=myorg repoName=myrepo limit=5
# rows carry .id — 3767

f fj call listActionTasks …
# rows carry .id — 4491 (a per-attempt row id)
# and .run_number — 10 (what the web UI URL /actions/runs/10 shows)
```

Feed the wrong one to `/actions/runs/{id}` and the API answers with a bare
`"resource does not exist"` — no status code, no hint. The agent burned a
round-trip concluding it had a _permissions_ problem before realizing it
had used the `run_number` from the URL it was staring at.

**2. The zip arriving as garbled text.** The JSON printer mangled the
binary on the way out:

```sh
f fj GET /repos/myorg/myrepo/actions/runs/3767/logs > /tmp/logs.bin
# PK..-J-...[binary re-encoded as text]
```

So the workaround was a Python subprocess that captured raw bytes around
`f fj`, wrote them to a file, and unzipped — a scratch script kept in
`/tmp` just to _see_ a CI log:

```python
import subprocess, zipfile
raw = subprocess.run(
    ["f", "fj", "GET", "/repos/myorg/myrepo/actions/runs/3767/logs"],
    capture_output=True,
).stdout
open("/tmp/logs.zip", "wb").write(raw)
for n in zipfile.ZipFile("/tmp/logs.zip"):
    print(n, len(n.read()))
```

Even that corrupted on some runs, because the uck's stdout path was text.

**3. Paging 10,000-line logs blind.** No grep across jobs, no job filter —
`sed -n` ranges and hope, repeated until the `--- FAIL:` line surfaced.
Each window was a full tool round-trip with the context re-sent.

The session's own notes from that era:

> _binary corruption: `f fj GET …/logs` returns a binary zip that `f fj`
> prints as garbled text; piping corrupts it. Workaround:
> python3 subprocess.run(..., capture_output=True)._

## The fix — two words added to an existing uck

The gap was small enough that the right response was not a new tool but a
small edit to the uck that already owned Forgejo auth, base-URL
resolution, and error reporting. That is the contract paying off:
`f fj` is a directory with an `index.js`
([the uck contract](/ucks/)), so extending it means editing a file —
no new package, no new config, no deployment. The change landed in
fcli-ucks and was published with `f uck push fj`:

- **`f fj runs [newest|<run_id>]`** — list recent runs as
  `<id>  status  event  sha  ref  duration`, or show one run plus its
  jobs. The list comes from the same `listActionRuns` data the agent used
  to parse by hand, but the _API's_ id is what gets printed, so the
  three-id confusion disappears by construction.
- **`f fj joblogs <run_id> [grep] [--job x] [--out dir]`** — the raw
  logs endpoint, handled as **bytes**: a ~30-line ZIP central-directory
  reader (stored + `zlib.inflateRawSync` for deflated entries — the
  SDK's client already fetched with `arraybuffer`, so no new
  dependencies) unzips the run's log, then greps every job with
  `file:line:content` or saves the files to a directory.

How easy the edit actually was, in the uck's own terms: the run-listing
and job-listing calls reuse the uck's existing `makeClient`/token
plumbing verbatim; the only genuinely new code is the zip walk and the
output format. Everything the LLM had to solve around the uck —
authentication, which instance, error messages that say what is wrong —
was already solved _inside_ it.

One follow-up commit the same day:
`runs` tolerates a truncated consumer (`| head -3`) instead of dying with
an `EPIPE` stack — the kind of edge a two-hour session immediately
exercises.

## The "after" — the same session

**Which run, and did it break:**

```sh
f fj runs newest
```

```
3774  success   pull_request  fec3afa9  #1291 9m
3773  failure   pull_request  58eb1186  #1291
3772  success   pull_request  8fefc8e0  #1267 10m
3771  failure   pull_request  eb3c213d  #1267 9m
```

**Which job, and what failed:**

```sh
f fj runs 3767
```

```
  job 4491  failure   build · lint · test · e2e
  job 4492  success   tui-integration
3767  failure   pull_request  831fff27  #1267 9m
```

```sh
f fj joblogs 3767 "--- FAIL"
```

```
build · lint · test · e2e-4491-attempt-1.log:9348:--- FAIL: TestListWebhooks (6.68s)
```

One command: the zip is downloaded as bytes, unzipped, grepped across
every job. The job name is in the filename, so the agent never opens a
log viewer to learn which of five jobs blew up. Narrow to one job:

```sh
f fj joblogs 3767 "go test|TUITest" --job tui
```

```
tui-integration-4501-attempt-1.log:711:ok      github.com/nucleotide/tui/app    5.559s
```

**Whole log for deeper reading** (`"x"` matches nothing — you only want
the files):

```sh
f fj joblogs 3772 "x" --out /tmp/logs3772
```

```
saved build · lint · test · e2e-4500-attempt-1.log -> /tmp/logs3772/build · lint · test · e2e-4500-attempt-1.log
saved tui-integration-4501-attempt-1.log -> /tmp/logs3772/tui-integration-4501-attempt-1.log
```

Now the profiling pass is a plain one-liner over text, and the answer
comes out in one round-trip:

```
gap 29s after: Run `npm audit` for details.
gap 90s after: > Task :checkKotlinGradlePluginConfigurationErrors SKIPPED
gap 90s after: Preparing "Install Android SDK Build-Tools 34 v.34.0.0".
gap 78s after: ok      github.com/nucleotide/tui/app    165.077s
```

Cold Gradle daemon (~2 min), Go tests running per-package (`queue` alone:
243 s), and a Playwright Chromium download _every run_ (~75 s). That
attribution became the follow-up PR that cut the pipeline.

**Is the fix in yet:**

```sh
f fj runs newest && f fj joblogs 3774 "--- FAIL"
# silence means green
```

## What changed, concretely

| Before (LLM + the REST-only fj uck)                                                            | After (`f fj runs` / `joblogs`)                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Python subprocess wrapping `f fj` to capture zip bytes; corrupted when the text path kicked in | `joblogs` treats the response as binary end to end            |
| Unzip + grep via scratch scripts in `/tmp`                                                     | `joblogs <run> <grep> [--job x] [--out dir]`                  |
| Three candidate run ids, guessed; opaque `resource does not exist`                             | `runs` prints the API's id; the UI's number is never involved |
| `sed -n` paging over 10k-line logs, one round-trip per window                                  | grep across all jobs in one call                              |
| ~6–8 tool round-trips to answer "what failed"                                                  | 2                                                             |

## Good to know

- **Auth** — same as the rest of `f fj`: `--token`, `FORGEJO_TOKEN`, or
  the `creds` uck keyed by host. Read access to the repo is enough for
  runs and logs (owner-only endpoints like runners and secrets still
  403).
- **Repo** — `runs`/`joblogs` default to the git origin of the current
  directory; `--repo owner/name` points elsewhere.
- **Extending it further** — the words live in
  [fcli-ucks](https://github.com/fclidev/fcli-ucks) under `fj/`; it is one
  `index.js`. If your instance's Actions surface differs, edit the file and
  `f uck push fj`.
