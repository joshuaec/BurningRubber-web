# Burning Rubber in a browser

This is a static browser port of the MIT-licensed 1995 Pascal game created by Jonas Echterhoff. It reads the original level, road, car, object, animation, sprite, and sound resources bundled in `data/` and runs at the original 620 × 480 playfield resolution.

## AI disclaimer

This was built with a combination of free AI harnesses / models. Primarily GPT-6 Luna via GitHub Copilot Free tier.

## How this came to be

Burning Rubber was one of my favourite games as a kid, I played it a lot on my Macintosh Performa 6200. I really wanted an easy way to play it again on modern hardware.

In 2019, Jonas released his source code to GitHub, making this recreation possible.

I originally started with a port of the Pascal code to Unity but I wasn't very happy with the results, it works and offers a way to build for various platform targets but it is bloated and Unity is heavy for a basic game like this.

So then I tried this JavaScript version, which is loosely based off the Pascal source code.

## Run locally

From the `BurningRubber` source repository root, start any static file server.
For example:

```sh
python3 -m http.server 8000 --directory web
```

Then open <http://localhost:8000>. The page must be served over HTTP rather
than opened as a `file:` URL because it fetches the resource data as JSON.

## Controls

- **Left / Right** or **A / D**: steer
- **Up**, **W**, or **Space**: accelerate
- **Down** or **S**: brake
- **P** or **Escape**: pause or resume

Touch controls are shown on touch devices. The game uses a fixed 12 Hz
simulation to match the original frame pacing; rendering scales responsively.
The original AIFF-C effects are retained in the extracted resources and
converted to WAV for browser playback.

## Known issues

- Screens / UI does not match the original
- Speedometer gauge was problematic to recreate with AI models, so a more basic speedometer bar is displayed instead
- Traffic light does not show at start of a level
- Score counting sounds do not play and the stage complete screen appearance is different to the original game
- Probably a couple of difference in sounds to the original game
- Probably some more tweaking that could be done to the collision physics to improve playability
- Testing mainly done in Firefox on macOS, other browsers may exhibit other bugs