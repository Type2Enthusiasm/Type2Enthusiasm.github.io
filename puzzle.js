const PHYSICS = {
  gravity: 900,
  damping: 0.992,
  hangingIterations: 4,
  unwoundIterations: 6,
  restitution: 0.35,
  floorFriction: 0.85,
  grabRadius: 24,
  dragThreshold: 20,
  releaseStretch: 1.16,
  releaseImpulse: 0.22,
  substepClamp: 1 / 30
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

function initPuzzle() {
  const main = document.querySelector("main[data-puzzle-stage]");
  const trigger = document.querySelector("[data-puzzle-trigger]");
  const proseLinkedIn = document.querySelector("[data-puzzle-linkedin]");
  const canvas = document.querySelector("[data-puzzle-canvas]");
  const glyphLayer = document.querySelector("[data-puzzle-glyph-layer]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const ceiling = document.querySelector("[data-puzzle-ceiling]");
  const floor = document.querySelector("[data-puzzle-floor]");
  const walls = document.querySelector("[data-puzzle-walls]");

  if (!main || !trigger || !proseLinkedIn || !canvas || !glyphLayer || !resetButton || !ceiling || !floor || !walls) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const state = {
    main,
    trigger,
    proseLinkedIn,
    canvas,
    ctx,
    glyphLayer,
    resetButton,
    boundsSources: { ceiling, floor, walls },
    stage: "static",
    running: false,
    rafId: 0,
    lastTime: 0,
    pointerId: null,
    pointerStartX: 0,
    pointerStartY: 0,
    dragDistance: 0,
    grabTarget: null,
    grabOffsetX: 0,
    grabOffsetY: 0,
    hiddenElements: new Set(),
    hangingScene: null,
    runScene: null
  };

  bindEvents(state);
}

function bindEvents(state) {
  state.trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.stage !== "static") {
      return;
    }
    startHanging(state);
  });

  state.resetButton.addEventListener("click", () => resetPuzzle(state));
  window.addEventListener("resize", () => refreshSceneLayout(state));
  window.addEventListener("scroll", () => refreshSceneLayout(state), { passive: true });

  state.canvas.addEventListener("pointerdown", (event) => handlePointerDown(state, event));
  state.canvas.addEventListener("pointermove", (event) => handlePointerMove(state, event));
  state.canvas.addEventListener("pointerup", () => releasePointer(state));
  state.canvas.addEventListener("pointercancel", () => releasePointer(state));
}

function startHanging(state) {
  clearGlyphLayer(state);

  const linkedInGlyphs = collectElementGlyphs(state.proseLinkedIn).filter((glyph) => glyph.draw);
  if (linkedInGlyphs.length < 8) {
    return;
  }

  setSceneActive(state, true);
  setHidden(state, state.proseLinkedIn, true);

  state.hangingScene = buildHangingScene(linkedInGlyphs, state.glyphLayer);
  state.runScene = null;
  state.stage = "hanging";
  state.main.dataset.puzzleStage = "hanging";
  state.resetButton.hidden = false;
  syncGlyphs(state);
  startLoop(state);
}

function startUnwound(state, transition = null) {
  clearGlyphLayer(state);

  const runs = [...state.main.querySelectorAll("[data-puzzle-run]")];
  const items = runs
    .map((element) => buildRunItem(element, state.glyphLayer))
    .filter(Boolean);

  if (!items.length) {
    return;
  }

  for (const item of items) {
    setHidden(state, item.element, true);
  }

  state.hangingScene = null;
  state.runScene = { items };
  state.stage = "unwound";
  state.main.dataset.puzzleStage = "unwound";
  setSceneActive(state, true);

  if (transition) {
    const target = findTransitionNode(items, transition.text, transition.clientX, transition.clientY);
    if (target) {
      unlockNode(target, true);
      state.pointerId = transition.pointerId;
      state.pointerStartX = transition.clientX;
      state.pointerStartY = transition.clientY;
      state.dragDistance = PHYSICS.dragThreshold;
      state.grabTarget = target;
      state.grabOffsetX = target.x - transition.clientX;
      state.grabOffsetY = target.y - transition.clientY;
    }
  }

  syncGlyphs(state);
}

