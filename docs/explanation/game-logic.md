# Explanation: Game logic

This document explains how the browser port models Burning Rubber’s gameplay. It focuses on the *why* and *mental model*; for exact fields and function names, see the [Code architecture reference](../reference/code-architecture.md).

## Design model

The original game is a Classic Mac OS Pascal application with a fixed playfield and resource-driven data. The web port preserves that model:

- **Data-driven courses and objects.** Levels, road shapes, object placements, checkpoints, car stats, graphics, and sounds come from extracted resource data.
- **Fixed-step simulation.** Gameplay advances in discrete ticks (12 Hz), not in variable frame time. Rendering runs on `requestAnimationFrame`, but simulation catches up using an accumulator.
- **Canvas as playfield.** The game draws into a 620×480 coordinate space that mirrors the original screen layout.

This is a 2D arcade racer viewed from above: the road scrolls through pre-authored profile data while the player car mostly stays near the bottom of the playfield.

## Coordinate system

The port keeps original-style coordinates:

- **Screen space:** `(0,0)` is top-left of the 620×480 canvas; positive y goes down.
- **Course/profile space:** `LEVL` contains rows of four horizontal road boundaries. Each row represents a vertical slice of the course.
- **Vertical mapping:** one profile row corresponds to 2 screen pixels. Code maps row/scroll to screen y using the pattern `480 - (index - scroll) * 2` (and related forms for objects/bonus).
- **Scroll:** `current.scroll` is the car’s progress through the course. Forward speed moves scroll by `trunc(speed / 2)` per update.
- **Horizontal position:** `current.x` is the player’s x position in playfield coordinates. The car is treated as a 32×32 base rectangle, enlarged during jumps.

The `OFFSET` constant (100) appears in road checks, object activation, and checkpoint logic to align the visible/player reference with course data.

## Frame loop

Each animation frame (`frame()`):

1. Measures elapsed time since the last render.
2. Adds elapsed time to an accumulator (clamped to avoid spiral-of-death after long pauses/tab stalls).
3. Runs `updateGame()` once per 12 Hz step while enough time has accumulated.
4. Draws the current state.
5. Requests another frame while in active gameplay.

`updateGame()` handles high-level sequencing: wait/countdown, objects, bonus, car, time/bonus countdown, extra lives, animations, and engine sound. When the police dialog or pause stops gameplay, the mode changes and the RAF loop is not rescheduled until explicitly resumed.

## Player car physics

`updateCar()` implements arcade-style step physics, not realistic vehicle dynamics:

- **Acceleration/braking** modify forward speed (`speed`), with clamps based on car data.
- **Steering** modifies lateral speed (`lateralSpeed`), with damping and limits.
- **Drag/slowdown** and finish-line slowdown reduce speed over time.
- **Direction/frame** is derived from lateral vs. forward movement and clamped to the car’s available frames.
- **Jumping** temporarily changes size/effective interaction and has its own rise/fall behavior.
- **Road edges** are checked against `LEVL` boundaries. `ROAD.flags` determine consequences: crash, drawn/crash variant, off-road slowdown, and drawing behavior. Mac `BitTst` bit numbering is used for flag checks.

The player can die from road-edge consequences (depending on road flags), lethal object interactions, or time/bonus expiration.

## Objects and collisions

Objects are `OBJS` placements instantiated against `ODEF` definitions. Definitions carry behavior, not just appearance: movement defaults, size, flags, weight, crash threshold, jump/score effects, and animation/death IDs.

The port’s object system handles:

- **Movement:** objects update position from their velocities; special cases include police pursuit (`def.die === 1`).
- **Navigation:** objects with navigation flag steer away from road/divider boundaries (Pascal `doNvgte`-style lookahead).
- **Boundary behavior:** only flag 7 objects are removed/crashed by road boundaries (Pascal `BackCrash` behavior), checked against the object’s road position.
- **Player interactions:** solid collisions exchange momentum and play contact sound 1102; hazards/collectibles/jumps/lethal thresholds are applied according to ODEF flags/data.
- **NPC interactions:** reactive object-object contact plays 1108. The port also adds practical NPC avoidance so traffic doesn’t constantly self-destruct; player-forced collisions can still create stronger NPC interactions.
- **Police encounter:** colliding with police (`item.id === 1042` or `def.die === 1`, unless already paid for the level) opens a modal choice. Paying costs points and removes police for the current level; running away has a risk of being caught.

Collision detection is primarily AABB rectangle overlap plus road boundary checks (`checkSect`/`inRoad`). It is intentionally simple, matching the spirit of the original.

## Scoring, lives, and progression

- **Score** increases from object bonuses and end-of-stage bonus conversion.
- **Bonus/time** counts down during active play; running out can kill the player.
- **Multiplier pickup** is placed on the level and affects bonus conversion when collected.
- **Extra life** is awarded at 2000-point milestones.
- **Checkpoints (`RSET`)** are used for respawn after death (if lives remain).
- **Finish** occurs when the car passes `INFO.stopAt`; the port enters a completion/tally phase, converts remaining bonus, then starts the next level.
- **Game over** occurs when lives are exhausted; best score is stored in `localStorage`.

Level lookup wraps across the 10 original `INFO` records by default; see the [How to add a level](../how-to/add-a-level.md) guide before extending beyond that.

## Rendering

The canvas is redrawn every RAF tick:

1. Background pattern/color.
2. Road bands from the visible `LEVL` rows (unless road flags suppress drawing).
3. Objects and level bonus pickup.
4. Active animations.
5. Player car.
6. HUD (speed bar, lives/time/score/multiplier).
7. Messages (level intro, countdown, stage complete, time up).

The HTML overlays (menu, pause, police, game over) sit above the canvas. On the menu, the canvas is intentionally cleared to avoid duplicate title visuals.

## Fidelity and tradeoffs

The port aims to be playable and faithful to original data/behavior, but it is not a perfect emulator:

- Mac Toolbox behavior is approximated in browser APIs.
- `ROAD`/`ODEF` flags use Mac `BitTst` numbering; getting this wrong breaks many behaviors.
- Some systems (animation CLUT/palette effects, police flow details, exact original feel/timing nuances) may differ from the Pascal original.
- The code favors clear browser-side JavaScript over reproducing Pascal structure line-for-line.

When diagnosing behavior, compare the port’s logic with [`../../reference/GAME_ARCHITECTURE.md`](../../../reference/GAME_ARCHITECTURE.md) and the relevant Pascal unit under `BurningRubber/`.
