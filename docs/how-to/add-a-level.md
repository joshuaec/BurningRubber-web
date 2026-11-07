# How to add or wire a level

This guide explains how levels are represented in the web port and what to change when adding or replacing a course.

> **Current constraint:** the port is built around the 10 original extracted courses. `LEVEL_COUNT` is `10` and `currentLevelInfo(level)` wraps with `((level - 1) % LEVEL_COUNT)`, with level 10 mapped to `INFO` 999 and levels 1–9 mapped to `INFO 1000..1008`. To add levels beyond 10, you must add data **and** change this lookup logic.

## 1. Understand the level data model

Course data lives in `web/data/Levels.json` (hex-encoded Mac resource payloads) and is joined with definitions/assets from `web/data/Race.json`.

| Resource | Location | Purpose | Parsed by |
|---|---|---|---|
| `INFO` | `Levels.json` | Course metadata and resource IDs: data/road/object IDs, finish position (`stopAt`), starting bonus, name. | `parseInfo()` |
| `LEVL` | `Levels.json` | Road geometry/profile: 4 signed 16-bit values per row `[left, innerLeft, innerRight, right]`. | `parseRoadProfile()` |
| `OBJS` | `Levels.json` | Object placements: 3 signed/unsigned words per entry `[id, scroll, x]`, terminated by id `10000`. | `parsePlacements()` |
| `RSET` | `Levels.json` | Checkpoints/rebirth points: `[scroll, x]` pairs, sentinel `scroll == 32767`. | `parseCheckpoints()` |
| `ROAD` | `Race.json` | Visual/behavior data: patterns, colors, `flags` byte (crash/drawn/off-road/draw behavior via Mac `BitTst` bit numbering). | `parseRoad()` |
| `ODEF` | `Race.json` | Object definitions referenced by `OBJS` IDs (sprite, movement, flags, size, crash/jump/score behavior). | `parseObjectDefinition()` |
| `ANIM`/sprites/sounds | `Race.json` + assets | Animation frames, cicn/ppat/PICT images, WAV sound files. | `parseAnimation()`, image/sound loaders |

`INFO` is the join record. In `startLevel(level)`:

```js
const info = currentLevelInfo(level);
const road = parseRoad(info.roadId);
const roadProfile = parseRoadProfile(requiredResource(levelResources.LEVL, info.dataId, "LEVL"));
const placements = parsePlacements(requiredResource(levelResources.OBJS, info.objectId, "OBJS"));
const checkpoints = parseCheckpoints(requiredResource(levelResources.RSET, info.dataId, "RSET"));
```

## 2. Inspect an existing course

Use an existing entry as a template. Example: `INFO 1000` (“Beware of the Cops”) in `Levels.json` contains a hex `data` payload; `parseInfo()` reads:

- bytes 0–1: `dataId` (big-endian u16)
- bytes 2–3: `roadId`
- bytes 4–5: `objectId`
- bytes 6–7: `stopAt`
- bytes 8–9: `bonus`
- byte 10: Pascal string length
- bytes 11+: name bytes

The corresponding `LEVL`/`OBJS`/`RSET`/`ROAD` entries must exist under the IDs referenced by that `INFO`.

## 3. Add data for a new course

1. **Create or export the resource records** in the same hex JSON shape used by `Levels.json`/`Race.json` (`{"name"?,"order"?,"data":"..."}`; `LEVL`/`OBJS`/`RSET`/`INFO` live in `Levels.json`).
2. **Choose IDs** that do not conflict with existing records of the same resource type. Resource IDs are scoped by type (`INFO`, `LEVL`, `ROAD`, etc.), not globally unique.
3. **Wire `INFO` to the right records.** Its `dataId` must resolve to `LEVL` and `RSET`; `roadId` must resolve to `ROAD` (and, in original data conventions, related appearance data); `objectId` must resolve to `OBJS`.
4. **Ensure referenced ODEF/sprites/sounds exist** in `Race.json`/assets for every object/animation you use.
5. **Validate geometry.** `stopAt`, object `scroll` positions, and checkpoint `scroll` positions must make sense for the `LEVL` profile length. The car advances by `trunc(speed / 2)` per tick and maps rows as `y = 480 - (index - scroll) * 2`.

> Practical note: authoring raw hex Mac resource payloads by hand is error-prone. Prefer the project’s original resource/export pipeline (Classic Mac resources/resource dumps) if you have it, then convert to the JSON format used here.

## 4. Update level lookup in `game.js`

The port currently supports 10 levels:

```js
const LEVEL_COUNT = 10;

function currentLevelInfo(level) {
  const index = (level - 1) % LEVEL_COUNT;
  const infoId = index === 9 ? 999 : 1000 + index;
  return parseInfo(infoId);
}
```

To add more than 10 levels, replace this with an explicit mapping. For example:

```js
const LEVEL_COUNT = 11;
const LEVEL_INFO_IDS = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 999, 1100];

function currentLevelInfo(level) {
  const index = Math.min(level - 1, LEVEL_INFO_IDS.length - 1);
  return parseInfo(LEVEL_INFO_IDS[index]);
}
```

Also decide whether completion should wrap, end, or show a final screen. `updateGame()` currently does:

```js
if (current.completedTicks > 85 && current.bonus <= 0) {
  startLevel(state.level + 1);
  return;
}
```

If you don’t want wrapping/infinite progression, add an end-of-game condition when `state.level >= LEVEL_COUNT`.

## 5. Update UI text if needed

- The menu footer and help text are in `web/index.html`.
- Level selection uses `LEVEL_COUNT` and `currentLevelInfo(level).name` in `game.js`.
- Docs/README may mention “10 original courses”.

## 6. Test

1. Run a local server and open the game.
2. Use **Choose level** (or start progression) to load the new course.
3. Check: road renders, car can drive, objects appear at expected positions, checkpoints respawn sensibly, finish line triggers at `stopAt`, next-level transition behaves as intended.
4. Watch console errors for missing resources (`Missing original <TYPE> resource <id>`).

For format details, see [Code architecture reference](../reference/code-architecture.md) and the original [GAME_ARCHITECTURE.md](../../../reference/GAME_ARCHITECTURE.md).
