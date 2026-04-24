import { prepareWithSegments } from "./pretext.js";

const PHYSICS = {
  damping: 0.97,
  gravity: 0.22,
  iterations: 12,
  constraintStretch: 1.2,
  unlockThreshold: 1,
  bounce: 0.4,
  collisionRadius: 7,
  fixedStep: 1 / 120,
  maxFrame: 1 / 20,
  tailUnlockCount: 6,
  tailSagStep: 3.5
};

const TEXT_STYLE_KEYS = [
  "font",
  "color",
  "fontKerning",
  "fontFeatureSettings",
  "fontVariationSettings",
  "fontVariantLigatures",
  "fontVariantCaps",
  "fontStretch",
  "fontStyle",
  "fontWeight",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textRendering",
  "textDecorationLine",
  "textDecorationColor",
  "textDecorationStyle",
  "textDecorationThickness",
  "textUnderlineOffset",
  "textDecorationSkipInk",
  "textShadow",
  "opacity"
];

function boot() {
  const main = document.querySelector("main[data-puzzle-stage]");
  const trigger = document.querySelector("[data-puzzle-trigger]");
  const target = document.querySelector("[data-puzzle-linkedin]");
  const glyphLayer = document.querySelector("[data-puzzle-glyph-layer]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const walls = document.querySelector("[data-puzzle-walls]");

  if (!main || !trigger || !target || !glyphLayer || !resetButton || !walls) {
    return;
  }

  const measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) {
    return;
  }

  const state = {
    main,
    trigger,
    target,
    glyphLayer,
    resetButton,
    walls,
    measureCtx,
    stage: "static",
    scene: null,
    prepared: false,
    running: false,
    rafId: 0,
    accumulator: 0,
    lastTime: -1,
    drags: new Map(),
    sourceOpacity: target.style.opacity || ""
  };

  bindEvents(state);
  installPointerDelegation(state);
  prepareWhenReady(state);
}

function bindEvents(state) {
  state.trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.stage !== "static") {
      return;
    }
    armPuzzle(state);
  });

  state.target.addEventListener("click", async (event) => {
    if (state.stage !== "armed") {
      return;
    }
    event.preventDefault();
    await activatePuzzle(state);
  });

  state.resetButton.addEventListener("click", () => resetPuzzle(state));
  window.addEventListener("resize", () => refreshScene(state));
  window.addEventListener("scroll", () => refreshScene(state), { passive: true });
}

async function prepareWhenReady(state) {
  await waitForFonts();
  prepareScene(state);
}

function armPuzzle(state) {
  state.stage = "armed";
  state.main.dataset.puzzleStage = "armed";
  state.resetButton.hidden = false;
}

async function activatePuzzle(state) {
  await waitForFonts();
  if (!state.prepared) {
    prepareScene(state);
  }
  if (!state.scene) {
    return;
  }

  state.stage = "active";
  state.main.dataset.puzzleStage = "active";
  unlockTail(state.scene);
  syncScene(state.scene);
  startLoop(state);
}

function resetPuzzle(state) {
  stopLoop(state);
  clearDrags(state);
  state.stage = "static";
  state.main.dataset.puzzleStage = "static";
  state.resetButton.hidden = true;

  if (!state.scene) {
    return;
  }

  for (const letter of state.scene.letters) {
    letter.locked = true;
    letter.x = letter.ox;
    letter.y = letter.oy;
    letter.px = letter.ox;
    letter.py = letter.oy;
    setLetterInteractive(letter, false);
  }
  syncScene(state.scene);
}

function prepareScene(state) {
  const previous = state.scene;
  clearScene(state);

  const scene = buildScene(state.target, state.glyphLayer, state.measureCtx);
  if (!scene) {
    state.target.style.opacity = state.sourceOpacity;
    state.prepared = false;
    return;
  }

  state.scene = scene;
  state.prepared = true;
  state.glyphLayer.hidden = false;
  state.target.style.opacity = "0";

  for (const letter of scene.letters) {
    attachDragListeners(letter, state);
  }

  if (previous) {
    carrySceneState(scene, previous);
  }

  syncScene(scene);
}

function refreshScene(state) {
  if (!state.prepared && state.stage === "static") {
    return;
  }

  const previous = state.scene;
  prepareScene(state);
  if (!state.scene || !previous) {
    return;
  }

  if (state.stage === "active") {
    const unlockedStart = state.scene.letters.length - Math.min(PHYSICS.tailUnlockCount, state.scene.letters.length - 1);
    for (let index = unlockedStart; index < state.scene.letters.length; index += 1) {
      setLetterInteractive(state.scene.letters[index], true);
    }
  }
}

