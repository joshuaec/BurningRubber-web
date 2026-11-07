# Burning Rubber Web — Documentation

This documentation follows the [Diátaxis](https://diataxis.fr/) framework. Use the section that matches what you need:

| Need | Section | Purpose |
|---|---|---|
| Learn by doing | [Tutorials](./tutorials/run-and-play.md) | Run the game locally and understand the basic flow. |
| Solve a specific task | [How-to guides](./how-to/add-a-level.md) | Step-by-step tasks, such as adding or wiring a level. |
| Look up facts | [Reference](./reference/code-architecture.md) | Code layout, state, data formats, controls, and resource IDs. |
| Understand why/how | [Explanation](./explanation/game-logic.md) | Game loop, coordinates, physics/collision model, and design tradeoffs. |

## Scope

These docs cover the **browser port** in `web/` (`index.html`, `style.css`, `game.js`, `data/`). The original 1995 Classic Mac OS Pascal source lives in the parent `BurningRubber/` directory; see:

- [`../README.md`](../README.md) — run instructions for the web port.
- [`../reference/GAME_ARCHITECTURE.md`](../../reference/GAME_ARCHITECTURE.md) — original Pascal/resource architecture.
- [`../AGENTS.md`](../AGENTS.md) — implementation notes for agents working on the port.

## Quick facts

- **No build step.** Static HTML/CSS/JS served over HTTP.
- **Playfield:** 620×480 canvas, original coordinate model.
- **Simulation:** fixed 12 Hz (`FRAME_RATE = 12`) with `requestAnimationFrame` accumulator.
- **Data:** extracted Mac resource JSON in `web/data/` (`Race.json`, `Levels.json`) plus images/sounds under `web/data/Race.json_resources/` and `web/data/sounds/`.
- **Courses:** 10 original courses; level lookup wraps by default (see [How to add a level](./how-to/add-a-level.md)).
