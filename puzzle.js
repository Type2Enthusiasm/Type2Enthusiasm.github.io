
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
  const glyphLayer = document.querySelector("[data-puzzle-glyph-layer]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const walls = document.querySelector("[data-puzzle-walls]");

  if (!main || !trigger || !glyphLayer || !resetButton || !walls) {
    return;
  }

  const state = {
    main,
    trigger,
    glyphLayer,
    resetButton,
    walls,
    stage: "static",
    scene: null,
    prepared: false,
    running: false,
    rafId: 0,
    accumulator: 0,
    lastTime: -1,
    drags: new Map(),
    unraveling: false,
    unravelIdx: -1
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
    activatePuzzle(state);
  });

  state.resetButton.addEventListener("click", () => resetPuzzle(state));

  window.addEventListener("keydown", (e) => {
    if ((e.key === "f" || e.key === "F") && state.stage === "active" && !state.unraveling) {
      state.unraveling = true;
      state.unravelIdx = state.scene.letters.length - 1;
      while (state.unravelIdx >= 0 && !state.scene.letters[state.unravelIdx].locked) {
        state.unravelIdx--;
      }
    }
  });

  window.addEventListener("resize", () => refreshScene(state));
  window.addEventListener("scroll", () => refreshScene(state), { passive: true });
}


async function activatePuzzle(state) {
  await waitForFonts();
  prepareScene(state);
  if (!state.scene) {
    return;
  }

  state.stage = "active";
  state.main.dataset.puzzleStage = "active";
  state.resetButton.hidden = false;

  for (const el of state.walls.querySelectorAll("[data-puzzle-run]")) {
    el.dataset.puzzleHidden = "";
  }

  state.glyphLayer.hidden = false;
  startLoop(state);
}

function resetPuzzle(state) {
  stopLoop(state);
  state.stage = "static";
  state.main.dataset.puzzleStage = "static";
  state.resetButton.hidden = true;
  state.unraveling = false;
  state.unravelIdx = -1;

  for (const el of state.walls.querySelectorAll("[data-puzzle-run]")) {
    delete el.dataset.puzzleHidden;
  }

  state.glyphLayer.hidden = true;
  clearScene(state);
  state.prepared = false;
}

function prepareScene(state) {
  const previous = state.scene;
  clearScene(state);

  const scene = buildScene(state.walls, state.glyphLayer);
  if (!scene) {
    state.prepared = false;
    return;
  }

  state.scene = scene;
  state.prepared = true;

  for (const letter of scene.letters) {
    attachDragListeners(letter, state);
  }

  if (previous) {
    carrySceneState(scene, previous);
  }

  if (state.stage === "active") {
    state.glyphLayer.hidden = false;
  }

  syncScene(scene);
}

function refreshScene(state) {
  if (state.stage !== "active") {
    return;
  }
  prepareScene(state);
}

function clearScene(state) {
  if (state.scene) {
    clearDrags(state);
  }
  state.glyphLayer.textContent = "";
  state.scene = null;
}

