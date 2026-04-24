import { prepareWithSegments } from "./pretext.js";

const PHYSICS = {
  damping: 0.97,
  gravity: 1800,
  iterations: 12,
  constraintStretch: 1.18,
  unlockThreshold: 1,
  grabRadius: 26,
  collisionRadius: 7,
  bounce: 0.35,
  fixedStep: 1 / 120,
  maxFrame: 1 / 20
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
  const canvas = document.querySelector("[data-puzzle-canvas]");
  const glyphLayer = document.querySelector("[data-puzzle-glyph-layer]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const ceiling = document.querySelector("[data-puzzle-ceiling]");
  const floor = document.querySelector("[data-puzzle-floor]");
  const walls = document.querySelector("[data-puzzle-walls]");

  if (!main || !trigger || !target || !canvas || !glyphLayer || !resetButton || !ceiling || !floor || !walls) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const state = {
    main,
    trigger,
    target,
    canvas,
    ctx,
    glyphLayer,
    resetButton,
    boundsSources: { ceiling, floor, walls },
    stage: "static",
    scene: null,
    prepared: false,
    running: false,
    rafId: 0,
    lastTime: 0,
    accumulator: 0,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    grabbedNode: null,
    grabOffsetX: 0,
    grabOffsetY: 0,
    sourceOpacity: target.style.opacity || "",
    measureCtx: document.createElement("canvas").getContext("2d")
  };

  if (!state.measureCtx) {
    return;
  }

  resizeCanvas(state);
  bindEvents(state);
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
  window.addEventListener("resize", () => refreshPreparedScene(state));
  window.addEventListener("scroll", () => refreshPreparedScene(state), { passive: true });

  state.canvas.addEventListener("pointerdown", (event) => handlePointerDown(state, event));
  state.canvas.addEventListener("pointermove", (event) => handlePointerMove(state, event));
  state.canvas.addEventListener("pointerup", (event) => handlePointerUp(state, event));
  state.canvas.addEventListener("pointercancel", (event) => handlePointerUp(state, event));
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
  syncScene(state.scene, true);
  setCanvasActive(state, true);
  startLoop(state);
}

function resetPuzzle(state) {
  stopLoop(state);
  releasePointer(state);
  state.stage = "static";
  state.main.dataset.puzzleStage = "static";
  state.resetButton.hidden = true;
  setCanvasActive(state, false);

  if (!state.scene) {
    return;
  }

  for (const node of state.scene.nodes) {
    node.locked = true;
    node.x = node.homeX;
    node.y = node.homeY;
    node.px = node.homeX;
    node.py = node.homeY;
  }
  syncScene(state.scene, true);
}

function prepareScene(state, previousScene = null) {
  clearScene(state);
  resizeCanvas(state);

  const glyphs = collectPreparedGlyphs(state.target, state.measureCtx);
  if (glyphs.length < 2) {
    state.target.style.opacity = state.sourceOpacity;
    state.prepared = false;
    return;
  }

  state.scene = buildScene(glyphs, state.glyphLayer);
  state.prepared = true;
  state.glyphLayer.hidden = false;
  state.target.style.opacity = "0";

  if (previousScene) {
    carrySceneState(state.scene, previousScene);
  }

  syncScene(state.scene, true);
}

function refreshPreparedScene(state) {
  resizeCanvas(state);
  if (!state.prepared && state.stage === "static") {
    return;
  }

  const previousScene = state.scene;
  prepareScene(state, previousScene);
  if (!state.scene) {
    return;
  }

  if (state.stage === "active") {
    setCanvasActive(state, true);
  }
}

function clearScene(state) {
  state.scene = null;
  state.glyphLayer.textContent = "";
}

function buildScene(glyphs, glyphLayer) {
  const nodes = glyphs.map((glyph, index) => createNode(glyph, index, glyphLayer));
  const fixedCount = Math.max(2, nodes.length - Math.min(5, Math.max(2, nodes.length - 1)));

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const previous = nodes[index - 1] || null;
    node.prev = previous;
    if (previous) {
      previous.next = node;
      node.restLength = distance(previous.homeX, previous.homeY, node.homeX, node.homeY) * PHYSICS.constraintStretch;
    }
    node.locked = true;
  }

  return { nodes, fixedCount };
}