function clearScene(state) {
  if (state.scene) {
    clearDrags(state);
  }
  state.glyphLayer.textContent = "";
  state.scene = null;
}

function buildScene(element, glyphLayer, measureCtx) {
  const text = element.textContent || "";
  if (!text.trim()) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const style = getComputedStyle(element);
  const font = style.font;
  measureCtx.font = font;

  const prepared = prepareWithSegments(text, font);
  const graphemes = explodePreparedGlyphs(prepared, measureCtx);
  if (graphemes.length < 2) {
    return null;
  }

  const totalWidth = graphemes.reduce((sum, glyph) => sum + glyph.w, 0);
  const startX = rect.left + (rect.width - totalWidth) / 2;
  const startY = rect.top + (rect.height - rect.height) / 2;
  const lineHeight = parseFloat(style.lineHeight) || rect.height;

  let cursorX = startX;
  const letters = graphemes.map((glyph, index) => {
    const letter = {
      index,
      ch: glyph.text,
      w: glyph.w,
      h: rect.height,
      x: cursorX,
      y: startY,
      ox: cursorX,
      oy: startY,
      px: cursorX,
      py: startY,
      locked: true,
      el: createGlyphElement(glyph.text, glyph.w, rect.height, pickTextStyles(style), glyphLayer)
    };
    cursorX += glyph.w;
    return letter;
  });

  const restLengths = [];
  for (let index = 0; index < letters.length - 1; index += 1) {
    const a = letters[index];
    const b = letters[index + 1];
    const dist = Math.hypot((b.ox + b.w / 2) - (a.ox + a.w / 2), (b.oy + lineHeight / 2) - (a.oy + lineHeight / 2));
    restLengths.push(dist * PHYSICS.constraintStretch);
  }

  return {
    letters,
    restLengths,
    lineHeight,
    style
  };
}

function carrySceneState(nextScene, previousScene) {
  for (let index = 0; index < nextScene.letters.length; index += 1) {
    const next = nextScene.letters[index];
    const prev = previousScene.letters[index];
    if (!next || !prev) {
      continue;
    }

    next.locked = prev.locked;
    if (prev.locked) {
      continue;
    }

    const dx = next.ox - prev.ox;
    const dy = next.oy - prev.oy;
    next.x = prev.x + dx;
    next.y = prev.y + dy;
    next.px = prev.px + dx;
    next.py = prev.py + dy;
    setLetterInteractive(next, true);
  }
}

function createGlyphElement(text, width, height, styles, glyphLayer) {
  const span = document.createElement("span");
  span.className = "puzzle-glyph";
  span.textContent = text;
  span.style.width = `${width}px`;
  span.style.height = `${height}px`;
  applyTextStyles(span, styles);
  glyphLayer.appendChild(span);
  return span;
}

function unlockTail(scene) {
  const { letters } = scene;
  const unlockCount = Math.min(PHYSICS.tailUnlockCount, Math.max(1, letters.length - 1));
  const start = letters.length - unlockCount;

  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index];
    if (index < start) {
      letter.locked = true;
      setLetterInteractive(letter, false);
      continue;
    }

    const sag = (index - start + 1) * PHYSICS.tailSagStep;
    letter.locked = false;
    letter.x = letter.ox;
    letter.y = letter.oy + sag;
    letter.px = letter.ox;
    letter.py = letter.y - Math.max(1, sag * 0.85);
    setLetterInteractive(letter, true);
  }
}

function setLetterInteractive(letter, interactive) {
  letter.el.classList.toggle("draggable", interactive);
  if (!interactive) {
    letter.el.classList.remove("dragging");
  }
}

function startLoop(state) {
  if (state.running) {
    return;
  }
  state.running = true;
  state.lastTime = -1;
  state.accumulator = 0;
  state.rafId = requestAnimationFrame((time) => tick(state, time));
}

function stopLoop(state) {
  if (!state.running) {
    return;
  }
  cancelAnimationFrame(state.rafId);
  state.running = false;
}

function tick(state, now) {
  if (!state.running || state.stage !== "active" || !state.scene) {
    return;
  }

  if (state.lastTime < 0) {
    state.lastTime = now;
    state.rafId = requestAnimationFrame((time) => tick(state, time));
    return;
  }

  const frameDt = Math.min((now - state.lastTime) / 1000, PHYSICS.maxFrame);
  state.lastTime = now;
  state.accumulator += frameDt;

  while (state.accumulator >= PHYSICS.fixedStep) {
    simulate(state);
    state.accumulator -= PHYSICS.fixedStep;
  }

  syncScene(state.scene);
  state.rafId = requestAnimationFrame((time) => tick(state, time));
}

