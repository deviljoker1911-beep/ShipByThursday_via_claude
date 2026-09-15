# Build log

Append-only. Newest entry at the bottom. Timestamps are local (IST).

---

## Day 1 — Tuesday, Sept 15, 2026

### Repo initialized
Empty repo, one README stub. Set up the premise, the rules, and the log
structure before writing any product code, so the record starts clean.

### Next
Pick the product. Constraints that matter for a 72-hour build:
- Must be demoable by a stranger in under 60 seconds, without a signup wall.
- Must have a real, narrow use — not a toy, not a platform.
- Must not depend on a third-party approval loop (app store review, API
  allowlist, payment onboarding) that can't clear inside three days.

### Product picked: Shipped
Paste a public GitHub repo, get the story of how it was built, read out of the
commit history. Chose it over three alternatives because it demonstrates itself:
the first repo we point it at is this one, so the product's output *is* the
writeup of the build. Nothing else on the list closes that loop.

### Day 1 build
Next.js 15 + TypeScript + Tailwind v4, Claude Opus 5 with adaptive thinking,
streamed to the browser. Two real problems showed up:

**The newest 100 commits are the wrong 100.** GitHub pages commits newest-first,
so a naive fetch of a ten-year project reads you last month and calls it the
story. `lib/github.ts` counts the full history first — asking for `per_page=1`
and reading the page number off the `last` link header, which costs one request
instead of downloading anything — then pulls evenly spaced windows across the
whole range. Svelte: 11,399 commits reduced to 300 spanning 2016-11-21 to
2026-09-11, in under 3 seconds.

**A sample looks like a hiatus.** Handing a model non-consecutive commits makes
it write "development paused through 2021" about a gap that is an artifact of
our own sampling. The digest now states the sample explicitly and forbids that
reading. Worth noting as the general shape of the problem: the model was not
wrong to infer it, we just hadn't told it what it was looking at.

Also fixed: `^0.71.0` silently pinned a nine-month-old Anthropic SDK with no
`thinking: {type: "adaptive"}` in its types — caret ranges don't cross minor
versions on `0.x`. Worth checking on any `0.x` dependency.

### Next
End-to-end run needs an `ANTHROPIC_API_KEY`. GitHub layer, build, and UI verified.

### Hardening pass
Ran the GitHub layer against real repos looking for ways it breaks. Found one
that would have hit people constantly: `https://github.com/owner/repo?tab=readme-ov-file`
returned 404. The URL pattern matched "anything up to a slash", so the query
string became part of the repo name. That exact suffix is what GitHub's own
copy-link button produces, so a large share of pasted URLs would have failed
with "repo not found" — the least debuggable possible error, because the repo
obviously does exist.

Fixed by matching GitHub's real character sets for owner and repo instead of
a loose catch-all. Locked in with tests (`npm test`), which also cover `.git`
suffixes, `git@` remotes, deep links, `#readme` anchors, and bare `owner/repo`.
Node 26 runs TypeScript tests natively — no test framework, no new dependencies.

Two smaller ones: `next build` and `next dev` share `.next`, and running the
build while the dev server was live corrupted its chunks into a runtime
TypeError that looked like an app bug and wasn't. And a constructor parameter
property in `GitHubError` blocked Node's type stripping, so the module couldn't
be run outside a bundler — worth avoiding in any file you might want to test
directly.

Verified: mobile at 375px, production build, typecheck, 3 test files passing.

## Day 1 (cont.) — Tuesday, Sept 15, 2026

### Pivot: Shipped → Galaxy
Direction changed. Instead of a tool *about* build stories, build an
open-source take on the Grok Bot product being demoed on the stream: a room of
AI teammates who use tools and hand work to each other.

Shipped isn't deleted — its GitHub reader became a bot tool. Kai (engineering)
can read a repository's commit history mid-conversation. Day 1's product became
Day 2's feature, which is the most honest outcome a pivot can have.

### The thing that made this buildable in a day
Grok Bot's headline capabilities are "browses the web, runs code, works with
files". The obvious reading is that you need a VM fleet. You don't: Anthropic's
API ships `web_search`, `web_fetch` and `code_execution` as **server-side**
tools, executed on Anthropic's infrastructure inside a real container. The
client declares them and reads the results. That removes essentially all the
infrastructure from the problem.

What genuinely can't be done this way — a persistent desktop a bot logs into
services on, and teach-a-task from a screen recording — is documented as out of
scope rather than faked.

### A conflict worth knowing about
The 2026 web tools (`web_search_20260209`) run code execution internally for
dynamic filtering, so declaring `code_execution` alongside them puts two
execution environments in front of the model. Kai needs a real sandbox, so Kai
gets the basic web tool variants instead; the other bots get the modern ones.
`toolsFor()` in `lib/agent.ts` makes that choice per bot.

### Design notes
The transcript is stored as plain text turns, not API message objects. Each
bot's view is rebuilt from it every turn — its own turns become `assistant`,
everyone else's become `user` with a speaker prefix. That makes handoffs
almost free: when a bot passes work on, its in-flight message list is simply
dropped, because nothing downstream depends on it.

Personas are written to disagree. A room where every bot concurs is one bot with
extra API calls, so each has a distinct remit, a named failure mode to avoid,
and explicit permission to push back.

### Not yet verified
The agent loop has never run against the real API — there's no key on this
machine. Types check and the build is clean, which proves nothing about runtime.
Handoffs, tool execution, and cost accounting are all unverified.
