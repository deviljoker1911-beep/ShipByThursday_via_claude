# Galaxy

**A room of AI colleagues who disagree with each other.** Built in 72 hours with
Claude, in the open.

Not one assistant — a working session. A founder who kills ideas, an engineer who
runs real code and says what will break, a PM who cuts scope, a salesperson who
knows what people actually pay for. They search the web, execute code, read
repositories, and hand work to each other when it isn't theirs.

Runs entirely in your browser on your own Anthropic API key. **There is no server
in this product** — no account, no database, nothing to breach. The build output
is static files.

---

## The premise

xAI ran [Grok Bot Galaxy](https://x.ai/galaxy) September 15–17: three SpaceXAI
staffers building a company from a blank whiteboard, live, with Grok Bot agents
as the labor. This is the same challenge on the same clock with Claude — and the
product is an open-source take on the thing being demoed.

Everything here was built with [Claude](https://claude.com/claude-code). Every
commit is public. Every decision is logged, including the wrong ones.

## Bring your own key

You need an [Anthropic API key](https://console.anthropic.com/settings/keys).

**A Claude Pro or Max subscription does not include API access** — it's billed
separately through the Console. The same is true of ChatGPT Plus and the OpenAI
API. There's no legitimate way for a third-party app to use a consumer
subscription, so this app doesn't pretend otherwise.

Your key is held in your browser's local storage and sent only to
`api.anthropic.com`. It never reaches a server of ours, because there isn't one.
You pay Anthropic directly for exactly what the room uses; the running total sits
in the header.

## What the bots can do

| Capability | How |
|---|---|
| Search the web | Anthropic's server-side `web_search` tool |
| Read pages | server-side `web_fetch` |
| Execute real code | server-side `code_execution` — a real sandbox, not a description of one |
| Read a repo's history | client-side GitHub reader, sampled across the project's whole life |
| Hand work to a teammate | `hand_off` tool — ends that bot's turn and briefs the next |

The sandbox and web tools run on Anthropic's infrastructure. That's the reason
this was buildable in three days rather than three months: no VM fleet to
operate.

### Deliberately not built

A persistent hosted desktop where a bot logs into services as a human, and
learning a task from a screen recording. Both are infrastructure problems rather
than orchestration problems, and neither fits in 72 hours. Saying so beats
faking them.

## Run it

```bash
npm install
npm run dev
```

Then add your key in Settings. `npm test` runs the suite; `npm run build`
produces static files that deploy anywhere.

> One gotcha: don't run `npm run build` while `npm run dev` is live — they share
> `.next` and the dev server will start throwing runtime errors that look like
> app bugs.

## Follow along

- Build log: [`docs/build-log.md`](docs/build-log.md) — including the dead ends
- Decisions: [`docs/decisions.md`](docs/decisions.md)
- `git log --reverse` reads as a diary of the three days
