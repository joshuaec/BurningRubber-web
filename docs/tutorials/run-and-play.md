# Tutorial: Run and play the web port

This tutorial gets the browser port running locally and points out the main gameplay systems you will see in code.

## 1. Serve the `web/` directory

The game loads JSON and assets with `fetch()`, so it must be served over HTTP (not opened as `file:`).

From the repository root:

```sh
python3 -m http.server 8000 --directory BurningRubber/web
```

Or from `BurningRubber/web`:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## 2. Start a run

On the menu:

- **Start driving** starts level 1 with score/lives reset.
- **Choose level** lets you pick one of the 10 original courses.
- **How to play** toggles basic controls/objectives.
- **Sound** toggles effects/engine audio.

## 3. Controls

- **Steer:** Left/Right arrows or `A`/`D`
- **Accelerate:** Up arrow, `W`, or Space
- **Brake:** Down arrow, `S`, or Control
- **Pause/resume:** `P` or `Escape`

Touch devices show on-screen controls.

## 4. What to observe

A normal run exercises these systems:

- **Countdown/start wait** before control is fully active.
- **Scrolling road** generated from `LEVL` profile rows (2 screen pixels per row).
- **Player car physics** (acceleration, steering, braking, lateral drift, jump, road-edge behavior).
- **Objects/NPC traffic** from `OBJS` placements + `ODEF` definitions (hazards, pickups, solid collisions, police).
- **Bonus/time and multiplier pickup**; time expiring can cost a life.
- **Lives/score HUD** (bottom bar and speedometer) and extra life every 2000 points.
- **Stage complete**: remaining bonus is tallied into score, then the next level loads.
- **Game over**: no lives left returns to menu flow and stores best score in `localStorage`.

## 5. Where this maps in code

- Page/overlays: `web/index.html`, `web/style.css`
- All runtime logic: `web/game.js`
- Extracted data: `web/data/Race.json`, `web/data/Levels.json`, `web/data/sounds/*.wav`, `web/data/Race.json_resources/*`

Next: [How to add a level](../how-to/add-a-level.md) for the data/ID wiring, or [Code architecture reference](../reference/code-architecture.md) for implementation details.
