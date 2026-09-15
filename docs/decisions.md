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

## D5 — Ship a capability check, and be explicit about what it can't tell you

**Context:** "How do I know the bots allocated to these roles actually have the
skills?" A multi-agent product is trivially easy to fake — you can name a bot
"Engineering", give it no tools at all, and it will produce confident,
plausible, entirely fabricated code output. That's the default failure mode, not
an edge case.

**Choice:** A Verify panel that runs live probes and shows raw evidence. Each
probe is checked twice: **structurally** (did a tool_use block genuinely appear
in the response?) and **factually** (does the answer match a truth we computed
ourselves?).

The factual half is the part that matters. Probes ask for values that cannot be
produced from memory:
- a SHA-256 digest — a model without a sandbox will emit a well-formed, wrong hash
- a real commit sha, compared against one we fetched directly from GitHub
- a page heading, compared against the live page

**And the limit, stated in the panel itself:** none of this says whether Ada's
business judgment is any good. A persona is a prompt, not a credential. There is
no test for taste, and a check that implied otherwise would be worse than no
check — it would launder a vibe into a green tick.

**Trade-off:** Running the checks costs the user a few cents of real credit, and
publishing a test your own product can fail is a risk. Both are correct: a
capability claim nobody can test is just marketing.

## D6 — An original RTS, not Age of Empires V

**Context:** The request was to build "Age of Empires IV to Age of Empires V"
for desktop, mobile and web.

**Choice:** Built an original game in the genre. Own name, own units, own art,
own map generation. Nothing borrowed from the series.

**Why:** Age of Empires is a Microsoft/Xbox Game Studios property — the name,
the civilizations, the roster, the art. Shipping something presented as the
next entry in their series is trademark infringement, and publishing it under
that name is not something to negotiate around. The genre itself is not
ownable, so everything that actually makes the request interesting survives;
only the branding is off the table.

**Trade-off:** No recognition to trade on. A player arrives with no idea what
Emberhold is. Against that: it's publishable, and it's honest about what it is.

## D7 — Test the simulation headlessly, not through the renderer

**Context:** The browser pane throttles `requestAnimationFrame` to 1fps when
unfocused, so the game could not be evaluated by playing it here.

**Choice:** Made the simulation completely independent of the renderer and
tested it directly — build a world, issue orders, run thousands of fixed
timesteps in milliseconds, assert on the outcome.

**Trade-off:** Says nothing about whether the game *feels* good, which is most
of what matters in a game and can only be judged by playing. What it does buy
is the rules being provably correct, in half a second, on every push. Both
bugs found today were logic bugs that a screenshot renders as "a villager
standing still" — near-invisible by eye, unambiguous in a test.

The split also happens to be the right architecture: a simulation that doesn't
know about pixels is the precondition for headless testing, deterministic
replays, and eventually a networked server.