function simulate(state) {
  const { letters, restLengths, lineHeight } = state.scene;
  const draggedIndexes = new Set([...state.drags.values()].map((drag) => drag.idx));

  for (let index = letters.length - 2; index >= 0; index -= 1) {
    const current = letters[index];
    const next = letters[index + 1];
    if (!current.locked || next.locked) {
      continue;
    }
    const dx = (next.x + next.w / 2) - (current.ox + current.w / 2);
    const dy = (next.y + lineHeight / 2) - (current.oy + lineHeight / 2);
    const dist = Math.hypot(dx, dy);
    if (dist <= restLengths[index] + PHYSICS.unlockThreshold) {
      continue;
    }
    current.locked = false;
    current.px = current.x;
    current.py = current.y - 1;
    setLetterInteractive(current, true);
  }

  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index];
    if (letter.locked || draggedIndexes.has(index)) {
      continue;
    }
    const vx = (letter.x - letter.px) * PHYSICS.damping;
    const vy = (letter.y - letter.py) * PHYSICS.damping;
    letter.px = letter.x;
    letter.py = letter.y;
    letter.x += vx;
    letter.y += vy + PHYSICS.gravity;
  }

  for (let iter = 0; iter < PHYSICS.iterations; iter += 1) {
    for (let index = 0; index < letters.length - 1; index += 1) {
      solveDistance(letters[index], letters[index + 1], restLengths[index], draggedIndexes.has(index), draggedIndexes.has(index + 1), lineHeight);
    }
    solveCollisions(letters, draggedIndexes, lineHeight);
    constrainLetters(letters, lineHeight, state.walls.getBoundingClientRect(), draggedIndexes);
    applyDragPositions(state, lineHeight);
  }
}

function solveDistance(a, b, restLength, aDragged, bDragged, lineHeight) {
  if (a.locked && b.locked) {
    return;
  }

  const ax = a.x + a.w / 2;
  const ay = a.y + lineHeight / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + lineHeight / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 0.001;
  const diff = (dist - restLength) / dist;
  const aFixed = a.locked || aDragged;
  const bFixed = b.locked || bDragged;

  if (aFixed && !bFixed) {
    b.x -= dx * diff;
    b.y -= dy * diff;
    return;
  }

  if (!aFixed && bFixed) {
    a.x += dx * diff;
    a.y += dy * diff;
    return;
  }

  if (!aFixed && !bFixed) {
    a.x += dx * diff * 0.5;
    a.y += dy * diff * 0.5;
    b.x -= dx * diff * 0.5;
    b.y -= dy * diff * 0.5;
  }
}

function solveCollisions(letters, draggedIndexes, lineHeight) {
  const minDist = PHYSICS.collisionRadius * 2;

  for (let index = 0; index < letters.length; index += 1) {
    const a = letters[index];
    if (a.locked) {
      continue;
    }
    const aDragged = draggedIndexes.has(index);
    const acx = a.x + a.w / 2;
    const acy = a.y + lineHeight / 2;

    for (let other = index + 1; other < letters.length; other += 1) {
      if (Math.abs(index - other) === 1) {
        continue;
      }
      const b = letters[other];
      if (b.locked) {
        continue;
      }
      const bDragged = draggedIndexes.has(other);
      const bcx = b.x + b.w / 2;
      const bcy = b.y + lineHeight / 2;
      const dx = bcx - acx;
      const dy = bcy - acy;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist >= minDist) {
        continue;
      }

      const overlap = (minDist - dist) / dist * 0.5;
      if (aDragged && !bDragged) {
        b.x += dx * overlap;
        b.y += dy * overlap;
      } else if (!aDragged && bDragged) {
        a.x -= dx * overlap;
        a.y -= dy * overlap;
      } else if (!aDragged && !bDragged) {
        a.x -= dx * overlap;
        a.y -= dy * overlap;
        b.x += dx * overlap;
        b.y += dy * overlap;
      }
    }
  }
}

function constrainLetters(letters, lineHeight, wallRect, draggedIndexes) {
  const minX = -wallRect.left;
  const minY = -wallRect.top;
  const maxX = window.innerWidth - wallRect.left;
  const maxY = window.innerHeight - wallRect.top;

  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index];
    if (letter.locked || draggedIndexes.has(index)) {
      continue;
    }

    if (letter.x < minX) {
      letter.x = minX;
      letter.px = letter.x + (letter.x - letter.px) * PHYSICS.bounce;
    }
    if (letter.x + letter.w > maxX) {
      letter.x = maxX - letter.w;
      letter.px = letter.x + (letter.x - letter.px) * PHYSICS.bounce;
    }
    if (letter.y < minY) {
      letter.y = minY;
      letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
    }
    if (letter.y + lineHeight > maxY) {
      letter.y = maxY - lineHeight;
      letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
    }
  }
}

