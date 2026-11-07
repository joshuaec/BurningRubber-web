# Reference: Code architecture

## Files

| Path | Purpose |
|---|---|
| `web/index.html` | Canvas, menu/pause/police/game-over overlays, touch controls, footer. |
| `web/style.css` | Layout, overlay styling, responsive/touch rules. |
| `web/game.js` | All game logic: loading, parsing, simulation, rendering, input, audio. |
| `web/data/Race.json` | General resources: `CAR `, `ROAD`, `ODEF`, `ANIM`, image/sound tables. |
| `web/data/Levels.json` | Course resources: `INFO`, `LEVL`, `OBJS`, `RSET`. |
| `web/data/sounds/<id>.wav` | Runtime sound effects; engine is sound `2000`. |
| `web/data/Race.json_resources/*` | Extracted image assets referenced by resource tables. |

## Runtime constants

Defined near the top of `game.js`:

| Constant | Value | Meaning |
|---|---:|---|
| `WIDTH` | 620 | Canvas/playfield width (original pixels). |
| `HEIGHT` | 480 | Canvas/playfield height. |
| `ROAD_BOTTOM` | 462 | Lowest y used for road drawing loop. |
| `FRAME_RATE` | 12 | Simulation steps per second. |
| `OFFSET` | 100 | Original vertical/car offset used in row/checkpoint math. |
| `LEVEL_COUNT` | 10 | Number of courses exposed by current lookup. |

## Global/runtime state

| Name | Purpose |
|---|---|
| `input` | Booleans: `left`, `right`, `accelerate`, `brake`. |
| `images` | Loaded images keyed by `"type:id"` and plain `id`. |
| `sounds` | Map of numeric sound ID → WAV URL. |
| `state` | App state: `mode`, `level`, `score`, `lives`, best score, sound toggle, timing accumulators. |
| `current` | Active level/session data: parsed info/car/road/profile/placements/checkpoints, position/speeds, jump, timers, animations, flags. |
| `engineAudio` | Looping engine `Audio` instance (sound 2000). |

`state.mode` values used by the port include `menu`, `game`, `paused`, `police`, and `game-over`.

## Main functions

### Loading and startup

- `loadGame()` — fetches `Race.json`/`Levels.json`, loads images/sounds, enables Start.
- `fetchJson()`, `bytesOf()`, `word()`, `dataView()`, `requiredResource()` — resource fetch/decode helpers.
- `loadImage()`, `loadImages()` — image asset loading.

### Parsing

- `parseInfo(id)` — `INFO` record.
- `parseRoad(id)` — `ROAD` record (patterns, RGB colors, flags byte).
- `parseCar()` — `CAR ` resource 1000.
- `parseObjectDefinition(id)` — `ODEF` record.
- `parsePlacements(resource)` — `OBJS` placement list.
- `parseRoadProfile(resource)` — `LEVL` profile rows.
- `parseCheckpoints(resource)` — `RSET` checkpoint list.
- `parseAnimation(id)` — `ANIM` sound + frame/control words.
- `currentLevelInfo(level)` — maps game level number to `INFO` ID.

### Level/session

- `startLevel(level)` — parses resources, creates `current`, hides overlays, starts loop.
- `showMenu()` — returns to menu mode and redraws.
- `finishGame()` — records best score and shows game-over overlay.
- `pauseGame()` / `resumeGame()` — pause/resume RAF simulation.
- `resumeFromPolice()` — resumes after police dialog.

### Simulation

- `frame(timestamp)` — `requestAnimationFrame` loop; fixed-step accumulator at 12 Hz.
- `updateGame()` — per-tick orchestration: completion tally, objects/bonus, car, countdown/wait, time-up, extra lives, animations, engine sound.
- `updateCar()` — input response, speed/steering, jump, road-edge checks, scroll/x movement, finish detection.
- `updateObjects()` — NPC movement/navigation/avoidance, boundary crash (flag 7), player collisions, pickups/hazards/jumps/police, NPC-NPC interactions.
- `updateBonus()` — level multiplier pickup.
- `updateAnimations()` — advances animation slots.

### Road/collision helpers

- `roadAt(scroll)` — clamps/selects a `LEVL` row.
- `checkSect(scroll, x, tolerance)` — road boundary/divider test returning `{ off, idea }`; uses Mac bit logic context via callers.
- `inRoad(x, scroll, tolerance)` — inverse of `checkSect().off`.
- `bit(flags, index)` — **Mac `BitTst` convention**: bit 0 is MSB (`0x80 >> index`). Used for `ROAD` and `ODEF` flags.
- `overlaps(a, b)` — AABB rectangle intersection.
- `playerRect()`, `objectRect(item, def)` — collision/draw rectangles.

### Rendering

- `draw()` — clears canvas on menu; otherwise draws scene.
- `drawBackground()`, `drawRoad()`, `drawObjects()`, `drawBonus()`, `drawAnimations()`, `drawCar()`, `drawHud()`, `drawGauge()`, `drawMessages()`.
- `sprite(id, x, y, width, height)` / `imageFor(type, id)` — sprite lookup/draw.

### Audio and UI handlers

- `playSound(id)` — one-shot effect from `sounds` map (if enabled).
- `unlockSound()` / `updateEngineSound()` — engine loop handling.
- DOM event handlers for keyboard, touch controls, menu buttons, pause/police/game-over dialogs.

## Resource format notes

- Binary payloads are hex strings decoded to bytes and read as **big-endian** integers.
- Pascal/Mac string fields (e.g. `INFO.name`) are length-prefixed.
- `OBJS` entries: `[id, scroll, x]`, terminator `10000`.
- `RSET` entries: `[scroll, x]`, sentinel `scroll == 32767`.
- `LEVL` rows: `[leftOuter, innerLeft, innerRight, rightOuter]`. Equal inner values mean a normal road; different values mean a divided road.
- Flags in `ROAD`/`ODEF` are checked with `bit()` using Mac `BitTst` numbering (bit 0 = MSB).

## Persistence and browser APIs

- Best score: `localStorage` key `burning-rubber-best`.
- Audio: `Audio` elements; engine uses looping sound 2000.
- Rendering: 2D canvas, `imageSmoothingEnabled = false`.
- Input: keyboard events + pointer/touch controls.

## Known implementation boundaries

- No build system, type checker, or automated tests in `web/`.
- Animation palette/CLUT effects from the original are not fully emulated.
- Some behaviors are pragmatic ports rather than exact Pascal emulation; compare with `../../reference/GAME_ARCHITECTURE.md` and Pascal sources when fidelity matters.
