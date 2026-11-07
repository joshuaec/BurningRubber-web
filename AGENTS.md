# AGENTS.md — `web/` (Burning Rubber browser port)

This directory contains a static, dependency-free browser port of the 1995 Classic Mac OS Pascal game *Burning Rubber*. The port runs on an HTML canvas and consumes extracted original resource data from `web/data/`.

## Quick start

Serve the `web/` directory over HTTP (the game fetches JSON resources; `file:` URLs will fail):

```sh
python3 -m http.server 8000 --directory web
# or, from repo root:
python3 -m http.server 8000 --directory BurningRubber/web
```

Open `http://localhost:8000`. There is no build step, package manager, bundler, or automated test suite in this directory.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell, canvas (`620×480`), menu/pause/police/game-over overlays, touch controls, module script entry. |
| `style.css` | Cabinet/layout styling, overlays, responsive/touch behavior. |
| `game.js` | Entire game: resource loading/parsing, simulation, rendering, input, audio, UI state. |
| `README.md` | Short user-facing run/controls notes. |
| `data/Race.json` | Extracted general game resources (`CAR `, `ROAD`, `ODEF`, `ANIM`, sprite/sound/image tables, etc.). |
| `data/Levels.json` | Extracted course resources (`INFO`, `LEVL`, `OBJS`, `RSET`). |
| `data/Race.json_resources/` | Extracted binary assets referenced by `Race.json` (PICT/ppat/cicn images, AIFF sounds in source tree; runtime loads WAVs from `data/sounds/`). |
| `data/sounds/*.wav` | Browser-playable sound effects used by `game.js`. |

## Original sources (reference, not executed)

The port is based on the Pascal sources and extracted resources in the parent repository:

- `../reference/GAME_ARCHITECTURE.md` — best high-level map of modules, resource formats, coordinates, rules, and porting notes.
- Pascal gameplay/core: `../Race.p`, `../Game.p`, `../GameGlobals.p`, `../Globals.p`, `../GameTools.p`, `../RoadDraw.p`, `../Car.p`, `../Objects.p`, `../Animations.p`, `../Display.p`, `../Shell.p`/`../PowerShell.p`/`../Tools.p`.
- Original resource forks/data: `../Race.rsrc`, `../Levels.rsrc`; extracted dumps under `../resource-dumps/`.

When changing behavior, prefer matching the original logic/feel unless intentionally diverging. Document intentional divergences in code comments or commit messages.

## Architecture (`game.js`)

`game.js` is a single ES module with top-level state and functions (no framework).

### Top-level state

- `input` — current control booleans: `left`, `right`, `accelerate`, `brake`.
- `images` — loaded image map keyed by `"type:id"` and plain `id`.
- `sounds` — loaded sound URL map keyed by numeric sound resource ID.
- `state` — app/session state: `mode` (`menu` / `game` / `paused` / `game-over`; police uses a transient mode in object collision path), score/lives, best score (`localStorage` key `burning-rubber-best`), sound toggle, RAF timing accumulators.
- `current` — active race state for the current level (car stats, road/profile, placements/checkpoints, scroll/position/speeds, jump, timers/counters, animations, etc.).

### Lifecycle

1. `loadGame()` fetches `data/Race.json` and `data/Levels.json`, preloads `cicn`/`ppat`/`PICT` images, maps `snd ` IDs to `data/sounds/<id>.wav`, enables Start.
2. `startLevel(level)` parses the level’s `INFO`/`ROAD`/`LEVL`/`OBJS`/`RSET` data, initializes `current`, resets timing, and starts the RAF loop.
3. `frame()` accumulates elapsed time and runs fixed simulation steps at `FRAME_RATE = 12` Hz (`1000/12 ms` per step), then draws.
4. `updateGame()` advances countdown, objects, bonus pickup, car, completion/bonus tally, time-up/death, extra-life milestones, animations, and engine sound. It returns to menu/game-over flows via DOM overlays and state changes.

### Rendering

All drawing targets the 620×480 canvas in original playfield coordinates.

- `drawBackground()` — tiled `ppat` background or road background color.
- `drawRoad()` — fills road bands per visible `LEVL` row unless road flag bit 3 suppresses drawing; uses 2 px vertical slices (`HEIGHT - (index - scroll) * 2` mapping, stepped by 2).
- `drawObjects()` / `drawBonus()` / `drawAnimations()` / `drawCar()` — sprite blits via `sprite(id, x, y, w, h)`.
- `drawHud()` / `drawMessages()` — speedometer, status strip, lives/time/score, countdown/level/stage-complete messages.

Image smoothing is disabled (`ctx.imageSmoothingEnabled = false`).

## Coordinate system and units

The port keeps the original 620×480 top-left canvas space:

- `WIDTH = 620`, `HEIGHT = 480`, `ROAD_BOTTOM = 462`, `OFFSET = 100`.
- Road profile (`LEVL`) rows are course cross-sections. A row index maps vertically as `y = 480 - (index - scroll) * 2` (2 screen pixels per profile row).
- `scroll` is the current course position; car advances it by `trunc(speed / 2)` (see `updateCar`).
- Player car is nominally 32×32 around `(x, y)` with `y = HEIGHT - OFFSET - 16` at level start; jump inflates draw/collision rect.
- `OFFSET`/road checks follow original conventions (e.g. `roadAt(scroll)`, `inRoad(..., rowScroll, tolerance)` uses `scroll + OFFSET/2` in key paths).

