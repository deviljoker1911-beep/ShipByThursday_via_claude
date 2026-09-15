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

- **Isometric map**, procedurally generated and seeded — the same seed gives the
  same valley, which matters when a bug only appears on one layout.
- **Economy**: villagers fell trees and mine gold, carry ten at a time, and bank
  it at a drop-off. Farms trickle food.
- **Building**: houses raise the population cap, barracks train soldiers, farms
  feed them. Sites are built by villagers and can be finished by several at once.
- **Combat**: spearmen and archers, with range and cooldowns. Idle soldiers
  defend themselves.
- **An opponent** that economises, expands housing when capped, and attacks in
  waves that grow. It cheats at nothing — same costs, same build times, same
  gather rates as you.

## Controls

|  | Desktop | Touch |
|---|---|---|
| Select | click, or drag a box | tap, or drag a box |
| Order | click the ground, a tree, or an enemy | same |
| Pan | right-drag, or WASD / arrows | drag with two fingers |
| Zoom | scroll wheel | — |
| Cancel placement | `Esc` | tap the highlighted build button again |

With units selected, a click is an **order**, not a re-selection — clicking a
tree sends villagers to chop it, clicking an enemy attacks. That's the genre
convention and it's what your hands will expect.

## Honest scope

This is a **vertical slice**, not a finished game. Three days with one
person and an AI buys the core loop working properly; it does not buy what a
studio ships. Deliberately absent:

- **Multiplayer.** Networked RTS needs lockstep determinism and rollback — a
  project in its own right, not a feature.
- **Fog of war**, tech ages, unit upgrades, campaign, sound.
- **Formations and group pathing.** Units separate so they don't stack, but
  they path individually; a large group will straggle.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 14 headless simulation tests
npm run build   # static files in out/
```

> Don't run a build while `npm run dev` is live — they share `.next`, and the
> dev server starts throwing runtime errors that look like app bugs.

## How it's tested

The simulation has no dependency on the renderer, so it's tested headlessly:
build a world, issue orders, run thousands of fixed timesteps in milliseconds,
assert on the result. `npm test` plays out real matches — a villager's full
gather loop, a construction site, a unit dying, the AI developing its base over
three simulated minutes, a match ending.

That found two bugs a play-through would have taken much longer to pin down,
both the same shape and both invisible in a screenshot. See
[`docs/build-log.md`](docs/build-log.md).

Map generation is asserted across 40 seeds, because a start with no reachable
wood isn't a hard match — it's an unplayable one.