function carrySceneState(nextScene, previousScene) {
  for (let index = 0; index < nextScene.nodes.length; index += 1) {
    const next = nextScene.nodes[index];
    const prev = previousScene?.nodes[index];
    if (!next || !prev) {
      continue;
    }

    const deltaHomeX = next.homeX - prev.homeX;
    const deltaHomeY = next.homeY - prev.homeY;
    next.locked = prev.locked;
    if (!prev.locked) {
      next.x = prev.x + deltaHomeX;
      next.y = prev.y + deltaHomeY;
      next.px = prev.px + deltaHomeX;
      next.py = prev.py + deltaHomeY;
    }
  }
}

function createNode(glyph, index, glyphLayer) {
  const el = document.createElement("span");
  el.className = "puzzle-glyph";
  el.textContent = glyph.text;
  el.style.width = `${glyph.width}px`;
  el.style.height = `${glyph.height}px`;
  applyTextStyles(el, glyph.style);
  glyphLayer.append(el);

  return {
    index,
    width: glyph.width,
    height: glyph.height,
    x: glyph.x,
    y: glyph.y,
    px: glyph.x,
    py: glyph.y,
    homeX: glyph.x,
    homeY: glyph.y,
    locked: true,
    restLength: glyph.width,
    prev: null,
    next: null,
    el
  };
}

function unlockTail(scene) {
  for (let index = scene.fixedCount; index < scene.nodes.length; index += 1) {
    const node = scene.nodes[index];
    const sag = (index - scene.fixedCount + 1) * 1.75;
    node.locked = false;
    node.x = node.homeX;
    node.y = node.homeY + sag;
    node.px = node.homeX;
    node.py = node.y - Math.max(1, sag * 0.75);
  }
}

function setCanvasActive(state, active) {
  state.canvas.hidden = !active;
  state.canvas.classList.toggle("is-active", active);
}

