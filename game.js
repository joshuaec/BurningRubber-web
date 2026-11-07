const WIDTH = 620;
const HEIGHT = 480;
const ROAD_BOTTOM = 462;
const FRAME_RATE = 12;
const OFFSET = 100;
const LEVEL_COUNT = 10;

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const menu = document.querySelector("#menu");
const pauseDialog = document.querySelector("#pause");
const gameOverDialog = document.querySelector("#game-over");
const policeDialog = document.querySelector("#police");
const errorBox = document.querySelector("#error");
const bestScoreLabel = document.querySelector("#best-score");
const soundButton = document.querySelector("#sound-toggle");

ctx.imageSmoothingEnabled = false;

const input = { left: false, right: false, accelerate: false, brake: false };
const images = new Map();
const sounds = new Map();
const state = {
  mode: "menu",
  level: 1,
  score: 0,
  lives: 3,
  bestScore: Number(localStorage.getItem("burning-rubber-best") || 0),
  lifeMilestone: 0,
  soundEnabled: true,
  lastTick: 0,
  accumulator: 0,
  error: "",
};

let raceResources;
let levelResources;
let current;
let engineAudio;
let loopHandle;
let uiHelp = false;
let uiLevels = false;

bestScoreLabel.textContent = String(state.bestScore);

function showError(message) {
  state.error = message;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status}).`);
  }
  return response.json();
}

function bytesOf(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("A game resource contains malformed hexadecimal data.");
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16));
}

function word(view, offset, signed = true) {
  if (offset + 2 > view.byteLength) {
    throw new Error("A game resource record is shorter than expected.");
  }
  return signed ? view.getInt16(offset, false) : view.getUint16(offset, false);
}

function dataView(hex) {
  const bytes = bytesOf(hex);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function requiredResource(table, id, type) {
  const resource = table[String(id)];
  if (!resource) {
    throw new Error(`Missing original ${type} resource ${id}.`);
  }
  return resource;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image ${url}.`));
    image.src = url;
  });
}

async function loadImages(table, baseUrl) {
  const entries = Object.entries(table ?? {});
  const results = await Promise.all(entries.map(async ([id, resource]) => {
    if (!resource.file) return;
    const image = await loadImage(new URL(`./Race.json_resources/${resource.file}`, baseUrl));
    images.set(`${resource.type ?? ""}:${id}`, image);
    images.set(id, image);
  }));
  return results;
}

function colorAt(view, offset) {
  const red = Math.round(word(view, offset, false) / 257);
  const green = Math.round(word(view, offset + 2, false) / 257);
  const blue = Math.round(word(view, offset + 4, false) / 257);
  return `rgb(${red} ${green} ${blue})`;
}

function parseInfo(id) {
  const view = dataView(requiredResource(levelResources.INFO, id, "INFO").data);
  const dataId = word(view, 0, false);
  const roadId = word(view, 2, false);
  const objectId = word(view, 4, false);
  const stopAt = word(view, 6, false);
  const bonus = word(view, 8, false);
  const nameLength = view.getUint8(10);
  const name = Array.from({ length: nameLength }, (_, index) =>
    String.fromCharCode(view.getUint8(11 + index))).join("");
  return { dataId, roadId, objectId, stopAt, bonus, name };
}

function parseRoad(id) {
  const view = dataView(requiredResource(raceResources.ROAD, id, "ROAD").data);
  return {
    roadPattern: word(view, 0, false),
    backPattern: word(view, 2, false),
    barrierPattern: word(view, 4, false),
    roadColor: colorAt(view, 8),
    backColor: colorAt(view, 16),
    barrierColor: colorAt(view, 24),
    flags: view.getUint8(36),
  };
}

function parseCar() {
  const view = dataView(requiredResource(raceResources["CAR "], 1000, "CAR ").data);
  return {
    baseIcon: word(view, 0, false),
    crash: word(view, 2, false),
    drawn: word(view, 4, false),
    maxSpeed: word(view, 6, false),
    acceleration: word(view, 8, false),
    brakes: word(view, 10, false),
    steering: word(view, 12, false),
    frames: word(view, 14, false),
    bumping: word(view, 16, false),
    offRoad: word(view, 18, false),
    weight: word(view, 20, false),
  };
}

function parseObjectDefinition(id) {
  const view = dataView(requiredResource(raceResources.ODEF, id, "ODEF").data);
  return {
    icon: word(view, 0, false),
    ud: word(view, 2),
    lr: word(view, 4),
    brakes: word(view, 6),
    die: word(view, 8, false),
    flags: view.getUint8(10),
    width: word(view, 12),
    height: word(view, 14),
    weight: word(view, 16, false),
    crash: word(view, 18),
    jump: word(view, 20),
    score: word(view, 22, false),
  };
}

function bit(flags, index) {
  // Classic Mac BitTst uses bit 0 = MSB (0x80).
  return (flags & (0x80 >> index)) !== 0;
}

