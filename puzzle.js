import { prepareWithSegments, layoutWithLines } from "./pretext.js";

const PHYSICS = {
  // Velocity retention each step (lower = settles faster, higher = more wiggle).
  damping: 0.97,
  // Downward acceleration applied to unlocked glyphs every step.
  gravity: 0.22,
  // Constraint-solver passes per step (higher = stiffer/less stretch, more CPU).
  iterations: 12,
  // Rest-length multiplier for link constraints (1.0 taut, >1 looser chain).
  // 1.2 gives the chain ~20% slack so a hanging tail can droop a few px under
  // gravity without the solver yanking it back to the reading line.
  constraintStretch: 1.2,
  // Extra stretch required before a locked neighbor auto-unlocks.
  unlockThreshold: 1,
  // Pointer travel required before a grabbed locked glyph detaches.
  dragUnlockThreshold: 9,
  // Energy kept when hitting walls (higher = more rebound).
  bounce: 0.4,
  // Fraction of constraint-induced motion treated as real velocity (0 = none, 1 = all).
  // Lowering kills "constraint-ghost velocity" that makes chains keep twisting.
  constraintVelocityKeep: 0.25,
  // Per-step impulse cap when separating non-adjacent colliding glyphs in a scene.
  collisionSeparationCap: 0.35,
  // Collision sphere radius around each glyph center.
  collisionRadius: 7,
  // Physics simulation step (seconds). Fixed for stable Verlet behavior.
  fixedStep: 1 / 120,
  // Per-letter velocity (px/step) below which the letter counts as still.
  sleepVelocity: 0.06,
  // Consecutive still ticks needed before a scene goes to sleep.
  sleepFrames: 90,
  // Clamp for large frame gaps to avoid simulation explosions.
  maxFrame: 1 / 20,
  // Initial per-glyph sag offset for data-puzzle-drop scenes.
  tailSagStep: 3.5,
  // Separator spring stiffness (higher = stronger pull back to rest).
  separatorSpringK: 0.2,
  // Separator velocity damping (lower = settles faster).
  separatorDamping: 0.82,
  // Contribution of each unlocked glyph to separator "weight."
  separatorGlyphMass: 0.35,
  // Ceiling spring stiffness (higher = more resistance).
  ceilingSpringK: 0.2,
  // Ceiling spring damping (lower = settles faster).
  ceilingDamping: 0.82,
  // Contribution of each contacting glyph to ceiling load.
  ceilingGlyphMass: 0.35,
  // Downward spring displacement (px) required to count as solved.
  ceilingSolveDisplacement: 14,
  // Consecutive simulation ticks above threshold before reveal.
  ceilingSolveHoldTicks: 20,
  // Invisible body thickness around each 1px line. Tunable after testing.
  lineCollisionThickness: 6,
  // Open-end clearance so words can route around line ends. Tunable after testing.
  lineEndClearance: 9,
  // Gravity applied to a snapped header line body.
  snappedLineGravity: 0.18,
  // Velocity retention for the snapped line body.
  snappedLineDamping: 0.985,
  // Converts off-center overload into initial angular velocity.
  snappedLineTorqueScale: 0.0008,
  // Below this linear/angular speed, the snapped line can sleep after landing.
  snappedLineSleepVelocity: 0.08,
  // Reveal: calmer than full rigid-body, but still damped and angle-limited.
  snappedLineRevealAngularDamping: 0.68,
  snappedLineRevealMaxAngle: 0.36,
  // Extra damping on horizontal spin only during reveal (keeps a smooth fall).
  snappedLineRevealLateralDamping: 0.92,
  snappedLineRevealSpinDamping: 0.9,
  // When glyphs depenetrate the snapped line, push the bar back (reaction) so
  // the line does not look weightless.
  snappedLineGlyphReactionLinear: 0.014,
  snappedLineGlyphReactionTorque: 0.00045,
  snappedLineGlyphReactionMaxDV: 0.12,
  snappedLineGlyphReactionMaxDomega: 0.02,
  // Weaker reactions while the line is in the long reveal (less wiggle, still responsive).
  snappedLineGlyphReactionRevealLinearScale: 0.5,
  snappedLineGlyphReactionRevealTorqueScale: 0.38,
  // Added to `gravity` for letters/line while sweeping (keeps a brisk exit).
  revealSweepExtraGravity: 0.1,
  // Minimum ticks the reveal stays in the unwind phase once it starts.
  revealUnravelMinTicks: 150,
  // Delay opacity fade so the falling glyphs and line are visible first.
  revealSweepFadeStartTicks: 240,
  // Minimum ticks spent sweeping before quotes can fade in.
  revealSweepMinTicks: 420,
  // Fallback ticks before revealing even if a long chain is still visible.
  revealSweepMaxTicks: 720,
  // How far below the viewport glyphs should be before the reward appears.
  revealOffscreenMargin: 36
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

const FAVORITE_QUOTES = [
  "Everything should be made as simple as possible, but not simpler. - Albert Einstein",
  "The man who moves a mountain begins by carrying away small stones. - Confucius",
  "Chance favors the prepared mind. - Louis Pasteur",
  "In the middle of difficulty lies opportunity. - Albert Einstein",
  "We are what we repeatedly do. Excellence, then, is not an act but a habit. - Will Durant",
  "What I cannot create, I do not understand. - Richard Feynman",
  "First, solve the problem. Then, write the code. - John Johnson",
  "All models are wrong, but some are useful. - George Box"
];

function boot() {
  const main = document.querySelector("main[data-puzzle-stage]");
  const trigger = document.querySelector("[data-puzzle-trigger]");
  const glyphLayer = document.querySelector("[data-puzzle-glyph-layer]");
  const resetButton = document.querySelector("[data-puzzle-reset]");
  const walls = document.querySelector("[data-puzzle-walls]");
  const separator = document.querySelector("[data-puzzle-separator]");
  const ceiling = document.querySelector("[data-puzzle-ceiling]");
  const reward = document.querySelector("[data-puzzle-reward]");
  const featuredQuote = document.querySelector("[data-puzzle-featured-quote]");
  const quoteStack = document.querySelector("[data-puzzle-quote-stack]");

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
    ceiling,
    reward,
    featuredQuote,
    quoteStack,
    stage: "static",
    scenes: [],
    prepared: false,
    running: false,
    rafId: 0,
    accumulator: 0,
    lastTime: -1,
    drags: new Map(),
    separatorDisplacement: 0,
    separatorVelocity: 0,
    ceilingDisplacement: 0,
    ceilingVelocity: 0,
    ceilingSolveTicks: 0,
    topLineSnapped: false,
    snappedTopLine: null,
    revealPhase: "idle",
    revealTicks: 0,
    revealScrollLocked: false,
    revealScrollY: 0,
    revealLayoutTimer: 0,
    rewardUnlocked: false
  };

  initRewardContent(state);
  bindEvents(state);
  installPointerDelegation(state);
  prepareWhenReady();
}

