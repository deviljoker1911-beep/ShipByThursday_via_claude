# Decisions

One entry per call that shaped the build. Context, the choice, and what we
gave up by making it.

---

## D1 — Log the build in the repo, not in a thread

**Context:** The run is public. The record could live in social posts, a
stream, or the repo itself.

**Choice:** The repo is the primary record. `docs/build-log.md` and the git
history. Anything posted elsewhere links back here.

**Trade-off:** Lower reach than posting natively on a social platform. Worth
it — a thread is unverifiable and disappears; a git log with timestamps is
neither.
