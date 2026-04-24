const PHYSICS = {
  gravity: 900,
  damping: 0.992,
  hangingIterations: 4,
  unwoundIterations: 6,
  restitution: 0.4,
  floorFriction: 0.85,
  grabRadius: 24,
  dragThreshold: 20,
  substepClamp: 1 / 30
};

/**
 * Initialize the landing-page puzzle if all required elements are present.
 */
function initPuzzle() {
  const main = document.querySelector("main[data-puzzle-stage]");
  const trigger = document.querySelector("[data-puzzle-trigger]");
  const proseLinkedIn = document.querySelector("[data-puzzle-linkedin]");
  const canvas = document.querySelector("[data-puzzle-canvas]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const ceiling = document.querySelector("[data-puzzle-ceiling]");
  const floor = document.querySelector("[data-puzzle-floor]");
  const walls = document.querySelector("[data-puzzle-walls]");

  if (!main || !trigger || !proseLinkedIn || !canvas || !resetButton || !ceiling || !floor || !walls) {
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
    resetButton,
    boundsSources: { ceiling, floor, walls },
    stage: "static",
    running: false,
    rafId: 0,
    lastTime: 0,
    pointerId: null,
    dragDistance: 0,
    grabTarget: null,
    grabOffsetX: 0,
    grabOffsetY: 0,
    hiddenElements: new Set(),
    hangingScene: null,
    runScene: null,
    measureText: null
  };

  Promise.all([loadPretextMeasure(), document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve()])
    .then(([measureText]) => {
      state.measureText = measureText;
      bindEvents(state);
    })
    .catch(() => {
      state.measureText = createCanvasMeasure();
      bindEvents(state);
    });
}

/**
 * Try loading a pinned Pretext build from esm.sh and fall back to canvas text measurement.
 * Conservative default: canvas metrics are the baseline path if import shape or network differs.
 * @returns {Promise<(font: string, text: string) => number>}
 */
async function loadPretextMeasure() {
  try {
    const mod = await import("https://esm.sh/pretext@0.0.4");
    const candidate = mod?.default ?? mod?.Pretext ?? mod;
    if (typeof candidate === "function") {
      return createPretextMeasure(candidate);
    }
    if (candidate && typeof candidate.measureText === "function") {
      return (font, text) => {
        const result = candidate.measureText(text, { font });
        return typeof result === "number" ? result : Number(result?.width) || 0;
      };
    }
    console.warn("Puzzle: Pretext import succeeded but no compatible API was found. Falling back to canvas.measureText.");
  } catch (error) {
    console.warn("Puzzle: unable to load Pretext from esm.sh, using canvas.measureText fallback.", error);
  }
  return createCanvasMeasure();
}

/**
 * Create a measurement function using a Pretext constructor-style API.
 * @param {Function} PretextCtor
 * @returns {(font: string, text: string) => number}
 */
function createPretextMeasure(PretextCtor) {
  const cache = new Map();
  return (font, text) => {
    const key = `${font}::${text}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    let width = 0;
    try {
      const instance = new PretextCtor({ font, text });
      width = Number(instance?.width ?? instance?.measure?.().width ?? 0);
    } catch (error) {
      width = 0;
    }

    if (!width) {
      width = createCanvasMeasure()(font, text);
    }
    cache.set(key, width);
    return width;
  };
}

function createCanvasMeasure() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  return (font, text) => {
    if (!ctx) {
      return text.length * 8;
    }
    ctx.font = font;
    return ctx.measureText(text).width;
  };
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
  const linkedInMetrics = getInlineTextMetrics(state.proseLinkedIn, state.measureText);
  if (!linkedInMetrics) {
    return;
  }

  setCanvasActive(state, true);
  setHidden(state, state.proseLinkedIn, true);

  state.hangingScene = buildHangingScene(state, linkedInMetrics);
  state.runScene = null;
  state.stage = "hanging";
  state.main.dataset.puzzleStage = "hanging";
  state.resetButton.hidden = false;
  startLoop(state);
}

function startUnwound(state) {
  const runs = [...state.main.querySelectorAll("[data-puzzle-run]")];
  const items = runs
    .map((element) => buildRunItem(element, state.measureText))
    .filter(Boolean);

  if (!items.length) {
    return;
  }

  for (const item of items) {
    setHidden(state, item.element, true);
  }

  state.runScene = { items };
  state.stage = "unwound";
  state.main.dataset.puzzleStage = "unwound";
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
  setCanvasActive(state, false);
  state.resetButton.hidden = true;
  stopLoop(state);
}

function setCanvasActive(state, active) {
  state.canvas.hidden = !active;
  state.canvas.classList.toggle("is-active", active);
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
    resetPuzzle(state);
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
  state.rafId = requestAnimationFrame((nextTime) => tick(state, nextTime));
}

function updateScene(state, dt) {
  const bounds = getBounds(state);
  if (state.stage === "hanging" && state.hangingScene) {
    stepChains(state.hangingScene.letters, dt, bounds, PHYSICS.hangingIterations, true, state.hangingScene.anchor);
  }
  if (state.stage === "unwound" && state.runScene) {
    for (const item of state.runScene.items) {
      stepChains(item.nodes, dt, bounds, PHYSICS.unwoundIterations, false);
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

function buildHangingScene(state, metrics) {
  const detached = "edIn";
  const fixed = "Link";
  const linkWidth = state.measureText(metrics.font, fixed);
  const detachedWidths = [...detached].map((char) => state.measureText(metrics.font, char));
  const anchorX = metrics.left + linkWidth;
  const baselineY = metrics.baseline;
  const nodes = [];
  const spacing = 2;
  let x = anchorX;

  for (let index = 0; index < detached.length; index += 1) {
    const width = detachedWidths[index];
    const node = createNode(x + width / 2, baselineY - metrics.fontSize * 0.7, width, detached[index]);
    nodes.push(node);
    x += width + spacing;
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const previous = index === 0 ? { x: anchorX, y: baselineY - metrics.fontSize * 0.7, pinned: true } : nodes[index - 1];
    nodes[index].restLength = distance(previous.x, previous.y, nodes[index].x, nodes[index].y);
  }

  return {
    font: metrics.font,
    color: metrics.color,
    fixedText: fixed,
    fixedX: metrics.left,
    baselineY,
    anchorX,
    anchorY: baselineY - metrics.fontSize * 0.7,
    glyphOffsetY: metrics.fontSize * 0.22,
    anchor: { x: anchorX, y: baselineY - metrics.fontSize * 0.7, pinned: true },
    letters: nodes
  };
}

function buildRunItem(element, measureText) {
  const metrics = getBlockTextMetrics(element);
  if (!metrics || !metrics.text.trim()) {
    return null;
  }

  const chars = [];
  let cursorX = metrics.left;
  const gap = 0.5;

  for (const char of metrics.text) {
    const width = char === " " ? measureText(metrics.font, " ") : measureText(metrics.font, char);
    const node = createNode(cursorX + width / 2, metrics.baseline - metrics.fontSize * 0.7, width, char);
    chars.push(node);
    cursorX += width + gap;
  }

  for (let index = 1; index < chars.length; index += 1) {
    chars[index].restLength = distance(chars[index - 1].x, chars[index - 1].y, chars[index].x, chars[index].y);
  }

  const scatter = Math.min(10, metrics.fontSize * 0.35);
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index].char === " ") {
      continue;
    }
    chars[index].prevX -= (Math.random() - 0.5) * scatter;
    chars[index].prevY -= Math.random() * scatter;
  }

  return {
    element,
    font: metrics.font,
    color: metrics.color,
    glyphOffsetY: metrics.fontSize * 0.22,
    nodes: chars
  };
}

function getInlineTextMetrics(element, measureText) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const style = getComputedStyle(element);
  const font = style.font;
  const fontSize = parseFloat(style.fontSize) || 16;
  const width = measureText(font, element.textContent || "");
  return {
    left: rect.left + (rect.width - width) / 2,
    baseline: rect.top + rect.height * 0.78,
    font,
    fontSize,
    color: style.color
  };
}

function getBlockTextMetrics(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const style = getComputedStyle(element);
  return {
    left: rect.left,
    baseline: rect.top + rect.height * 0.8,
    font: style.font,
    fontSize: parseFloat(style.fontSize) || 16,
    color: style.color,
    text: normalizeWhitespace(element.textContent || "")
  };
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function createNode(x, y, width, char) {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    width,
    char,
    restLength: width
  };
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
      const previous = index === 0 && hangingOnly
        ? anchor
        : nodes[index - 1];

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

function solveDistance(a, b, targetLength) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const diff = (dist - targetLength) / dist;

  if (a.pinned) {
    b.x -= dx * diff;
    b.y -= dy * diff;
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
  ctx.save();
  ctx.font = scene.font;
  ctx.fillStyle = scene.color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(scene.fixedText, scene.fixedX, scene.baselineY);

  ctx.strokeStyle = scene.color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let previousX = scene.anchorX;
  let previousY = scene.anchorY;
  for (const node of scene.letters) {
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(node.x, node.y);
    previousX = node.x;
    previousY = node.y;
  }
  ctx.stroke();

  for (const node of scene.letters) {
    ctx.fillText(node.char, node.x - node.width / 2, node.y + scene.glyphOffsetY);
  }
  ctx.restore();
}

function drawRunItem(ctx, item) {
  ctx.save();
  ctx.font = item.font;
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";
  for (const node of item.nodes) {
    if (node.char === " ") {
      continue;
    }
    ctx.fillText(node.char, node.x - node.width / 2, node.y + item.glyphOffsetY);
  }
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
  state.grabTarget = target;
  state.dragDistance = 0;
  state.grabOffsetX = target.x - event.clientX;
  state.grabOffsetY = target.y - event.clientY;
  state.canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(state, event) {
  if (state.pointerId !== event.pointerId || !state.grabTarget) {
    return;
  }

  const nextX = event.clientX + state.grabOffsetX;
  const nextY = event.clientY + state.grabOffsetY;
  state.dragDistance += Math.hypot(nextX - state.grabTarget.x, nextY - state.grabTarget.y);
  state.grabTarget.x = nextX;
  state.grabTarget.y = nextY;

  if (state.stage === "hanging" && state.dragDistance > PHYSICS.dragThreshold) {
    releasePointer(state);
    startUnwound(state);
  }
}

function releasePointer(state) {
  if (state.pointerId !== null && state.canvas.hasPointerCapture(state.pointerId)) {
    state.canvas.releasePointerCapture(state.pointerId);
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
      pools.push(...item.nodes.filter((node) => node.char !== " "));
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

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

document.addEventListener("DOMContentLoaded", initPuzzle);