function applyDragPositions(state, lineHeight) {
  const rect = state.glyphLayer.getBoundingClientRect();
  for (const [pointerId, drag] of state.drags.entries()) {
    const letter = state.scene?.letters[drag.idx];
    if (!letter) {
      state.drags.delete(pointerId);
      continue;
    }
    letter.x = drag.clientX - rect.left - drag.offsetX;
    letter.y = drag.clientY - rect.top - drag.offsetY;
    letter.px = letter.x;
    letter.py = letter.y;
    letter.locked = false;
    setLetterInteractive(letter, true);
  }
}

function syncScene(scene) {
  for (const letter of scene.letters) {
    if (!letter.locked) {
      setLetterInteractive(letter, true);
    }
    letter.el.style.transform = `translate(${letter.x}px, ${letter.y}px)`;
  }
}

function clearDrags(state) {
  for (const drag of state.drags.values()) {
    const letter = state.scene?.letters[drag.idx];
    if (letter) {
      letter.el.classList.remove("dragging");
    }
  }
  state.drags.clear();
}

function explodePreparedGlyphs(prepared, measureCtx) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const entries = [];

  for (let index = 0; index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index];
    const breakable = prepared.breakableWidths[index];
    const graphemes = [...segmenter.segment(segment)].map((part) => part.segment);

    if (breakable && breakable.length === graphemes.length) {
      for (let gi = 0; gi < graphemes.length; gi += 1) {
        entries.push({ text: normalizeGlyphText(graphemes[gi]), w: breakable[gi] || 1 });
      }
      continue;
    }

    for (const grapheme of graphemes) {
      entries.push({ text: normalizeGlyphText(grapheme), w: measureCtx.measureText(grapheme).width || 1 });
    }
  }

  return entries;
}

function normalizeGlyphText(text) {
  if (text === " ") {
    return "\u00A0";
  }
  if (text === "\t") {
    return "\u00A0\u00A0\u00A0\u00A0";
  }
  return text;
}

function pickTextStyles(style) {
  const picked = {};
  for (const key of TEXT_STYLE_KEYS) {
    picked[key] = style[key];
  }
  return picked;
}

function applyTextStyles(element, styles) {
  for (const [key, value] of Object.entries(styles)) {
    if (!value) {
      continue;
    }
    element.style[key] = value;
  }
}

function waitForFonts() {
  if (!document.fonts || typeof document.fonts.ready?.then !== "function") {
    return Promise.resolve();
  }
  return document.fonts.ready.catch(() => undefined);
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function handleGlyphPointerDown(state, index, event) {
  if (state.stage !== "active" || !state.scene) {
    return;
  }
  const letter = state.scene.letters[index];
  if (!letter || letter.locked || state.drags.has(event.pointerId)) {
    return;
  }

  const rect = state.glyphLayer.getBoundingClientRect();
  state.drags.set(event.pointerId, {
    idx: index,
    offsetX: event.clientX - rect.left - letter.x,
    offsetY: event.clientY - rect.top - letter.y,
    clientX: event.clientX,
    clientY: event.clientY
  });
  letter.el.classList.add("dragging");
  letter.el.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handleGlyphPointerMove(state, event) {
  const drag = state.drags.get(event.pointerId);
  if (!drag) {
    return;
  }
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
}

function handleGlyphPointerUp(state, event) {
  const drag = state.drags.get(event.pointerId);
  if (!drag) {
    return;
  }
  const letter = state.scene?.letters[drag.idx];
  if (letter) {
    letter.el.classList.remove("dragging");
  }
  state.drags.delete(event.pointerId);
}

function handleGlobalPointerMove(state, event) {
  handleGlyphPointerMove(state, event);
}

function handleGlobalPointerUp(state, event) {
  handleGlyphPointerUp(state, event);
}

function attachDragListeners(letter, state) {
  letter.el.addEventListener("pointerdown", (event) => handleGlyphPointerDown(state, letter.index, event));
}

function installPointerDelegation(state) {
  window.addEventListener("pointermove", (event) => handleGlobalPointerMove(state, event));
  window.addEventListener("pointerup", (event) => handleGlobalPointerUp(state, event));
  window.addEventListener("pointercancel", (event) => handleGlobalPointerUp(state, event));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