function parsePlacements(resource) {
  const view = dataView(resource.data);
  const placements = [];
  for (let offset = 0; offset + 6 <= view.byteLength; offset += 6) {
    const id = word(view, offset, false);
    if (id === 10000) break;
    placements.push({
      id,
      scroll: word(view, offset + 2),
      x: word(view, offset + 4),
      vx: 0,
      vz: 0,
      collected: false,
    });
  }
  return placements;
}

function parseRoadProfile(resource) {
  const view = dataView(resource.data);
  const profile = [];
  for (let offset = 0; offset + 8 <= view.byteLength; offset += 8) {
    profile.push([
      word(view, offset),
      word(view, offset + 2),
      word(view, offset + 4),
      word(view, offset + 6),
    ]);
  }
  return profile;
}

function parseCheckpoints(resource) {
  const view = dataView(resource.data);
  const checkpoints = [];
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 4) {
    const scroll = word(view, offset);
    const x = word(view, offset + 2);
    if (scroll === 32767) break;
    checkpoints.push({ scroll, x });
  }
  return checkpoints;
}

function parseAnimation(id) {
  const resource = requiredResource(raceResources.ANIM, id, "ANIM");
  const view = dataView(resource.data);
  const frames = [];
  for (let offset = 4; offset + 2 <= view.byteLength; offset += 2) {
    frames.push(word(view, offset));
  }
  return {
    sound: word(view, 2, false),
    frames,
  };
}

function currentLevelInfo(level) {
  const index = (level - 1) % LEVEL_COUNT;
  const infoId = index === 9 ? 999 : 1000 + index;
  return parseInfo(infoId);
}

function imageFor(type, id) {
  return images.get(`${type}:${id}`) ?? images.get(String(id));
}

function sprite(id, x, y, width, height) {
  const image = imageFor("cicn", id);
  if (image) ctx.drawImage(image, x, y, width, height);
}

function startLevel(level) {
  state.level = level;
  const info = currentLevelInfo(level);
  const road = parseRoad(info.roadId);
  const roadProfile = parseRoadProfile(requiredResource(levelResources.LEVL, info.dataId, "LEVL"));
  const placements = parsePlacements(requiredResource(levelResources.OBJS, info.objectId, "OBJS"));
  const checkpoints = parseCheckpoints(requiredResource(levelResources.RSET, info.dataId, "RSET"));
  const bonusPosition = 200 + Math.floor(Math.random() * Math.max(1, info.stopAt - 560));
  const bonusRow = roadProfile[Math.min(bonusPosition, roadProfile.length - 1)];
  const bonusLeft = bonusRow[2] !== bonusRow[1] && bonusRow[2] - bonusRow[1] > bonusRow[3] - bonusRow[2]
    ? bonusRow[0] + (bonusRow[1] - bonusRow[0]) / 2 - 16
    : bonusRow[0] + (bonusRow[3] - bonusRow[0]) / 2 - 12;

  current = {
    info,
    road,
    roadProfile,
    placements,
    checkpoints,
    car: parseCar(),
    scroll: 0,
    oldScroll: -240,
    x: WIDTH / 2 - 16,
    y: HEIGHT - OFFSET - 16,
    speed: 0,
    lateralSpeed: 0,
    direction: 0,
    jump: 0,
    maxJump: 0,
    wait: 45,
    bonus: Math.max(0, info.bonus - (level > 10 ? Math.floor(120 / Math.floor((level - 1) / 10)) : 0)),
    bonusPosition,
    bonusX: bonusLeft,
    multiplier: Math.floor(Math.random() * 3) + 1,
    deadTicks: 0,
    dead: false,
    gameOver: false,
    completedTicks: 0,
    animations: [],
    brakeSoundPlayed: false,
    frame: 0,
  };
  state.lastTick = 0;
  state.accumulator = 0;
  state.mode = "game";
  hideOverlays();
  unlockSound();
  requestFrame();
}

function hideOverlays() {
  menu.hidden = true;
  pauseDialog.hidden = true;
  gameOverDialog.hidden = true;
  errorBox.hidden = true;
}

function showMenu() {
  state.mode = "menu";
  for (const control of Object.keys(input)) input[control] = false;
  menu.hidden = false;
  pauseDialog.hidden = true;
  gameOverDialog.hidden = true;
  draw();
}

function startAnimation(id, rect) {
  if (id === 1) {
    playSound(1208);
    current.speed = 0;
    current.lateralSpeed = 0;
    return;
  }
  if (id === 0) id = bit(current.road.flags, 0) ? 1020 : 1021;
  const animationResource = raceResources.ANIM[String(id)];
  if (!animationResource) return;
  const animation = parseAnimation(id);
  if (!animation.frames.length) return;
  if (current.animations.length < 10) {
    current.animations.push({ ...animation, frame: 0, rect: { ...rect }, soundPlayed: true });
    playSound(animation.sound);
  }
}