function resetPuzzle(state) {
  state.stage = "static";
  state.main.dataset.puzzleStage = "static";
  state.hangingScene = null;
  state.runScene = null;
  state.dragDistance = 0;
  state.grabTarget = null;
  state.pointerId = null;
  state.lastTime = 0;

  for (const element of state.hiddenElements) {
    element.removeAttribute("data-puzzle-hidden");
  }
  state.hiddenElements.clear();

  clearGlyphLayer(state);
  setSceneActive(state, false);
  state.resetButton.hidden = true;
  stopLoop(state);
}

function setSceneActive(state, active) {
  state.canvas.hidden = !active;
  state.canvas.classList.toggle("is-active", active);
  state.glyphLayer.hidden = !active;
  state.glyphLayer.classList.toggle("is-active", active);
  if (active) {
    resizeCanvas(state);
  }
}

function setHidden(state, element, hidden) {
  if (hidden) {
    element.setAttribute("data-puzzle-hidden", "");
    state.hiddenElements.add(element);
  } else {
    element.removeAttribute("data-puzzle-hidden");
    state.hiddenElements.delete(element);
  }
}

function refreshSceneLayout(state) {
  if (state.stage === "static") {
    return;
  }
  resizeCanvas(state);
  if (state.stage === "hanging") {
    startHanging(state);
    return;
  }
  if (state.stage === "unwound") {
    startUnwound(state);
  }
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
  if (!state.running) {
    return;
  }
  const dt = state.lastTime ? Math.min((time - state.lastTime) / 1000, PHYSICS.substepClamp) : 1 / 60;
  state.lastTime = time;

  updateScene(state, dt);
  drawScene(state);
  syncGlyphs(state);
  state.rafId = requestAnimationFrame((nextTime) => tick(state, nextTime));
}

function updateScene(state, dt) {
  const bounds = getBounds(state);
  if (state.stage === "hanging" && state.hangingScene) {
    stepChains(state.hangingScene.letters, dt, bounds, PHYSICS.hangingIterations, true, state.hangingScene.anchor);
  }
  if (state.stage === "unwound" && state.runScene) {
    for (const item of state.runScene.items) {
      stepRunItem(item, dt, bounds);
    }
  }
}

function drawScene(state) {
  const ctx = state.ctx;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (state.stage === "hanging" && state.hangingScene) {
    drawHangingScene(ctx, state.hangingScene);
  }
  if (state.stage === "unwound" && state.runScene) {
    for (const item of state.runScene.items) {
      drawRunItem(ctx, item);
    }
  }
}

function syncGlyphs(state) {
  if (state.stage === "hanging" && state.hangingScene) {
    syncNodes(state.hangingScene.fixedGlyphs);
    syncNodes(state.hangingScene.letters);
  }
  if (state.stage === "unwound" && state.runScene) {
    for (const item of state.runScene.items) {
      syncNodes(item.nodes);
    }
  }
}

function syncNodes(nodes) {
  for (const node of nodes) {
    if (!node.el) {
      continue;
    }
    node.el.style.transform = `translate(${node.x - node.width / 2}px, ${node.y - node.height / 2}px)`;
    node.el.style.visibility = node.draw ? "visible" : "hidden";
  }
}

function clearGlyphLayer(state) {
  state.glyphLayer.textContent = "";
}

function buildHangingScene(linkedInGlyphs, glyphLayer) {
  const fixedGlyphs = linkedInGlyphs.slice(0, 4).map((glyph) => createNode(glyph, glyphLayer));
  const detachedGlyphs = linkedInGlyphs.slice(4).map((glyph) => createNode(glyph, glyphLayer));

  const anchorSource = fixedGlyphs[fixedGlyphs.length - 1];
  const anchor = {
    x: anchorSource.x,
    y: anchorSource.y,
    pinned: true
  };

  for (let index = 0; index < detachedGlyphs.length; index += 1) {
    const previous = index === 0 ? anchor : detachedGlyphs[index - 1];
    detachedGlyphs[index].restLength = distance(previous.x, previous.y, detachedGlyphs[index].x, detachedGlyphs[index].y);
  }

  return {
    anchor,
    fixedGlyphs,
    letters: detachedGlyphs
  };
}