function resizeCanvas(state) {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  state.canvas.width = Math.round(width * ratio);
  state.canvas.height = Math.round(height * ratio);
  state.canvas.style.width = `${width}px`;
  state.canvas.style.height = `${height}px`;
  state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function startLoop(state) {
  if (state.running) {
    return;
  }
  state.running = true;
  state.lastTime = 0;
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

function tick(state, time) {
  if (!state.running || state.stage !== "active" || !state.scene) {
    return;
  }

  if (!state.lastTime) {
    state.lastTime = time;
  }

  const frameDt = Math.min((time - state.lastTime) / 1000, PHYSICS.maxFrame);
  state.lastTime = time;
  state.accumulator += frameDt;

  while (state.accumulator >= PHYSICS.fixedStep) {
    simulate(state.scene, PHYSICS.fixedStep, getBounds(state), state.grabbedNode, state.pointerX, state.pointerY, state.grabOffsetX, state.grabOffsetY);
    state.accumulator -= PHYSICS.fixedStep;
  }

  syncScene(state.scene, true);
  clearCanvas(state.ctx);
  state.rafId = requestAnimationFrame((nextTime) => tick(state, nextTime));
}

function simulate(scene, dt, bounds, grabbedNode, pointerX, pointerY, grabOffsetX, grabOffsetY) {
  for (const node of scene.nodes) {
    if (node.locked && node !== grabbedNode) {
      node.x = node.homeX;
      node.y = node.homeY;
      node.px = node.homeX;
      node.py = node.homeY;
      continue;
    }

    if (node === grabbedNode) {
      node.x = pointerX + grabOffsetX;
      node.y = pointerY + grabOffsetY;
      node.px = node.x;
      node.py = node.y;
      continue;
    }

    const vx = (node.x - node.px) * PHYSICS.damping;
    const vy = (node.y - node.py) * PHYSICS.damping;
    node.px = node.x;
    node.py = node.y;
    node.x += vx;
    node.y += vy + PHYSICS.gravity * dt * dt;
  }

  for (let iteration = 0; iteration < PHYSICS.iterations; iteration += 1) {
    for (let index = 0; index < scene.nodes.length - 1; index += 1) {
      solveDistance(scene.nodes[index], scene.nodes[index + 1], scene.nodes[index + 1].restLength, grabbedNode);
    }

    solveCollisions(scene.nodes, grabbedNode);

    for (const node of scene.nodes) {
      if (node === grabbedNode) {
        node.x = pointerX + grabOffsetX;
        node.y = pointerY + grabOffsetY;
        continue;
      }
      if (node.locked) {
        node.x = node.homeX;
        node.y = node.homeY;
        continue;
      }
      constrainNode(node, bounds);
    }
  }

  propagateRelease(scene.nodes, scene.fixedCount);
}

function solveDistance(a, b, restLength, grabbedNode) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const current = Math.hypot(dx, dy) || 0.0001;
  const diff = (current - restLength) / current;

  const aFixed = a.locked || a === grabbedNode;
  const bFixed = b.locked || b === grabbedNode;

  if (aFixed && bFixed) {
    return;
  }

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

  const offsetX = dx * diff * 0.5;
  const offsetY = dy * diff * 0.5;
  a.x += offsetX;
  a.y += offsetY;
  b.x -= offsetX;
  b.y -= offsetY;
}

function solveCollisions(nodes, grabbedNode) {
  const minDist = PHYSICS.collisionRadius * 2;

  for (let index = 0; index < nodes.length; index += 1) {
    const a = nodes[index];
    if (a.locked) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
      if (Math.abs(index - otherIndex) === 1) {
        continue;
      }

      const b = nodes[otherIndex];
      if (b.locked) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const current = Math.hypot(dx, dy) || 0.0001;
      if (current >= minDist) {
        continue;
      }

      const overlap = (minDist - current) / current;
      const aFixed = a === grabbedNode;
      const bFixed = b === grabbedNode;

      if (aFixed && !bFixed) {
        b.x += dx * overlap;
        b.y += dy * overlap;
        continue;
      }

      if (!aFixed && bFixed) {
        a.x -= dx * overlap;
        a.y -= dy * overlap;
        continue;
      }

      a.x -= dx * overlap * 0.5;
      a.y -= dy * overlap * 0.5;
      b.x += dx * overlap * 0.5;
      b.y += dy * overlap * 0.5;
    }
  }
}

function propagateRelease(nodes, fixedCount) {
  for (let index = nodes.length - 2; index >= fixedCount - 1; index -= 1) {
    const current = nodes[index];
    const next = nodes[index + 1];
    if (!current || !next || !current.locked || next.locked) {
      continue;
    }

    const stretch = distance(current.homeX, current.homeY, next.x, next.y);
    const threshold = next.restLength + PHYSICS.unlockThreshold;
    if (stretch <= threshold) {
      continue;
    }

    current.locked = false;
    current.px = current.x;
    current.py = current.y - 0.5;
  }
}

function constrainNode(node, bounds) {
  const minX = bounds.left + node.width / 2;
  const maxX = bounds.right - node.width / 2;
  const minY = bounds.top + node.height / 2;
  const maxY = bounds.bottom - node.height / 2;

  if (node.x < minX) {
    node.x = minX;
    node.px = node.x + (node.x - node.px) * PHYSICS.bounce;
  } else if (node.x > maxX) {
    node.x = maxX;
    node.px = node.x + (node.x - node.px) * PHYSICS.bounce;
  }

  if (node.y < minY) {
    node.y = minY;
    node.py = node.y + (node.y - node.py) * PHYSICS.bounce;
  } else if (node.y > maxY) {
    node.y = maxY;
    node.py = node.y + (node.y - node.py) * PHYSICS.bounce;
  }
}

