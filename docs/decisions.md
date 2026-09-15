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

## D2 — Pivot from Shipped to Galaxy

**Context:** Day 1 built *Shipped* — paste a repo, get the story of how it was
built. Working, pushed, and fine. Mid-Day-1 the goal changed: build an
open-source take on the Grok Bot product itself, rather than a side project
about build stories.

**Choice:** Pivoted. Galaxy is a multi-bot agent workspace. Shipped's GitHub
reader survived as a bot tool rather than being deleted — Kai (engineering) can
read a repository's history mid-conversation.

**Trade-off:** Lost the self-demonstrating property, which was the main reason
Shipped won the Day 1 vote: its first output was the writeup of its own build.
Galaxy has no equivalent loop. Gained a far larger product surface and a
sharper answer to "why does this exist".

## D3 — Bring your own key, and no server at all

**Context:** The product needs an Anthropic key per user. The original ask was
to accept "an API key, or a Claude/ChatGPT paid account".

**Choice:** API keys only, held in the browser, sent directly to
api.anthropic.com via `dangerouslyAllowBrowser`. No backend.

**Why the account half was dropped:** consumer subscriptions don't grant API
access. Anthropic's own documentation is explicit that a paid Claude plan
doesn't include the API or Console, and ChatGPT Plus grants no OpenAI API
credits. Driving a consumer account from a third-party app means scraping
session cookies — against both providers' terms, and a good way to get a user
banned. Better to state the limitation in the UI than to build something that
quietly breaks people's accounts.

**Trade-off:** A real barrier to entry. Someone who pays for Claude every month
still has to go get a separate key, and some will bounce. Accepted, because the
alternative doesn't legitimately exist. The upside is unusually strong: no
server means no key custody, no breach surface, and a static deploy.

## D4 — Cost is shown in the header, permanently

**Context:** BYOK means every message spends the user's own money, and a
multi-bot room can fire six model calls from one human sentence.

**Choice:** Running spend in the header, per-model prices in Settings, and a
hard handoff cap defaulting to 6 turns.

**Trade-off:** Shows an uncomfortable number, which is the point. A product that
spends someone else's money silently should be showing them the meter.