function buildScene(walls, glyphLayer) {
  const elements = [...walls.querySelectorAll("[data-puzzle-run]")];
  if (!elements.length) {
    return null;
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const range = document.createRange();
  const readingPositions = [];
  let globalLineHeight = 0;
  let globalStyle = null;

  for (const el of elements) {
    const elRect = el.getBoundingClientRect();
    if (!elRect.width || !elRect.height) {
      continue;
    }

    const elStyle = getComputedStyle(el);
    const elLineHeight = parseFloat(elStyle.lineHeight) || elRect.height;
    if (!globalLineHeight) {
      globalLineHeight = elLineHeight;
      globalStyle = elStyle;
    }

    let lineIndex = 0;
    let curLineInkTop = null;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const parentStyle = getComputedStyle(textNode.parentElement);
      const textStyles = pickTextStyles(parentStyle);

      let offset = 0;
      for (const { segment } of segmenter.segment(textNode.textContent)) {
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + segment.length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (curLineInkTop === null) {
            curLineInkTop = rect.top;
          } else if (rect.top > curLineInkTop + elLineHeight * 0.5) {
            lineIndex++;
            curLineInkTop = rect.top;
          }
          const ch = normalizeGlyphText(segment);
          const glyphY = elRect.top + lineIndex * elLineHeight;
          readingPositions.push({ x: rect.left, y: glyphY, w: rect.width, ch, textStyles, lineHeight: elLineHeight });
        }
        offset += segment.length;
      }
    }
  }

  if (readingPositions.length < 2 || !globalLineHeight) {
    return null;
  }

  // Group reading positions into visual lines by shared y coordinate
  const lineGroups = groupByVisualLine(readingPositions);

  // Map string index → reading index via zig-zag snake
  const stringOrder = buildZigzagOrder(lineGroups);

  const letters = stringOrder.map((readingIdx, si) => {
    const rp = readingPositions[readingIdx];
    return {
      index: si,
      ch: rp.ch,
      w: rp.w,
      h: rp.lineHeight,
      x: rp.x,
      y: rp.y,
      ox: rp.x,
      oy: rp.y,
      px: rp.x,
      py: rp.y,
      locked: true,
      readingIdx,
      el: createGlyphElement(rp.ch, rp.w, rp.lineHeight, rp.textStyles, glyphLayer)
    };
  });

  const restLengths = [];
  for (let si = 0; si < letters.length - 1; si++) {
    const a = letters[si];
    const b = letters[si + 1];
    const dist = Math.hypot(
      (b.ox + b.w / 2) - (a.ox + a.w / 2),
      (b.oy + globalLineHeight / 2) - (a.oy + globalLineHeight / 2)
    );
    restLengths.push(dist * PHYSICS.constraintStretch);
  }

  // Unlock the tail with progressive sag
  const unlockCount = Math.min(PHYSICS.tailUnlockCount, Math.max(1, letters.length - 1));
  const tailStart = letters.length - unlockCount;
  for (let si = tailStart; si < letters.length; si++) {
    const letter = letters[si];
    const sag = (si - tailStart + 1) * PHYSICS.tailSagStep;
    letter.locked = false;
    letter.x = letter.ox;
    letter.y = letter.oy + sag;
    letter.px = letter.ox;
    letter.py = letter.y - Math.max(1, sag * 0.85);
  }

  return { letters, restLengths, lineHeight: globalLineHeight, style: globalStyle };
}

// Group flat reading-position array into arrays of indices sharing the same visual line (y).
function groupByVisualLine(readingPositions) {
  const groups = [];
  let currentGroup = [];
  let currentY = null;
  for (let i = 0; i < readingPositions.length; i++) {
    const y = readingPositions[i].y;
    if (currentY === null || Math.abs(y - currentY) > 2) {
      if (currentGroup.length) {
        groups.push(currentGroup);
      }
      currentGroup = [i];
      currentY = y;
    } else {
      currentGroup.push(i);
    }
  }
  if (currentGroup.length) {
    groups.push(currentGroup);
  }
  return groups;
}

// Snake through visual lines so the physical string end lands at the natural reading end.
// Last line is always left-to-right; alternate lines are reversed.
function buildZigzagOrder(lineGroups) {
  const N = lineGroups.length;
  const stringOrder = [];
  for (let li = 0; li < N; li++) {
    const indices = lineGroups[li];
    const reversed = (li % 2) !== ((N - 1) % 2);
    if (reversed) {
      for (let i = indices.length - 1; i >= 0; i--) {
        stringOrder.push(indices[i]);
      }
    } else {
      for (const idx of indices) {
        stringOrder.push(idx);
      }
    }
  }
  return stringOrder;
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

  // Progressive F-key unravel: unlock one letter per simulation step
  if (state.unraveling) {
    if (state.unravelIdx < 0) {
      state.unraveling = false;
    } else if (letters[state.unravelIdx].locked) {
      const l = letters[state.unravelIdx];
      l.locked = false;
      l.px = l.x;
      l.py = l.y - 0.5;
      setLetterInteractive(l, true);
      state.unravelIdx--;
    } else {
      state.unravelIdx--;
    }
  }

  // Auto-unlock: when a free letter pulls its locked neighbor past the rest length
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
    applyDragPositions(state);
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

function applyDragPositions(state) {
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

async function prepareWhenReady(state) {
  await waitForFonts();
}

function waitForFonts() {
  if (!document.fonts || typeof document.fonts.ready?.then !== "function") {
    return Promise.resolve();
  }
  return document.fonts.ready.catch(() => undefined);
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

function attachDragListeners(letter, state) {
  letter.el.addEventListener("pointerdown", (event) => handleGlyphPointerDown(state, letter.index, event));
}

function installPointerDelegation(state) {
  window.addEventListener("pointermove", (event) => handleGlyphPointerMove(state, event));
  window.addEventListener("pointerup", (event) => handleGlyphPointerUp(state, event));
  window.addEventListener("pointercancel", (event) => handleGlyphPointerUp(state, event));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