function initRewardContent(state) {
  if (!state.reward || !state.featuredQuote || !state.quoteStack) {
    return;
  }
  state.featuredQuote.textContent = FAVORITE_QUOTES[0];
  state.quoteStack.textContent = "";
  for (let i = 1; i < FAVORITE_QUOTES.length; i += 1) {
    const item = document.createElement("li");
    item.textContent = FAVORITE_QUOTES[i];
    state.quoteStack.appendChild(item);
  }
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
      startUnravelAllScenes(state);
    } else if (e.key === "~" && state.stage === "active") {
      forcePuzzleReveal(state);
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
  state.rewardUnlocked = false;
  state.ceilingSolveTicks = 0;
  hideReward(state);

  for (const el of state.walls.querySelectorAll("[data-puzzle-run]")) {
    el.dataset.puzzleHidden = "";
  }

  state.glyphLayer.hidden = false;
  for (const scene of state.scenes) {
    for (const letter of scene.letters) {
      setLetterInteractive(letter, true);
    }
  }
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
  state.ceilingDisplacement = 0;
  state.ceilingVelocity = 0;
  state.ceilingSolveTicks = 0;
  state.topLineSnapped = false;
  state.snappedTopLine = null;
  state.revealPhase = "idle";
  state.revealTicks = 0;
  unlockRevealScroll(state);
  state.revealScrollY = 0;
  clearRevealLayout(state);
  state.rewardUnlocked = false;
  if (state.separator) {
    state.separator.style.transform = "";
    state.separator.classList.remove("is-compressing");
  }
  if (state.ceiling) {
    state.ceiling.style.removeProperty("--puzzle-ceiling-offset");
    state.ceiling.style.removeProperty("--puzzle-ceiling-x-offset");
    state.ceiling.style.removeProperty("--puzzle-ceiling-rotation");
    state.ceiling.style.removeProperty("--puzzle-ceiling-opacity");
    state.ceiling.classList.remove("is-compressing");
  }
  hideReward(state);
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
      setLetterInteractive(letter, state.stage === "active");
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
  if (state.stage !== "active" || state.revealPhase !== "idle") {
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

function parseCssPxNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const letterSpacing = parseCssPxNumber(elStyle.letterSpacing);

  const prepared = prepareWithSegments(text, font, { letterSpacing });
  const { lines } = layoutWithLines(prepared, maxWidth, lineHeight);

  const styleMap = buildStyleMap(el);

  // Precompute character offset for each segment
  const segCharOffsets = new Array(prepared.segments.length);
  let off = 0;
  for (let i = 0; i < prepared.segments.length; i++) {
    segCharOffsets[i] = off;
    off += prepared.segments[i].length;
  }

  // Per-grapheme positions come from pretext's line layout. The repo disables
  // kerning on <main> (font-feature-settings: "kern" 0), so canvas measureText
  // matches browser layout. Walking pretext's `lines` and accumulating an
  // xCursor per line gives us positions that align with the hidden DOM with no
  // half-leading correction needed: the glyph layer is position:fixed and the
  // span top equals the line-box top.
  const readingPositions = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let xCursor = elRect.left;
    const y = elRect.top + li * lineHeight;

    for (let si = line.start.segmentIndex; si <= line.end.segmentIndex && si < prepared.segments.length; si++) {
      const segKind = prepared.kinds[si];
      if (segKind === "hard-break" || segKind === "soft-hyphen" || segKind === "zero-width-break") {
        continue;
      }

      const graphemes = [...graphemeSegmenter.segment(prepared.segments[si])].map((g) => g.segment);
      const startG = (si === line.start.segmentIndex) ? line.start.graphemeIndex : 0;
      const endG = (si === line.end.segmentIndex) ? line.end.graphemeIndex : graphemes.length;

      const breakable = prepared.breakableWidths[si];
      let graphemeWidths;
      if (breakable) {
        graphemeWidths = breakable;
      } else if (graphemes.length === 1) {
        graphemeWidths = [prepared.widths[si]];
      } else {
        const perG = prepared.widths[si] / graphemes.length;
        graphemeWidths = graphemes.map(() => perG);
      }

      const segCharOffset = segCharOffsets[si];

      for (let gi = startG; gi < endG; gi++) {
        const ch = graphemes[gi];
        const w = graphemeWidths[gi] || 0;
        if (w <= 0) {
          continue;
        }

        let charOffsetForG = segCharOffset;
        for (let k = 0; k < gi; k++) {
          charOffsetForG += graphemes[k].length;
        }

        const textStyles = lookupStyles(styleMap, charOffsetForG);
        readingPositions.push({
          x: xCursor,
          y,
          w,
          ch: normalizeGlyphText(ch),
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

  // Opt-in droop behavior: only the last 4 letters sag; the rest stay locked
  // as normal anchors. We give the tail a small initial offset and let the
  // constraint solver settle the chain into a tiny visible droop. constraintStretch
  // already provides a few percent of slack per link, which is enough for a
  // gentle hang without yanking the tail back onto the line.
  if (el.hasAttribute("data-puzzle-drop") && letters.length > 1) {
    const droopCount = Math.min(4, letters.length - 1);
    const tailStart = letters.length - droopCount;
    for (let si = tailStart; si < letters.length; si++) {
      const letter = letters[si];
      const sag = (si - tailStart + 1) * PHYSICS.tailSagStep;
      letter.locked = false;
      letter.x = letter.ox;
      letter.y = letter.oy + sag;
      letter.px = letter.ox;
      letter.py = letter.y - Math.max(1, sag * 0.85);
    }
  }

  return {
    letters,
    restLengths,
    lineHeight,
    style: elStyle,
    element: el,
    sleeping: false,
    idleTicks: 0,
    hasFolded: false,
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

  // Short-circuit: if every scene is sleeping with no input or separator motion,
  // skip integration entirely. We still rAF to keep the loop responsive to clicks.
  const allSleeping = allScenesSleeping(state);
  const idleSeparator = Math.abs(state.separatorVelocity) < 0.01 && state.separatorDisplacement === 0;
  const idleCeiling = Math.abs(state.ceilingVelocity) < 0.01 && state.ceilingDisplacement === 0;
  const idleSnappedLine = !state.snappedTopLine || state.snappedTopLine.sleeping;
  const idleReveal = state.revealPhase === "idle" || state.revealPhase === "revealed";
  if (allSleeping && state.drags.size === 0 && idleSeparator && idleCeiling && idleSnappedLine && idleReveal) {
    state.accumulator = 0;
    state.rafId = requestAnimationFrame((time) => tick(state, time));
    return;
  }

  state.accumulator += frameDt;

  while (state.accumulator >= PHYSICS.fixedStep) {
    simulate(state);
    state.accumulator -= PHYSICS.fixedStep;
  }

  for (const scene of state.scenes) {
    syncScene(scene);
  }

  syncLineVisuals(state);

  state.rafId = requestAnimationFrame((time) => tick(state, time));
}

function allScenesSleeping(state) {
  for (const scene of state.scenes) {
    if (!scene.sleeping || scene.unraveling) return false;
  }
  return true;
}

function isSceneAtRest(scene) {
  for (const letter of scene.letters) {
    if (letter.locked) continue;
    const vx = letter.x - letter.px;
    const vy = letter.y - letter.py;
    if (Math.hypot(vx, vy) > PHYSICS.sleepVelocity) return false;
  }
  return true;
}

function wakeScene(scene) {
  scene.sleeping = false;
  scene.idleTicks = 0;
}

function startUnravelAllScenes(state) {
  for (const scene of state.scenes) {
    wakeScene(scene);
    if (scene.unraveling) {
      continue;
    }
    scene.unraveling = true;
    scene.unravelIdx = scene.letters.length - 1;
    while (scene.unravelIdx >= 0 && !scene.letters[scene.unravelIdx].locked) {
      scene.unravelIdx--;
    }
  }
}

function syncLineVisuals(state) {
  if (state.separator) {
    state.separator.style.transform = `translateY(${state.separatorDisplacement}px)`;
    state.separator.classList.toggle("is-compressing", state.separatorDisplacement > 1);
  }

  if (!state.ceiling) {
    return;
  }

  if (state.topLineSnapped && state.snappedTopLine) {
    const attached = buildAttachedTopBar(state);
    const xOffset = state.snappedTopLine.cx - attached.cx;
    const yOffset = state.snappedTopLine.cy - attached.cy;
    state.ceiling.style.setProperty("--puzzle-ceiling-x-offset", `${xOffset}px`);
    state.ceiling.style.setProperty("--puzzle-ceiling-offset", `${yOffset}px`);
    state.ceiling.style.setProperty("--puzzle-ceiling-rotation", `${state.snappedTopLine.angle}rad`);
    state.ceiling.classList.add("is-compressing");
    return;
  }

  state.ceiling.style.setProperty("--puzzle-ceiling-x-offset", "0px");
  state.ceiling.style.setProperty("--puzzle-ceiling-offset", `${state.ceilingDisplacement}px`);
  state.ceiling.style.setProperty("--puzzle-ceiling-rotation", "0rad");
  state.ceiling.classList.toggle("is-compressing", state.ceilingDisplacement > 1);
}

// Drag-gated cascade unlock. Two complementary rules, applied symmetrically
// to forward (loose -> locked) and backward (locked -> loose) links:
//
//  1. Stretch: link distance is greater than restLength + threshold. Locked
//     end unlocks. This lets hanging tails unzip themselves as they fall.
//
//  2. Crossing: the loose letter has been pulled past the locked neighbor's
//     anchor along the chain's natural direction (dot product of the
//     loose->locked-anchor vector against the natural anchor-to-anchor
//     direction is non-positive). This catches the "pull into chain" case
//     where the link compresses or inverts -- stretch unlock alone never
//     fires there, leaving the locked side frozen.
//
// Drag-gated and no pre-positioning: newly unlocked letters keep their
// current position so the constraint solver pulls them naturally instead
// of teleporting, which is what produced the previous "shatter" feeling.
function cascadeUnzip(letters, restLengths, lineHeight) {
  const halfH = lineHeight / 2;
  // backward: locked cur with loose nxt
  for (let i = letters.length - 2; i >= 0; i -= 1) {
    const cur = letters[i];
    const nxt = letters[i + 1];
    if (!cur.locked || nxt.locked) continue;
    const cax = cur.ox + cur.w / 2;
    const cay = cur.oy + halfH;
    const naturalDx = (nxt.ox + nxt.w / 2) - cax;
    const naturalDy = (nxt.oy + halfH) - cay;
    const currentDx = (nxt.x + nxt.w / 2) - cax;
    const currentDy = (nxt.y + halfH) - cay;
    const dist = Math.hypot(currentDx, currentDy);
    const stretched = dist > restLengths[i] + PHYSICS.unlockThreshold;
    const crossed = (naturalDx * currentDx + naturalDy * currentDy) <= 0;
    if (!stretched && !crossed) continue;
    cur.locked = false;
    cur.px = cur.x;
    cur.py = cur.y - 1;
    setLetterInteractive(cur, true);
  }
  // forward: loose cur with locked nxt
  for (let i = 0; i < letters.length - 1; i += 1) {
    const cur = letters[i];
    const nxt = letters[i + 1];
    if (cur.locked || !nxt.locked) continue;
    const nax = nxt.ox + nxt.w / 2;
    const nay = nxt.oy + halfH;
    const naturalDx = (cur.ox + cur.w / 2) - nax;
    const naturalDy = (cur.oy + halfH) - nay;
    const currentDx = (cur.x + cur.w / 2) - nax;
    const currentDy = (cur.y + halfH) - nay;
    const dist = Math.hypot(currentDx, currentDy);
    const stretched = dist > restLengths[i] + PHYSICS.unlockThreshold;
    const crossed = (naturalDx * currentDx + naturalDy * currentDy) <= 0;
    if (!stretched && !crossed) continue;
    nxt.locked = false;
    nxt.px = nxt.x;
    nxt.py = nxt.y - 1;
    setLetterInteractive(nxt, true);
  }
}

function simulate(state) {
  state._tickCount = (state._tickCount || 0) + 1;

  const wallRect = state.walls.getBoundingClientRect();
  const topBar = state.topLineSnapped ? null : buildAttachedTopBar(state);
  const bottomBar = buildAttachedBottomBar(state);
  const sweepingReveal = state.revealPhase === "sweeping";
  const revealedPhase = state.revealPhase === "revealed";
  const revealKinetic =
    state.revealPhase === "unraveling" || state.revealPhase === "sweeping";
  // Only skip walls once the reward path has teleported glyphs off (revealed).
  // During unravel + sweep: letters still collide with the separator (bottom
  // line) but not the viewport bottom edge, so they can fall off-screen.
  const clearedReveal = revealedPhase;
  const collisionTopBar = sweepingReveal ? null : topBar;
  const collisionBottomBar = bottomBar;
  const allowFallThroughViewportBottom = revealKinetic;

  // Per-tick aggregate: total loose letters across all scenes, and how many
  // scenes contribute any loose letter at all. Used to (a) adaptively drop
  // constraint iteration count when the system is a heavy pile, where extra
  // stiffness is invisible but expensive, and (b) skip cross-scene collision
  // when only a single scene has loose letters (intra-scene collision already
  // covers it).
  let looseTotal = 0;
  let scenesWithLoose = 0;
  for (const scene of state.scenes) {
    let sceneLoose = 0;
    for (let i = 0; i < scene.letters.length; i += 1) {
      if (!scene.letters[i].locked) sceneLoose += 1;
    }
    if (sceneLoose > 0) scenesWithLoose += 1;
    looseTotal += sceneLoose;
  }
  let iterations = PHYSICS.iterations;
  if (looseTotal > 400) iterations = 6;
  else if (looseTotal > 200) iterations = 8;

  // Per-scene physics
  for (const scene of state.scenes) {
    const { letters, restLengths, lineHeight } = scene;
    const draggedIndexes = new Set();
    let hasDrag = false;
    for (const [, drag] of state.drags.entries()) {
      if (drag.scene === scene) {
        hasDrag = true;
        if (!drag.pendingUnlock) {
          draggedIndexes.add(drag.letterIdx);
        }
      }
    }

    // Skip the entire physics block for sleeping scenes with no input.
    if (scene.sleeping && !hasDrag && !scene.unraveling && !revealKinetic) {
      continue;
    }

    // Progressive F-key unravel: unlock one letter every 2 simulation ticks.
    // At fixedStep=1/120 that's still ~60 letters/sec (visually identical to
    // 120/sec) but it spreads the simultaneous unlock + integration spike
    // across twice as many frames so the per-frame budget never collapses.
    if (scene.unraveling && (state._tickCount & 1) === 0) {
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

    // Bidirectional cascade unlock: stretch unlock fires when a chain link is
    // overstretched, compression unlock fires when a loose letter is squashed
    // close to a locked neighbor's anchor. Drag-gated so bare clicks or
    // settling jitter never trigger it. No pre-positioning -- newly unlocked
    // letters keep their position so the constraint solver pulls them
    // naturally instead of teleporting.
    if (draggedIndexes.size > 0) {
      cascadeUnzip(letters, restLengths, lineHeight);
    }

    // Verlet integration:
    // Position is advanced using current - previous position (implicit velocity),
    // then gravity is applied. Damping scales that implicit velocity term.
    for (let index = 0; index < letters.length; index += 1) {
      const letter = letters[index];
      if (letter.locked || draggedIndexes.has(index)) {
        continue;
      }
      const vx = (letter.x - letter.px) * PHYSICS.damping;
      const vy = (letter.y - letter.py) * PHYSICS.damping;
      letter.px = letter.x;
      letter.py = letter.y;
      const g =
        state.revealPhase === "sweeping"
          ? PHYSICS.gravity + PHYSICS.revealSweepExtraGravity
          : PHYSICS.gravity;
      letter.x += vx;
      letter.y += vy + g;
    }

    // Detect "folded" state once the chain has dropped enough to overlap itself.
    // hasFolded gates the O(n^2) non-adjacent collision check for this scene.
    if (!scene.hasFolded) {
      const baseY = letters[0].oy;
      for (let index = 0; index < letters.length; index += 1) {
        if (letters[index].y > baseY + lineHeight * 1.5) {
          scene.hasFolded = true;
          break;
        }
      }
    }

    // Snapshot post-integration positions so we can isolate constraint-induced
    // displacement from real (gravity + inertia) velocity in the next step.
    for (let index = 0; index < letters.length; index += 1) {
      const letter = letters[index];
      if (letter.locked || draggedIndexes.has(index)) {
        continue;
      }
      letter._preX = letter.x;
      letter._preY = letter.y;
    }

    // Constraint solving (chain stiffness only). Intra-scene collision is
    // intentionally NOT inside this loop -- it has been moved to a single
    // pass per tick after the iterations complete. With iterations=12 that
    // cuts in-scene collision work by ~12x. Collision impulses are tiny
    // (collisionSeparationCap), so one pass per tick + next tick's Verlet
    // step is more than enough to keep glyphs separated.
    for (let iter = 0; iter < iterations; iter += 1) {
      for (let index = 0; index < letters.length - 1; index += 1) {
        solveDistance(letters[index], letters[index + 1], restLengths[index], draggedIndexes.has(index), draggedIndexes.has(index + 1), lineHeight);
      }
      if (!clearedReveal) {
        constrainLetters(
          letters,
          lineHeight,
          wallRect,
          draggedIndexes,
          collisionBottomBar,
          collisionTopBar,
          allowFallThroughViewportBottom
        );
        applyDragPositionsForScene(
          state,
          scene,
          draggedIndexes,
          collisionBottomBar,
          collisionTopBar,
          allowFallThroughViewportBottom
        );
      }
    }

    // Single intra-scene collision pass per tick. We re-run walls and drag
    // afterwards so collision pushes can't violate either invariant.
    if (scene.hasFolded) {
      solveCollisionsInScene(letters, draggedIndexes, lineHeight);
      if (!clearedReveal) {
        constrainLetters(
          letters,
          lineHeight,
          wallRect,
          draggedIndexes,
          collisionBottomBar,
          collisionTopBar,
          allowFallThroughViewportBottom
        );
        applyDragPositionsForScene(
          state,
          scene,
          draggedIndexes,
          collisionBottomBar,
          collisionTopBar,
          allowFallThroughViewportBottom
        );
      }
    }

    // Bleed off "constraint-ghost velocity": shift px/py by (1 - keep) of the
    // constraint-induced delta, so the next Verlet step does not treat the
    // solver corrections as inertia. This is what stops perpetual twist/wiggle.
    const keep = PHYSICS.constraintVelocityKeep;
    for (let index = 0; index < letters.length; index += 1) {
      const letter = letters[index];
      if (letter.locked || draggedIndexes.has(index)) {
        continue;
      }
      letter.px += (1 - keep) * (letter.x - letter._preX);
      letter.py += (1 - keep) * (letter.y - letter._preY);
    }

    // Sleep evaluation: scenes settle to "sleeping" after enough still ticks,
    // dropping their per-step cost to zero. Any drag, unravel, or wake call
    // resets the counter.
    if (!hasDrag && !scene.unraveling && isSceneAtRest(scene)) {
      scene.idleTicks += 1;
      if (scene.idleTicks > PHYSICS.sleepFrames) {
        scene.sleeping = true;
      }
    } else {
      scene.idleTicks = 0;
      scene.sleeping = false;
    }
  }

  // Cross-scene collision detection: only relevant if at least TWO scenes
  // contribute loose letters AND any of them is awake + folded. With one
  // contributor, the intra-scene pass already covers it.
  if (state.scenes.length > 1 && scenesWithLoose >= 2) {
    let anyActive = false;
    for (const scene of state.scenes) {
      if (!scene.sleeping && scene.hasFolded) {
        anyActive = true;
        break;
      }
    }
    if (anyActive) {
      solveCollisionsCross(state);
    }
  }

  updateBottomBarSpring(state, bottomBar);
  updateTopBarSpringAndSnap(state, topBar);
  updateSnappedTopLine(state, bottomBar);
  updateRevealSequence(state);
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
  // Cheap early-out: distance squared vs minDist squared avoids a sqrt for
  // every pair, and the vast majority of pairs reject here. Only call sqrt
  // when an actual overlap correction is needed.
  const minDistSq = minDist * minDist;

  for (let index = 0; index < letters.length; index += 1) {
    const a = letters[index];
    if (a.locked) {
      continue;
    }
    const aDragged = draggedIndexes.has(index);
    const acx = a.x + a.w / 2;
    const acy = a.y + lineHeight / 2;

    for (let other = index + 1; other < letters.length; other += 1) {
      if (other - index === 1) {
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
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistSq) {
        continue;
      }
      const dist = Math.sqrt(distSq) || 0.001;

      const overlap = Math.min(
        PHYSICS.collisionSeparationCap,
        (minDist - dist) / dist * 0.5
      );
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
  // Squared-distance early-out (see solveCollisionsInScene for rationale).
  const minDistSq = minDist * minDist;
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
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistSq) {
        continue;
      }
      const dist = Math.sqrt(distSq) || 0.001;
      const overlap = (minDist - dist) / dist * 0.5;
      a.x -= dx * overlap;
      a.y -= dy * overlap;
      b.x += dx * overlap;
      b.y += dy * overlap;
    }
  }
}

function buildLineBody(kind, left, right, y) {
  const width = Math.max(0, right - left);
  const thickness = PHYSICS.lineCollisionThickness;
  return {
    kind,
    left,
    right,
    width,
    cx: left + width / 2,
    cy: y,
    top: y - thickness / 2,
    bottom: y + thickness / 2,
    thickness,
    endClearance: PHYSICS.lineEndClearance
  };
}

function buildAttachedTopBar(state) {
  const span = getPuzzleLineSpan(state);
  const y = state.ceiling
    ? state.ceiling.getBoundingClientRect().bottom + state.ceilingDisplacement
    : 0;
  return buildLineBody("top", span.left, span.right, y);
}

function buildAttachedBottomBar(state) {
  const rect = state.separator?.getBoundingClientRect();
  if (!rect) {
    return null;
  }
  return buildLineBody("bottom", rect.left, rect.right, rect.top);
}

function getTopFaceLoad(scenes, bar, requireResting) {
  if (!bar) {
    return { count: 0, centerX: bar?.cx || 0 };
  }

  let count = 0;
  let weightedX = 0;
  const restThreshold = PHYSICS.sleepVelocity * 2;
  for (const scene of scenes) {
    for (const letter of scene.letters) {
      if (letter.locked || !overlapsBarFace(letter, bar)) {
        continue;
      }
      if (Math.abs((letter.y + letter.h) - bar.top) > Math.max(1.5, bar.thickness / 2)) {
        continue;
      }
      if (requireResting) {
        const speed = Math.hypot(letter.x - letter.px, letter.y - letter.py);
        if (speed > restThreshold) {
          continue;
        }
      }
      count++;
      weightedX += letter.x + letter.w / 2;
    }
  }

  return {
    count,
    centerX: count ? weightedX / count : bar.cx
  };
}

function updateBottomBarSpring(state, bottomBar) {
  if (!bottomBar) {
    return;
  }

  const load = getTopFaceLoad(state.scenes, bottomBar, false);
  const weight = load.count * PHYSICS.separatorGlyphMass * PHYSICS.gravity;
  const spring = -PHYSICS.separatorSpringK * state.separatorDisplacement;
  state.separatorVelocity = (state.separatorVelocity + weight + spring) * PHYSICS.separatorDamping;
  state.separatorDisplacement += state.separatorVelocity;
  if (state.separatorDisplacement < 0) {
    state.separatorDisplacement = 0;
    state.separatorVelocity = 0;
  }
}

function updateTopBarSpringAndSnap(state, topBar) {
  if (!topBar || state.topLineSnapped) {
    return;
  }

  const load = getTopFaceLoad(state.scenes, topBar, false);
  const weight = load.count * PHYSICS.ceilingGlyphMass * PHYSICS.gravity;
  const spring = -PHYSICS.ceilingSpringK * state.ceilingDisplacement;
  state.ceilingVelocity = (state.ceilingVelocity + weight + spring) * PHYSICS.ceilingDamping;
  state.ceilingDisplacement += state.ceilingVelocity;
  if (state.ceilingDisplacement < 0) {
    state.ceilingDisplacement = 0;
    state.ceilingVelocity = 0;
  }

  if (state.ceilingDisplacement >= PHYSICS.ceilingSolveDisplacement) {
    state.ceilingSolveTicks += 1;
  } else {
    state.ceilingSolveTicks = Math.max(0, state.ceilingSolveTicks - 2);
  }

  if (state.ceilingSolveTicks >= PHYSICS.ceilingSolveHoldTicks) {
    snapTopLine(state, topBar, load.centerX);
  }
}

function forcePuzzleReveal(state) {
  if (state.rewardUnlocked || state.revealPhase !== "idle") {
    return;
  }

  if (!state.topLineSnapped) {
    const topBar = buildAttachedTopBar(state);
    snapTopLine(state, topBar, getRevealLoadCenterX(state, topBar));
    return;
  }

  startRevealSequence(state);
}

function snapTopLine(state, topBar, loadCenterX) {
  if (state.topLineSnapped) {
    return;
  }

  const offCenter = loadCenterX - topBar.cx;
  const normalizedLoad = Math.max(-1, Math.min(1, offCenter / Math.max(1, topBar.width / 2)));
  const loadDirection = normalizedLoad === 0 ? 1 : Math.sign(normalizedLoad);
  const lateralVelocity = normalizedLoad * 0.7 + loadDirection * 0.18;
  const angularVelocity = Math.max(
    -0.075,
    Math.min(0.075, offCenter * PHYSICS.snappedLineTorqueScale + loadDirection * 0.018)
  );

  state.topLineSnapped = true;
  state.snappedTopLine = {
    cx: topBar.cx,
    cy: topBar.cy,
    width: topBar.width,
    thickness: topBar.thickness,
    angle: 0,
    vx: lateralVelocity,
    vy: Math.max(0.5, state.ceilingVelocity),
    angularVelocity,
    sleeping: false
  };
  state.ceilingDisplacement = 0;
  state.ceilingVelocity = 0;
  startRevealSequence(state);
}

function getRevealLoadCenterX(state, topBar) {
  let total = 0;
  let count = 0;
  for (const scene of state.scenes) {
    for (const letter of scene.letters) {
      if (letter.locked) {
        continue;
      }
      total += letter.x + letter.w / 2;
      count += 1;
    }
  }
  if (count > 0) {
    return total / count;
  }
  return topBar.cx + topBar.width * 0.18;
}

function startRevealSequence(state) {
  clearDrags(state);
  lockRevealLayout(state);
  lockRevealScroll(state);
  state.revealPhase = "unraveling";
  state.revealTicks = 0;
  startUnravelAllScenes(state);
}

function updateRevealSequence(state) {
  if (state.revealPhase === "idle" || state.revealPhase === "revealed") {
    return;
  }

  state.revealTicks += 1;
  maintainRevealScrollLock(state);

  if (state.revealPhase === "unraveling") {
    if (allScenesFullyUnraveled(state) && state.revealTicks >= PHYSICS.revealUnravelMinTicks) {
      state.revealPhase = "sweeping";
      state.revealTicks = 0;
      clearDrags(state);
    }
    return;
  }

  applyRevealSweepForces(state);
  const sweptLongEnough = state.revealTicks >= PHYSICS.revealSweepMinTicks;
  const sweptTooLong = state.revealTicks >= PHYSICS.revealSweepMaxTicks;
  if ((sweptLongEnough && allRevealObjectsOffscreen(state)) || sweptTooLong) {
    moveUnlockedGlyphsOffscreen(state);
    finishReveal(state);
  }
}

function allScenesFullyUnraveled(state) {
  for (const scene of state.scenes) {
    if (scene.unraveling) {
      return false;
    }
    for (const letter of scene.letters) {
      if (letter.locked) {
        return false;
      }
    }
  }
  return true;
}

function applyRevealSweepForces(state) {
  for (const scene of state.scenes) {
    scene.sleeping = false;
    scene.idleTicks = 0;
    for (const letter of scene.letters) {
      if (letter.locked) {
        continue;
      }
      letter.el.style.opacity = String(getRevealSweepOpacity(state));
      setLetterInteractive(letter, false);
    }
  }

  if (state.snappedTopLine) {
    state.snappedTopLine.sleeping = false;
    if (state.ceiling) {
      state.ceiling.style.setProperty("--puzzle-ceiling-opacity", String(getRevealSweepOpacity(state)));
    }
  }
}

function getRevealSweepOpacity(state) {
  const sweepMinTicks = PHYSICS.revealSweepMinTicks;
  const fadeStartTicks = PHYSICS.revealSweepFadeStartTicks;
  const fadeTicks = Math.max(1, sweepMinTicks - fadeStartTicks);
  const progress = Math.max(
    0,
    Math.min(1, (state.revealTicks - fadeStartTicks) / fadeTicks)
  );
  return Math.max(0, 1 - progress);
}

function allRevealObjectsOffscreen(state) {
  const threshold = window.innerHeight + PHYSICS.revealOffscreenMargin;
  for (const scene of state.scenes) {
    for (const letter of scene.letters) {
      if (!letter.locked && letter.y < threshold) {
        return false;
      }
    }
  }
  return !state.snappedTopLine || state.snappedTopLine.cy > threshold;
}

function unlockAllScenesNow(state) {
  for (const scene of state.scenes) {
    wakeScene(scene);
    scene.unraveling = false;
    scene.unravelIdx = -1;
    for (const letter of scene.letters) {
      letter.locked = false;
      setLetterInteractive(letter, false);
    }
  }
}

function moveUnlockedGlyphsOffscreen(state) {
  const y = window.innerHeight + PHYSICS.revealOffscreenMargin + 20;
  for (const scene of state.scenes) {
    scene.sleeping = true;
    scene.idleTicks = PHYSICS.sleepFrames + 1;
    for (const letter of scene.letters) {
      if (letter.locked) {
        continue;
      }
      letter.y = y;
      letter.py = y;
      letter.el.style.opacity = "0";
      setLetterInteractive(letter, false);
    }
  }
  if (state.snappedTopLine) {
    state.snappedTopLine.cy = y;
    state.snappedTopLine.vy = 0;
    state.snappedTopLine.angularVelocity = 0;
    state.snappedTopLine.sleeping = true;
  }
  if (state.ceiling) {
    state.ceiling.style.setProperty("--puzzle-ceiling-opacity", "0");
  }
  if (state.glyphLayer) {
    state.glyphLayer.hidden = true;
  }
}

function finishReveal(state) {
  state.revealPhase = "revealed";
  state.revealTicks = 0;
  const restoreY = unlockRevealScroll(state);
  if (state.main) {
    state.main.dataset.puzzleStage = "revealed";
  }
  unlockReward(state);
  settleRevealLayout(state);
  scrollRewardIntoView(state, restoreY);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function lockRevealScroll(state) {
  if (state.revealScrollLocked) {
    return;
  }

  state.revealScrollY = window.scrollY;
  state.revealScrollLocked = true;
  document.documentElement.classList.add("puzzle-scroll-lock");
  document.body.classList.add("puzzle-scroll-lock");
}

function maintainRevealScrollLock(state) {
  if (!state.revealScrollLocked) {
    return;
  }
  window.scrollTo(0, state.revealScrollY);
}

function unlockRevealScroll(state) {
  if (!state.revealScrollLocked) {
    return window.scrollY;
  }

  const restoreY = state.revealScrollY;
  state.revealScrollLocked = false;
  document.documentElement.classList.remove("puzzle-scroll-lock");
  document.body.classList.remove("puzzle-scroll-lock");
  window.scrollTo(0, restoreY);
  return restoreY;
}

function scrollRewardIntoView(state, fallbackY) {
  if (!state.reward) {
    window.scrollTo(0, fallbackY || 0);
    return;
  }

  requestAnimationFrame(() => {
    const top = state.reward.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
  });
}

function lockRevealLayout(state) {
  if (!state.walls) {
    return;
  }

  if (state.revealLayoutTimer) {
    window.clearTimeout(state.revealLayoutTimer);
    state.revealLayoutTimer = 0;
  }

  const height = Math.ceil(state.walls.getBoundingClientRect().height);
  state.walls.style.setProperty("--puzzle-reveal-min-height", `${height}px`);
  state.walls.dataset.puzzleRevealLayout = "locked";
}

function settleRevealLayout(state) {
  if (!state.walls || !state.reward) {
    clearRevealLayout(state);
    return;
  }

  window.requestAnimationFrame(() => {
    const height = Math.ceil(state.reward.getBoundingClientRect().height + 32);
    state.walls.style.setProperty("--puzzle-reveal-min-height", `${height}px`);
    state.revealLayoutTimer = window.setTimeout(() => {
      clearRevealLayout(state);
    }, prefersReducedMotion() ? 0 : 700);
  });
}

function clearRevealLayout(state) {
  if (state.revealLayoutTimer) {
    window.clearTimeout(state.revealLayoutTimer);
    state.revealLayoutTimer = 0;
  }
  if (!state.walls) {
    return;
  }
  delete state.walls.dataset.puzzleRevealLayout;
  state.walls.style.removeProperty("--puzzle-reveal-min-height");
}

function updateSnappedTopLine(state, bottomBar) {
  const bar = state.snappedTopLine;
  if (!bar || bar.sleeping) {
    return;
  }

  const sweeping = state.revealPhase === "sweeping";
  const revealActive = state.revealPhase !== "idle" && state.revealPhase !== "revealed";
  const sweepG = PHYSICS.gravity + PHYSICS.revealSweepExtraGravity;
  bar.vy += sweeping ? sweepG : PHYSICS.snappedLineGravity;
  bar.vx *= PHYSICS.snappedLineDamping;
  bar.vy *= PHYSICS.snappedLineDamping;
  bar.angularVelocity *= PHYSICS.snappedLineDamping;
  if (revealActive) {
    bar.vx *= PHYSICS.snappedLineRevealLateralDamping;
    bar.angularVelocity *= PHYSICS.snappedLineRevealSpinDamping;
  }
  bar.cx += bar.vx;
  bar.cy += bar.vy;
  bar.angle += bar.angularVelocity;
  constrainSnappedLineRevealRotation(bar, revealActive);

  collideLettersWithSnappedLine(state, bar);

  // While the reveal is running, the snapped header line passes through the
  // footer separator so it can fall off with the glyphs; only after that
  // (theory: line should be gone) would we rest on the bottom bar.
  if (!revealActive && bottomBar && snappedLineOverlapsBar(bar, bottomBar)) {
    const bottom = snappedLineBottom(bar);
    const penetration = bottom - bottomBar.top;
    if (penetration > 0) {
      const impact = Math.abs(bar.vy);
      const rollDirection = Math.sign(bar.angularVelocity || bar.vx || Math.sin(bar.angle) || 1);
      bar.cy -= penetration;
      bar.vy *= -0.28;
      bar.vx += rollDirection * Math.min(0.18, impact * 0.04);
      bar.angularVelocity = (bar.angularVelocity + rollDirection * Math.min(0.018, impact * 0.003)) * 0.78;
    }
  }

  if (
    !revealActive &&
    Math.abs(bar.vy) < PHYSICS.snappedLineSleepVelocity &&
    Math.abs(bar.angularVelocity) < PHYSICS.snappedLineSleepVelocity * 0.03 &&
    (bar.cy > window.innerHeight + 80 || (bottomBar && snappedLineBottom(bar) >= bottomBar.top - 0.5))
  ) {
    bar.sleeping = true;
    bar.vx = 0;
    bar.vy = 0;
    bar.angularVelocity = 0;
  }
}

function constrainSnappedLineRevealRotation(bar, revealActive) {
  if (!revealActive) {
    return;
  }

  bar.angularVelocity *= PHYSICS.snappedLineRevealAngularDamping;
  if (Math.abs(bar.angle) <= PHYSICS.snappedLineRevealMaxAngle) {
    return;
  }

  const direction = Math.sign(bar.angle);
  bar.angle = direction * PHYSICS.snappedLineRevealMaxAngle;
  if (Math.sign(bar.angularVelocity) === direction) {
    bar.angularVelocity = 0;
  }
}

function snappedLineBottom(bar) {
  const halfW = bar.width / 2;
  return Math.max(
    bar.cy + Math.sin(bar.angle) * halfW,
    bar.cy - Math.sin(bar.angle) * halfW
  ) + bar.thickness / 2;
}

function snappedLineOverlapsBar(line, bar) {
  const halfW = line.width / 2;
  const left = Math.min(
    line.cx - Math.cos(line.angle) * halfW,
    line.cx + Math.cos(line.angle) * halfW
  );
  const right = Math.max(
    line.cx - Math.cos(line.angle) * halfW,
    line.cx + Math.cos(line.angle) * halfW
  );
  return right > bar.left + bar.endClearance && left < bar.right - bar.endClearance;
}

function collideLettersWithSnappedLine(state, bar) {
  const halfW = bar.width / 2;
  const dx = Math.cos(bar.angle);
  const dy = Math.sin(bar.angle);
  const nx = -dy;
  const ny = dx;
  const radius = PHYSICS.collisionRadius + bar.thickness / 2;

  for (const scene of state.scenes) {
    for (const letter of scene.letters) {
      if (letter.locked) {
        continue;
      }
      const cx = letter.x + letter.w / 2;
      const cy = letter.y + letter.h / 2;
      const relX = cx - bar.cx;
      const relY = cy - bar.cy;
      const along = relX * dx + relY * dy;
      if (along < -halfW + PHYSICS.lineEndClearance || along > halfW - PHYSICS.lineEndClearance) {
        continue;
      }
      const dist = relX * nx + relY * ny;
      if (Math.abs(dist) >= radius) {
        continue;
      }
      const push = (radius - Math.abs(dist)) * (dist < 0 ? -1 : 1);
      letter.x += nx * push;
      letter.y += ny * push;
      letter.px = letter.x;
      letter.py = letter.y;
      // Equal-and-opposite to the depenetration: linear + torque (r×F) at the
      // foot of the letter onto the bar, r = along * (dx,dy), F = -(nx,ny)·f.
      const revealKinetic =
        state.revealPhase === "unraveling" || state.revealPhase === "sweeping";
      const lScale = revealKinetic ? PHYSICS.snappedLineGlyphReactionRevealLinearScale : 1;
      const tScale = revealKinetic ? PHYSICS.snappedLineGlyphReactionRevealTorqueScale : 1;
      const li = PHYSICS.snappedLineGlyphReactionLinear * lScale;
      const ti = PHYSICS.snappedLineGlyphReactionTorque * tScale;
      let dvx = -nx * push * li;
      let dvy = -ny * push * li;
      let domega = -along * push * ti;
      const vcap = PHYSICS.snappedLineGlyphReactionMaxDV;
      const wcap = PHYSICS.snappedLineGlyphReactionMaxDomega;
      dvx = Math.max(-vcap, Math.min(vcap, dvx));
      dvy = Math.max(-vcap, Math.min(vcap, dvy));
      domega = Math.max(-wcap, Math.min(wcap, domega));
      bar.vx += dvx;
      bar.vy += dvy;
      bar.angularVelocity += domega;
    }
  }
}

function constrainLetters(
  letters,
  lineHeight,
  wallRect,
  draggedIndexes,
  floorLine,
  ceilingLine,
  allowFallThroughViewportBottom = false
) {
  // letter.x / letter.y live in viewport coordinates (the glyph layer is
  // position:fixed; inset:0, so transform translate places each glyph at
  // viewport (letter.x, letter.y)). Walls are therefore the literal viewport
  // edges, recomputed from window.innerWidth/innerHeight each tick so resize
  // is automatic. The visible top/bottom lines are finite spring objects.
  void wallRect; // wallRect kept on the signature for future use; not needed here
  void draggedIndexes; // Dragged letters are constrained after pointer placement too.
  const minX = 0;
  const minY = 0;
  const maxX = window.innerWidth;
  const maxY = window.innerHeight;

  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index];
    if (letter.locked) {
      continue;
    }
    constrainLetter(
      letter,
      lineHeight,
      minX,
      minY,
      maxX,
      maxY,
      floorLine,
      ceilingLine,
      letter.px,
      letter.py,
      allowFallThroughViewportBottom
    );
  }
}

function constrainLetter(
  letter,
  lineHeight,
  minX,
  minY,
  maxX,
  maxY,
  floorLine,
  ceilingLine,
  prevX = letter.px,
  prevY = letter.py,
  allowFallThroughViewportBottom = false
) {
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
  if (!allowFallThroughViewportBottom && letter.y + lineHeight > maxY) {
    letter.y = maxY - lineHeight;
    letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
  }
  constrainLetterAgainstBar(letter, lineHeight, ceilingLine, prevX, prevY);
  constrainLetterAgainstBar(letter, lineHeight, floorLine, prevX, prevY);
}

function constrainLetterAgainstBar(letter, lineHeight, bar, prevX, prevY) {
  if (!bar || !overlapsBarFace(letter, bar)) {
    return;
  }

  const prevTop = prevY;
  const prevBottom = prevY + lineHeight;
  const currentTop = letter.y;
  const currentBottom = letter.y + lineHeight;

  if (overlapsBarFaceAt(prevX, letter.w, bar) && prevBottom <= bar.top && currentBottom > bar.top) {
    letter.y = bar.top - lineHeight;
    letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
    return;
  }
  if (overlapsBarFaceAt(prevX, letter.w, bar) && prevTop >= bar.bottom && currentTop < bar.bottom) {
    letter.y = bar.bottom;
    letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
    return;
  }

  if (currentTop < bar.bottom && currentBottom > bar.top) {
    const overlapFromTop = currentBottom - bar.top;
    const overlapFromBottom = bar.bottom - currentTop;
    if (overlapFromTop <= overlapFromBottom) {
      letter.y = bar.top - lineHeight;
    } else {
      letter.y = bar.bottom;
    }
    letter.py = letter.y + (letter.y - letter.py) * PHYSICS.bounce;
  }
}

function overlapsBarFace(letter, bar) {
  return overlapsBarFaceAt(letter.x, letter.w, bar);
}

function overlapsBarFaceAt(x, width, bar) {
  return x + width > bar.left + bar.endClearance && x < bar.right - bar.endClearance;
}

function getPuzzleLineSpan(state) {
  const separatorRect = state.separator?.getBoundingClientRect();
  if (separatorRect) {
    return { left: separatorRect.left, right: separatorRect.right };
  }

  const containerWidth = parseCssPxNumber(getComputedStyle(document.documentElement).getPropertyValue("--container")) || window.innerWidth;
  const width = Math.min(window.innerWidth, containerWidth);
  const left = (window.innerWidth - width) / 2;
  return { left, right: left + width };
}

function applyDragPositionsForScene(
  state,
  scene,
  draggedIndexes,
  floorLine,
  ceilingLine,
  allowFallThroughViewportBottom = false
) {
  const rect = state.glyphLayer.getBoundingClientRect();
  const minX = 0;
  const minY = 0;
  const maxX = window.innerWidth;
  const maxY = window.innerHeight;
  for (const [pointerId, drag] of state.drags.entries()) {
    if (drag.scene !== scene) {
      continue;
    }
    const letter = scene.letters[drag.letterIdx];
    if (!letter) {
      state.drags.delete(pointerId);
      continue;
    }
    if (drag.pendingUnlock) {
      const pullX = drag.clientX - drag.startClientX;
      const pullY = drag.clientY - drag.startClientY;
      const pullDistance = Math.hypot(pullX, pullY);
      if (pullDistance < PHYSICS.dragUnlockThreshold) {
        continue;
      }
      drag.pendingUnlock = false;
      // Promote this letter into the dragged set immediately so the rest of
      // this tick treats it as a fixed puller rather than a loose letter that
      // the solver will yank back.
      if (draggedIndexes) {
        draggedIndexes.add(drag.letterIdx);
      }
    }
    const prevX = letter.x;
    const prevY = letter.y;
    letter.x = drag.clientX - rect.left - drag.offsetX;
    letter.y = drag.clientY - rect.top - drag.offsetY;
    letter.locked = false;
    constrainLetter(
      letter,
      scene.lineHeight,
      minX,
      minY,
      maxX,
      maxY,
      floorLine,
      ceilingLine,
      prevX,
      prevY,
      allowFallThroughViewportBottom
    );
    letter.px = letter.x;
    letter.py = letter.y;
    setLetterInteractive(letter, true);
  }
}

function syncScene(scene) {
  for (const letter of scene.letters) {
    setLetterInteractive(letter, true);
    letter.el.style.transform = `translate(${letter.x}px, ${letter.y}px)`;
  }
}

function unlockReward(state) {
  state.rewardUnlocked = true;
  if (!state.reward) {
    return;
  }
  state.reward.hidden = false;
  window.requestAnimationFrame(() => {
    if (!state.rewardUnlocked || !state.reward) {
      return;
    }
    state.reward.dataset.puzzleRevealed = "true";
  });
}

function hideReward(state) {
  if (!state.reward) {
    return;
  }
  state.reward.hidden = true;
  delete state.reward.dataset.puzzleRevealed;
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
  if (!letter || state.drags.has(event.pointerId)) {
    return;
  }
  wakeScene(scene);

  const rect = state.glyphLayer.getBoundingClientRect();
  state.drags.set(event.pointerId, {
    scene,
    letterIdx,
    offsetX: event.clientX - rect.left - letter.x,
    offsetY: event.clientY - rect.top - letter.y,
    startClientX: event.clientX,
    startClientY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    pendingUnlock: letter.locked
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