Be careful not to mix course indices, screen pixels, and object-local widths/heights.

## Resource parsing (big-endian Mac integers)

Extracted binary payloads are hex strings decoded by `bytesOf`/`dataView`. Multi-byte values are read big-endian (`DataView.getInt16/getUint16(..., false)`).

Current parsers:

- `parseInfo(id)` (`INFO`): `dataId, roadId, objectId, stopAt, bonus` + Pascal-style length-prefixed name at byte 10.
- `parseRoad(id)` (`ROAD`): pattern IDs, RGB colors (16-bit Mac components scaled by `/257`), flags byte.
- `parseCar()` (`CAR ` id 1000): base icon, crash/drawn anim IDs, speed/acc/brakes/steering, frames, bumping/off-road, weight (reads fields as stored in resource).
- `parseObjectDefinition(id)` (`ODEF`): icon, velocities, brakes, `die`, flags, width/height offsets, weight/crash/jump/score.
- `parsePlacements(resource)` (`OBJS`): 3 words per entry `(id, scroll, x)` until terminator `id == 10000`; adds runtime fields (`vx`, `vz`, `collected`).
- `parseRoadProfile(resource)` (`LEVL`): 4 signed words per row `[left, innerLeft, innerRight, right]`.
- `parseCheckpoints(resource)` (`RSET`): `(scroll, x)` pairs until sentinel `scroll == 32767`.
- `parseAnimation(id)` (`ANIM`): sound ID at offset 2, frame/control words from offset 4 onward.

Level selection follows original lookup: `(level - 1) % 10`, with level 10 using `INFO` 999 and 1–9 using `INFO 1000 + index`.

## Gameplay behavior to preserve/check

- Fixed 12 Hz simulation pacing; movement/timers/sounds are step-based.
- Car physics: acceleration (faster below speed 8), steering proportional to speed, braking with one-shot brake sound threshold, drag, finish slowdown, lateral damping, direction frames clamped to car frames.
- Road: divided roads use inner boundaries; `ROAD.Flags` bits affect edge/off-road behavior (crash/drawn/off-road slowdown; flag bit 3 affects road drawing path in original — JS skips road fill when bit 3 is set).
- Objects: ODEF flags/fields drive hazards, pickups, solid collisions, jump ramps, navigation/police-like behavior (`die === 1`), boundary removal, scoring, and animations.
- Bonus/lives/score: countdown bonus per level, random multiplier pickup, +1 life every 2000 points, time-up can kill, stage complete converts remaining bonus to score then advances level.
- Death/respawn uses latest checkpoint behind `scroll + OFFSET` (or start fallback).

## Fidelity notes / known differences

The web port is a practical recreation, not a byte-perfect emulation. Known areas to inspect carefully before “fixing” to match Pascal:

- **Palette/CLUT effects** from original animations (`SetCLUT`/`ScreenBlood`/`RemoveBlood`) are not reproduced as Mac palette animation.
- **Police encounter flow**: Pascal routes through `Animate(1)`/`DoPolice` (modal alert in Animations.p); JS shows an HTML `#police` dialog on certain object collisions and handles pay/run outcomes in JS. Verify trigger/behavior against original intent before changing.
- **Animation playback details**: JS plays visible frames and skips low control values `< 1000` by advancing, but does not implement original palette-control semantics; `frame` is incremented after processing.
- **Object parsing/collision edge cases**: JS re-parses ODEFs during updates and includes simplified assumptions. Compare with `Objects.p` for authoritative behavior when debugging collisions, navigation, crash thresholds, and object/object interactions.
- **Sound IDs**: JS loads `data/sounds/<id>.wav`; engine uses sound `2000`. Effect playback creates a new `Audio` per play (simple, but can be noisy/allocate under load).
- **Session/UI scope**: original shell/preferences/controls/high-score dialogs/help/about art are only partially represented by the web menu/overlays.
- **Persistence**: only best score is stored (`localStorage`).

If you improve fidelity, add targeted checks for all 10 courses, divided roads, checkpoints/finish positions, bonus pickup, police, jumps, and stage transitions.

## Editing guidelines

- Keep it static and simple: plain HTML/CSS/JS modules unless there is a strong reason to add tooling.
- Avoid changing resource IDs or asset paths without updating both loaders and data.
- Treat `data/*.json` as extracted original data; regenerate/fix via the project’s extraction pipeline outside this directory rather than hand-editing hex payloads unless necessary.
- Preserve the 620×480 simulation/render contract when adjusting visuals; use CSS scaling for display size.
- For gameplay changes, cross-check `../reference/GAME_ARCHITECTURE.md` and the relevant Pascal unit before guessing.

## Useful grep targets

```sh
# game states / UI
rg -n 'state\.mode|showMenu|pauseGame|finishGame|#police' game.js

# resource parsing
rg -n '^function parse|currentLevelInfo|dataView|word\(' game.js

# simulation
rg -n '^function update|startLevel|FRAME_RATE|OFFSET|inRoad|overlaps' game.js

# rendering
rg -n '^function draw|sprite\(|imageFor\(' game.js
```