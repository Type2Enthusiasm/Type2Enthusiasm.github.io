import { prepareWithSegments, layoutWithLines } from "./pretext.js";

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
  tailSagStep: 3.5,
  separatorSpringK: 0.15,
  separatorDamping: 0.85,
  separatorGlyphMass: 0.08
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
  const separator = document.querySelector("[data-puzzle-separator]");

  if (!main || !trigger || !glyphLayer || !resetButton || !walls) {
    return;
  }

  const state = {
    main,
    trigger,
    glyphLayer,
    resetButton,
    walls,
    separator,
    stage: "static",
    scenes: [],
    prepared: false,
    running: false,
    rafId: 0,
    accumulator: 0,
    lastTime: -1,
    drags: new Map(),
    separatorDisplacement: 0,
    separatorVelocity: 0
  };

  bindEvents(state);
  installPointerDelegation(state);
  prepareWhenReady();
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
    if ((e.key === "f" || e.key === "F") && state.stage === "active") {
      for (const scene of state.scenes) {
        if (!scene.unraveling) {
          scene.unraveling = true;
          scene.unravelIdx = scene.letters.length - 1;
          while (scene.unravelIdx >= 0 && !scene.letters[scene.unravelIdx].locked) {
            scene.unravelIdx--;
          }
        }
      }
    }
  });

  window.addEventListener("resize", () => refreshScene(state));
  window.addEventListener("scroll", () => refreshScene(state), { passive: true });
}


