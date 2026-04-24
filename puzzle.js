const PHYSICS = {
  gravity: 1400,
  damping: 0.992,
  constraintIterations: 7,
  grabRadius: 28,
  releaseThreshold: 1.12,
  propagationBoost: 0.03,
  maxStep: 1 / 30
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
    running: false,
    rafId: 0,
    lastTime: 0,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    grabbedNode: null,
    grabOffsetX: 0,
    grabOffsetY: 0,
    sourceOpacity: target.style.opacity || ""
  };

  resizeCanvas(state);
  bindEvents(state);
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
    await activateTarget(state);
  });

  state.resetButton.addEventListener("click", () => resetPuzzle(state));
  window.addEventListener("resize", () => refreshActiveScene(state));
  window.addEventListener("scroll", () => refreshActiveScene(state), { passive: true });

  state.canvas.addEventListener("pointerdown", (event) => handlePointerDown(state, event));
  state.canvas.addEventListener("pointermove", (event) => handlePointerMove(state, event));
  state.canvas.addEventListener("pointerup", (event) => handlePointerUp(state, event));
  state.canvas.addEventListener("pointercancel", (event) => handlePointerUp(state, event));
}

function armPuzzle(state) {
  state.stage = "armed";
  state.main.dataset.puzzleStage = "armed";
  state.resetButton.hidden = false;
}

async function activateTarget(state) {
  await waitForFonts();
  buildSceneFromTarget(state);
  if (!state.scene) {
    return;
  }

  state.stage = "active";
  state.main.dataset.puzzleStage = "active";
  state.target.style.opacity = "0";
  setSceneVisible(state, true);
  syncScene(state.scene, true);
  drawScene(state);
  startLoop(state);
}

function buildSceneFromTarget(state, previousScene = null) {
  clearScene(state);
  resizeCanvas(state);

  const glyphs = collectElementGlyphs(state.target).filter((glyph) => glyph.draw);
  if (glyphs.length < 2) {
    return;
  }

  state.scene = buildScene(glyphs, state.glyphLayer);
  if (previousScene) {
    for (let index = 0; index < state.scene.nodes.length; index += 1) {
      const next = state.scene.nodes[index];
      const prev = previousScene.nodes[index];
      if (!next || !prev) {
        continue;
      }
      next.isReleased = prev.isReleased;
      if (prev.isReleased) {
        next.x = prev.x;
        next.y = prev.y;
        next.prevX = prev.prevX;
        next.prevY = prev.prevY;
      }
    }
  }
}

function buildScene(glyphs, glyphLayer) {
  const fixedCount = Math.max(1, Math.min(4, glyphs.length - 1));
  const nodes = glyphs.map((glyph, index) => createNode(glyph, index, glyphLayer));

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const previous = nodes[index - 1] || null;
    node.prev = previous;
    if (previous) {
      previous.next = node;
      node.restLength = distance(previous.homeX, previous.homeY, node.homeX, node.homeY);
    }
    if (index < fixedCount) {
      node.pinned = true;
      node.isReleased = true;
    }
  }

  return { nodes };
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
    prevX: glyph.x,
    prevY: glyph.y,
    homeX: glyph.x,
    homeY: glyph.y,
    pinned: false,
    isReleased: false,
    restLength: glyph.width,
    prev: null,
    next: null,
    el
  };
}

function refreshActiveScene(state) {
  resizeCanvas(state);
  if (state.stage !== "active" || !state.scene) {
    return;
  }

  const previousScene = state.scene;
  const grabbedIndex = state.grabbedNode?.index ?? null;
  buildSceneFromTarget(state, previousScene);
  if (!state.scene) {
    return;
  }

  if (grabbedIndex !== null) {
    state.grabbedNode = state.scene.nodes[grabbedIndex] || null;
  }
  setSceneVisible(state, true);
  syncScene(state.scene, true);
  drawScene(state);
}

function resetPuzzle(state) {
  stopLoop(state);
  releasePointer(state);
  clearScene(state);
  state.target.style.opacity = state.sourceOpacity;
  state.stage = "static";
  state.main.dataset.puzzleStage = "static";
  state.resetButton.hidden = true;
  setSceneVisible(state, false);
  drawScene(state);
}

function clearScene(state) {
  state.scene = null;
  state.glyphLayer.textContent = "";
}

function setSceneVisible(state, active) {
  state.canvas.hidden = !active;
  state.glyphLayer.hidden = !active;
  state.canvas.classList.toggle("is-active", active);
  state.glyphLayer.classList.toggle("is-active", active);
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

  const dt = state.lastTime ? Math.min((time - state.lastTime) / 1000, PHYSICS.maxStep) : 1 / 60;
  state.lastTime = time;

  stepScene(state.scene, dt, getBounds(state), state.grabbedNode, state.pointerX, state.pointerY, state.grabOffsetX, state.grabOffsetY);
  syncScene(state.scene, true);
  drawScene(state);
  state.rafId = requestAnimationFrame((nextTime) => tick(state, nextTime));
}