function playSound(id) {
  if (!state.soundEnabled || !id || !sounds.has(id)) return;
  const audio = new Audio(sounds.get(id));
  audio.volume = 0.55;
  audio.play().catch(() => {});
}

function unlockSound() {
  if (!state.soundEnabled || !sounds.has(2000)) return;
  if (!engineAudio) {
    engineAudio = new Audio(sounds.get(2000));
    engineAudio.loop = true;
    engineAudio.volume = 0;
  }
  engineAudio.play().catch(() => {});
}

function updateEngineSound() {
  if (!engineAudio) return;
  const audible = state.mode === "game" && !current.dead && current.speed > 0;
  engineAudio.volume = audible && state.soundEnabled ? Math.min(0.35, 0.06 + current.speed / 150) : 0;
  engineAudio.playbackRate = Math.max(0.55, Math.min(2.4, 0.65 + current.speed / 30));
}

function roadAt(scroll) {
  const index = Math.max(0, Math.min(current.roadProfile.length - 1, Math.floor(scroll)));
  return current.roadProfile[index] ?? [0, 0, 0, WIDTH];
}

function checkSect(scroll, x, tolerance = 0) {
  const row = roadAt(scroll);
  if (!row) return { off: false, idea: 0 };
  const [left, innerLeft, innerRight, right] = row;
  if (left + tolerance >= x) return { off: true, idea: 1 };
  if (right - tolerance <= x) return { off: true, idea: -1 };
  if (innerLeft !== innerRight && innerLeft - tolerance <= x && innerRight + tolerance >= x) {
    return { off: true, idea: (x - innerLeft < innerRight - x) ? -1 : 1 };
  }
  return { off: false, idea: 0 };
}