async function activatePuzzle(state) {
  await waitForFonts();
  prepareScene(state);
  if (!state.scenes.length) {
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

  for (const el of state.walls.querySelectorAll("[data-puzzle-run]")) {
    delete el.dataset.puzzleHidden;
  }

  state.glyphLayer.hidden = true;
  clearScene(state);
  state.prepared = false;
  state.separatorDisplacement = 0;
  state.separatorVelocity = 0;
  if (state.separator) {
    state.separator.style.transform = "";
  }
}

function prepareScene(state) {
  const previousScenes = state.scenes;
  clearScene(state);

  const scenes = buildAllScenes(state.walls, state.glyphLayer);
  if (!scenes.length) {
    state.prepared = false;
    return;
  }

  state.scenes = scenes;
  state.prepared = true;

  for (const scene of scenes) {
    for (const letter of scene.letters) {
      attachDragListeners(letter, state, scene);
    }
  }

  for (let i = 0; i < scenes.length; i++) {
    if (previousScenes[i]) {
      carrySceneState(scenes[i], previousScenes[i]);
    }
  }

  if (state.stage === "active") {
    state.glyphLayer.hidden = false;
  }

  for (const scene of scenes) {
    syncScene(scene);
  }
}

function refreshScene(state) {
  if (state.stage !== "active") {
    return;
  }
  prepareScene(state);
}

function clearScene(state) {
  if (state.scenes.length) {
    clearDrags(state);
  }
  state.glyphLayer.textContent = "";
  state.scenes = [];
}

// --- Measurement helpers ---

function buildCanvasFont(computedStyle) {
  const weight = computedStyle.fontWeight;
  const size = computedStyle.fontSize;
  const family = computedStyle.fontFamily;
  return `${weight} ${size} ${family}`;
}

function buildStyleMap(el) {
  const ranges = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let charOffset = 0;
  let textNode;
  while ((textNode = walker.nextNode())) {
    const len = textNode.textContent.length;
    const styles = pickTextStyles(getComputedStyle(textNode.parentElement));
    ranges.push({ start: charOffset, end: charOffset + len, styles });
    charOffset += len;
  }
  return ranges;
}

function lookupStyles(styleMap, charOffset) {
  for (const range of styleMap) {
    if (charOffset >= range.start && charOffset < range.end) {
      return range.styles;
    }
  }
  return styleMap.length ? styleMap[styleMap.length - 1].styles : {};
}

// --- Scene building ---

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function buildElementScene(el, glyphLayer) {
  const text = el.textContent;
  if (!text.trim()) {
    return null;
  }

  const elRect = el.getBoundingClientRect();
  if (!elRect.width || !elRect.height) {
    return null;
  }

  const elStyle = getComputedStyle(el);
  const lineHeight = parseFloat(elStyle.lineHeight) || elRect.height;
  const font = buildCanvasFont(elStyle);
  const maxWidth = elRect.width;

  const prepared = prepareWithSegments(text, font);
  const { lines } = layoutWithLines(prepared, maxWidth, lineHeight);

  const styleMap = buildStyleMap(el);

  // Precompute character offset for each segment
  const segCharOffsets = new Array(prepared.segments.length);
  let off = 0;
  for (let i = 0; i < prepared.segments.length; i++) {
    segCharOffsets[i] = off;
    off += prepared.segments[i].length;
  }

  // Extract per-grapheme reading positions from pretext layout
  const readingPositions = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let xCursor = elRect.left;
    const y = elRect.top + li * lineHeight;

    // Walk segments within this line's range
    for (let si = line.start.segmentIndex; si <= line.end.segmentIndex && si < prepared.segments.length; si++) {
      const segKind = prepared.kinds[si];

      // Skip non-visible segments
      if (segKind === "hard-break" || segKind === "soft-hyphen" || segKind === "zero-width-break") {
        continue;
      }

      // Determine grapheme range within this segment for this line
      const graphemes = [...graphemeSegmenter.segment(prepared.segments[si])].map(g => g.segment);
      const startG = (si === line.start.segmentIndex) ? line.start.graphemeIndex : 0;
      const endG = (si === line.end.segmentIndex) ? line.end.graphemeIndex : graphemes.length;

      // Get per-grapheme widths
      const breakable = prepared.breakableWidths[si];
      let graphemeWidths;
      if (breakable) {
        graphemeWidths = breakable;
      } else if (graphemes.length === 1) {
        graphemeWidths = [prepared.widths[si]];
      } else {
        // Multi-grapheme but no breakable widths (e.g. CJK unit) — distribute evenly
        const perG = prepared.widths[si] / graphemes.length;
        graphemeWidths = graphemes.map(() => perG);
      }

      const segCharOffset = segCharOffsets[si];

      for (let gi = startG; gi < endG; gi++) {
        const ch = graphemes[gi];
        const w = graphemeWidths[gi] || 0;

        // Skip zero-width glyphs
        if (w <= 0) {
          continue;
        }

        // Compute character offset within the full text for style lookup
        let charOffsetForG = segCharOffset;
        for (let k = 0; k < gi; k++) {
          charOffsetForG += graphemes[k].length;
        }

        const textStyles = lookupStyles(styleMap, charOffsetForG);
        const normalizedCh = normalizeGlyphText(ch);

        readingPositions.push({
          x: xCursor,
          y,
          w,
          ch: normalizedCh,
          textStyles,
          lineHeight
        });
        xCursor += w;
      }
    }
  }

  if (readingPositions.length < 2) {
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
      (b.oy + lineHeight / 2) - (a.oy + lineHeight / 2)
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

  return {
    letters,
    restLengths,
    lineHeight,
    style: elStyle,
    element: el,
    unraveling: false,
    unravelIdx: -1
  };
}

function buildAllScenes(walls, glyphLayer) {
  const elements = [...walls.querySelectorAll("[data-puzzle-run]")];
  const scenes = [];
  for (const el of elements) {
    const scene = buildElementScene(el, glyphLayer);
    if (scene) {
      scenes.push(scene);
    }
  }
  return scenes;
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
  if (!state.running || state.stage !== "active" || !state.scenes.length) {
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

  for (const scene of state.scenes) {
    syncScene(scene);
  }

  if (state.separator) {
    state.separator.style.transform = `translateY(${state.separatorDisplacement}px)`;
  }

  state.rafId = requestAnimationFrame((time) => tick(state, time));
}

function simulate(state) {
  const wallRect = state.walls.getBoundingClientRect();

  // Per-scene physics
  for (const scene of state.scenes) {
    const { letters, restLengths, lineHeight } = scene;
    const draggedIndexes = new Set();
    for (const [, drag] of state.drags.entries()) {
      if (drag.scene === scene) {
        draggedIndexes.add(drag.letterIdx);
      }
    }

    // Progressive F-key unravel: unlock one letter per simulation step
    if (scene.unraveling) {
      if (scene.unravelIdx < 0) {
        scene.unraveling = false;
      } else if (letters[scene.unravelIdx].locked) {
        const l = letters[scene.unravelIdx];
        l.locked = false;
        l.px = l.x;
        l.py = l.y - 0.5;
        setLetterInteractive(l, true);
        scene.unravelIdx--;
      } else {
        scene.unravelIdx--;
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

    // Verlet integration
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

    // Constraint solving
    for (let iter = 0; iter < PHYSICS.iterations; iter += 1) {
      for (let index = 0; index < letters.length - 1; index += 1) {
        solveDistance(letters[index], letters[index + 1], restLengths[index], draggedIndexes.has(index), draggedIndexes.has(index + 1), lineHeight);
      }
      solveCollisionsInScene(letters, draggedIndexes, lineHeight);
      constrainLetters(letters, lineHeight, wallRect, draggedIndexes);
      applyDragPositionsForScene(state, scene);
    }
  }

  // Cross-scene collision detection
  if (state.scenes.length > 1) {
    solveCollisionsCross(state);
  }

  // Separator spring physics
  if (state.separator) {
    let unlockedCount = 0;
    for (const scene of state.scenes) {
      for (const letter of scene.letters) {
        if (!letter.locked) unlockedCount++;
      }
    }
    const weight = unlockedCount * PHYSICS.separatorGlyphMass * PHYSICS.gravity;
    const spring = -PHYSICS.separatorSpringK * state.separatorDisplacement;
    state.separatorVelocity = (state.separatorVelocity + weight + spring) * PHYSICS.separatorDamping;
    state.separatorDisplacement += state.separatorVelocity;
    if (state.separatorDisplacement < 0) {
      state.separatorDisplacement = 0;
      state.separatorVelocity = 0;
    }
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

function solveCollisionsInScene(letters, draggedIndexes, lineHeight) {
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

function solveCollisionsCross(state) {
  const minDist = PHYSICS.collisionRadius * 2;
  const allUnlocked = [];

  for (const scene of state.scenes) {
    for (const letter of scene.letters) {
      if (!letter.locked) {
        allUnlocked.push(letter);
      }
    }
  }

  for (let i = 0; i < allUnlocked.length; i++) {
    const a = allUnlocked[i];
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;

    for (let j = i + 1; j < allUnlocked.length; j++) {
      const b = allUnlocked[j];
      const bcx = b.x + b.w / 2;
      const bcy = b.y + b.h / 2;
      const dx = bcx - acx;
      const dy = bcy - acy;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist >= minDist) {
        continue;
      }
      const overlap = (minDist - dist) / dist * 0.5;
      a.x -= dx * overlap;
      a.y -= dy * overlap;
      b.x += dx * overlap;
      b.y += dy * overlap;
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

function applyDragPositionsForScene(state, scene) {
  const rect = state.glyphLayer.getBoundingClientRect();
  for (const [pointerId, drag] of state.drags.entries()) {
    if (drag.scene !== scene) {
      continue;
    }
    const letter = scene.letters[drag.letterIdx];
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
    const letter = drag.scene?.letters[drag.letterIdx];
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

async function prepareWhenReady() {
  await waitForFonts();
}

function waitForFonts() {
  if (!document.fonts || typeof document.fonts.ready?.then !== "function") {
    return Promise.resolve();
  }
  return document.fonts.ready.catch(() => undefined);
}

function handleGlyphPointerDown(state, scene, letterIdx, event) {
  if (state.stage !== "active" || !state.scenes.length) {
    return;
  }
  const letter = scene.letters[letterIdx];
  if (!letter || letter.locked || state.drags.has(event.pointerId)) {
    return;
  }

  const rect = state.glyphLayer.getBoundingClientRect();
  state.drags.set(event.pointerId, {
    scene,
    letterIdx,
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
  const letter = drag.scene?.letters[drag.letterIdx];
  if (letter) {
    letter.el.classList.remove("dragging");
  }
  state.drags.delete(event.pointerId);
}

function attachDragListeners(letter, state, scene) {
  letter.el.addEventListener("pointerdown", (event) => handleGlyphPointerDown(state, scene, letter.index, event));
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