function buildRunItem(element, glyphLayer) {
  const glyphs = collectElementGlyphs(element);
  if (!glyphs.length) {
    return null;
  }

  const nodes = glyphs.map((glyph, index) => createNode({
    ...glyph,
    homeX: glyph.x,
    homeY: glyph.y,
    homeLocked: true,
    index
  }, glyphLayer));

  for (let index = 0; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    nodes[index].prev = previous || null;
    if (previous) {
      previous.next = nodes[index];
      nodes[index].restLength = distance(previous.x, previous.y, nodes[index].x, nodes[index].y);
    } else {
      nodes[index].restLength = 0;
    }
  }

  return {
    element,
    nodes
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

      const metrics = getTextRect(textNode, start, end);
      if (!metrics) {
        continue;
      }

      glyphs.push({
        char: grapheme,
        text: normalizeGlyphText(grapheme),
        x: metrics.left + metrics.width / 2,
        y: metrics.top + metrics.height / 2,
        width: Math.max(metrics.width, 1),
        height: Math.max(metrics.height, 1),
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

function createNode(options, glyphLayer) {
  const el = document.createElement("span");
  el.className = "puzzle-glyph";
  el.textContent = options.text ?? options.char;
  el.style.width = `${options.width}px`;
  el.style.height = `${options.height}px`;
  applyTextStyles(el, options.style);
  glyphLayer.append(el);

  return {
    x: options.x,
    y: options.y,
    prevX: options.x,
    prevY: options.y,
    width: options.width,
    height: options.height,
    char: options.char,
    draw: options.draw ?? true,
    pinned: options.pinned ?? false,
    restLength: options.restLength ?? options.width,
    homeX: options.homeX ?? options.x,
    homeY: options.homeY ?? options.y,
    homeLocked: options.homeLocked ?? false,
    prev: null,
    next: null,
    index: options.index ?? 0,
    el
  };
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

function stepChains(nodes, dt, bounds, iterations, hangingOnly, anchor = null) {
  const ceiling = bounds.ceiling;
  const floor = bounds.floor;
  const walls = bounds.walls;

  for (const node of nodes) {
    if (node.pinned) {
      continue;
    }
    const velocityX = (node.x - node.prevX) * PHYSICS.damping;
    const velocityY = (node.y - node.prevY) * PHYSICS.damping;
    node.prevX = node.x;
    node.prevY = node.y;
    node.x += velocityX;
    node.y += velocityY + PHYSICS.gravity * dt * dt;
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < nodes.length; index += 1) {
      const current = nodes[index];
      const previous = index === 0 && hangingOnly ? anchor : nodes[index - 1];

      if (!previous) {
        continue;
      }
      solveDistance(previous, current, current.restLength);
    }

    for (const node of nodes) {
      if (node.pinned) {
        continue;
      }
      constrainNode(node, ceiling, floor, walls, hangingOnly);
    }
  }
}

function stepRunItem(item, dt, bounds) {
  const ceiling = bounds.ceiling;
  const floor = bounds.floor;
  const walls = bounds.walls;

  for (const node of item.nodes) {
    if (node.pinned || node.homeLocked) {
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

  for (let iteration = 0; iteration < PHYSICS.unwoundIterations; iteration += 1) {
    for (let index = 1; index < item.nodes.length; index += 1) {
      const previous = item.nodes[index - 1];
      const current = item.nodes[index];
      solveDistance(previous, current, current.restLength);
    }

    for (const node of item.nodes) {
      if (node.pinned || node.homeLocked) {
        node.x = node.homeX;
        node.y = node.homeY;
        continue;
      }
      constrainNode(node, ceiling, floor, walls, false);
    }
  }

  propagateRelease(item.nodes);
}

function propagateRelease(nodes) {
  for (const node of nodes) {
    if (!node.homeLocked) {
      continue;
    }

    const prevStretch = getEdgeStretch(node.prev, node);
    const nextStretch = getEdgeStretch(node, node.next);
    if (Math.max(prevStretch, nextStretch) < PHYSICS.releaseStretch) {
      continue;
    }

    unlockNode(node);
    if (node.prev && node.prev.homeLocked && prevStretch >= PHYSICS.releaseStretch + 0.05) {
      unlockNode(node.prev);
    }
    if (node.next && node.next.homeLocked && nextStretch >= PHYSICS.releaseStretch + 0.05) {
      unlockNode(node.next);
    }
  }
}

function getEdgeStretch(a, b) {
  if (!a || !b) {
    return 0;
  }
  const rest = Math.max(b.restLength, 0.0001);
  const current = distance(a.x, a.y, b.x, b.y);
  return current / rest;
}

function unlockNode(node, immediate = false) {
  if (!node || !node.homeLocked) {
    return;
  }

  node.homeLocked = false;
  if (immediate) {
    return;
  }

  const velocityX = node.x - node.prevX;
  const velocityY = node.y - node.prevY;
  node.prevX = node.x - velocityX * PHYSICS.releaseImpulse;
  node.prevY = node.y - velocityY * PHYSICS.releaseImpulse;
}

function solveDistance(a, b, targetLength) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const diff = (dist - targetLength) / dist;

  const aLocked = a.pinned || a.homeLocked;
  const bLocked = b.pinned || b.homeLocked;

  if (aLocked && bLocked) {
    return;
  }

  if (aLocked) {
    b.x -= dx * diff;
    b.y -= dy * diff;
    return;
  }

  if (bLocked) {
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

function constrainNode(node, ceiling, floor, walls, hangingOnly) {
  const radius = Math.max(node.width * 0.45, 4);
  const velocityX = node.x - node.prevX;
  const velocityY = node.y - node.prevY;

  if (!hangingOnly && node.x - radius < walls.left) {
    node.x = walls.left + radius;
    node.prevX = node.x + velocityX * PHYSICS.restitution;
  } else if (!hangingOnly && node.x + radius > walls.right) {
    node.x = walls.right - radius;
    node.prevX = node.x + velocityX * PHYSICS.restitution;
  }

  if (!hangingOnly && node.y - radius < ceiling) {
    node.y = ceiling + radius;
    node.prevY = node.y + velocityY * PHYSICS.restitution;
  } else if (node.y + radius > floor) {
    node.y = floor - radius;
    node.prevY = node.y + velocityY * PHYSICS.restitution;
    node.prevX = node.x - velocityX * PHYSICS.floorFriction;
  }
}

function drawHangingScene(ctx, scene) {
  if (!scene.fixedGlyphs.length) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = getComputedStyle(scene.fixedGlyphs[0].el).color || "currentColor";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let previousX = scene.anchor.x;
  let previousY = scene.anchor.y;
  for (const node of scene.letters) {
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(node.x, node.y);
    previousX = node.x;
    previousY = node.y;
  }
  ctx.stroke();
  ctx.restore();
}

function drawRunItem(ctx, item) {
  const visibleNodes = item.nodes.filter((node) => node.draw);
  if (visibleNodes.length < 2) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = getComputedStyle(visibleNodes[0].el).color || "currentColor";
  ctx.lineWidth = 0.9;
  ctx.beginPath();

  let penDown = false;
  for (const node of item.nodes) {
    if (!node.draw) {
      penDown = false;
      continue;
    }

    if (!penDown) {
      ctx.moveTo(node.x, node.y);
      penDown = true;
      continue;
    }
    ctx.lineTo(node.x, node.y);
  }

  ctx.stroke();
  ctx.restore();
}

function getBounds(state) {
  const ceilingRect = state.boundsSources.ceiling.getBoundingClientRect();
  const floorRect = state.boundsSources.floor.getBoundingClientRect();
  const wallRect = state.boundsSources.walls.getBoundingClientRect();
  return {
    ceiling: ceilingRect.bottom,
    floor: floorRect.top,
    walls: {
      left: wallRect.left,
      right: wallRect.right
    }
  };
}

function handlePointerDown(state, event) {
  if (state.stage === "static") {
    return;
  }

  const target = findNearestNode(state, event.clientX, event.clientY);
  if (!target) {
    return;
  }

  state.pointerId = event.pointerId;
  state.pointerStartX = event.clientX;
  state.pointerStartY = event.clientY;
  state.grabTarget = target;
  state.dragDistance = 0;
  state.grabOffsetX = target.x - event.clientX;
  state.grabOffsetY = target.y - event.clientY;
  state.canvas.setPointerCapture(event.pointerId);

  if (state.stage === "unwound") {
    unlockNode(target, true);
  }
}

function handlePointerMove(state, event) {
  if (state.pointerId !== event.pointerId || !state.grabTarget) {
    return;
  }

  const nextX = event.clientX + state.grabOffsetX;
  const nextY = event.clientY + state.grabOffsetY;
  state.dragDistance = distance(state.pointerStartX, state.pointerStartY, event.clientX, event.clientY);

  if (state.stage === "hanging" && state.dragDistance > PHYSICS.dragThreshold) {
    const transition = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      text: state.grabTarget.char
    };
    startUnwound(state, transition);
    state.canvas.setPointerCapture(event.pointerId);
  }

  if (!state.grabTarget) {
    return;
  }

  state.grabTarget.x = nextX;
  state.grabTarget.y = nextY;
  syncGlyphs(state);
}

function releasePointer(state) {
  if (state.pointerId !== null && state.canvas.hasPointerCapture(state.pointerId)) {
    state.canvas.releasePointerCapture(state.pointerId);
  }
  if (state.grabTarget && state.stage === "unwound" && !state.grabTarget.pinned) {
    state.grabTarget.prevX = state.grabTarget.x;
    state.grabTarget.prevY = state.grabTarget.y;
  }
  state.pointerId = null;
  state.grabTarget = null;
  state.dragDistance = 0;
}

function findNearestNode(state, x, y) {
  const pools = [];
  if (state.stage === "hanging" && state.hangingScene) {
    pools.push(...state.hangingScene.letters);
  }
  if (state.stage === "unwound" && state.runScene) {
    for (const item of state.runScene.items) {
      pools.push(...item.nodes.filter((node) => node.draw));
    }
  }

  let winner = null;
  let bestDistance = PHYSICS.grabRadius;
  for (const node of pools) {
    const d = distance(node.x, node.y, x, y);
    if (d < bestDistance) {
      bestDistance = d;
      winner = node;
    }
  }
  return winner;
}

function findTransitionNode(items, text, x, y) {
  const candidates = [];
  for (const item of items) {
    for (const node of item.nodes) {
      if (node.char === text && node.draw) {
        candidates.push(node);
      }
    }
  }

  if (!candidates.length) {
    return findClosestDrawnNode(items, x, y);
  }

  let winner = null;
  let bestDistance = Infinity;
  for (const node of candidates) {
    const d = distance(node.x, node.y, x, y);
    if (d < bestDistance) {
      bestDistance = d;
      winner = node;
    }
  }
  return winner;
}

function findClosestDrawnNode(items, x, y) {
  let winner = null;
  let bestDistance = Infinity;
  for (const item of items) {
    for (const node of item.nodes) {
      if (!node.draw) {
        continue;
      }
      const d = distance(node.x, node.y, x, y);
      if (d < bestDistance) {
        bestDistance = d;
        winner = node;
      }
    }
  }
  return winner;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

document.addEventListener("DOMContentLoaded", initPuzzle);
