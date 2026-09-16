# Emberhold

### → [Play it](https://deviljoker1911-beep.github.io/ShipByThursday_via_claude/)

A small isometric real-time strategy game. Gather, build, train, fight. Runs in
any browser on desktop and mobile, and installs as an app. Built with Claude, in
the open, in 72 hours.

---

## What it is

An **original** RTS in the classic mould — not a clone of, or successor to, any
existing title. Its own units, its own map generation, its own art. Genre isn't
ownable; a brand is, and this borrows neither name nor asset from anyone.

- **Economy** — food, wood, gold and stone. Villagers carry ten at a time and
  bank it at a drop-off; farms feed you once the forage runs out.
- **A counter triangle** — spearmen beat riders, riders beat archers, archers
  beat spearmen. Arrows barely scratch buildings, so breaking a base takes melee.
- **Fog of war** — unexplored, remembered, and in sight. Enemy buildings stay on
  your map as last seen until someone looks again, so scouting is worth doing.
- **Formations** — a selected army moves as one: spearmen in front, archers
  behind, speeds matched so the riders don't arrive alone.
- **Defence** — town centres and watchtowers shoot back. Ring the alarm and your
  villagers run to shelter, adding arrows as they arrive.
- **An opponent that plays fair** — it scouts to find you, raids where it last
  saw your workers, answers the units it has seen, rebuilds what it loses, and
  is under the same fog, costs and gather rates as you. Difficulty changes its
  timing and army size, never its income.
- **Fair maps** — every map is exactly point-symmetric, with guaranteed
  resources at both starts and lanes that create chokepoints.

## Controls

The genre's model: **left-click selects, right-click orders.** What a right-click
does depends on what's under it — move, gather, attack, build, repair, or set a
building's rally point.

| | Desktop | Touch |
|---|---|---|
| Select · box-select | click · drag | tap · hold, then drag |
| Order | right-click | tap anywhere with units selected |
| Queue an order | Shift + right-click | — |
| All of a type on screen | double-click | double-tap |
| Attack-move · Stop · Patrol · Formation | A · S · P · F | command buttons |
| Build (villagers) · Train (buildings) | Q W E R T Y | command buttons |
| Control groups | Ctrl/Alt+1–9 to set, 1–9 to recall | group buttons |
| Next idle villager · Town centre | . · H | Idle · Town |
| Alarm · Back to work | B · Shift+B | Alarm · Work |
| Camera | arrows, screen edge, minimap | drag, pinch |
| Zoom | wheel (two-finger swipe pans) | pinch |

The full list is in the in-game menu. Everything a key does is also a button.

## Honest scope

A **vertical slice**, not a finished game. Deliberately absent: multiplayer
(lockstep networking is a project of its own), tech ages and upgrades, siege
units, elevation, sound, and a second faction.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 56 headless tests, including full AI-vs-AI matches
npm run build   # static files in out/
```

> Don't run a build while `npm run dev` is live — they share `.next`, and the
> dev server starts throwing runtime errors that look like app bugs.

## How it's tested

The simulation has no dependency on the renderer, so it's tested headlessly:
build a world, issue orders, run thousands of fixed timesteps in milliseconds,
assert on the result. `npm test` plays out complete matches with the AI in both
seats, checks map fairness and connectivity across hundreds of seeds, and pins
the counter triangle, fog of war, formations, context orders and the HUD's
command card.

The rules are deterministic — a seed replays the same match exactly — and
combat resolves simultaneously, so neither player gets a first-strike edge from
processing order.

What the tests cannot say is whether it's fun. See
[`docs/build-log.md`](docs/build-log.md) for what was found by playing.