function inRoad(x, scroll, tolerance = 0) {
  return !checkSect(scroll, x, tolerance).off;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function playerRect() {
  const grow = Math.floor(current.jump / 5);
  return {
    x: current.x - grow,
    y: current.y - grow,
    width: 32 + grow * 2,
    height: 32 + grow * 2,
  };
}

function loseLife(animationId = current.car.crash) {
  if (current.dead) return;
  current.dead = true;
  current.deadTicks = 20;
  current.speed = 0;
  current.lateralSpeed = 0;
  current.oldScroll = current.scroll;
  state.lives -= 1;
  current.gameOver = state.lives <= 0;
  if (animationId !== null) startAnimation(animationId, playerRect());
}

function respawn() {
  current.dead = false;
  if (current.bonus <= 0) current.bonus = 500;
  const checkpoint = [...current.checkpoints].reverse().find(item => item.scroll < current.scroll + OFFSET);
  if (checkpoint) {
    current.scroll = checkpoint.scroll;
    current.oldScroll = current.scroll - 480 + OFFSET;
    current.x = checkpoint.x;
  } else {
    current.scroll = 0;
    current.oldScroll = -480 - OFFSET;
    current.x = WIDTH / 2 - 16;
  }
}

function updateCar() {
  if (current.dead) {
    current.deadTicks -= 1;
    if (current.deadTicks <= 0) {
      if (current.gameOver) {
        finishGame();
        return;
      }
      respawn();
    }
    return;
  }

  const car = current.car;
  if (current.jump > 0) {
    if (current.jump < current.maxJump) current.jump += 2;
    else current.jump -= 2;
    if (current.jump <= 0) {
      current.jump = 0;
      current.maxJump = 0;
      playSound(1103);
    }
  }

  if (current.jump === 0) {
    if (input.left) current.lateralSpeed -= Math.round(current.speed / 50 * car.steering);
    if (input.right) current.lateralSpeed += Math.round(current.speed / 50 * car.steering);
    if (input.accelerate && current.wait === 0) {
      current.speed += current.speed > 8 ? car.acceleration : car.acceleration * 2;
    }
    if (input.brake) {
      if (current.speed > car.maxSpeed * 0.75 && !current.brakeSoundPlayed) playSound(1000);
      current.brakeSoundPlayed = true;
      if (current.speed >= car.brakes) current.speed -= car.brakes;
      current.lateralSpeed = Math.trunc(current.lateralSpeed / (car.brakes * 2));
    } else {
      current.brakeSoundPlayed = false;
    }

    if (current.speed > 0 && current.frame % 3 === 0) current.speed -= 1;
    if (current.speed < 0 && current.frame % 3 === 0) current.speed += 1;
    if (current.completedTicks > 0) current.speed = Math.max(0, current.speed - 5);
    current.speed = Math.min(car.maxSpeed, Math.max(-car.maxSpeed, current.speed));
    current.lateralSpeed = Math.max(-car.maxSpeed, Math.min(car.maxSpeed, current.lateralSpeed));
    if (current.lateralSpeed !== 0) current.lateralSpeed -= Math.sign(current.lateralSpeed);

    const rowIndex = current.scroll + OFFSET / 2;
    if (!inRoad(current.x, rowIndex, 7)) {
      if (current.completedTicks === 0
        && bit(current.road.flags, 0)
        && !inRoad(current.x + 16, rowIndex, -16)) {
        loseLife(current.car.crash);
        return;
      }
      if (current.completedTicks === 0
        && bit(current.road.flags, 1)
        && !inRoad(current.x + 16, rowIndex, -16)) {
        loseLife(current.car.drawn);
        return;
      }
      if (bit(current.road.flags, 2)) {
        if (current.speed > 16 * (car.offRoad / 100)) current.speed -= car.acceleration * 3;
        if (Math.abs(current.lateralSpeed) > 8 * (car.offRoad / 100)) {
          current.lateralSpeed -= car.acceleration * 3 * Math.sign(current.lateralSpeed);
        }
      }
    }
  }

  current.scroll += Math.trunc(current.speed / 2);
  current.x += current.lateralSpeed;
  current.direction = current.speed !== 0
    ? Math.round((current.lateralSpeed / current.speed) * 6)
    : 0;
  current.direction = Math.max(-car.frames, Math.min(car.frames, current.direction));

  if (current.scroll + OFFSET / 2 > current.info.stopAt && current.completedTicks === 0) {
    current.completedTicks = 1;
    playSound(1104);
  }
}

function objectRect(item, def) {
  return {
    x: item.x,
    y: HEIGHT - 2 * (item.scroll - current.scroll),
    width: Math.max(1, 32 + def.width),
    height: Math.max(1, 32 + def.height),
  };
}

function navigateObject(item, def) {
  // Pascal doNvgte: look ahead along road and steer away from boundaries (flag 3).
  const aheadSign = def.ud > 0 ? 1 : -1;
  const start = def.ud > 0 ? 2 : -2;
  const end = def.ud > 0 ? 25 : -25;
  const step = def.ud > 0 ? 1 : -1;
  const probeX = item.x + (32 + def.width) / 2;
  for (let y = start; def.ud > 0 ? y <= end : y >= end; y += step) {
    const probeScroll = item.scroll + y * 4 - (32 + def.height) / 2;
    const hit = checkSect(probeScroll, probeX, 22);
    if (hit.off) {
      const mag = Math.abs(def.ud);
      item.vx = hit.idea * (Math.abs(y) > 22 ? mag / 2 : mag);
      return;
    }
  }
}

function avoidNearbyObjects(item, def, index) {
  // Reduce NPC-NPC crashes by default (user-requested behavior): solid moving
  // objects steer apart unless recently forced by the player.
  if (!bit(def.flags, 4) || item.playerForced > 0) return;
  for (let j = 0; j < current.placements.length; j += 1) {
    if (j === index) continue;
    const other = current.placements[j];
    if (other.collected || other.playerForced > 0) continue;
    if (Math.abs(other.scroll - item.scroll) > 120) continue;
    const odef = parseObjectDefinition(other.id);
    if (!bit(odef.flags, 4)) continue;
    const dz = other.scroll - item.scroll;
    const dx = (other.x + odef.width / 2) - (item.x + def.width / 2);
    const closing = def.ud >= 0 ? (dz > -8 && dz < 90) : (dz < 8 && dz > -90);
    if (!closing || Math.abs(dx) > 44) continue;
    item.vx += dx <= 0 ? 2 : -2;
    item.vx = Math.max(-Math.max(8, Math.abs(def.ud) * 2), Math.min(Math.max(8, Math.abs(def.ud) * 2), item.vx));
  }
}

function updateObjects() {
  if (current.completedTicks > 0) return;
  const player = playerRect();
  const rowScroll = current.scroll + OFFSET / 2;

  // Reactive NPC-NPC collisions (Pascal ObjTouch), but soften unless forced by player.
  for (let i = 0; i < current.placements.length; i += 1) {
    const a = current.placements[i];
    if (a.collected || Math.abs(a.scroll - current.scroll) > 260) continue;
    const adef = parseObjectDefinition(a.id);
    if (!bit(adef.flags, 4)) continue;
    const arect = objectRect(a, adef);
    for (let j = i + 1; j < current.placements.length; j += 1) {
      const b = current.placements[j];
      if (b.collected || Math.abs(b.scroll - current.scroll) > 260) continue;
      const bdef = parseObjectDefinition(b.id);
      if (!bit(bdef.flags, 4) || !overlaps(arect, objectRect(b, bdef))) continue;
      playSound(1108);
      if (a.playerForced > 0 || b.playerForced > 0) {
        const avz = a.vz, avx = a.vx, bvz = b.vz, bvx = b.vx;
        const am = Math.max(1, adef.weight) / 100;
        const bm = Math.max(1, bdef.weight) / 100;
        a.vz = Math.round(bvz * bm / am);
        a.vx = Math.round(bvx * bm / am);
        b.vz = Math.round(avz * am / bm);
        b.vx = Math.round(avx * am / bm);
      } else {
        const sep = (a.x <= b.x) ? -1 : 1;
        a.vx += sep * 2;
        b.vx -= sep * 2;
        a.scroll -= Math.sign(a.vz || 1);
        b.scroll += Math.sign(b.vz || 1);
      }
    }
  }

  for (let i = 0; i < current.placements.length; i += 1) {
    const item = current.placements[i];
    if (item.collected || Math.abs(item.scroll - current.scroll) > 500) continue;
    if (item.playerForced > 0) item.playerForced -= 1;
    const def = parseObjectDefinition(item.id);

    item.x += item.vx;
    item.scroll += item.vz;

    if (def.die === 1) {
      if (item.scroll < rowScroll && item.vz < 16) item.vz += 1;
      if (item.scroll > rowScroll && item.vz > 8) item.vz -= 3;
      item.vz = Math.max(9, item.vz);
      item.vx = item.x < current.x ? item.vz / 2 : -item.vz / 2;
    } else {
      if (item.vx < def.lr) item.vx += 1;
      if (item.vx > def.lr) item.vx -= 1;
      if (item.vz < def.ud) item.vz += 1;
      if (item.vz > def.ud) item.vz -= 1;
      if (bit(def.flags, 3)) navigateObject(item, def);
      avoidNearbyObjects(item, def, i);
    }

    const rect = objectRect(item, def);

    // Pascal BackCrash: only flag 7 objects crash on road boundaries; check LR (tolerance 0).
    if (bit(def.flags, 7) && checkSect(item.scroll, item.x, 0).off) {
      startAnimation(def.die, rect);
      item.collected = true;
      state.score += def.score;
      continue;
    }

    if (!current.dead && current.jump === 0 && overlaps(rect, player)) {
      if (!current.policePaid && (item.id === 1042 || def.die === 1)) {
        state.mode = "police";
        policeDialog.hidden = false;
        playSound(1208);
        current.speed = 0;
        current.lateralSpeed = 0;
        return;
      }
      if (bit(def.flags, 4)) {
        item.playerForced = 18; // allow player to force NPC collisions/crashes
        const oldPlayerSpeed = current.speed;
        const oldPlayerLateral = current.lateralSpeed;
        const oldItemVz = item.vz;
        const oldItemVx = item.vx;
        const objectMass = Math.max(1, def.weight) / 100;
        const playerMass = Math.max(1, current.car.bumping) / 100;
        if (Math.abs(oldPlayerSpeed - oldItemVz) > Math.abs(oldPlayerLateral - oldItemVx) * 2) {
          if (oldItemVz < oldPlayerSpeed) item.scroll += 32;
          else item.scroll -= 32;
        } else {
          if (oldItemVx < oldPlayerLateral) item.x += 32;
          else item.x -= 32;
        }
        item.vz = Math.round(oldPlayerSpeed * playerMass / objectMass);
        item.vx = Math.round(oldPlayerLateral * playerMass / objectMass);
        current.speed = Math.round(oldItemVz * objectMass / playerMass);
        current.lateralSpeed = Math.round(oldItemVx * objectMass / playerMass);
        current.speed -= (current.speed - oldPlayerSpeed) / 4;
        current.lateralSpeed -= (current.lateralSpeed - oldPlayerLateral) / 4;
        playSound(1102); // bump/collision contact; crash/explosion handled by lethal/crash paths
      }
      if (def.brakes !== 0 && current.speed > def.brakes * current.car.offRoad / 100) {
        current.speed = def.brakes * current.car.offRoad / 100;
        current.lateralSpeed = Math.trunc(current.lateralSpeed / 2);
      }
      if (bit(def.flags, 1)) {
        startAnimation(def.die, rect);
        item.collected = true;
        state.score += def.score;
      }
      if (bit(def.flags, 0) && Math.sign(def.crash || 1) * current.speed > item.vz + def.crash) {
        loseLife();
        return;
      }
      if (bit(def.flags, 6)) {
        current.maxJump = Math.floor(current.speed * def.jump / 100);
        if (current.maxJump > 0) current.jump = 1;
      }
    }
  }
}

function updateBonus() {
  if (current.bonusPosition < 0 || current.wait !== 0) return;
  if (current.scroll + 480 < current.bonusPosition) return;
  const bonus = {
    x: current.bonusX - 5,
    y: HEIGHT - (current.bonusPosition - current.scroll) * 2 - 5,
    width: 34,
    height: 34,
  };
  if (overlaps(bonus, playerRect())) {
    current.bonusPosition = -1000;
    current.multiplier = -current.multiplier;
    playSound(1107);
  }
}

function updateAnimations() {
  for (const animation of current.animations) {
    while (animation.frame < animation.frames.length && animation.frames[animation.frame] < 1000) {
      animation.frame += 2;
    }
    if (animation.frame >= animation.frames.length) {
      animation.finished = true;
      continue;
    }
    animation.drawFrame = animation.frames[animation.frame];
    animation.drawRect = { ...animation.rect };
    animation.frame += 1;
    animation.rect.y += current.speed;
  }
  current.animations = current.animations.filter(animation => !animation.finished);
}

function updateGame() {
  if (state.mode !== "game") return;
  current.frame += 1;
  if (current.completedTicks > 0) {
    if (current.completedTicks > 12 && current.bonus > 0) {
      const points = Math.min(15, current.bonus);
      current.bonus -= points;
      state.score += points * (current.multiplier < 0 ? Math.abs(current.multiplier) + 1 : 1);
    }
    current.completedTicks += 1;
    if (current.completedTicks > 85 && current.bonus <= 0) {
      startLevel(state.level + 1);
      return;
    }
  } else {
    updateObjects();
    updateBonus();
  }

  updateCar();
  if (state.mode !== "game") return;
  if (current.wait > 0) {
    if (current.wait > 1 && current.wait <= 38 && (current.wait + 2) % 10 === 0) playSound(1100);
    if (current.wait === 1) playSound(1101);
    current.wait -= 1;
  }
  else if (!current.dead && current.completedTicks === 0) {
    current.bonus -= 1;
    if (current.bonus <= 0) {
      playSound(1020);
      loseLife(null);
    }
  }

  const milestone = Math.floor(state.score / 2000);
  if (milestone > state.lifeMilestone) {
    state.lives += milestone - state.lifeMilestone;
    state.lifeMilestone = milestone;
    playSound(1500);
  }
  updateAnimations();
  updateEngineSound();
}

function drawBackground() {
  const image = imageFor("ppat", current.road.backPattern);
  if (image) {
    const pattern = ctx.createPattern(image, "repeat");
    ctx.fillStyle = pattern ?? current.road.backColor;
  } else {
    ctx.fillStyle = current.road.backColor;
  }
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawRoad() {
  if (bit(current.road.flags, 3)) return;
  ctx.fillStyle = current.road.roadColor;
  for (let y = 0; y < ROAD_BOTTOM; y += 2) {
    const index = Math.floor(current.scroll + (HEIGHT - y) / 2);
    const row = current.roadProfile[index];
    if (!row) continue;
    const [left, innerLeft, innerRight, right] = row;
    if (innerLeft === innerRight) {
      ctx.fillRect(left, y, right - left, 2);
    } else {
      ctx.fillRect(left, y, innerLeft - left, 2);
      ctx.fillRect(innerRight, y, right - innerRight, 2);
    }
  }
}

function drawObjects() {
  const objects = current.placements
    .filter(item => !item.collected && Math.abs(item.scroll - current.scroll) < 230)
    .sort((a, b) => b.scroll - a.scroll);
  for (const item of objects) {
    const def = parseObjectDefinition(item.id);
    const width = Math.max(1, 32 + def.width);
    const height = Math.max(1, 32 + def.height);
    const y = HEIGHT - 2 * (item.scroll - current.scroll);
    sprite(def.icon, item.x, y, width, height);
  }
}

function drawCar() {
  if (current.dead) return;
  const player = playerRect();
  sprite(current.car.baseIcon + current.direction, player.x, player.y, player.width, player.height);
}

function drawBonus() {
  if (current.bonusPosition < 0 || current.wait !== 0) return;
  const y = HEIGHT - (current.bonusPosition - current.scroll) * 2;
  if (y < -40 || y > HEIGHT) return;
  // Pascal draws 1030 + multiBonus (1-3) for the on-level pickup.
  const spriteId = 1030 + Math.abs(current.multiplier);
  sprite(spriteId, current.bonusX, y, 24, 24);
}

function drawAnimations() {
  for (const animation of current.animations) {
    if (animation.drawFrame >= 1000 && animation.drawRect) {
      const { x, y, width, height } = animation.drawRect;
      sprite(animation.drawFrame, x, y, width, height);
    }
  }
}

function drawGauge() {
  const speed = Math.max(0, current.speed - Math.abs(current.lateralSpeed) / 5);
  const max = Math.max(1, current.car.maxSpeed);
  const ratio = Math.max(0, Math.min(1, speed / max));
  const x = 14;
  const y = 458;
  const w = 72;
  const h = 10;

  ctx.font = "bold 11px 'Courier New', monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffeb34";
  ctx.fillText("MPH", x, y + h / 2);

  const barX = x + 34;
  ctx.fillStyle = "#1b1d17";
  ctx.fillRect(barX, y, w, h);
  ctx.strokeStyle = "#a9aaa0";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, y + 0.5, w - 1, h - 1);
  if (ratio > 0) {
    ctx.fillStyle = speed > max * 0.85 ? "#ff7a3a" : "#7dff5a";
    ctx.fillRect(barX + 1, y + 1, Math.max(0, Math.floor((w - 2) * ratio)), h - 2);
  }
}

function drawHud() {
  const strip = imageFor("cicn", 1000);
  if (strip) ctx.drawImage(strip, 100, 448, 520, 32);

  // Bottom-left panel for speedometer bar.
  ctx.fillStyle = "#090a09";
  ctx.beginPath();
  ctx.roundRect(8, 450, 120, 26, 6);
  ctx.fill();
  ctx.strokeStyle = "#a9aaa0";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#090a09";
  ctx.beginPath();
  ctx.roundRect(310, 452, 300, 27, 13);
  ctx.fill();
  ctx.strokeStyle = "#a9aaa0";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawGauge();

  ctx.font = "bold 12px 'Courier New', monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffeb34";
  ctx.fillText(`LIVES:${state.lives}`, 326, 466);
  ctx.fillText(`TIME:${Math.max(0, current.bonus)}`, 405, 466);
  if (current.multiplier < 0) {
    // Pascal HUD indicator uses 1040 + abs(multiBonus).
    sprite(1040 + Math.abs(current.multiplier), 486, 458, 18, 18);
  }
  ctx.fillText(`SCORE:${state.score}`, 508, 466);
}

function drawMessages() {
  if (current.wait > 38) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 27px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LEVEL ${state.level}`, WIDTH / 2, 185);
    ctx.font = "bold 17px 'Courier New', monospace";
    ctx.fillText(current.info.name, WIDTH / 2, 220);
    ctx.textAlign = "left";
  } else if (current.wait > 0) {
    ctx.fillStyle = "#ffe64a";
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(Math.min(3, Math.ceil(current.wait / 10))), WIDTH / 2, 200);
    ctx.textAlign = "left";
  }
  if (current.completedTicks > 0) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("STAGE COMPLETE", WIDTH / 2, 190);
    ctx.font = "16px 'Courier New', monospace";
    ctx.fillText(`BONUS ${Math.max(0, current.bonus)}`, WIDTH / 2, 222);
    ctx.textAlign = "left";
  } else if (current.bonus <= 0 && !current.dead) {
    ctx.fillStyle = "#ffdc33";
    ctx.font = "bold 21px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("TIME IS UP", WIDTH / 2, 210);
    ctx.textAlign = "left";
  }
}

function drawTitle() {
  ctx.fillStyle = "#050705";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const title = imageFor("PICT", 2010);
  if (title) ctx.drawImage(title, WIDTH / 2 - 100, 105, 200, 92);
  ctx.fillStyle = "#192116";
  ctx.fillRect(80, 260, 460, 110);
  ctx.strokeStyle = "#b09c25";
  ctx.strokeRect(80.5, 260.5, 459, 109);
  ctx.fillStyle = "#d4d7ba";
  ctx.font = "14px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText("ORIGINAL CLASSIC MACINTOSH RACING", WIDTH / 2, 292);
  ctx.fillStyle = "#f4e05a";
  ctx.font = "bold 20px 'Courier New', monospace";
  ctx.fillText("10 COURSES · ONE LIFE AT A TIME", WIDTH / 2, 331);
  ctx.textAlign = "left";
}

function draw() {
  if (state.mode === "menu" || !current) {
    // Home/start uses the HTML overlay; keep canvas empty to avoid overlap.
    ctx.fillStyle = "#050705";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }
  drawBackground();
  drawRoad();
  drawObjects();
  drawBonus();
  drawAnimations();
  drawCar();
  drawHud();
  drawMessages();
}

function requestFrame() {
  if (loopHandle) return;
  loopHandle = requestAnimationFrame(frame);
}

function frame(timestamp) {
  loopHandle = undefined;
  if (!state.lastTick) state.lastTick = timestamp;
  state.accumulator += Math.min(250, timestamp - state.lastTick);
  state.lastTick = timestamp;
  const step = 1000 / FRAME_RATE;
  while (state.accumulator >= step) {
    updateGame();
    state.accumulator -= step;
  }
  draw();
  if (state.mode === "game") requestFrame();
}

function finishGame() {
  state.mode = "game-over";
  state.bestScore = Math.max(state.bestScore, state.score);
  localStorage.setItem("burning-rubber-best", String(state.bestScore));
  bestScoreLabel.textContent = String(state.bestScore);
  document.querySelector("#final-score").textContent = `Final score: ${state.score}`;
  gameOverDialog.hidden = false;
  if (engineAudio) engineAudio.pause();
}

function pauseGame() {
  if (state.mode !== "game") return;
  state.mode = "paused";
  pauseDialog.hidden = false;
  if (engineAudio) engineAudio.volume = 0;
}

function resumeGame() {
  if (state.mode !== "paused") return;
  pauseDialog.hidden = true;
  state.mode = "game";
  state.lastTick = 0;
  requestFrame();
}

function setControl(control, pressed) {
  if (Object.hasOwn(input, control)) input[control] = pressed;
}

document.addEventListener("keydown", event => {
  const keys = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "accelerate",
    KeyW: "accelerate",
    Space: "accelerate",
    ArrowDown: "brake",
    KeyS: "brake",
    ControlLeft: "brake",
    ControlRight: "brake",
  };
  if (keys[event.code]) {
    event.preventDefault();
    setControl(keys[event.code], true);
  }
  if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat) {
    event.preventDefault();
    if (state.mode === "game") pauseGame();
    else if (state.mode === "paused") resumeGame();
  }
});

document.addEventListener("keyup", event => {
  const keys = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "accelerate",
    KeyW: "accelerate",
    Space: "accelerate",
    ArrowDown: "brake",
    KeyS: "brake",
    ControlLeft: "brake",
    ControlRight: "brake",
  };
  if (keys[event.code]) setControl(keys[event.code], false);
});

document.querySelectorAll("[data-control]").forEach(button => {
  const control = button.dataset.control;
  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setControl(control, true);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(eventName, () => setControl(control, false));
  }
});

document.querySelector("#start").addEventListener("click", () => {
  state.score = 0;
  state.lives = 3;
  state.lifeMilestone = 0;
  startLevel(1);
});
document.querySelector("#choose-level").addEventListener("click", () => {
  uiLevels = !uiLevels;
  const list = document.querySelector("#level-list");
  list.hidden = !uiLevels;
  list.replaceChildren();
  if (uiLevels) {
    for (let index = 0; index < LEVEL_COUNT; index += 1) {
      const level = index + 1;
      const button = document.createElement("button");
      button.textContent = `${level}. ${currentLevelInfo(level).name}`;
      button.addEventListener("click", () => {
        state.score = 0;
        state.lives = 3;
        state.lifeMilestone = 0;
        startLevel(level);
      });
      list.append(button);
    }
  }
});
document.querySelector("#help").addEventListener("click", () => {
  uiHelp = !uiHelp;
  const help = document.querySelector("#help-copy");
  help.hidden = !uiHelp;
  help.textContent = uiHelp
    ? "Steer with ← / → or A / D. Hold ↑ / W / Space to accelerate; ↓ / S to brake. Stay on the road, avoid traffic and hazards, collect the flashing bonus, and reach the finish before time runs out. P or Esc pauses."
    : "";
});
soundButton.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  soundButton.textContent = `Sound: ${state.soundEnabled ? "on" : "off"}`;
  soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
  if (!state.soundEnabled && engineAudio) engineAudio.volume = 0;
  else unlockSound();
});
document.querySelector("#resume").addEventListener("click", resumeGame);
document.querySelector("#quit-to-menu").addEventListener("click", showMenu);
document.querySelector("#play-again").addEventListener("click", () => {
  state.score = 0;
  state.lives = 3;
  state.lifeMilestone = 0;
  startLevel(1);
});
document.querySelector("#game-over-menu").addEventListener("click", showMenu);
function resumeFromPolice() {
  policeDialog.hidden = true;
  state.mode = "game";
  state.lastTick = 0;
  state.accumulator = 0;
  unlockSound();
  requestFrame();
}

document.querySelector("#police-pay").addEventListener("click", () => {
  state.score = Math.max(0, state.score - 500);
  if (current) {
    current.policePaid = true;
    for (const item of current.placements) {
      if (item.id === 1042 || parseObjectDefinition(item.id).die === 1) {
        item.collected = true;
      }
    }
  }
  resumeFromPolice();
});
document.querySelector("#police-run").addEventListener("click", () => {
  // "Don't pay" is risky: significantly higher chance of being caught.
  if (Math.random() < 0.35) {
    policeDialog.hidden = true;
    state.mode = "game";
    state.lastTick = 0;
    state.accumulator = 0;
    loseLife();
    playSound(1207);
    requestFrame();
  } else {
    resumeFromPolice();
  }
});

async function loadGame() {
  try {
    const raceUrl = new URL("./data/Race.json", import.meta.url);
    const levelsUrl = new URL("./data/Levels.json", import.meta.url);
    [raceResources, levelResources] = await Promise.all([
      fetchJson(raceUrl),
      fetchJson(levelsUrl),
    ]);
    const imageTables = ["cicn", "ppat", "PICT"].map(type => {
      const table = raceResources[type] ?? {};
      return Object.fromEntries(Object.entries(table).map(([id, resource]) => [id, { ...resource, type }]));
    });
    await Promise.all(imageTables.map(table => loadImages(table, raceUrl)));
    for (const id of Object.keys(raceResources["snd "] ?? {})) {
      sounds.set(Number(id), new URL(`./data/sounds/${id}.wav`, import.meta.url).href);
    }
    if (!imageFor("PICT", 2010)) throw new Error("The original title artwork could not be loaded.");
    document.querySelector("#start").disabled = false;
    menu.hidden = false;
    draw();
  } catch (error) {
    showError(`The game could not start: ${error.message}`);
    document.querySelector("#start").disabled = true;
  }
}

document.querySelector("#start").disabled = true;
loadGame();