function handlePointerDown(state, event) {
  if (state.stage !== "active" || !state.scene) {
    return;
  }

  const node = findClosestUnlockedNode(state.scene.nodes, event.clientX, event.clientY, PHYSICS.grabRadius);
  if (!node) {
    return;
  }

  state.pointerId = event.pointerId;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.grabbedNode = node;
  state.grabOffsetX = node.x - event.clientX;
  state.grabOffsetY = node.y - event.clientY;
  node.locked = false;
  node.px = node.x;
  node.py = node.y;
  state.canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(state, event) {
  if (event.pointerId !== state.pointerId) {
    return;
  }
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
}

function handlePointerUp(state, event) {
  if (event.pointerId !== state.pointerId) {
    return;
  }
  releasePointer(state);
}

function releasePointer(state) {
  if (state.pointerId !== null && state.canvas.hasPointerCapture?.(state.pointerId)) {
    state.canvas.releasePointerCapture(state.pointerId);
  }
  state.pointerId = null;
  state.grabbedNode = null;
  state.grabOffsetX = 0;
  state.grabOffsetY = 0;
}

function findClosestUnlockedNode(nodes, x, y, radius) {
  let winner = null;
  let bestDistance = radius;

  for (const node of nodes) {
    if (node.locked) {
      continue;
    }
    const current = distance(node.x, node.y, x, y);
    if (current >= bestDistance) {
      continue;
    }
    bestDistance = current;
    winner = node;
  }

  return winner;
}

function syncScene(scene, visible) {
  for (const node of scene.nodes) {
    node.el.style.transform = `translate(${node.x - node.width / 2}px, ${node.y - node.height / 2}px)`;
    node.el.style.visibility = visible ? "visible" : "hidden";
  }
}

function clearCanvas(ctx) {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function getBounds(state) {
  const ceilingRect = state.boundsSources.ceiling.getBoundingClientRect();
  const floorRect = state.boundsSources.floor.getBoundingClientRect();
  const wallsRect = state.boundsSources.walls.getBoundingClientRect();

  return {
    top: Math.max(ceilingRect.bottom + 4, 0),
    bottom: Math.min(floorRect.top - 6, window.innerHeight),
    left: Math.max(wallsRect.left, 0),
    right: Math.min(wallsRect.right, window.innerWidth)
  };
}

function collectPreparedGlyphs(element, measureCtx) {
  const text = element.textContent || "";
  if (!text) {
    return [];
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return [];
  }

  const style = getComputedStyle(element);
  const font = style.font;
  measureCtx.font = font;

  const prepared = prepareWithSegments(text, font);
  const entries = explodePreparedEntries(prepared, measureCtx);
  const totalWidth = entries.reduce((sum, entry) => sum + entry.width, 0);
  const startX = rect.left + (rect.width - totalWidth) / 2;
  const centerY = rect.top + rect.height / 2;

  let x = startX;
  return entries.map((entry) => {
    const glyph = {
      text: entry.text,
      width: entry.width,
      height: rect.height,
      x: x + entry.width / 2,
      y: centerY,
      style: pickTextStyles(style)
    };
    x += entry.width;
    return glyph;
  });
}

function explodePreparedEntries(prepared, measureCtx) {
  const entries = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  for (let index = 0; index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index];
    const graphemeWidths = prepared.breakableWidths[index];

    if (graphemeWidths && graphemeWidths.length) {
      const graphemes = [...segmenter.segment(segment)].map((part) => part.segment);
      for (let offset = 0; offset < graphemes.length; offset += 1) {
        entries.push({
          text: normalizeGlyphText(graphemes[offset]),
          width: graphemeWidths[offset] || measureCtx.measureText(graphemes[offset]).width || 1
        });
      }
      continue;
    }

    const graphemes = [...segmenter.segment(segment)].map((part) => part.segment);
    if (graphemes.length <= 1) {
      entries.push({
        text: normalizeGlyphText(segment),
        width: prepared.widths[index] || measureCtx.measureText(segment).width || 1
      });
      continue;
    }

    for (const grapheme of graphemes) {
      entries.push({
        text: normalizeGlyphText(grapheme),
        width: measureCtx.measureText(grapheme).width || 1
      });
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
  if (!styles) {
    return;
  }
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