function stepScene(scene, dt, bounds, grabbedNode, pointerX, pointerY, grabOffsetX, grabOffsetY) {
  for (const node of scene.nodes) {
    if (node.pinned) {
      node.x = node.homeX;
      node.y = node.homeY;
      node.prevX = node.homeX;
      node.prevY = node.homeY;
      continue;
    }

    if (!node.isReleased) {
      node.x = node.homeX;
      node.y = node.homeY;
      node.prevX = node.homeX;
      node.prevY = node.homeY;
      continue;
    }

    const velocityX = (node.x - node.prevX) * PHYSICS.damping;
    const velocityY = (node.y - node.prevY) * PHYSICS.damping;
    node.prevX = node.x;
    node.prevY = node.y;
    node.x += velocityX;
    node.y += velocityY + PHYSICS.gravity * dt * dt;
  }

  if (grabbedNode) {
    grabbedNode.x = pointerX + grabOffsetX;
    grabbedNode.y = pointerY + grabOffsetY;
  }

  for (let iteration = 0; iteration < PHYSICS.constraintIterations; iteration += 1) {
    for (let index = 1; index < scene.nodes.length; index += 1) {
      solveDistance(scene.nodes[index - 1], scene.nodes[index], scene.nodes[index].restLength);
    }

    for (const node of scene.nodes) {
      if (node.pinned) {
        continue;
      }
      constrainNode(node, bounds);
      if (!node.isReleased) {
        node.x = node.homeX;
        node.y = node.homeY;
      }
    }

    if (grabbedNode) {
      grabbedNode.x = pointerX + grabOffsetX;
      grabbedNode.y = pointerY + grabOffsetY;
    }
  }

  propagateRelease(scene.nodes);
}

function propagateRelease(nodes) {
  for (const node of nodes) {
    if (node.pinned || node.isReleased) {
      continue;
    }

    const prevStretch = getStretch(node.prev, node);
    const nextStretch = getStretch(node, node.next);
    const threshold = PHYSICS.releaseThreshold + releaseBias(node);
    if (Math.max(prevStretch, nextStretch) < threshold) {
      continue;
    }

    node.isReleased = true;
    nudgeVelocity(node);
  }
}

function releaseBias(node) {
  return Math.min(node.index * PHYSICS.propagationBoost, 0.18);
}

function nudgeVelocity(node) {
  const velocityX = node.x - node.prevX;
  const velocityY = node.y - node.prevY;
  node.prevX = node.x - velocityX * 0.6;
  node.prevY = node.y - velocityY * 0.6;
}

function getStretch(a, b) {
  if (!a || !b) {
    return 0;
  }
  return distance(a.x, a.y, b.x, b.y) / Math.max(b.restLength, 0.001);
}

function constrainNode(node, bounds) {
  const minX = bounds.left + node.width / 2;
  const maxX = bounds.right - node.width / 2;
  const minY = bounds.top + node.height / 2;
  const maxY = bounds.bottom - node.height / 2;

  node.x = clamp(node.x, minX, maxX);
  node.y = clamp(node.y, minY, maxY);
}

function solveDistance(a, b, restLength) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const current = Math.hypot(dx, dy) || 0.0001;
  const diff = (current - restLength) / current;

  if (a.pinned && !b.pinned) {
    b.x -= dx * diff;
    b.y -= dy * diff;
    return;
  }

  if (!a.pinned && b.pinned) {
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

function handlePointerDown(state, event) {
  if (state.stage !== "active" || !state.scene) {
    return;
  }

  const node = findClosestNode(state.scene.nodes, event.clientX, event.clientY, PHYSICS.grabRadius);
  if (!node) {
    return;
  }

  state.pointerId = event.pointerId;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.grabbedNode = node;
  state.grabOffsetX = node.x - event.clientX;
  state.grabOffsetY = node.y - event.clientY;
  node.isReleased = true;
  nudgeVelocity(node);
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

function findClosestNode(nodes, x, y, radius) {
  let bestNode = null;
  let bestDistance = radius;

  for (const node of nodes) {
    const current = distance(node.x, node.y, x, y);
    if (current > bestDistance) {
      continue;
    }
    bestDistance = current;
    bestNode = node;
  }

  return bestNode;
}

function drawScene(state) {
  const ctx = state.ctx;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (state.stage !== "active" || !state.scene) {
    return;
  }

  ctx.lineWidth = 1.15;
  ctx.strokeStyle = "rgba(39, 40, 56, 0.45)";
  ctx.beginPath();
  for (let index = 1; index < state.scene.nodes.length; index += 1) {
    const previous = state.scene.nodes[index - 1];
    const current = state.scene.nodes[index];
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
  }
  ctx.stroke();
}

function syncScene(scene, visible) {
  for (const node of scene.nodes) {
    node.el.style.transform = `translate(${node.x - node.width / 2}px, ${node.y - node.height / 2}px)`;
    node.el.style.visibility = visible ? "visible" : "hidden";
  }
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

function collectElementGlyphs(element) {
  const textNodes = getTextNodes(element);
  const glyphs = [];

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent) {
      continue;
    }

    const style = getComputedStyle(parent);
    const graphemes = segmentText(textNode.textContent || "");
    let offset = 0;

    for (const grapheme of graphemes) {
      const start = offset;
      const end = start + grapheme.length;
      offset = end;

      const rect = getTextRect(textNode, start, end);
      if (!rect) {
        continue;
      }

      glyphs.push({
        char: grapheme,
        text: normalizeGlyphText(grapheme),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: Math.max(rect.width, 1),
        height: Math.max(rect.height, 1),
        draw: /\S/.test(grapheme),
        style: pickTextStyles(style)
      });
    }
  }

  return glyphs;
}

function getTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.length) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function segmentText(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(text)].map((segment) => segment.segment);
  }
  return Array.from(text);
}

function getTextRect(textNode, start, end) {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
  const lineRect = range.getBoundingClientRect();
  range.detach?.();

  if (!rects.length || !lineRect.height) {
    return null;
  }

  const rect = rects[0];
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width || rect.height * 0.28,
    height: rect.height
  };
}

function normalizeGlyphText(grapheme) {
  if (grapheme === " ") {
    return "\u00A0";
  }
  if (grapheme === "\t") {
    return "\u00A0\u00A0\u00A0\u00A0";
  }
  return grapheme;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
